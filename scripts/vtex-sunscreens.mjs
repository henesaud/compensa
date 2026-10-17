// Reads sunscreens from VTEX stores through their public catalog search API,
// which returns structured product data (brand, price, stock, image, and for
// some stores ingredients and texture) without rendering the page.

import { fetchKonfidencyReviews, fetchTrustvoxReviews } from './sunscreen-reviews.mjs';

export const vtexSunscreenSources = [
  // trustvoxStoreId / konfidencyCustomer: the store's id in its review
  // widget, found in the product page HTML ("storeId" next to _trustvox, or
  // the path of reviews.konfidency.com.br/<customer>/loader.js).
  { store: 'Adcos', origin: 'https://www.lojaadcos.com.br', brands: ['Adcos'], trustvoxStoreId: 719 },
  { store: 'Dermage', origin: 'https://www.dermage.com.br', brands: ['Dermage'], trustvoxStoreId: 106480 },
  {
    store: 'Drogaria São Paulo',
    origin: 'https://www.drogariasaopaulo.com.br',
    konfidencyCustomer: 'drogariasaopaulo',
    brands: ['Sundown', 'Episol', 'Cenoura e Bronze', 'Principia', 'Sallve', 'Sunless', 'Nivea', 'Anasol', 'Helioderm', 'Nutriex', 'Oaz',
      'Isdin', 'La Roche-Posay', 'Eucerin', 'Vichy', 'Avène', 'Bioderma', 'Ollie', 'Pink Cheeks', 'Mustela', 'Neutrogena',
      'Neostrata', 'Cicatricure', 'Banana Boat', 'Darrow', 'Australian Gold', "L'Oréal Paris"],
  },
];

// Brands the store sometimes files under the manufacturer's name instead.
// Those listings only count when the product name mentions the brand.
const MANUFACTURERS = {
  Sunless: ['Farmax'],
  Helioderm: ['Kley Hertz'],
  Oaz: ['Eurofarma'],
  "L'Oréal Paris": ['L Oréal'],
};
// Other spellings the store uses for the same brand.
const ALIASES = {
  'La Roche-Posay': ['La Roche'],
};

const PAGE_SIZE = 50;
const MAX_PAGES = 6;
const normalize = (value) => String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/&/g, 'e').replace(/[-'’]/g, ' ').replace(/\s+/g, ' ').trim();

// The store sometimes answers a burst of searches with HTTP 500 or 429.
async function fetchWithRetry(url) {
  for (let attempt = 1; ; attempt += 1) {
    const response = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0', accept: 'application/json' } });
    if (response.ok || attempt === 4 || ![429, 500, 502, 503].includes(response.status)) return response;
    await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
  }
}

export async function searchStore(origin, query) {
  const results = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * PAGE_SIZE;
    const url = `${origin}/api/catalog_system/pub/products/search?ft=${encodeURIComponent(query)}&_from=${from}&_to=${from + PAGE_SIZE - 1}`;
    const response = await fetchWithRetry(url);
    if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
    const batch = await response.json();
    results.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return results;
}

// Some stores (Dermage) leave the size out of the name and only mention it in
// the description, so the first "40 g" / "50 ml" found there is the fallback.
function packageSize(item, sku) {
  const nameSize = `${item.productName} ${sku.nameComplete || ''}`.match(/\d+(?:[.,]\d+)?\s*(?:ml|g)\b/i);
  if (nameSize) return nameSize[0];
  const description = `${item.description || ''} ${(item['Descrição longa'] || []).join(' ')}`.replace(/<[^>]+>/g, ' ');
  return description.match(/\d+(?:[.,]\d+)?\s*(?:ml|g)\b/i)?.[0];
}

const htmlToText = (html) => String(html || '').replace(/<br\s*\/?>|<\/p>/gi, '\n').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');

// The ingredient list sits in a store-specific field, sometimes followed by
// disclaimers starting with "*".
function ingredients(item) {
  const html = (item['Princípios Ativos'] || item.Ativos || []).join('\n');
  const lines = htmlToText(html).split('\n').map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line && !line.startsWith('*'));
  return lines.length ? lines.join('\n') : undefined;
}

function texture(item) {
  const value = item.Textura || item['Apresentação'];
  return value?.length ? value.join(', ').replace(/^em\s+/i, '') : undefined;
}

async function reviews(source, item, sku) {
  try {
    if (source.trustvoxStoreId) return await fetchTrustvoxReviews(source.trustvoxStoreId, item.productId) || undefined;
    if (source.konfidencyCustomer) return await fetchKonfidencyReviews(source.konfidencyCustomer, sku.itemId) || undefined;
    return undefined;
  } catch (error) {
    console.warn(`Could not read reviews for ${item.productName}: ${error.message}`);
    return undefined;
  }
}

// Returns raw listings ({ name, text, brand, price, url, imageUrl, details })
// for toProduct(). Kits, multi-packs and makeup with SPF are skipped. details
// holds the optional barcode, ingredients, texture and reviews.
export async function fetchVtexSunscreens(source) {
  const listings = new Map();
  for (const brand of source.brands) {
    for (const item of await searchStore(source.origin, `protetor solar ${brand.replace(/['’]/g, ' ')}`)) {
      const name = String(item.productName || '').replace(/\s+/g, ' ').trim();
      const byManufacturer = (MANUFACTURERS[brand] || []).some((maker) => normalize(item.brand) === normalize(maker))
        && normalize(name).includes(normalize(brand));
      const sameBrand = [brand, ...(ALIASES[brand] || [])].some((name) => normalize(item.brand) === normalize(name));
      if (!sameBrand && !byManufacturer) continue;
      if (!/fps\s*\d{2,3}|\d{2,3}\s*fps/i.test(name) || /\bkit\b|\+|\b\d+\s*unidades\b|\bbase\b|compact|estojo|refil|labial|l[áa]bios|batom|gloss|blush|p[óo] transl/i.test(name)) continue;
      const sku = item.items?.find((candidate) => candidate.sellers?.some((seller) => seller.commertialOffer?.AvailableQuantity > 0));
      const offer = sku?.sellers.find((seller) => seller.commertialOffer?.AvailableQuantity > 0)?.commertialOffer;
      if (!offer?.Price) continue;
      const url = `${source.origin}/${item.linkText}/p`;
      if (listings.has(url)) continue;
      listings.set(url, {
        name,
        text: packageSize(item, sku),
        brand,
        price: offer.Price,
        url,
        imageUrl: sku.images?.[0]?.imageUrl,
        details: {
          barcode: /^\d{8,14}$/.test(sku.ean || '') && !/^0+1?$/.test(sku.ean) ? sku.ean : undefined,
          ingredients: ingredients(item),
          texture: texture(item),
          reviews: await reviews(source, item, sku),
        },
      });
    }
  }
  return [...listings.values()];
}
