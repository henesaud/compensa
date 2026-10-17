// Looks up sunscreens in the Mercado Livre product catalog by barcode to read
// the attributes it lists (water resistance, oil free, tint, kids...). The
// catalog has no prices or reviews for apps like ours, only product data.
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

async function catalogSearch(token, params) {
  const url = `${API}/products/search?${new URLSearchParams({ status: 'active', site_id: 'MLB', ...params })}`;
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
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
