// Reads sunscreens from VTEX stores through their public catalog search API,
// which returns structured product data (brand, price, stock, image) without
// rendering the page.

export const vtexSunscreenSources = [
  { store: 'Adcos', origin: 'https://www.lojaadcos.com.br', brands: ['Adcos'] },
  { store: 'Dermage', origin: 'https://www.dermage.com.br', brands: ['Dermage'] },
  {
    store: 'Drogaria São Paulo',
    origin: 'https://www.drogariasaopaulo.com.br',
    brands: ['Sundown', 'Episol', 'Cenoura e Bronze', 'Principia', 'Sallve'],
  },
];

const PAGE_SIZE = 50;
const MAX_PAGES = 6;
const normalize = (value) => String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/&/g, 'e').replace(/\s+/g, ' ').trim();

async function searchStore(origin, query) {
  const results = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * PAGE_SIZE;
    const url = `${origin}/api/catalog_system/pub/products/search?ft=${encodeURIComponent(query)}&_from=${from}&_to=${from + PAGE_SIZE - 1}`;
    const response = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0', accept: 'application/json' } });
    if (!response.ok) break;
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

// Returns raw listings ({ name, text, brand, price, url, imageUrl }) for
// toProduct(). Kits, multi-packs and makeup with SPF are skipped.
export async function fetchVtexSunscreens(source) {
  const listings = new Map();
  for (const brand of source.brands) {
    for (const item of await searchStore(source.origin, `protetor solar ${brand}`)) {
      if (normalize(item.brand) !== normalize(brand)) continue;
      const name = String(item.productName || '').replace(/\s+/g, ' ').trim();
      if (!/fps\s*\d{2,3}|\d{2,3}\s*fps/i.test(name) || /\bkit\b|\+|\b\d+\s*unidades\b|\bbase\b|compact|estojo|refil/i.test(name)) continue;
      const sku = item.items?.find((candidate) => candidate.sellers?.some((seller) => seller.commertialOffer?.AvailableQuantity > 0));
      const offer = sku?.sellers.find((seller) => seller.commertialOffer?.AvailableQuantity > 0)?.commertialOffer;
      if (!offer?.Price) continue;
      const url = `${source.origin}/${item.linkText}/p`;
      listings.set(url, {
        name,
        text: packageSize(item, sku),
        brand,
        price: offer.Price,
        url,
        imageUrl: sku.images?.[0]?.imageUrl,
      });
    }
  }
  return [...listings.values()];
}
