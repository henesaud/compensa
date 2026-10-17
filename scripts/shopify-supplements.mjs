// Reads supplements (whey, creatine) from brand stores built on Shopify
// through their public /products.json feed. Nutrition tables come from the
// product page, read by update-products.mjs.

import { matchesCategory, sizeOf, withoutStoreSuffix } from './supplement-rules.mjs';

// A single sachet is one serving, not a package to compare.
const SINGLE_SACHET = /sach[êe](?!s)/i;

// Returns raw listings ({ name, brand, price, url, imageUrl }) for toProduct().
// Each product keeps the cheapest variant (flavor) in stock, bought once
// rather than by subscription. Stores list each flavor as its own product
// too; those share price and size, so only one per price and size is kept,
// preferring the product that groups the flavors.
export async function fetchShopifySupplements(source, category) {
  const response = await fetch(`${source.origin}/products.json?limit=250`, { headers: { 'user-agent': 'Mozilla/5.0', accept: 'application/json' } });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${source.origin}/products.json`);
  const { products = [] } = await response.json();
  const listings = new Map();
  for (const product of products) {
    const name = withoutStoreSuffix(String(product.title || '').replace(/\s+/g, ' ').trim(), source.brand);
    if (!matchesCategory(name, category) || SINGLE_SACHET.test(name)) continue;
    const variants = (product.variants || []).filter((variant) => variant.available);
    const oneTime = variants.filter((variant) => /uma vez|avuls/i.test(variant.title));
    const prices = (oneTime.length ? oneTime : variants).filter((variant) => !/mensal|assinatura|recorrente/i.test(variant.title))
      .map((variant) => Number(variant.price)).filter((price) => price > 0);
    if (!prices.length) continue;
    const listing = {
      name,
      text: variants.map((variant) => variant.title).join(' '),
      brand: source.brand,
      price: Math.min(...prices),
      url: `${source.origin}/products/${product.handle}`,
      imageUrl: product.images?.[0]?.src,
      flavors: variants.length,
    };
    const key = `${listing.price}:${sizeOf(name)}`;
    if (!listings.has(key) || listing.flavors > listings.get(key).flavors) listings.set(key, listing);
  }
  return [...listings.values()].map(({ flavors, ...listing }) => listing);
}
