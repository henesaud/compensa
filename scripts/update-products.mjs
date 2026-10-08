import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = path.join(root, 'data', 'products.json');
const searches = [{ category: 'whey', query: 'whey' }];

function parsePrice(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (!value) return null;
  const normalized = String(value).replace(/[^\d.,]/g, '').replace(/\./g, '').replace(',', '.');
  const price = Number(normalized);
  return Number.isFinite(price) && price > 0 ? price : null;
}

function parseAmount(name, category) {
  const pattern = category === 'whey' ? /(\d+(?:[.,]\d+)?)\s*(kg|g)\b/i : /(\d+(?:[.,]\d+)?)\s*(ml|l)\b/i;
  const match = String(name).match(pattern);
  if (!match) return null;
  const amount = Number(match[1].replace(',', '.'));
  const unit = match[2].toLowerCase();
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return { amount, unit };
}

function productType(name, category) {
  const normalized = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
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

function toProduct(raw, category) {
  const name = String(raw.name || '').replace(/\s+/g, ' ').trim();
  const normalizedName = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (category === 'whey' && !normalizedName.includes('whey')) return null;
  const amount = parseAmount(name, category) || parseAmount(raw.text || '', category);
  const price = parsePrice(raw.price);
  if (!name || !amount || !price) return null;

  const brand = String(raw.brand || 'Growth Supplements').trim();
  const url = isDirectProductUrl(raw.url) ? raw.url : undefined;
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

  return product;
}

function isDirectProductUrl(value) {
  try {
    const url = new URL(value);
    return url.hostname === 'www.gsuplementos.com.br' && /-p\d+$/i.test(url.pathname);
  } catch {
    return false;
  }
}

async function scrapeSearch(page, query, category) {
  const url = new URL('https://www.gsuplementos.com.br/busca');
  url.searchParams.set('busca', query);
  console.log(`Searching ${query}: ${url}`);
  await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 60000 });
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

  const extracted = await page.evaluate(() => {
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
    const tokens = (value) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().match(/[a-z0-9]+/g) || [];
    const productNameTokens = (value) => new Set(tokens(value).filter((token) => token.length > 2 || ['2w', '3w'].includes(token))
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
      .filter((link) => link.url && /(?:-p\d+|\/produto\/|\/product\/)/i.test(link.url));
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
        const productUrl = /(?:-p\d+|\/produto\/|\/product\/)/i.test(directUrl) ? directUrl : findProductUrl(node.name);
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

    const productLinks = [...document.querySelectorAll('a[href]')].filter((anchor) => /(?:-p\d+|\/produto\/|\/product\/)/i.test(anchor.href));
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
      const name = headings[0] || anchor.innerText.trim() || imageAlt;
      const productLinks = [...bestCard.querySelectorAll('a[href]')]
        .map((link) => ({ url: absoluteUrl(link.href), tokens: new Set(tokens(new URL(link.href).pathname)) }))
        .filter((link) => link.url && /(?:-p\d+|\/produto\/|\/product\/)/i.test(link.url));
      const bestLink = productLinks
        .map((link) => ({ ...link, score: linkScore(name, link) }))
        .sort((a, b) => b.score - a.score)[0];
      if (!tokens(name).includes('whey') || !bestLink || bestLink.score < 2) continue;
      const priceMatches = [...text.matchAll(/R\$\s*([\d.]+,\d{2})/gi)];
      const nonInstallmentPrices = priceMatches.filter((match) => {
        const before = text.slice(Math.max(0, match.index - 16), match.index);
        return !/\d+\s*x\s*(?:de\s*)?$/i.test(before);
      });
      const price = nonInstallmentPrices[0]?.[1] || priceMatches[0]?.[1];
      if (name && price) output.push({ name, text, price, url: bestLink.url, imageUrl, brand: 'Growth Supplements' });
    }
    return output;
  });

  const products = new Map();
  let withoutDirectLink = 0;
  for (const raw of extracted) {
    const product = toProduct(raw, category);
    if (!product) continue;
    if (!product.url) {
      withoutDirectLink += 1;
      continue;
    }
    const normalizedName = product.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const identity = `${normalizedName}:${product.amount}${product.unit}`;
    const existing = products.get(identity);
    if (!existing) products.set(identity, product);
    else {
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
    await page.waitForTimeout(1200);
    return await page.evaluate(() => {
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
      const rows = [
        ...uniqueRows.map((row) => row.text),
        ...(document.body?.innerText || '').split('\n'),
      ].map((row) => row.replace(/\s+/g, ' ').trim()).filter(Boolean);

      const findGrams = (pattern) => {
        for (const row of rows) {
          const normalizedRow = normalize(row);
          if (!pattern.test(normalizedRow)) continue;
          const labelIndex = normalizedRow.search(pattern);
          const rest = row.slice(labelIndex + normalizedRow.slice(labelIndex).match(pattern)[0].length);
          const value = rest.match(/(?:^|[^\d])(\d+(?:[.,]\d+)?)/);
          if (value) return Number(value[1].replace(',', '.'));
        }
        return null;
      };

      return {
        carbohydrateGrams: findGrams(/^carboidratos?\b/),
        proteinGrams: findGrams(/^proteinas?\b/),
        nutritionTable,
      };
    });
  } catch (error) {
    console.warn(`Could not read nutrition facts from ${productUrl}: ${error.message}`);
    return { carbohydrateGrams: null, proteinGrams: null, nutritionTable: null };
  }
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

async function saveProductImages(catalog, context) {
  const imageDirectory = path.join(root, 'assets', 'products');
  await mkdir(imageDirectory, { recursive: true });
  let saved = 0;

  for (const products of Object.values(catalog)) {
    for (const product of products) {
      if (!product.imageUrl) continue;
      try {
        const response = await context.request.get(product.imageUrl, {
          headers: { referer: 'https://www.gsuplementos.com.br/' },
          timeout: 30000,
        });
        if (!response.ok()) throw new Error(`HTTP ${response.status()}`);
        const contentType = response.headers()['content-type'] || '';
        const extension = imageExtension(product.imageUrl, contentType);
        if (!contentType.toLowerCase().startsWith('image/') || !extension) throw new Error(`Unexpected content type: ${contentType || 'unknown'}`);
        const body = await response.body();
        if (body.length > 10 * 1024 * 1024) throw new Error('Image exceeds the 10 MB limit');

        const slug = product.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
          .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
        const hash = createHash('sha256').update(product.imageUrl).digest('hex').slice(0, 10);
        const filename = `${slug}-${hash}.${extension}`;
        await writeFile(path.join(imageDirectory, filename), body);
        product.image = `assets/products/${filename}`;
        delete product.imageUrl;
        saved += 1;
      } catch (error) {
        console.warn(`Could not save image for "${product.name}": ${error.message}`);
        delete product.imageUrl;
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

  const catalog = { whey: [] };
  for (const [index, search] of searches.entries()) {
    catalog[search.category] = await scrapeSearch(page, search.query, search.category);
    console.log(`Found ${catalog[search.category].length} ${search.category} products.`);
    if (index < searches.length - 1) await page.waitForTimeout(1500);
  }

  if (catalog.whey.length === 0) {
    throw new Error('No whey products were extracted. The store page may have changed or blocked the browser; existing catalog was left untouched.');
  }

  for (const product of catalog.whey) {
    let detailsUrl = nutritionSourceUrl(product, catalog.whey);
    if (!detailsUrl && /\b(?:2w|3w)\b/i.test(product.name)) {
      const query = product.name.replace(/\b\d+(?:[.,]\d+)?\s*(?:kg|g)\b/i, '').trim();
      const related = await scrapeSearch(page, query, 'whey');
      const marker = product.name.match(/\b(?:2w|3w)\b/i)?.[0].toLowerCase();
      detailsUrl = related.find((candidate) => candidate.url && candidate.name.toLowerCase().includes(marker))?.url;
    }
    if (!detailsUrl) {
      product.carbohydrateGrams = null;
      product.proteinGrams = null;
      product.carbProteinRatio = null;
      product.nutritionTable = null;
      console.warn(`No product detail page found for nutrition data: ${product.name}`);
      continue;
    }
    const nutrition = await scrapeNutrition(page, detailsUrl);
    product.carbohydrateGrams = nutrition.carbohydrateGrams;
    product.proteinGrams = nutrition.proteinGrams;
    product.nutritionTable = nutrition.nutritionTable;
    product.carbProteinRatio = Number.isFinite(nutrition.carbohydrateGrams)
      && Number.isFinite(nutrition.proteinGrams)
      && nutrition.proteinGrams > 0
      ? nutrition.carbohydrateGrams / nutrition.proteinGrams
      : null;
    if (product.carbProteinRatio === null) console.warn(`Nutrition facts not found for: ${product.name}`);
  }

  const imageCount = await saveProductImages(catalog, context);
  const output = {
    source: 'https://www.gsuplementos.com.br',
    updatedAt: new Date().toISOString(),
    products: catalog,
  };
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  console.log(`Saved ${catalog.whey.length} whey products and ${imageCount} product images to the local catalog.`);
  console.log('Review the data, then commit and push it to publish the updated catalog.');
} finally {
  await browser.close();
}
