// Compares a fresh scrape with the previous catalog, so a store that changed
// its layout (or blocked the scraper) is reported instead of silently
// removing products or data from the site.

// A source that returns less than this share of its previous products is
// treated as broken and keeps its previous products.
export const MIN_KEPT_SHARE = 0.5;
// Price changes larger than this (up or down) are reported for review, since
// they usually mean the price parser picked up the wrong number.
export const MAX_PRICE_CHANGE = 0.6;

const NUTRITION_FIELDS = {
  'carb/protein ratio': (product) => product.carbProteinRatio,
  energy: (product) => product.nutritionDetails?.energyKcalPerServing,
  'saturated fat': (product) => product.nutritionDetails?.saturatedFatGrams,
};

// Returns why a source's result looks broken, or null when it looks fine.
export function shrinkage(foundCount, previousCount) {
  if (!previousCount) return null;
  if (foundCount === 0) return `found no products (had ${previousCount})`;
  if (foundCount < previousCount * MIN_KEPT_SHARE) return `found only ${foundCount} products (had ${previousCount})`;
  return null;
}

// Lists products, matched by URL, that lost nutrition data or whose price
// moved more than MAX_PRICE_CHANGE since the previous catalog.
export function compareProducts(previousProducts, currentProducts) {
  const previousByUrl = new Map(previousProducts.filter((product) => product.url).map((product) => [product.url, product]));
  const problems = [];
  for (const product of currentProducts) {
    const previous = previousByUrl.get(product.url);
    if (!previous) continue;
    const lost = Object.entries(NUTRITION_FIELDS)
      .filter(([, value]) => Number.isFinite(value(previous)) && !Number.isFinite(value(product)))
      .map(([field]) => field);
    if (lost.length) problems.push(`${product.name}: lost ${lost.join(', ')} (${product.url})`);
    if (previous.price > 0 && product.price > 0 && Math.abs(product.price / previous.price - 1) > MAX_PRICE_CHANGE) {
      problems.push(`${product.name}: price went from R$ ${previous.price} to R$ ${product.price}; check it (${product.url})`);
    }
  }
  return problems;
}
