// Looks up products in the Mercado Livre product catalog by barcode to read
// the attributes it lists (for sunscreens: water resistance, oil free, tint,
// kids...), and the cheapest trustworthy offer for that catalog product. Search, single
// listings and reviews are blocked for apps like ours (403); a catalog
// product's list of offers is not.
//
// Needs ML_CLIENT_ID and ML_CLIENT_SECRET (a Mercado Livre developer app) in
// the environment or in .env; without them the lookup is skipped.

const API = 'https://api.mercadolibre.com';

export async function mercadoLivreToken() {
  try {
    process.loadEnvFile('.env');
  } catch {
    // No .env file; the variables may still come from the environment.
  }
  const { ML_CLIENT_ID: clientId, ML_CLIENT_SECRET: clientSecret } = process.env;
  if (!clientId || !clientSecret) return null;
  const response = await fetch(`${API}/oauth/token`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} from Mercado Livre token`);
  return (await response.json()).access_token;
}

const attributesOf = (result) => Object.fromEntries((result.attributes || [])
  .filter((attribute) => attribute.value_name != null)
  .map((attribute) => [attribute.id, attribute.value_name]));

// Mercado Livre answers bursts with HTTP 429; wait and try again.
async function apiFetch(token, url) {
  for (let attempt = 1; ; attempt += 1) {
    const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    if (response.status !== 429 || attempt === 4) return response;
    await new Promise((resolve) => setTimeout(resolve, 3000 * attempt));
  }
}

async function catalogSearch(token, params) {
  const url = `${API}/products/search?${new URLSearchParams({ status: 'active', site_id: 'MLB', ...params })}`;
  const response = await apiFetch(token, url);
  if (!response.ok) throw new Error(`HTTP ${response.status} from Mercado Livre catalog`);
  return (await response.json()).results || [];
}

async function withDetails(token, match) {
  const details = await fetch(`${API}/products/${match.id}`, { headers: { authorization: `Bearer ${token}` } })
    .then((response) => (response.ok ? response.json() : null)).catch(() => null);
  return {
    id: match.id,
    name: match.name,
    attributes: attributesOf(match),
    mainFeatures: (details?.main_features || []).map((feature) => feature.text).filter(Boolean),
  };
}

// Returns { id, name, attributes: { ATTRIBUTE_ID: value }, mainFeatures } for
// the catalog product with this barcode, or null. A product whose SPF
// disagrees with ours is treated as a wrong barcode and ignored.
export async function fetchCatalogProduct(token, barcode, spf) {
  const match = (await catalogSearch(token, { product_identifier: barcode })).find((result) => {
    const catalogSpf = Number(attributesOf(result).SUN_PROTECTION_FACTOR);
    return !Number.isFinite(spf) || !catalogSpf || catalogSpf === spf;
  });
  return match ? withDetails(token, match) : null;
}

// The catalog product with this barcode as { id, name, attributes }, without
// the extra request for its features.
export async function findCatalogProduct(token, barcode) {
  const match = (await catalogSearch(token, { product_identifier: barcode }))[0];
  return match ? { id: match.id, name: match.name, attributes: attributesOf(match) } : null;
}

const plain = (value) => String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const STOPWORDS = new Set(['protetor', 'solar', 'fps', 'fator', 'com', 'de', 'e', 'para', 'uva', 'uvb', 'litro', 'litros', 'ml', 'g', 'l']);
const words = (value) => new Set(plain(value).split(/[^a-z0-9]+/).filter((word) => word.length > 1 && !STOPWORDS.has(word) && !/\d/.test(word)));
// "Kit 2", "+ Repelente 200ml", or two sizes in one name mean a bundle.
const isBundle = (result) => {
  const name = plain(result.name);
  const attributes = attributesOf(result);
  return /\bkit\b|\+/.test(name) || (name.match(/\d+(?:[.,]\d+)?\s*(?:ml|l|g|litros?)\b/g) || []).length > 1
    || attributes.SALE_FORMAT === 'Kit' || Number(attributes.UNITS_PER_PACK) > 1;
};
const parseSize = (text) => {
  const match = plain(text).match(/(\d+(?:[.,]\d+)?)\s*(ml|litros?|l|g|kg)\b/);
  return match ? `${Number(match[1].replace(',', '.'))}${match[2].startsWith('litro') ? 'l' : match[2]}` : null;
};
// The size attribute is sometimes wrong, so a size in the name must agree too.
const sizeMatches = (result, size) => {
  const attributes = attributesOf(result);
  const nameSize = parseSize(result.name);
  return parseSize(attributes.NET_VOLUME || attributes.NET_WEIGHT) === size && (!nameSize || nameSize === size);
};

// For products without a barcode: searches by name and accepts only a
// single-unit listing of the same brand, SPF and size. Among those, the one
// whose name shares the most words wins, and "com repelente" must agree.
export async function searchCatalogProduct(token, product) {
  const results = await catalogSearch(token, { domain_id: 'MLB-SUNSCREENS', q: `${product.brand} ${product.name}`, limit: 20 });
  const ours = words(product.name);
  const repellent = ours.has('repelente');
  const candidates = results.filter((result) => {
    const attributes = attributesOf(result);
    return plain(`${attributes.BRAND} ${result.name}`).includes(plain(product.brand))
      && Number(attributes.SUN_PROTECTION_FACTOR) === product.spf
      && sizeMatches(result, `${product.amount}${product.unit}`)
      && words(result.name).has('repelente') === repellent
      && !isBundle(result);
  }).map((result) => {
    const theirs = words(result.name);
    return { result, score: [...ours].filter((word) => theirs.has(word)).length / Math.max(ours.size, 1) };
  }).sort((a, b) => b.score - a.score);
  return candidates.length ? withDetails(token, candidates[0].result) : null;
}

// Seller reputation colors from Mercado Livre ("5_green" is the best level).
const TRUSTED_LEVELS = new Set(['5_green', '4_light_green']);

async function sellerLevel(token, sellerId, cache) {
  if (!cache.has(sellerId)) {
    cache.set(sellerId, apiFetch(token, `${API}/users/${sellerId}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((user) => user?.seller_reputation?.level_id || null)
      .catch(() => null));
  }
  return cache.get(sellerId);
}

// Returns the cheapest new offer with free shipping from a well-rated seller,
// as { price, originalPrice, itemId, url, sellerLevel }, or null. The API
// gives no shipping cost, so offers with paid shipping are left out: their
// listed price is not what the buyer pays. An offer under a third or over
// three times the store's price is treated as a different item (a sample, a
// kit, a wrong catalog match).
export async function fetchBestOffer(token, catalogProductId, { storePrice, sellers = new Map() } = {}) {
  const response = await apiFetch(token, `${API}/products/${catalogProductId}/items`);
  if (response.status === 404) return null; // no one is selling it right now
  if (!response.ok) throw new Error(`HTTP ${response.status} from Mercado Livre offers`);
  const offers = ((await response.json()).results || [])
    .filter((offer) => offer.condition === 'new' && offer.shipping?.free_shipping && offer.currency_id === 'BRL'
      && Number(offer.price) > 0 && (offer.min_purchase_unit || 1) === 1
      && (!storePrice || (Number(offer.price) >= storePrice / 3 && Number(offer.price) <= storePrice * 3)))
    .sort((a, b) => a.price - b.price);
  for (const offer of offers) {
    const level = await sellerLevel(token, offer.seller_id, sellers);
    if (!TRUSTED_LEVELS.has(level)) continue;
    return {
      price: Number(offer.price),
      originalPrice: Number(offer.original_price) || undefined,
      itemId: offer.item_id,
      url: `https://produto.mercadolivre.com.br/${offer.item_id.replace(/^MLB/, 'MLB-')}`,
      sellerLevel: level,
    };
  }
  return null;
}
