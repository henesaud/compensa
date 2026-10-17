// Reads supplements (whey, creatine) from brand stores built on VTEX through
// the public catalog search API. Nutrition tables are not in the API;
// update-products.mjs reads them from the product page.

import { searchStore } from './vtex-sunscreens.mjs';
import { SUPPLEMENT_RULES, matchesCategory, sizeOf, withoutStoreSuffix } from './supplement-rules.mjs';

// Returns raw listings ({ name, brand, price, url, imageUrl }) for toProduct().
// Stores list each flavor as its own product; those share price and size, so
// only the first one per price and size is kept.
export async function fetchVtexSupplements(source, category) {
  const listings = new Map();
  for (const item of await searchStore(source.origin, SUPPLEMENT_RULES[category].query)) {
    let name = withoutStoreSuffix(String(item.productName || '').replace(/\s+/g, ' ').trim(), source.brand);
    if (!matchesCategory(name, category)) continue;
    // "15 Sachês 15g" gives the size of one sachet; the total goes in the name.
    const sachets = name.match(/(\d+)\s*sach[êe]s\s*(?:de\s*)?(\d+(?:[.,]\d+)?)\s*g\b/i);
    if (sachets) name = `${name} (${Number(sachets[1]) * Number(sachets[2].replace(',', '.'))}g total)`;
    const sku = item.items?.find((candidate) => candidate.sellers?.some((seller) => seller.commertialOffer?.AvailableQuantity > 0));
    const offer = sku?.sellers.find((seller) => seller.commertialOffer?.AvailableQuantity > 0)?.commertialOffer;
    if (!offer?.Price) continue;
    const url = `${source.origin}/${item.linkText}/p`;
    const key = `${offer.Price}:${sizeOf(name) || sizeOf(sku.name || '')}`;
    if (!listings.has(key)) {
      listings.set(key, { name, text: sku.name, brand: source.brand, price: offer.Price, url, imageUrl: sku.images?.[0]?.imageUrl });
    }
  }
  return [...listings.values()];
}
