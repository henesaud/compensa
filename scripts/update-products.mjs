import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { createWorker } from 'tesseract.js';
import { fetchVtexSunscreens, vtexSunscreenSources } from './vtex-sunscreens.mjs';
import { fetchBestOffer, fetchCatalogProduct, findCatalogProduct, mercadoLivreToken, searchCatalogProduct } from './mercadolivre-catalog.mjs';
import { productThumbnail } from './product-image.mjs';
import { compareProducts, shrinkage } from './update-checks.mjs';
import { fatDetails } from './nutrition-table.mjs';
import { labelInfo } from './whey-label.mjs';
import { fetchVtexSupplements } from './vtex-supplements.mjs';
import { fetchShopifySupplements } from './shopify-supplements.mjs';
import { STORE_CATEGORIES, fetchStoreCategory, samePackage, tidyBrands } from './store-categories.mjs';
import { creatineShareFromText, matchesCategory } from './supplement-rules.mjs';
import { agreeingReading, hasSaturatedFat, mergeMissingRows, ocrNutritionTable, sameReading, parseOcrNutritionTable, summarizeOcrNutrition, validateOcrNutrition } from './nutrition-ocr.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = path.join(root, 'data', 'products.json');
const sources = [
  {
    brand: 'Growth Supplements',
    origin: 'https://www.gsuplementos.com.br',
    searchUrl: 'https://www.gsuplementos.com.br/busca?busca=whey',
    creatine: { searchUrl: 'https://www.gsuplementos.com.br/busca?busca=creatina' },
  },
  {
    brand: 'Max Titanium',
    origin: 'https://www.maxtitanium.com.br',
    searchUrl: 'https://www.maxtitanium.com.br/Produtos/Proteinas',
    creatine: { vtex: true },
  },
  {
    brand: 'Essential Nutrition',
    origin: 'https://www.essentialnutrition.com.br',
    searchUrls: [
      'https://www.essentialnutrition.com.br/produtos/proteinas/whey?product_list_dir=desc&product_list_order=name',
      'https://www.essentialnutrition.com.br/produtos/proteinas/whey?p=2&product_list_dir=desc&product_list_order=name',
      'https://www.essentialnutrition.com.br/produtos/proteinas/whey?p=3&product_list_dir=desc&product_list_order=name',
    ],
  },
  // `creatine` also reads the store's creatine: true for API stores, or the
  // settings that differ (a search page, the API) for the others. Stores with
  // `whey: false` only sell creatine here (their whey pages have no readable
  // nutrition table, which creatine can do without).
  // Brand stores on VTEX, read through the catalog API (scripts/vtex-supplements.mjs).
  { brand: 'Probiótica', origin: 'https://www.probiotica.com.br', vtex: true, creatine: true },
  { brand: 'Nutrify', origin: 'https://www.nutrify.com.br', vtex: true, creatine: true },
  { brand: 'Vitafor', origin: 'https://www.vitafor.com.br', vtex: true, whey: false, creatine: true },
  { brand: 'Atlhetica Nutrition', origin: 'https://www.atlheticanutrition.com.br', vtex: true, whey: false, creatine: true },
  { brand: 'Black Skull', origin: 'https://www.blackskullusa.com.br', vtex: true, whey: false, creatine: true },
  // Brand stores on Shopify, read through /products.json (scripts/shopify-supplements.mjs).
  { brand: 'True Source', origin: 'https://vivatrue.com.br', shopify: true, creatine: true },
  { brand: 'Soldiers Nutrition', origin: 'https://soldiersnutrition.com.br', shopify: true, creatine: true },
  { brand: 'Dark Lab', origin: 'https://darklabsuplementos.com.br', shopify: true, whey: false, creatine: true },
  { brand: 'FTW', origin: 'https://ftw.com.br', shopify: true, whey: false, creatine: true },
  // Other stores, read from the listing page; productPath tells product pages apart.
  {
    brand: 'Dux',
    origin: 'https://duxhumanhealth.com',
    searchUrl: 'https://duxhumanhealth.com/proteinas/',
    productPath: /^\/produtos\/[^/]+\/?$/,
    creatine: { searchUrl: 'https://duxhumanhealth.com/search/?q=creatina' },
  },
  {
    brand: 'Adaptogen',
    origin: 'https://www.adaptogen.com.br',
    searchUrl: 'https://www.adaptogen.com.br/proteinas/whey-protein',
    productPath: /^\/produto\/[^/]+$/,
    creatine: { searchUrl: 'https://www.adaptogen.com.br/busca?q=creatina' },
  },
  {
    brand: 'New Nutrition',
    origin: 'https://www.newnutrition.com.br',
    searchUrl: 'https://www.newnutrition.com.br/proteinas/whey-protein/',
    productPath: /^\/[^/]+\/p$/,
    creatine: { searchUrl: 'https://www.newnutrition.com.br/busca?q=creatina' },
  },
  {
    brand: 'Loja do Mecânico',
    productBrand: 'Nutriex',
    origin: 'https://www.lojadomecanico.com.br',
    searchUrl: 'https://www.lojadomecanico.com.br/setor/36/802/976/V/683/1/protetor-solar-cremes-de-protecao-e-higienizacao-protetor-solar-nutriex',
    category: 'sunscreen',
  },
];
const sourceOnlyIndex = process.argv.indexOf('--source');
const sourceOnly = sourceOnlyIndex >= 0 ? process.argv[sourceOnlyIndex + 1] : null;

function parsePrice(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (!value) return null;
  // Structured data writes prices as "213.90"; pages write "R$ 1.213,90".
  if (/^\s*\d+\.\d{1,2}\s*$/.test(String(value))) return Number(value);
  const normalized = String(value).replace(/[^\d.,]/g, '').replace(/\./g, '').replace(',', '.');
  const price = Number(normalized);
  return Number.isFinite(price) && price > 0 ? price : null;
}

function parseAmount(name, category) {
  const supplement = category !== 'sunscreen';
  const pattern = supplement ? /(\d+(?:[.,]\d+)?)\s*(kg|g)\b/i : /(\d+(?:[.,]\d+)?)\s*(ml|g|l(?:itros?)?)\b(?!['’])/i; // "FPS 70 L'Oréal" is not 70 liters
  const text = String(name);
  const totalMatch = supplement ? text.match(/(\d+(?:[.,]\d+)?)\s*(kg|g)\s*(?:total|no total)/i) : null;
  // "12 sachês de 34g" is the size of one sachet.
  const sachets = supplement && !totalMatch ? text.match(/\b(\d+)\s*sach[êe]s\s*(?:de\s*)?(\d+(?:[.,]\d+)?)\s*g\b/i) : null;
  if (sachets) return { amount: Number(sachets[1]) * Number(sachets[2].replace(',', '.')), unit: 'g' };
  // "Sachês 5g - 30Un": the size of one sachet and the count.
  const units = supplement && !totalMatch ? text.match(/(\d+(?:[.,]\d+)?)\s*g\b[^\d]{0,15}(\d+)\s*un\b/i) : null;
  if (units) return { amount: Number(units[1].replace(',', '.')) * Number(units[2]), unit: 'g' };
  const match = totalMatch || text.match(pattern);
  if (!match) {
    const doseCount = category === 'whey' ? text.match(/\b(\d+)\s*(?:doses?|sach[eê]s?)\b/i) : null;
    return doseCount ? { amount: Number(doseCount[1]) * 25, unit: 'g', estimatedFromDoses: true } : null;
  }
  const packageCount = !totalMatch && category === 'whey' ? Number(text.match(/\b(\d+)\s*(?:x|unidades?)\b/i)?.[1] || 1) : 1;
  const amount = Number(match[1].replace(',', '.')) * packageCount;
  const unit = match[2].toLowerCase().startsWith('l') ? 'l' : match[2].toLowerCase();
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return { amount, unit };
}

function productType(name, category) {
  const normalized = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (category === 'creatine') return /creapure/.test(normalized) ? 'Creapure' : 'Monohidratada';
  if (category === 'whey') {
    if (/\bblend\b|\b3w\b|\b2w\b|whey.*egg|egg.*whey/.test(normalized)) return 'Blend';
    if (/hidrolis/.test(normalized)) return 'Hidrolisado';
    if (/isolad/.test(normalized)) return 'Isolado';
    if (/concentrad/.test(normalized)) return 'Concentrado';
    return 'Whey protein';
  }
  if (/facial|rosto/.test(normalized) && /corporal|corpo/.test(normalized)) return 'Facial e corporal';
  if (/facial|rosto/.test(normalized)) return 'Facial';
  if (/corporal|corpo/.test(normalized)) return 'Corporal';
  return 'Uso geral';
}

function parseSpf(name) {
  const text = String(name);
  const match = text.match(/\b(?:fps|fator)\s*(\d{2,3})\b/i) || text.match(/\b(\d{2,3})\s*fps\b/i);
  const value = match ? Number(match[1]) : null;
  return Number.isFinite(value) && value >= 15 && value <= 100 ? value : null;
}

function toProduct(raw, category, source) {
  const name = String(raw.name || '').replace(/\s+/g, ' ').trim();
  const normalizedName = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (category === 'whey' && !normalizedName.includes('whey')) return null;
  // Kits and packs of several tubs can't be compared with a single one.
  if (category === 'whey' && /\bkit\b|\bpack\b|combo|\bduo\b|\b\d+\s*x\b/i.test(name)) return null;
  if (category === 'creatine' && !matchesCategory(name, 'creatine')) return null;
  if (category === 'sunscreen' && (!(source.vtex || /nutriex/i.test(raw.brand || source.productBrand || source.brand)) || !parseSpf(name))) return null;
  const amount = parseAmount(name, category) || parseAmount(raw.text || '', category);
  const price = parsePrice(raw.price);
  if (!name || !amount || !price) return null;

  // Whey stores sell their own brand; pages sometimes name the company instead.
  const brand = String(category !== 'sunscreen' ? source.brand : raw.brand || source.productBrand || source.brand).trim();
  const url = isDirectProductUrl(raw.url, source) ? raw.url : undefined;
  // Store APIs only return whey listings already; scraped pages can link elsewhere.
  const pathWord = { whey: 'whey', creatine: 'creatin' }[category];
  if (pathWord && url && !source.vtex && !source.shopify && !new URL(url).pathname.toLowerCase().includes(pathWord)) return null;
  const product = {
    brand,
    name,
    type: productType(name, category),
    amount: amount.amount,
    unit: amount.unit,
    price,
    url,
    imageUrl: raw.imageUrl,
  };
  if (category === 'sunscreen') {
    product.spf = parseSpf(name);
    product.store = source.store || source.brand;
    if (!source.vtex) product.paymentCondition = 'Pix ou boleto';
    for (const [key, value] of Object.entries(raw.details || {})) if (value !== undefined) product[key] = value;
  }
  if (amount.estimatedFromDoses) product.estimatedAmount = true;

  return product;
}

// Reviews only accumulate, so a product that comes back without them means the
// review service failed this run; the previous run's reviews are kept.
function keepPreviousReviews(sunscreens, previous) {
  const previousByUrl = new Map(previous.map((product) => [product.url, product.reviews]));
  let kept = 0;
  for (const product of sunscreens) {
    if (product.reviews || !previousByUrl.get(product.url)) continue;
    product.reviews = previousByUrl.get(product.url);
    kept += 1;
  }
  if (kept) console.warn(`Kept previous reviews for ${kept} sunscreens whose reviews could not be read.`);
}

// Copies the Mercado Livre catalog attributes onto sunscreens, found by
// barcode or, for stores without one, by name.
// Without credentials (or if the API fails) the previous run's data is kept.
// Creatine per serving, from the nutrition table ("Creatina 3 g" in a 3 g
// serving); otherwise from the ingredient list or name (supplement-rules.mjs).
function creatineContent(product, nutrition, label) {
  const row = nutrition.nutritionTable?.rows?.find((candidate) => /^creatina\b/i.test(candidate.label || ''));
  const creatineGrams = Number(String(row?.cells?.[1] || '').match(/\d+(?:[.,]\d+)?/)?.[0]?.replace(',', '.'));
  const servingMassGrams = nutritionDetails(nutrition.nutritionTable)?.servingMassGrams;
  if (creatineGrams > 0 && servingMassGrams >= creatineGrams * 0.95) {
    return { creatinePerServingGrams: creatineGrams, servingMassGrams, creatineShare: Math.min(creatineGrams / servingMassGrams, 1), creatineSource: 'table' };
  }
  // The page address often names the product better ("creatina-300g-monohidratada").
  return creatineShareFromText(`${product.name} ${new URL(product.url).pathname.replace(/[-/]/g, ' ')}`, label.ingredients);
}

// Lists creatine from the stores with `creatine` set and reads each product
// page for the nutrition table and label. Like whey, a store that fails keeps
// its previous products.
async function refreshCreatine(page, previousCatalog, problems, refreshSource) {
  const selected = sources.filter((source) => source.creatine && (!sourceOnly || source.brand.toLowerCase() === sourceOnly.toLowerCase()));
  if (sourceOnly && !selected.length) return previousCatalog;
  const products = new Map();
  for (const base of selected) {
    const source = { ...base, ...(typeof base.creatine === 'object' ? base.creatine : {}) };
    const previous = previousCatalog.filter((product) => product.brand === source.brand);
    const result = await refreshSource(`${source.brand} (creatina)`, previous, async () => {
      if (source.vtex || source.shopify) {
        const listings = source.vtex ? await fetchVtexSupplements(source, 'creatine') : await fetchShopifySupplements(source, 'creatine');
        return listings.map((raw) => toProduct(raw, 'creatine', source)).filter((product) => product?.url);
      }
      return scrapeSearch(page, source, 'creatine');
    });
    // Under R$ 4 per 100 g is far below any real creatine; the listing page
    // paired the name with another price.
    const misread = result.products.filter((product) => (product.price / product.amount) * (product.unit === 'kg' ? 0.1 : 100) < 4);
    misread.forEach((product) => console.warn(`Skipped creatine with an implausible price: ${product.name} (R$ ${product.price})`));
    result.products = result.products.filter((product) => !misread.includes(product));
    console.log(`Found ${result.kept ? 0 : result.products.length} creatine listings from ${source.brand}.`);
    for (const product of result.products) {
      const identity = `${product.brand}:${product.name.toLowerCase()}:${product.amount}${product.unit}`;
      if (!products.has(identity)) products.set(identity, { ...product, kept: result.kept });
    }
  }
  const previousByUrl = new Map(previousCatalog.map((product) => [product.url, product]));
  for (const product of products.values()) {
    if (product.kept) continue;
    const nutrition = await scrapeNutrition(page, product.url);
    if (!product.imageUrl && nutrition.productImageUrl) product.imageUrl = nutrition.productImageUrl;
    const label = labelInfo(nutrition.pageText);
    addLabel(product, label, previousByUrl.get(product.url));
    Object.assign(product, creatineContent(product, nutrition, label));
    if (product.creatineShare === null && previousByUrl.get(product.url)?.creatineShare) {
      Object.assign(product, { creatineShare: previousByUrl.get(product.url).creatineShare, creatineSource: previousByUrl.get(product.url).creatineSource });
    }
    if (product.creatineShare === null) console.warn(`Creatine content not found for: ${product.name}`);
  }
  const refreshed = [...products.values()].map(({ kept, ...product }) => product);
  const others = sourceOnly ? previousCatalog.filter((product) => !selected.some((source) => source.brand === product.brand)) : [];
  return [...others, ...refreshed];
}

// Reading a label image (OCR) can fail on one run and work on the next, so a
// failed read keeps the previous run's nutrition instead of erasing it.
const NUTRITION_FIELDS = ['carbohydrateGrams', 'proteinGrams', 'nutritionTable', 'nutritionDetails', 'carbProteinRatio',
  'nutritionDataSource', 'nutritionOcrConfidence', 'nutritionImageUrl', 'nutritionOcrVerified'];
function keepPreviousNutrition(product, previous) {
  if (!Number.isFinite(previous?.carbProteinRatio)) return false;
  for (const field of NUTRITION_FIELDS) {
    if (previous[field] !== undefined) product[field] = previous[field];
  }
  return true;
}

// Ingredients, allergens, gluten and lactose from the label text on the
// product page. A page that fails to load keeps the previous run's data.
const LABEL_FIELDS = ['ingredients', 'allergens', 'gluten', 'lactose'];
function addLabel(product, label, previous) {
  const found = label.ingredients || label.gluten || label.lactose || label.allergens.contains.length;
  for (const field of LABEL_FIELDS) {
    const value = found ? label[field] : previous?.[field];
    if (value !== undefined) product[field] = value;
  }
}

async function addMercadoLivreData(sunscreens, previous) {
  const previousByUrl = new Map(previous.map((product) => [product.url, product.mercadoLivre]));
  let token = null;
  try {
    token = await mercadoLivreToken();
  } catch (error) {
    console.warn(`Mercado Livre login failed, keeping previous catalog data: ${error.message}`);
  }
  if (!token) console.warn('No Mercado Livre credentials (ML_CLIENT_ID, ML_CLIENT_SECRET); keeping previous catalog data.');
  let matched = 0;
  let offers = 0;
  const sellers = new Map();
  for (const product of sunscreens) {
    let data = previousByUrl.get(product.url);
    if (token) {
      try {
        data = product.barcode
          ? await fetchCatalogProduct(token, product.barcode, product.spf)
          : await searchCatalogProduct(token, product);
      } catch (error) {
        console.warn(`Could not read Mercado Livre data for ${product.name}: ${error.message}`);
      }
    }
    if (!data) continue;
    // Prices go stale fast, so an offer is only kept from this run.
    delete data.offer;
    if (token) {
      try {
        const offer = await fetchBestOffer(token, data.id, { storePrice: product.price, sellers });
        if (offer) {
          data.offer = offer;
          offers += 1;
        }
      } catch (error) {
        console.warn(`Could not read Mercado Livre offers for ${product.name}: ${error.message}`);
      }
    }
    product.mercadoLivre = data;
    matched += 1;
  }
  console.log(`Found Mercado Livre catalog data for ${matched} of ${sunscreens.length} sunscreens, with an offer for ${offers}.`);
}

// Categories read from store catalogs (scripts/store-categories.mjs). With
// --source, only the named category or store is refreshed; the rest keeps the
// previous catalog. A store that fails keeps its previous products.
async function refreshStoreCategories(page, catalog, existingCatalog, problems, refreshSource) {
  const only = sourceOnly?.toLowerCase();
  const readPage = async (url) => {
    const nutrition = await scrapeNutrition(page, url);
    return {
      text: `${nutrition.nutritionTable?.text || ''}\n${nutrition.pageText || ''}`,
      proteinGrams: nutrition.proteinGrams,
      servingMassGrams: nutritionDetails(nutrition.nutritionTable)?.servingMassGrams,
    };
  };
  for (const [category, rule] of Object.entries(STORE_CATEGORIES)) {
    const previous = existingCatalog[category] || [];
    const wholeCategory = !only || only === category.toLowerCase();
    const stores = rule.stores.filter((store) => wholeCategory || only === store.store.toLowerCase());
    catalog[category] = previous.filter((product) => !stores.some((store) => store.store === product.store));
    for (const store of stores) {
      const unread = [];
      const result = await refreshSource(`${store.store} (${category})`, previous.filter((product) => product.store === store.store),
        () => fetchStoreCategory(category, store, { unread, readPage }));
      catalog[category].push(...result.products);
      console.log(`Found ${result.kept ? 0 : result.products.length} ${category} listings from ${store.store}.`);
      if (unread.length) console.warn(`Size or content not found for ${unread.length} ${category} listings from ${store.store}, e.g.: ${unread.slice(0, 5).join('; ')}`);
    }
    if (rule.reviews) keepPreviousReviews(catalog[category], previous);
    tidyBrands(catalog[category]);
    await addMercadoLivreOffers(category, catalog[category].filter((product) => stores.some((store) => store.store === product.store)));
  }
}

// The cheapest trustworthy Mercado Livre offer for store-category products,
// found by barcode. The catalog product must be the same package (count or
// size in its name), or the offer would be for a kit or another size. Offers
// are only kept from this run; without credentials there are none.
let mercadoLivreSession;
async function addMercadoLivreOffers(category, products) {
  if (!products.length) return;
  mercadoLivreSession ||= mercadoLivreToken().then((token) => ({ token, sellers: new Map() }))
    .catch((error) => (console.warn(`Mercado Livre login failed: ${error.message}`), { token: null }));
  const { token, sellers } = await mercadoLivreSession;
  if (!token) return;
  let matched = 0;
  let offers = 0;
  for (const product of products) {
    delete product.mercadoLivre;
    if (!product.barcode) continue;
    try {
      const match = await findCatalogProduct(token, product.barcode);
      if (!match || !samePackage(category, product, match.name)) continue;
      product.mercadoLivre = { id: match.id, name: match.name };
      matched += 1;
      const offer = await fetchBestOffer(token, match.id, { storePrice: product.price, sellers });
      if (offer) {
        product.mercadoLivre.offer = offer;
        offers += 1;
      }
    } catch (error) {
      console.warn(`Could not read Mercado Livre data for ${product.name}: ${error.message}`);
    }
  }
  console.log(`Found the same package on Mercado Livre for ${matched} of ${products.length} ${category} products, with an offer for ${offers}.`);
}

function isDirectProductUrl(value, source) {
  try {
    const url = new URL(value);
    if (url.origin !== source.origin) return false;
    if (source.brand === 'Growth Supplements') return /-p\d+$/i.test(url.pathname);
    if (source.brand === 'Max Titanium') return /\/p$/i.test(url.pathname);
    if (source.brand === 'Essential Nutrition') return /^\/[^/]*whey[^/]*\/?$/i.test(url.pathname);
    if (source.vtex) return /\/p$/i.test(url.pathname);
    if (source.shopify) return /^\/products\/[^/]+$/.test(url.pathname);
    if (source.productPath) return source.productPath.test(url.pathname);
    if (source.brand === 'Loja do Mecânico') return /^\/produto\/\d+\//.test(url.pathname);
    return false;
  } catch {
    return false;
  }
}

// Each product card holds one product link, its name and the cash price
// ("R$ 13,90 à vista no Pix ou Boleto"). Kits of several units are skipped.
async function scrapeLojaDoMecanicoSunscreens(page, source) {
  console.log(`Searching ${source.brand}: ${source.searchUrl}`);
  await page.goto(source.searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3000);
  // Card images load lazily, so scroll through the list first.
  for (let y = 0; y < await page.evaluate(() => document.body.scrollHeight); y += 600) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await page.waitForTimeout(150);
  }
  const extracted = await page.locator('a[href*="/produto/"]').evaluateAll((anchors) => {
    const result = new Map();
    for (const anchor of anchors) {
      if (result.has(anchor.href)) continue;
      for (let card = anchor, depth = 0; card && depth < 8; card = card.parentElement, depth += 1) {
        if (new Set([...card.querySelectorAll('a[href*="/produto/"]')].map((link) => link.href)).size > 1) break;
        const text = (card.innerText || '').replace(/\s+/g, ' ').trim();
        const price = text.match(/R\$\s*([\d.]+,\d{2})\s*à vista/i);
        if (!price) continue;
        const image = card.querySelector('img');
        const name = [anchor.getAttribute('title'), image?.alt, anchor.innerText]
          .map((value) => (value || '').replace(/\s+/g, ' ').trim())
          .filter((value) => /nutriex/i.test(value)).sort((a, b) => b.length - a.length)[0];
        if (name) result.set(anchor.href, { name, price: price[1], url: anchor.href, imageUrl: image?.getAttribute('data-src') || image?.currentSrc || image?.src, brand: 'Nutriex' });
        break;
      }
    }
    return [...result.values()];
  });
  return extracted
    .filter((raw) => !/\bkit\b/i.test(raw.name))
    // The card text loses the slash in "1/3 UVA".
    .map((raw) => ({ ...raw, name: raw.name.replace(/\b13 UVA\b/i, '1/3 UVA') }))
    .map((raw) => toProduct(raw, 'sunscreen', source))
    .filter((product) => product?.url);
}

async function scrapeEssentialSearch(page, source, category) {
  const extracted = await page.locator('a[href]').evaluateAll((anchors, origin) => {
    const seen = new Set();
    const directProductLink = (value) => {
      try {
        const url = new URL(value, location.href);
        return url.origin === origin && /^\/[^/]*whey[^/]*\/?$/i.test(url.pathname);
      } catch { return false; }
    };
    const absoluteImageUrl = (value) => {
      try {
        const url = new URL(value, location.href);
        return url.protocol === 'https:' ? url.href : '';
      } catch { return ''; }
    };
    const output = [];

    for (const anchor of anchors) {
      if (!directProductLink(anchor.href)) continue;
      const productUrl = new URL(anchor.href).href;
      if (seen.has(productUrl)) continue;
      seen.add(productUrl);

      let card = null;
      for (let element = anchor, depth = 0; element && depth < 8; element = element.parentElement, depth += 1) {
        const text = (element.innerText || '').replace(/\s+/g, ' ').trim();
        if (text.length <= 1800 && /R\$\s*[\d.]+,\d{2}/i.test(text)
          && /\d+\s*(?:doses?|sach[eê]s?|kg|g)\b/i.test(text)) {
          card = element;
          break;
        }
      }
      if (!card) continue;

      const cardAnchors = [...card.getElementsByTagName('a')];
      const name = cardAnchors
        .filter((candidate) => directProductLink(candidate.href))
        .map((candidate) => candidate.innerText.replace(/\s+/g, ' ').trim())
        .find((value) => /whey/i.test(value) && value.length > 3);
      if (!name) continue;

      const text = (card.innerText || '').replace(/\s+/g, ' ').trim();
      const priceMatches = [...text.matchAll(/R\$\s*([\d.]+,\d{2})/gi)];
      const prices = priceMatches.map((match) => match[1]);
      const price = prices.sort((a, b) => Number(a.replace(/\./g, '').replace(',', '.'))
        - Number(b.replace(/\./g, '').replace(',', '.')))[0];
      const images = [...card.getElementsByTagName('img')];
      const imageUrl = absoluteImageUrl(images.find((image) => /whey/i.test(`${image.alt} ${image.currentSrc} ${image.src}`))?.currentSrc
        || images.find((image) => /whey/i.test(`${image.alt} ${image.currentSrc} ${image.src}`))?.src
        || images[0]?.currentSrc
        || images[0]?.src
        || '');
      if (price) output.push({ name, text, price, url: productUrl, imageUrl, brand: 'Essential Nutrition' });
    }

    return output;
  }, source.origin);

  const products = new Map();
  for (const raw of extracted) {
    const product = toProduct(raw, category, source);
    if (!product?.url) continue;
    const normalizedName = product.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const identity = `${product.brand}:${normalizedName}:${product.amount}${product.unit}`;
    const existing = products.get(identity);
    if (!existing) products.set(identity, product);
    else if (product.price < existing.price) existing.price = product.price;
  }
  return [...products.values()];
}

async function scrapeSearch(page, source, category) {
  console.log(`Searching ${source.brand}: ${source.searchUrl}`);
  await page.goto(source.searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3000);

  const verificationPage = await page.evaluate(() => /verifying your browser|enable javascript/i.test(`${document.title} ${document.body?.innerText || ''}`));
  if (verificationPage) {
    console.log('The store is checking this browser. Complete any verification in the opened window; waiting up to 3 minutes.');
    await page.waitForFunction(
      () => !/verifying your browser|enable javascript/i.test(`${document.title} ${document.body?.innerText || ''}`),
      undefined,
      { timeout: 180000 },
    );
  }
  await page.waitForTimeout(2500);

  if (source.brand === 'Essential Nutrition') return scrapeEssentialSearch(page, source, category);

  // Cards count when a heading names the product kind ("whey", "creatina").
  const keyword = category === 'creatine' ? 'creatin' : 'whey';
  const extracted = await page.evaluate(({ brand, keyword }) => {
    const named = (value) => tokens(value).some((token) => token.startsWith(keyword));
    const output = [];
    const seen = new Set();
    const absoluteUrl = (value) => {
      if (!value) return '';
      try {
        const parsed = new URL(value, location.href);
        return parsed.origin === location.origin ? parsed.href : '';
      } catch { return ''; }
    };
    const absoluteImageUrl = (value) => {
      if (!value) return '';
      try {
        const parsed = new URL(value, location.href);
        return parsed.protocol === 'https:' ? parsed.href : '';
      } catch { return ''; }
    };
    const isProductLink = (value) => {
      try {
        const url = new URL(value, location.href);
        if (url.origin !== location.origin) return false;
        if (/(?:-p\d+|\/produtos?\/|\/product\/|\/p(?:$|\?)|\/products\/[^/?#]+)/i.test(url.href)) return true;
        return brand === 'Essential Nutrition' && /^\/[^/]*whey[^/]*\/?$/i.test(url.pathname);
      } catch { return false; }
    };
    const tokens = (value) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().match(/[a-z0-9]+/g) || [];
    const productNameTokens = (value) => new Set(tokens(value)
      .flatMap((token) => token === 'isowhey' ? ['iso'] : token === 'isolado' ? ['iso', token] : [token])
      .filter((token) => token.length > 2 || ['2w', '3w'].includes(token))
      .filter((token) => !['growth', 'supplements', 'whey', 'protein'].includes(token)));
    const linkScore = (name, link) => {
      const nameTokens = productNameTokens(name);
      const linkQuantity = [...link.tokens].filter((token) => /^\d+(?:kg|g|ml|l)$/.test(token));
      const nameQuantity = [...nameTokens].filter((token) => /^\d+(?:kg|g|ml|l)$/.test(token));
      if (nameQuantity.length && linkQuantity.length && !nameQuantity.some((token) => linkQuantity.includes(token))) return -1;
      return [...nameTokens].filter((token) => link.tokens.has(token)).length;
    };
    const productAnchors = [...document.querySelectorAll('a[href]')]
      .map((anchor) => ({ url: absoluteUrl(anchor.href), tokens: new Set(tokens(new URL(anchor.href).pathname)) }))
      .filter((link) => link.url && isProductLink(link.url));
    const findProductUrl = (name) => {
      const ranked = productAnchors
        .map((link) => ({ ...link, score: linkScore(name, link) }))
        .sort((a, b) => b.score - a.score);
      return ranked[0]?.score >= 2 ? ranked[0].url : '';
    };
    const getOfferPrice = (offers) => {
      const offer = Array.isArray(offers) ? offers[0] : offers;
      if (!offer || typeof offer !== 'object') return null;
      return offer.price ?? offer.lowPrice ?? offer.priceSpecification?.price ?? null;
    };
    const getImageUrl = (image) => {
      const value = Array.isArray(image) ? image[0] : image;
      const url = typeof value === 'string' ? value : value?.url || value?.contentUrl;
      return absoluteImageUrl(url || '');
    };
    const walk = (node) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      const types = Array.isArray(node['@type']) ? node['@type'] : [node['@type']];
      if (types.includes('Product') && node.name) {
        const directUrl = absoluteUrl(node.url || node['@id'] || '');
        const productUrl = isProductLink(directUrl) ? directUrl : findProductUrl(node.name);
        const price = getOfferPrice(node.offers);
        const brand = typeof node.brand === 'string' ? node.brand : node.brand?.name;
        const imageUrl = getImageUrl(node.image);
        if (price) {
          output.push({ name: node.name, brand, price, url: productUrl || undefined, imageUrl: imageUrl || undefined });
        }
      }
      Object.values(node).forEach(walk);
    };

    document.querySelectorAll('script[type="application/ld+json"]').forEach((script) => {
      try { walk(JSON.parse(script.textContent)); } catch { /* Ignore malformed structured data. */ }
    });

    const productLinks = [...document.querySelectorAll('a[href]')].filter((anchor) => isProductLink(anchor.href));
    for (const anchor of productLinks) {
      const productUrl = absoluteUrl(anchor.href);
      if (!productUrl || seen.has(productUrl)) continue;
      seen.add(productUrl);
      let bestCard = null;
      let element = anchor;
      for (let depth = 0; element && depth < 8; depth += 1, element = element.parentElement) {
        const text = (element.innerText || '').replace(/\s+/g, ' ').trim();
        if (text.length > 1800) continue;
        if (/R\$\s*[\d.]+,\d{2}/i.test(text) && /\d+(?:[.,]\d+)?\s*(?:kg|g|ml|l)\b/i.test(text)) {
          bestCard = element;
          break;
        }
      }
      if (!bestCard) continue;

      const text = (bestCard.innerText || '').replace(/\s+/g, ' ').trim();
      const headings = [...bestCard.querySelectorAll('h1,h2,h3,h4,[class*="title"],[class*="name"]')]
        .map((element) => element.innerText.trim())
        .filter((value) => value && value.length < 180);
      const imageAlt = bestCard.querySelector('img[alt]')?.alt?.trim();
      const imageUrl = absoluteImageUrl(bestCard.querySelector('img')?.currentSrc
        || bestCard.querySelector('img')?.getAttribute('data-src')
        || bestCard.querySelector('img')?.getAttribute('data-lazy-src')
        || bestCard.querySelector('img')?.src
        || '');
      const name = headings.find((value) => named(value) && /\d+(?:[.,]\d+)?\s*(?:kg|g)\b/i.test(value))
        || headings.find(named)
        || anchor.innerText.trim()
        || imageAlt;
      const productLinks = [...bestCard.querySelectorAll('a[href]')]
        .map((link) => ({ url: absoluteUrl(link.href), tokens: new Set(tokens(new URL(link.href).pathname)) }))
        .filter((link) => link.url && isProductLink(link.url));
      const bestLink = productLinks
        .map((link) => ({ ...link, score: linkScore(name, link) }))
        .sort((a, b) => b.score - a.score)[0];
      if (!named(name) || !bestLink || bestLink.score < 2) continue;
      const priceMatches = [...text.matchAll(/R\$\s*([\d.]+,\d{2})/gi)];
      const nonInstallmentPrices = priceMatches.filter((match) => {
        const before = text.slice(Math.max(0, match.index - 16), match.index);
        return !/\d+\s*x\s*(?:de\s*)?$/i.test(before);
      });
      const pixIndex = text.search(/(?:à\s*vista\s*)?no\s*pix/i);
      const pixPrice = pixIndex >= 0
        ? [...priceMatches].reverse().find((match) => match.index < pixIndex)?.[1]
        : null;
      const lowestListedPrice = [...nonInstallmentPrices].sort((a, b) => parseFloat(a[1].replace(/\./g, '').replace(',', '.')) - parseFloat(b[1].replace(/\./g, '').replace(',', '.')))[0]?.[1];
      const price = pixPrice || lowestListedPrice || priceMatches[0]?.[1];
      if (name && price) output.push({ name, text, price, url: bestLink.url, imageUrl, brand });
    }
    return output;
  }, { brand: source.brand, keyword });

  const products = new Map();
  let withoutDirectLink = 0;
  for (const raw of extracted) {
    const product = toProduct(raw, category, source);
    if (!product) continue;
    if (!product.url) {
      withoutDirectLink += 1;
      continue;
    }
    const normalizedName = product.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const identity = `${product.brand}:${normalizedName}:${product.amount}${product.unit}`;
    const existing = products.get(identity);
    if (!existing) products.set(identity, product);
    else {
      if (product.price < existing.price) existing.price = product.price;
      if (!existing.url && product.url) existing.url = product.url;
      if (!existing.imageUrl && product.imageUrl) existing.imageUrl = product.imageUrl;
    }
  }
  if (withoutDirectLink) console.log(`Skipped ${withoutDirectLink} ${category} listings without a direct product page.`);
  return [...products.values()];
}

function nutritionSourceUrl(product, products) {
  if (product.url) return product.url;
  const normalize = (value) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const nameTokens = normalize(product.name).match(/[a-z0-9]+/g) || [];
  const meaningful = new Set(nameTokens.filter((token) => token.length > 2 && ![
    'whey', 'protein', 'growth', 'supplements', 'dose', 'sabor', 'natural', 'top',
  ].includes(token) && !/^\d+(?:kg|g|ml|l)$/.test(token)));
  if (nameTokens.includes('3w') || nameTokens.includes('2w')) {
    return products.find((candidate) => candidate.url && normalize(candidate.name).includes(nameTokens.includes('3w') ? '3w' : '2w'))?.url;
  }
  const candidates = products
    .filter((candidate) => candidate.url && candidate.type === product.type)
    .map((candidate) => {
      const candidateTokens = new Set((normalize(candidate.name).match(/[a-z0-9]+/g) || []));
      return { url: candidate.url, score: [...meaningful].filter((token) => candidateTokens.has(token)).length };
    })
    .sort((a, b) => b.score - a.score);
  return candidates[0]?.score > 0 ? candidates[0].url : undefined;
}

async function scrapeNutrition(page, productUrl) {
  try {
    await page.goto(productUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    // Some stores render the nutrition table client-side after the page loads.
    // Stores that only publish it as an image never match, so the wait is capped.
    await page.waitForFunction(() => /informa[cç][aã]o nutricional/i.test(document.body?.innerText || ''), undefined, { timeout: 8000 })
      .catch(() => {});
    await page.waitForTimeout(500);
    const result = await page.evaluate(() => {
      const normalize = (value) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      const isNutritionTable = (table) => {
        const text = normalize(table.innerText || '');
        return /informacao nutricional/.test(text)
          || (/valor energetico/.test(text) && /carboidratos?/.test(text) && /proteinas?/.test(text)
            && /gorduras|fibra alimentar|sodio/.test(text));
      };
      const tableNodes = [...document.querySelectorAll('table,[role="table"]')]
        .filter(isNutritionTable);
      const tableRows = tableNodes.flatMap((table) =>
        [...table.querySelectorAll('tr,[role="row"]')].map((row) => {
          const cells = [...row.children]
            .filter((cell) => /^(TD|TH)$/.test(cell.tagName) || /^(cell|columnheader)$/.test(cell.getAttribute('role') || ''))
            .map((cell) => cell.innerText.replace(/\s+/g, ' ').trim())
            .filter(Boolean);
          const text = (cells.length ? cells.join(' | ') : row.innerText).replace(/\s+/g, ' ').trim();
          return { label: cells[0] || text, cells: cells.length ? cells : [text], text };
        }).filter((row) => row.text),
      );
      const uniqueRows = [...new Map(tableRows.map((row) => [row.text, row])).values()];
      const bodyLines = (document.body?.innerText || '').split('\n').map((line) => line.trim()).filter(Boolean);
      const headingIndex = bodyLines.findIndex((line) => /informacao nutricional/i.test(normalize(line)));
      let sectionLines = [];
      if (headingIndex >= 0) {
        sectionLines = bodyLines.slice(headingIndex);
        const footerIndex = sectionLines.findIndex((line) => /percentual de valores diarios/i.test(normalize(line)));
        const nextSectionIndex = sectionLines.findIndex((line, index) => index > 2
          && /^(ingredientes|alergenicos|alergicos|modo de preparo|sugestao de consumo|como consumir|conservacao|descricao do produto|informacoes adicionais)\b/i.test(normalize(line)));
        const stopIndex = footerIndex >= 0 ? footerIndex + 1 : nextSectionIndex >= 0 ? nextSectionIndex : sectionLines.length;
        sectionLines = sectionLines.slice(0, stopIndex);
      }
      const nutritionText = sectionLines.length
        ? sectionLines.join('\n')
        : tableNodes.map((table) => table.innerText.trim()).join('\n\n');
      const portionMatch = nutritionText.match(/(?:por[cç][aã]o|dose)\s*:?\s*([^\n|]+)/i);
      const fallbackRows = sectionLines.map((text) => {
        const cells = text.split(/\t+|\s{2,}|\s\|\s/).map((cell) => cell.trim()).filter(Boolean);
        return { label: cells[0] || text, cells: cells.length ? cells : [text], text };
      });
      const nutritionTable = (uniqueRows.length || sectionLines.length)
        ? {
          servingSize: portionMatch?.[1]?.trim() || null,
          rows: uniqueRows.length ? uniqueRows : fallbackRows,
          text: nutritionText,
        }
        : null;
      const findGrams = (pattern) => {
        const row = nutritionTable?.rows.find((candidate) => pattern.test(normalize(candidate.label || candidate.text || '')));
        if (!row) return null;
        const cellValue = row.cells?.slice(1).find((cell) => /\d/.test(cell));
        if (cellValue) {
          const value = cellValue.match(/\d+(?:[.,]\d+)?/);
          if (value) return Number(value[0].replace(',', '.'));
        }
        const normalizedRow = normalize(row.label || row.text || '');
        const labelMatch = normalizedRow.match(pattern);
        if (!labelMatch) return null;
        const labelIndex = normalizedRow.search(pattern);
        const remainder = String(row.text || row.label || '').slice(labelIndex + labelMatch[0].length);
        const value = remainder.match(/\d+(?:[.,]\d+)?/);
        return value ? Number(value[0].replace(',', '.')) : null;
      };

      const imageCandidates = new Map();
      let productImageUrl = null;
      const addImage = (value, baseScore, alt = '') => {
        if (!value) return;
        try {
          const url = new URL(value, location.href);
          if (url.protocol !== 'https:' || /logo|sprite|icon|banner|payment|badge|selo/i.test(`${url.pathname} ${url.search}`)) return;
          // VTEX stores serve resized copies at /arquivos/ids/<id>-<width>-<height>/;
          // galleries load 96px and 256px thumbnails, which are unreadable for OCR.
          url.pathname = url.pathname.replace(/^(\/arquivos\/ids\/\d+)(?:-\d+-\d+)?\//, '$1-1600-0/');
          const name = normalize(`${decodeURIComponent(url.pathname.split('/').pop())} ${alt}`);
          let score = baseScore;
          if (/tabela|nutri|supplement.?facts|(^|[-_ ])tn[-_ ]/.test(name)) score += 30;
          else if (/tras|verso|back|costas/.test(name)) score += 12;
          const previous = imageCandidates.get(url.href);
          imageCandidates.set(url.href, Math.max(score, previous || 0));
        } catch { /* Ignore malformed image URLs. */ }
      };
      for (const image of document.images) {
        const sources = [image.getAttribute('data-src'), image.getAttribute('data-lazy-src'), image.getAttribute('src'), image.currentSrc,
          ...(image.getAttribute('srcset') || '').split(',').map((entry) => entry.trim().split(/\s+/)[0])]
          .filter((source, index, all) => source && all.indexOf(source) === index);
        const inGallery = image.closest('main,[role="main"],[id*="product"],[class*="gallery"],[class*="Galeria"],[class*="product-image"],[class*="product__image"],[class*="swiper"],[class*="slick"]');
        for (const source of sources) addImage(source, inGallery ? 4 : 0, image.alt);
      }
      for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
        try {
          const walkProducts = (node) => {
            if (!node || typeof node !== 'object') return;
            if (Array.isArray(node)) return node.forEach(walkProducts);
            const types = Array.isArray(node['@type']) ? node['@type'] : [node['@type']];
            if (types.includes('Product')) {
              const images = Array.isArray(node.image) ? node.image : [node.image];
              const urls = images.map((image) => (typeof image === 'string' ? image : image?.url || image?.contentUrl)).filter(Boolean);
              productImageUrl ||= urls.find((url) => url.startsWith('https:')) || null;
              urls.forEach((url) => addImage(url, 6));
            }
            Object.values(node).forEach(walkProducts);
          };
          walkProducts(JSON.parse(script.textContent));
        } catch { /* Ignore invalid structured data. */ }
      }
      return {
        carbohydrateGrams: findGrams(/^carboidratos?\b/),
        proteinGrams: findGrams(/^proteinas?\b/),
        nutritionTable,
        productImageUrl,
        nutritionImageUrls: [...imageCandidates.entries()].filter(([, score]) => score >= 4)
          .sort((a, b) => b[1] - a[1]).slice(0, 6).map(([url]) => url),
        pageText: document.body?.innerText || '',
      };
    });
    return result;
  } catch (error) {
    console.warn(`Could not read nutrition facts from ${productUrl}: ${error.message}`);
    return { carbohydrateGrams: null, proteinGrams: null, nutritionTable: null, productImageUrl: null, nutritionImageUrls: [], pageText: '' };
  }
}

let nutritionOcrWorker;
let nutritionOcrUnavailable = false;

async function prepareImageForOcr(page, body, contentType, { largestSide, threshold = false }) {
  const dataUrl = `data:${contentType};base64,${body.toString('base64')}`;
  const pngDataUrl = await page.evaluate(async ({ source, target, threshold }) => {
    const image = new Image();
    image.src = source;
    await image.decode();
    const largestSide = Math.max(image.naturalWidth, image.naturalHeight);
    const scale = Math.min(5, target / Math.max(1, largestSide));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.filter = threshold ? 'grayscale(1)' : 'grayscale(1) contrast(1.35)';
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    if (threshold) {
      // Pure black and white keeps thin digits on small, blurry tables from
      // merging with cell borders.
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      for (let index = 0; index < pixels.data.length; index += 4) {
        const value = pixels.data[index] < 150 ? 0 : 255;
        pixels.data[index] = value;
        pixels.data[index + 1] = value;
        pixels.data[index + 2] = value;
      }
      context.putImageData(pixels, 0, 0);
    }
    return canvas.toDataURL('image/png');
  }, { source: dataUrl, target: largestSide, threshold });
  return Buffer.from(pngDataUrl.slice(pngDataUrl.indexOf(',') + 1), 'base64');
}

// Each image is read at a few scales and segmentation modes until a reading
// passes validation; a single OCR pass regularly drops digits ("11" -> "1").
const ocrAttempts = [
  { largestSide: 2000, pageSegMode: '4' },
  { largestSide: 2800, pageSegMode: '4' },
  { largestSide: 1400, pageSegMode: '4' },
  { largestSide: 2000, pageSegMode: '6' },
  { largestSide: 2800, pageSegMode: '4', threshold: true },
];

async function readNutritionFromImages(context, page, imageUrls, productUrl) {
  if (nutritionOcrUnavailable || !imageUrls?.length) return null;
  try {
    nutritionOcrWorker ||= await createWorker('por');
  } catch (error) {
    nutritionOcrUnavailable = true;
    console.warn(`Image OCR is unavailable: ${error.message}`);
    return null;
  }

  const unverified = [];
  for (const imageUrl of imageUrls) {
    try {
      const response = await context.request.get(imageUrl, {
        headers: productUrl ? { referer: `${new URL(productUrl).origin}/` } : {},
        timeout: 30000,
      });
      if (!response.ok()) continue;
      const contentType = (response.headers()['content-type'] || '').split(';')[0];
      if (!contentType.toLowerCase().startsWith('image/')) continue;
      const body = await response.body();
      if (!body.length || body.length > 10 * 1024 * 1024) continue;
      let verified = null;
      for (const attempt of ocrAttempts) {
        const png = await prepareImageForOcr(page, body, contentType, attempt);
        await nutritionOcrWorker.setParameters({ tessedit_pageseg_mode: attempt.pageSegMode });
        const { data } = await nutritionOcrWorker.recognize(png);
        const parsed = parseOcrNutritionTable(data.text);
        const validation = validateOcrNutrition(summarizeOcrNutrition(parsed));
        if (!validation) continue;
        const { summary, status } = validation;
        const result = { ...summary, table: ocrNutritionTable(parsed, summary), confidence: data.confidence, imageUrl, status };
        if (status === 'verified') {
          // Keep reading this image while saturated fat is missing; another
          // pass that verifies to the same macros may have read that row.
          if (!verified) verified = result;
          else if (sameReading(verified, result)) verified.table = mergeMissingRows(verified.table, result.table);
          if (hasSaturatedFat(verified.table)) return verified;
        } else if (!verified) unverified.push(result);
      }
      if (verified) return verified;
    } catch (error) {
      console.warn(`Could not OCR a product image: ${error.message}`);
    }
  }
  const agreed = agreeingReading(unverified);
  if (!agreed) return null;
  // Keep only the values both passes agreed on; the rest of that table is unchecked.
  const portion = `Porção: ${agreed.servingMassGrams} g`;
  const rows = [[portion], ['Proteínas (g)', String(agreed.proteinGrams).replace('.', ',')],
    ...(Number.isFinite(agreed.carbohydrateGrams) ? [['Carboidratos (g)', String(agreed.carbohydrateGrams).replace('.', ',')]] : [])]
    .map((cells) => ({ label: cells[0], cells, text: cells.join(' | ') }));
  return { ...agreed, table: { servingSize: `${agreed.servingMassGrams} g`, rows, text: rows.map((row) => row.text).join('\n') } };
}

function nutritionDetails(table) {
  if (!table?.rows?.length) return null;
  const normalize = (value) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const parseAmount = (value) => {
    if (!value) return null;
    const number = String(value).match(/\d+(?:[.,]\d+)?/);
    if (!number) return null;
    return Number(number[0].replace(/\./g, '').replace(',', '.'));
  };
  const definitions = [
    { name: 'Histidina', pattern: /histidina/, essential: true },
    { name: 'Isoleucina', pattern: /isoleucina/, essential: true },
    { name: 'Leucina', pattern: /leucina/, essential: true },
    { name: 'Lisina', pattern: /lisina/, essential: true },
    { name: 'Metionina', pattern: /metionina/, essential: true },
    { name: 'Fenilalanina', pattern: /fenilalanina/, essential: true },
    { name: 'Treonina', pattern: /treonina/, essential: true },
    { name: 'Triptofano', pattern: /triptofano/, essential: true },
    { name: 'Valina', pattern: /valina/, essential: true },
    { name: 'Alanina', pattern: /alanina/, essential: false },
    { name: 'Arginina', pattern: /arginina/, essential: false },
    { name: 'Aspartato', pattern: /aspartato|acido l? aspartico|aspartico/, essential: false },
    { name: 'Cisteína', pattern: /cisteina/, essential: false },
    { name: 'Ácido glutâmico', pattern: /glutamico/, essential: false },
    { name: 'Glicina', pattern: /glicina/, essential: false },
    { name: 'Prolina', pattern: /prolina/, essential: false },
    { name: 'Serina', pattern: /serina/, essential: false },
    { name: 'Tirosina', pattern: /tirosina/, essential: false },
    { name: 'Asparagina', pattern: /asparagina/, essential: false },
    { name: 'Glutamina', pattern: /glutamina/, essential: false },
  ];
  const energyRow = table.rows.find((row) => /valor energetico/i.test(normalize(row.label || row.text)));
  const energyKcalPerServing = parseAmount(energyRow?.cells?.[1] || energyRow?.text);
  const portionRow = table.rows.find((row) => /^\s*por[cç][aã]o\b/i.test(row.label || row.text || ''));
  // Some tables only give the serving in the column header ("Por 29 g", "30g").
  const headerCell = table.rows.slice(0, Math.max(table.rows.indexOf(energyRow), 1)).flatMap((row) => row.cells || [])
    .find((cell) => /^\s*(?:por\s+)?\d+(?:[.,]\d+)?\s*g\b/i.test(cell));
  const servingMassGrams = parseAmount((portionRow?.label || portionRow?.text || '').match(/\d+(?:[.,]\d+)?\s*g\b/i)?.[0])
    || parseAmount(table.servingSize?.match(/\d+(?:[.,]\d+)?\s*g\b/i)?.[0])
    || parseAmount(headerCell);
  const aminoAcids = { essential: [], nonEssential: [] };

  for (const row of table.rows) {
    const label = normalize(row.label || row.text);
    const definition = definitions.find((candidate) => candidate.pattern.test(label));
    if (!definition) continue;
    const amount = parseAmount(row.cells?.[1]);
    if (!Number.isFinite(amount)) continue;
    const unit = row.label.match(/\((mg|g)\)/i)?.[1]?.toLowerCase() || 'mg';
    aminoAcids[definition.essential ? 'essential' : 'nonEssential'].push({
      name: definition.name,
      amount,
      unit,
    });
  }

  return {
    servingMassGrams,
    ...fatDetails(table),
    energyKcalPerServing,
    energyKcalPer100g: Number.isFinite(energyKcalPerServing) && Number.isFinite(servingMassGrams) && servingMassGrams > 0
      ? (energyKcalPerServing / servingMassGrams) * 100
      : null,
    aminoAcids: aminoAcids.essential.length || aminoAcids.nonEssential.length ? aminoAcids : null,
  };
}

function packageMassFromNutrition(table) {
  if (!table?.text) return null;
  const normalized = table.text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const match = normalized.match(/porcoes por embalagem[^\n(]*\(\s*(\d+(?:[.,]\d+)?)\s*g\s*\)/i);
  return match ? Number(match[1].replace(',', '.')) : null;
}

function imageExtension(imageUrl, contentType) {
  const mimeExtensions = {
    'image/avif': 'avif',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
  };
  const mime = contentType.split(';')[0].trim().toLowerCase();
  if (mimeExtensions[mime]) return mimeExtensions[mime];
  const urlExtension = path.extname(new URL(imageUrl).pathname).slice(1).toLowerCase();
  return ['avif', 'jpg', 'jpeg', 'png', 'webp'].includes(urlExtension) ? (urlExtension === 'jpeg' ? 'jpg' : urlExtension) : null;
}

async function saveProductImages(catalog, context, previousImages, problems) {
  const imageDirectory = path.join(root, 'assets', 'products');
  await mkdir(imageDirectory, { recursive: true });
  let saved = 0;

  for (const products of Object.values(catalog)) {
    for (const product of products) {
      if (!product.imageUrl) continue;
      const slug = product.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
        .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
      const hash = createHash('sha256').update(product.imageUrl).digest('hex').slice(0, 10);
      const filename = `${slug}-${hash}.webp`;
      // The file name comes from the image address, so a saved file is current.
      if (await access(path.join(imageDirectory, filename)).then(() => true, () => false)) {
        product.image = `assets/products/${filename}`;
        delete product.imageUrl;
        continue;
      }
      try {
        const referer = product.url ? `${new URL(product.url).origin}/` : undefined;
        const response = await context.request.get(product.imageUrl, {
          headers: referer ? { referer } : {},
          timeout: 30000,
        });
        if (!response.ok()) throw new Error(`HTTP ${response.status()}`);
        const contentType = response.headers()['content-type'] || '';
        const extension = imageExtension(product.imageUrl, contentType);
        if (!contentType.toLowerCase().startsWith('image/') || !extension) throw new Error(`Unexpected content type: ${contentType || 'unknown'}`);
        const body = await response.body();
        if (body.length > 10 * 1024 * 1024) throw new Error('Image exceeds the 10 MB limit');

        await writeFile(path.join(imageDirectory, filename), await productThumbnail(body));
        product.image = `assets/products/${filename}`;
        delete product.imageUrl;
        saved += 1;
      } catch (error) {
        console.warn(`Could not save image for "${product.name}": ${error.message}`);
        delete product.imageUrl;
        const previousImage = previousImages.get(product.url);
        if (previousImage) product.image = previousImage;
        problems.push(`${product.name}: image download failed (${error.message})${previousImage ? '; kept the previous image' : ''}.`);
      }
    }
  }

  return saved;
}

const browser = await chromium.launch({ headless: process.env.HEADLESS === '1' });
try {
  const context = await browser.newContext({ locale: 'pt-BR' });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);

  const storeCategoryNames = [...Object.keys(STORE_CATEGORIES),
    ...new Set(Object.values(STORE_CATEGORIES).flatMap((rule) => rule.stores.map((store) => store.store)))];
  const known = [...sources.map((source) => source.brand), ...storeCategoryNames];
  if (sourceOnly && !known.some((name) => name.toLowerCase() === sourceOnly.toLowerCase())) {
    throw new Error(`Unknown product source "${sourceOnly}". Available: ${known.join(', ')}`);
  }
  // The previous catalog is the baseline for spotting broken sources, and its
  // data is kept for any source that fails.
  const emptyCatalog = () => Object.fromEntries(['whey', 'sunscreen', 'creatine', ...Object.keys(STORE_CATEGORIES)].map((category) => [category, []]));
  let existingCatalog = emptyCatalog();
  try {
    existingCatalog = { ...emptyCatalog(), ...JSON.parse(await readFile(outputPath, 'utf8')).products };
  } catch (error) {
    if (sourceOnly) throw new Error(`Could not load the existing catalog for a source-only update: ${error.message}`);
    console.warn(`No previous catalog to compare against: ${error.message}`);
  }
  const problems = [];
  // Runs one source's scraper. When it throws or returns far fewer products
  // than before, the previous products are kept and the problem is reported.
  async function refreshSource(label, previous, fetchProducts) {
    let found = [];
    try {
      found = await fetchProducts();
    } catch (error) {
      problems.push(`${label}: scraping failed (${error.message}).`);
    }
    const reason = shrinkage(found.length, previous.length);
    if (!reason) return { products: found, kept: false };
    problems.push(`${label}: ${reason}; kept the previous products. The site may have changed or blocked the scraper.`);
    return { products: previous, kept: true };
  }

  const catalog = emptyCatalog();
  const catalogProducts = new Map();
  // Products of failed sources, copied from the previous catalog unchanged.
  const keptWhey = [];
  for (const source of sources.filter((item) => !sourceOnly || item.brand.toLowerCase() === sourceOnly.toLowerCase())) {
    if ((source.category && source.category !== 'whey') || source.whey === false) continue;
    const searchUrls = source.searchUrls || [source.searchUrl];
    const previous = existingCatalog.whey.filter((product) => product.brand === source.brand);
    const result = await refreshSource(source.brand, previous, async () => {
      if (source.vtex || source.shopify) {
        const listings = source.vtex ? await fetchVtexSupplements(source, 'whey') : await fetchShopifySupplements(source, 'whey');
        return listings.map((raw) => toProduct(raw, 'whey', source)).filter((product) => product?.url);
      }
      const found = [];
      for (const [index, searchUrl] of searchUrls.entries()) {
        found.push(...await scrapeSearch(page, { ...source, searchUrl }, 'whey'));
        if (index < searchUrls.length - 1) await page.waitForTimeout(1200);
      }
      return found;
    });
    console.log(`Found ${result.kept ? 0 : result.products.length} whey listings from ${source.brand}.`);
    if (result.kept) keptWhey.push(...result.products);
    else {
      for (const product of result.products) {
        const normalizedName = product.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
        const identity = `${product.brand}:${normalizedName}:${product.amount}${product.unit}`;
        const existing = catalogProducts.get(identity);
        if (!existing) catalogProducts.set(identity, product);
        else {
          if (product.price < existing.price) existing.price = product.price;
          if (!existing.imageUrl && product.imageUrl) existing.imageUrl = product.imageUrl;
        }
      }
    }
    await page.waitForTimeout(1200);
  }
  const refreshedWhey = [...catalogProducts.values()];
  catalog.whey = [
    ...(sourceOnly ? existingCatalog.whey.filter((product) => product.brand.toLowerCase() !== sourceOnly.toLowerCase()) : []),
    ...keptWhey,
    ...refreshedWhey,
  ];

  if (!sourceOnly || sources.find((source) => source.brand.toLowerCase() === sourceOnly.toLowerCase())?.category === 'sunscreen') {
    const sunscreenSource = sources.find((source) => source.category === 'sunscreen');
    const previousFrom = (store) => existingCatalog.sunscreen.filter((product) => product.store === store);
    const nutriex = await refreshSource(sunscreenSource.brand, previousFrom(sunscreenSource.brand),
      () => scrapeLojaDoMecanicoSunscreens(page, sunscreenSource));
    catalog.sunscreen = nutriex.products;
    console.log(`Found ${nutriex.kept ? 0 : nutriex.products.length} Nutriex sunscreen listings from Loja do Mecânico.`);
    for (const vtexSource of vtexSunscreenSources) {
      const source = { ...vtexSource, brand: vtexSource.store, vtex: true };
      const result = await refreshSource(source.store, previousFrom(source.store), async () => (await fetchVtexSunscreens(source))
        .map((raw) => toProduct(raw, 'sunscreen', source)).filter((product) => product?.url));
      catalog.sunscreen.push(...result.products);
      console.log(`Found ${result.kept ? 0 : result.products.length} sunscreen listings from ${source.store}.`);
    }
    keepPreviousReviews(catalog.sunscreen, existingCatalog.sunscreen);
    await addMercadoLivreData(catalog.sunscreen, existingCatalog.sunscreen);
  } else {
    catalog.sunscreen = existingCatalog.sunscreen;
  }

  if (catalog.whey.length === 0) {
    throw new Error('No whey products were extracted. The store page may have changed or blocked the browser; existing catalog was left untouched.');
  }

  let imageOcrRecoveries = 0;
  const previousWheyByUrl = new Map(existingCatalog.whey.map((product) => [product.url, product]));
  for (const product of refreshedWhey) {
    const detailsUrl = nutritionSourceUrl(product, catalog.whey);
    if (!detailsUrl) {
      product.carbohydrateGrams = null;
      product.proteinGrams = null;
      product.carbProteinRatio = null;
      product.nutritionTable = null;
      product.nutritionDetails = null;
      delete product.estimatedAmount;
      if (keepPreviousNutrition(product, previousWheyByUrl.get(product.url))) continue;
      console.warn(`No product detail page found for nutrition data: ${product.name}`);
      continue;
    }
    const nutrition = await scrapeNutrition(page, detailsUrl);
    // Listing pages lazy-load card images, so a card can come back without one.
    if (!product.imageUrl && detailsUrl === product.url && nutrition.productImageUrl) product.imageUrl = nutrition.productImageUrl;
    delete nutrition.productImageUrl;
    addLabel(product, labelInfo(nutrition.pageText), previousWheyByUrl.get(product.url));
    delete nutrition.pageText;
    const htmlServingMass = nutritionDetails(nutrition.nutritionTable)?.servingMassGrams;
    if (!Number.isFinite(nutrition.proteinGrams) || !Number.isFinite(nutrition.carbohydrateGrams) || !Number.isFinite(htmlServingMass)) {
      const imageNutrition = await readNutritionFromImages(context, page, nutrition.nutritionImageUrls, detailsUrl);
      if (imageNutrition) {
        nutrition.proteinGrams = imageNutrition.proteinGrams;
        nutrition.carbohydrateGrams = imageNutrition.carbohydrateGrams;
        nutrition.nutritionTable = imageNutrition.table;
        nutrition.nutritionDataSource = 'product image OCR';
        nutrition.nutritionOcrConfidence = imageNutrition.confidence;
        nutrition.nutritionImageUrl = imageNutrition.imageUrl;
        nutrition.nutritionOcrVerified = imageNutrition.status === 'verified';
        if (!nutrition.nutritionOcrVerified) console.warn(`OCR nutrition for ${product.name} could not be checked against its energy value; review it.`);
      }
    }
    delete nutrition.nutritionImageUrls;
    if (product.estimatedAmount) {
      const exactMass = packageMassFromNutrition(nutrition.nutritionTable);
      if (Number.isFinite(exactMass) && exactMass > 0) {
        product.amount = exactMass;
        product.unit = 'g';
      }
      delete product.estimatedAmount;
    }
    product.carbohydrateGrams = nutrition.carbohydrateGrams;
    product.proteinGrams = nutrition.proteinGrams;
    product.nutritionTable = nutrition.nutritionTable;
    product.nutritionDetails = nutritionDetails(nutrition.nutritionTable);
    if (nutrition.nutritionDataSource) {
      product.nutritionDataSource = nutrition.nutritionDataSource;
      product.nutritionOcrConfidence = nutrition.nutritionOcrConfidence;
      product.nutritionImageUrl = nutrition.nutritionImageUrl;
      product.nutritionOcrVerified = nutrition.nutritionOcrVerified;
      imageOcrRecoveries += 1;
    }
    product.carbProteinRatio = Number.isFinite(nutrition.carbohydrateGrams)
      && Number.isFinite(nutrition.proteinGrams)
      && nutrition.proteinGrams > 0
      ? nutrition.carbohydrateGrams / nutrition.proteinGrams
      : null;
    if (product.carbProteinRatio === null && keepPreviousNutrition(product, previousWheyByUrl.get(product.url))) {
      console.warn(`Kept previous nutrition facts for: ${product.name} (this run could not read them)`);
    } else if (product.carbProteinRatio === null) console.warn(`Nutrition facts not found for: ${product.name}`);
  }

  catalog.creatine = await refreshCreatine(page, existingCatalog.creatine, problems, refreshSource);
  await refreshStoreCategories(page, catalog, existingCatalog, problems, refreshSource);

  if (!sourceOnly && !catalog.sunscreen.length) {
    throw new Error('No Nutriex sunscreen products were extracted. The store page may have changed or blocked the browser; existing catalog was left untouched.');
  }

  problems.push(...compareProducts(existingCatalog.whey, refreshedWhey));
  problems.push(...compareProducts(existingCatalog.sunscreen, catalog.sunscreen));
  problems.push(...compareProducts(existingCatalog.creatine, catalog.creatine));
  for (const category of Object.keys(STORE_CATEGORIES)) problems.push(...compareProducts(existingCatalog[category], catalog[category]));
  const previousImages = new Map(Object.values(existingCatalog).flat()
    .filter((product) => product.url && product.image).map((product) => [product.url, product.image]));
  const imageCount = await saveProductImages(catalog, context, previousImages, problems);
  const output = {
    sources: [...new Map([...sources.map(({ brand, origin }) => ({ brand, url: origin })),
      ...vtexSunscreenSources.map(({ store, origin }) => ({ brand: store, url: origin })),
      ...Object.values(STORE_CATEGORIES).flatMap((rule) => rule.stores.map(({ store, origin }) => ({ brand: store, url: origin })))]
      .map((source) => [source.url, source])).values()],
    updatedAt: new Date().toISOString(),
    products: catalog,
  };
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  console.log(`Saved ${Object.entries(catalog).map(([category, products]) => `${products.length} ${category}`).join(', ')} and ${imageCount} product images to the local catalog.`);
  console.log(`Recovered nutrition data from product images for ${imageOcrRecoveries} whey products.`);
  if (problems.length) {
    console.error(`\n${problems.length} problem(s) found. Review them before publishing:`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exitCode = 1;
  } else {
    console.log('No problems found compared with the previous catalog.');
  }
  console.log('Review the data, then commit and push it to publish the updated catalog.');
} finally {
  if (nutritionOcrWorker) await nutritionOcrWorker.terminate();
  await browser.close();
}
