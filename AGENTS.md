# Compensa?

Static price comparison site (whey protein, creatine and sunscreen), in Portuguese.

## Layout

- Site: `index.html`, `privacidade.html`, `script.js`, `styles.css`, `data/products.json`, `assets/products/`.
- Scraper (not published): `scripts/update-products.mjs` (Playwright + Tesseract OCR, no LLMs), `scripts/vtex-sunscreens.mjs` (VTEX catalog API), `scripts/nutrition-*.mjs`, `scripts/sunscreen-reviews.mjs`, `scripts/mercadolivre-catalog.mjs`, `scripts/whey-label.mjs`, `scripts/supplement-rules.mjs`, `scripts/check-catalog.mjs`, `scripts/vtex-supplements.mjs`, `scripts/shopify-supplements.mjs`.

## Commands

- `make update-products`: refresh `data/products.json` and images. `SOURCE=<brand>` refreshes one source; any sunscreen source (e.g. `SOURCE="Loja do Mecânico"`) refreshes all sunscreen sources, their reviews and Mercado Livre data.
- `make serve`: local server on port 8001, no caching.
- `make build`: copy only the public site into `dist/`.
- `npm test`: OCR parser, review keyword and whey label tests.
- `npm run check` (add `-- --site` with `make serve` running): sanity checks on `data/products.json` and the site. Run it after every update; see `.claude/skills/check-catalog`.

## Whey data

- Stores (`sources` in `scripts/update-products.mjs`): brand stores only, since they publish the nutrition table. Growth, Max Titanium and Essential are scraped from listing pages; VTEX stores (`vtex: true`: Probiótica, Nutrify) via the catalog API; Shopify stores (`shopify: true`: True Source, Soldiers) via `/products.json`; others (Dux, Adaptogen, New Nutrition) from a listing page with a `productPath` pattern. A new store's product URL pattern must also go in `isDirectProductUrl` in `script.js`, or the site hides its products.
- Kits, combos, bars, gainers and single sachets are skipped. Flavors sold as separate products with the same price and size are collapsed into one for API stores.
- Drogaria São Paulo also sells whey but its pages have no nutrition table, so it isn't used for whey. Integralmedica's store has no public product API. Black Skull, Vitafor, Atlhetica, Dark Lab and FTW were tried and left out: their pages have no nutrition table the scraper can read (only images it could not OCR).
- Label (`ingredients`, `allergens: { contains, mayContain }`, `gluten`, `lactose`): parsed from the product page text that the nutrition scrape already loads, by regex on the statements labels must print ("ALÉRGICOS: CONTÉM DERIVADOS DE…", "PODE CONTER…", "(NÃO) CONTÉM GLÚTEN", "CONTÉM LACTOSE"). `gluten`/`lactose` are `yes`, `no`, `depends` (flavors disagree) or null. Lactose counts only in upper case, so menus and Q&A don't match; Essential pages don't state it. A page that fails keeps the previous data.
- Mercado Livre is not used for whey: name matches were often wrong and its lactose data contradicts itself.

## Creatine data

- Same brand stores as whey; a source's `creatine` setting adds it (`true` for API stores, or the creatine search page). `whey: false` stores (Vitafor, Atlhetica, Black Skull, Dark Lab, FTW) sell only creatine here. Which listings count is in `scripts/supplement-rules.mjs` (capsules, kits and mixes are skipped).
- Compared by price per 100 g of creatine: `creatineShare` is creatine per serving over serving weight from the nutrition table (`creatineSource: 'table'`), or 1 when the ingredient list is creatine alone (`'ingredients'`) or the name says pure without a flavor (`'name'`). Without it the product has no unit price. Log to check: "Creatine content not found…".

## Sunscreen data

- Stores: Nutriex from Loja do Mecânico (Playwright); Adcos, Dermage and Drogaria São Paulo from the VTEX catalog API (Drogaria São Paulo by the brand list in `vtexSunscreenSources`), which also gives the barcode (`ean`), ingredients (Adcos, Dermage) and texture.
- Reviews (`reviews`): unofficial, login-free widget APIs. Trustvox for Adcos (store id 719) and Dermage (106480), keyed by VTEX product id; Konfidency for Drogaria São Paulo (`drogariasaopaulo`), keyed by SKU id. The ids are in `vtexSunscreenSources`. The 150 most recent reviews are read and keyword-counted per trait (eyes stinging, sticky, oily, dry finish, white cast, pilling), with "yes" and negated "no" counted apart. Tags show at 3+ mentions. When a fetch fails, the previous run's reviews are kept.
- Mercado Livre catalog (`mercadoLivre`): attributes such as water resistant, oil free, tinted, kids, eye area. Looked up by barcode, or by brand + SPF + size + name for stores without one (Nutriex). Needs a developer app (`client_credentials`, no user login) with `ML_CLIENT_ID` and `ML_CLIENT_SECRET` in `.env` (gitignored); without them, the previous data is kept. Mercado Livre search, single listings, shipping and reviews are blocked for this kind of app (403), but a catalog product's offers (`/products/{id}/items`) and seller reputation (`/users/{id}`) are not: `mercadoLivre.offer` holds the cheapest new, free-shipping offer from a green-rated seller, between a third and three times the store price, fetched fresh every run. The site uses whichever is cheaper, store or Mercado Livre, for the unit price and the main link, and shows the other under the price. No affiliate links (the owner works at Mercado Livre).
- Logs to check after an update: "Could not read reviews…", "Kept previous reviews…", "Found Mercado Livre catalog data for X of Y sunscreens, with an offer for Z".

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
