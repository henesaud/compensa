// Copies only the public site into dist/ for hosting. Scraper scripts, OCR
// data and dev files stay out. Product images not used by the catalog are
// skipped. Set SITE_URL (e.g. https://compensa.com.br) to make the social
// preview image URL absolute, which WhatsApp and others require.
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const files = ['catalog.js', 'script.js', 'styles.css', 'favicon.svg', 'og-image.png', 'privacidade.html', '_headers', 'robots.txt', 'data/products.json'];

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
for (const file of files) await cp(path.join(root, file), path.join(dist, file));

const siteUrl = (process.env.SITE_URL || '').replace(/\/$/, '');
const catalog = JSON.parse(await readFile(path.join(root, 'data/products.json'), 'utf8'));
const index = await readFile(path.join(root, 'index.html'), 'utf8');

// catalog.js holds the page texts and the price math the site uses, so the
// pages are prerendered with the same code.
const { ROOT_PAGE, CATEGORY_PAGES, renderCategorySummary } = vm.runInNewContext(
  `${await readFile(path.join(root, 'catalog.js'), 'utf8')}\n({ ROOT_PAGE, CATEGORY_PAGES, renderCategorySummary });`, { URL, Intl });

function replaceOnce(html, pattern, replacement) {
  if (!pattern.test(html)) throw new Error(`index.html no longer matches ${pattern}`);
  return html.replace(pattern, replacement);
}

const escapeAttribute = (value) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

// One page per category plus the home page (whey), each with its own title,
// description, address, active tab and summary.
function renderPage(page, category) {
  let html = index;
  if (siteUrl) html = replaceOnce(html, /content="\/og-image\.png"/, `content="${siteUrl}/og-image.png"`);
  html = replaceOnce(html, /<title>[^<]*<\/title>/, `<title>${escapeAttribute(page.title)}</title>`);
  html = replaceOnce(html, /<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${escapeAttribute(page.title)}">`);
  html = replaceOnce(html, /<meta name="description" content="[^"]*">/, `<meta name="description" content="${escapeAttribute(page.description)}">`);
  if (page !== ROOT_PAGE) html = replaceOnce(html, /<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${escapeAttribute(page.description)}">`);
  html = replaceOnce(html, /<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="https://compensaprecos.com.br${page.path}">`);
  html = replaceOnce(html, /(<h1 id="comparison-title">)[^<]*(<\/h1>)/, `$1${page.heading}$2`);
  html = replaceOnce(html, /<a class="category-button[^"]*" href="([^"]+)" data-category="(\w+)"[^>]*>/g, (_, href, tab) => (tab === category
    ? `<a class="category-button is-active" href="${href}" data-category="${tab}" aria-current="page">`
    : `<a class="category-button" href="${href}" data-category="${tab}">`));
  if (category === 'sunscreen') html = replaceOnce(html, /<button class="guide-button" id="guide-button" type="button" hidden>/, '<button class="guide-button" id="guide-button" type="button">');
  return replaceOnce(html, /(<section class="category-summary" id="category-summary"[^>]*>)(<\/section>)/, `$1${renderCategorySummary(category, catalog)}$2`);
}

// Workers static assets serve whey.html at /whey.
await writeFile(path.join(dist, 'index.html'), renderPage(ROOT_PAGE, 'whey'));
for (const [category, page] of Object.entries(CATEGORY_PAGES)) {
  await writeFile(path.join(dist, `${page.path.slice(1)}.html`), renderPage(page, category));
}

// The sitemap lists every page, dated by the last catalog update.
const catalogDate = catalog.updatedAt?.slice(0, 10);
const pageUrls = ['/', ...Object.values(CATEGORY_PAGES).map((page) => page.path), '/privacidade.html'].map((page) => `  <url><loc>https://compensaprecos.com.br${page}</loc>${catalogDate ? `<lastmod>${catalogDate}</lastmod>` : ''}</url>`);
await writeFile(path.join(dist, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pageUrls.join('\n')}\n</urlset>\n`);

const images = Object.values(catalog.products).flat().map((product) => product.image).filter(Boolean);
for (const image of new Set(images)) await cp(path.join(root, image), path.join(dist, image));
console.log(`Built dist/ with ${files.length + 2 + Object.keys(CATEGORY_PAGES).length} files and ${new Set(images).size} product images.`);
