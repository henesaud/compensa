// Copies only the public site into dist/ for hosting. Scraper scripts, OCR
// data and dev files stay out. Product images not used by the catalog are
// skipped. Set SITE_URL (e.g. https://compensa.com.br) to make the social
// preview image URL absolute, which WhatsApp and others require.
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const files = ['script.js', 'styles.css', 'favicon.svg', 'og-image.png', 'privacidade.html', '_headers', 'data/products.json'];

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
for (const file of files) await cp(path.join(root, file), path.join(dist, file));

const siteUrl = (process.env.SITE_URL || '').replace(/\/$/, '');
const index = await readFile(path.join(root, 'index.html'), 'utf8');
await writeFile(path.join(dist, 'index.html'), siteUrl ? index.replace('content="/og-image.png"', `content="${siteUrl}/og-image.png"`) : index);

const catalog = JSON.parse(await readFile(path.join(root, 'data/products.json'), 'utf8'));
const images = Object.values(catalog.products).flat().map((product) => product.image).filter(Boolean);
for (const image of new Set(images)) await cp(path.join(root, image), path.join(dist, image));
console.log(`Built dist/ with ${files.length + 1} files and ${new Set(images).size} product images.`);
