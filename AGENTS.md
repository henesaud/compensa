# Compensa?

Static price comparison site (whey protein and sunscreen), in Portuguese.

## Layout

- Site: `index.html`, `privacidade.html`, `script.js`, `styles.css`, `data/products.json`, `assets/products/`.
- Scraper (not published): `scripts/update-products.mjs` (Playwright + Tesseract OCR, no LLMs), `scripts/vtex-sunscreens.mjs` (VTEX catalog API), `scripts/nutrition-*.mjs`, `scripts/sunscreen-reviews.mjs`, `scripts/mercadolivre-catalog.mjs`.

## Commands

- `make update-products`: refresh `data/products.json` and images. `SOURCE=<brand>` refreshes one source; any sunscreen source (e.g. `SOURCE="Loja do Mecânico"`) refreshes all sunscreen sources, their reviews and Mercado Livre data.
- `make serve`: local server on port 8001, no caching.
- `make build`: copy only the public site into `dist/`.
- `npm test`: OCR parser and review keyword tests.

## Sunscreen data

- Stores: Nutriex from Loja do Mecânico (Playwright); Adcos, Dermage and Drogaria São Paulo from the VTEX catalog API, which also gives the barcode (`ean`), ingredients (Adcos, Dermage) and texture.
- Reviews (`reviews`): unofficial, login-free widget APIs. Trustvox for Adcos (store id 719) and Dermage (106480), keyed by VTEX product id; Konfidency for Drogaria São Paulo (`drogariasaopaulo`), keyed by SKU id. The ids are in `vtexSunscreenSources`. The 150 most recent reviews are read and keyword-counted per trait (eyes stinging, sticky, oily, dry finish, white cast, pilling), with "yes" and negated "no" counted apart. Tags show at 3+ mentions. When a fetch fails, the previous run's reviews are kept.
- Mercado Livre catalog (`mercadoLivre`): attributes such as water resistant, oil free, tinted, kids, eye area. Looked up by barcode, or by brand + SPF + size + name for stores without one (Nutriex). Needs a developer app (`client_credentials`, no user login) with `ML_CLIENT_ID` and `ML_CLIENT_SECRET` in `.env` (gitignored); without them, the previous data is kept. Mercado Livre reviews, prices and listings are blocked for this kind of app (403).
- Logs to check after an update: "Could not read reviews…", "Kept previous reviews…", "Found Mercado Livre catalog data for X of Y".

## Hosting

- Domain: https://compensaprecos.com.br (registered at Registro.br on 2026-10-16); DNS on Cloudflare (`garret.ns.cloudflare.com`, `joan.ns.cloudflare.com`).
- Hosted as a Cloudflare Worker with static assets (`wrangler.jsonc` serves `dist/`). Build: `npm run build`; deploy: `npx wrangler deploy`.
- Every push to `main` on `github.com/henesaud/compensa` (private repo) redeploys.
- Build variables: `SITE_URL` (absolute URL for the social preview image), `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`.

## Conventions

- Bump `?v=N` on `styles.css` and `script.js` in `index.html` after changing them, so browsers stop using the cached copy.
- Google Analytics `G-VXZPZ6TDW4` loads directly (no cookie banner, by choice).
- Keep every field in `data/products.json` (nutrition tables, OCR metadata, etc.) even if the site does not show it yet; it will be used later.
- Product images are stored as 176 px WebP thumbnails (`scripts/product-image.mjs`); the site only shows them at 88 px or less.
