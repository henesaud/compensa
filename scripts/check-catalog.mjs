// Sanity checks for data/products.json: values that are possible to parse
// but implausible for the product ("FPS 70 L'Oréal" read as 70 liters, a
// R$ 13,90 price for 500 g of creatine, 120% protein). Prints one line per
// finding and exits with 1 when there are errors.
//
//   node scripts/check-catalog.mjs          data checks
//   node scripts/check-catalog.mjs --site   also opens the site in a browser
//                                           (needs `make serve` on port 8001)

import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalog = JSON.parse(await readFile(path.join(root, 'data', 'products.json'), 'utf8'));
const findings = [];
const report = (level, category, product, message) => findings.push({ level, category, product, message });

const grams = (product) => (['kg', 'l'].includes(product.unit) ? product.amount * 1000 : product.amount);
const plain = (value) => String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Plausible package sizes in g or ml, by category.
const SIZE_RANGE = { whey: [20, 5000], creatine: [50, 2000], sunscreen: [8, 5000] };
const PRICE_RANGE = { whey: [5, 2000], creatine: [5, 1000], sunscreen: [5, 1000] };

// Every size written in the name ("30g", "1 Litro", "2,4kg"), in g or ml.
// "FPS 70 L'Oréal" is skipped: a size is never followed by an apostrophe.
function sizesInName(name) {
  return [...String(name).matchAll(/(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l|litros?)\b(?!['’])/gi)].map((match) => {
    const value = Number(match[1].replace(',', '.'));
    return /^(kg|l|litro)/i.test(match[2]) ? value * 1000 : value;
  });
}

function unitPrice(product, category) {
  if (category === 'whey') {
    const serving = product.nutritionDetails?.servingMassGrams;
    if (!(product.proteinGrams > 0) || !(serving > 0)) return null;
    return (product.price / (grams(product) * (product.proteinGrams / serving))) * 100;
  }
  if (category === 'creatine') return product.creatineShare > 0 ? (product.price / (grams(product) * product.creatineShare)) * 100 : null;
  return (product.price / grams(product)) * 100;
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
};

for (const [category, products] of Object.entries(catalog.products)) {
  const seen = new Map();
  for (const product of products) {
    const label = `${product.brand} — ${product.name}`;
    // Identity and links
    if (!product.brand?.trim() || !product.name?.trim()) report('error', category, label, 'missing brand or name');
    if (!/^https:\/\//.test(product.url || '')) report('error', category, label, `bad product URL: ${product.url}`);
    const key = `${product.url}|${product.amount}${product.unit}|${product.name}`;
    if (seen.has(key)) report('warn', category, label, 'duplicate product (same URL, size and name)');
    seen.set(key, product);
    if (product.image) {
      try { await access(path.join(root, product.image)); } catch { report('warn', category, label, `image file missing: ${product.image}`); }
    }
    if (/\b(kit|combo|duo|\d+\s*x)\b/i.test(product.name) && !/total/i.test(product.name) && category !== 'sunscreen') report('warn', category, label, 'looks like a kit or bundle');

    // Size and price
    const size = grams(product);
    const [minSize, maxSize] = SIZE_RANGE[category] || [1, 1e6];
    if (!(size > 0)) report('error', category, label, `no package size (${product.amount} ${product.unit})`);
    else if (size < minSize || size > maxSize) report('error', category, label, `implausible package size: ${product.amount} ${product.unit}`);
    const nameSizes = sizesInName(product.name);
    if (nameSizes.length && size > 0 && !nameSizes.some((value) => Math.abs(value - size) < 0.5)
      && !nameSizes.some((value) => size % value === 0) && !/total/i.test(product.name)) {
      report('error', category, label, `size ${product.amount} ${product.unit} is not the one in the name (${nameSizes.join(', ')})`);
    }
    const [minPrice, maxPrice] = PRICE_RANGE[category] || [0.01, 1e6];
    if (!(product.price >= minPrice && product.price <= maxPrice)) report('error', category, label, `implausible price: R$ ${product.price}`);

    // Category checks
    if (category === 'whey' && product.proteinGrams != null) {
      const serving = product.nutritionDetails?.servingMassGrams;
      const share = serving ? product.proteinGrams / serving : null;
      if (share !== null && (share < 0.4 || share > 0.97)) report('warn', category, label, `protein is ${Math.round(share * 100)}% of the serving (${product.proteinGrams} g in ${serving} g)`);
      if (serving && (serving < 10 || serving > 100)) report('warn', category, label, `unusual serving: ${serving} g`);
      if (product.carbProteinRatio != null && product.carbProteinRatio > 1.5) report('warn', category, label, `carb/protein ${product.carbProteinRatio.toFixed(2)}: more carbs than a whey usually has`);
      const kcal = product.nutritionDetails?.energyKcalPerServing;
      const fat = product.nutritionDetails?.totalFatGrams;
      if (kcal && Number.isFinite(product.carbohydrateGrams) && Number.isFinite(fat)) {
        const expected = 4 * product.proteinGrams + 4 * product.carbohydrateGrams + 9 * fat;
        if (Math.abs(kcal - expected) > Math.max(25, expected * 0.25)) report('warn', category, label, `energy ${kcal} kcal doesn't match the macros (~${Math.round(expected)} kcal)`);
      }
    }
    if (category === 'creatine' && product.creatineShare != null && (product.creatineShare < 0.5 || product.creatineShare > 1)) {
      report('warn', category, label, `creatine share ${product.creatineShare}`);
    }
    if (category === 'sunscreen') {
      if (!(product.spf >= 15 && product.spf <= 100)) report('error', category, label, `implausible SPF: ${product.spf}`);
      const nameSpf = (plain(product.name).match(/(?:fps|fator)\s*(\d{2,3})\b/) || plain(product.name).match(/\b(\d{2,3})\s*fps\b/))?.[1];
      if (nameSpf && Number(nameSpf) !== product.spf) report('error', category, label, `SPF ${product.spf} but the name says ${nameSpf}`);
      const reviews = product.reviews;
      if (reviews && (!(reviews.average >= 1 && reviews.average <= 5) || !(reviews.count >= 0))) report('warn', category, label, `odd review summary: ${reviews.average} ★, ${reviews.count}`);
    }
  }

  // Unit prices far from the category's median are usually a misread size or price.
  const groups = new Map();
  for (const product of products) {
    const value = unitPrice(product, category);
    if (!Number.isFinite(value)) continue;
    const group = category === 'sunscreen' ? (product.unit === 'g' ? 'g' : 'ml') : 'all';
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push({ product, value });
  }
  // Sunscreens range from 4 l bulk refills to 14 g sticks, so they get a wider band.
  const band = category === 'sunscreen' ? 15 : 8;
  for (const [group, items] of groups) {
    const middle = median(items.map((item) => item.value));
    for (const { product, value } of items) {
      if (value < middle / band || value > middle * band) {
        report('warn', category, `${product.brand} — ${product.name}`, `unit price R$ ${value.toFixed(2)} is far from the median R$ ${middle.toFixed(2)}${group === 'all' ? '' : ` (${group})`}`);
      }
    }
  }
}

// Optional: open the site and check every tab renders without errors and
// shows no card without a unit price.
if (process.argv.includes('--site')) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  try {
    await page.goto('http://localhost:8001/', { waitUntil: 'networkidle' });
    await page.waitForSelector('.product-card', { timeout: 10000 });
    for (const category of Object.keys(catalog.products)) {
      await page.click(`[data-category="${category}"]`);
      await page.waitForTimeout(300);
      const count = await page.locator('.product-card').count();
      const missing = await page.locator('.unit-price', { hasText: '—' }).count();
      if (!count) report('error', category, 'site', 'tab shows no products');
      if (missing) report('error', category, 'site', `${missing} cards without a unit price`);
      console.log(`site: ${category} shows ${count} products`);
    }
  } catch (error) {
    report('error', 'site', 'site', `could not check the site (is make serve running?): ${error.message}`);
  }
  errors.forEach((message) => report('error', 'site', 'browser', message));
  await browser.close();
}

for (const { level, category, product, message } of findings) console.log(`${level.toUpperCase()} [${category}] ${product}: ${message}`);
const errorCount = findings.filter((finding) => finding.level === 'error').length;
console.log(`\n${errorCount} errors, ${findings.length - errorCount} warnings.`);
process.exitCode = errorCount ? 1 : 0;
