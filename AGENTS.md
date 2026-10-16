# Compensa?

Static price comparison site (whey protein and sunscreen), in Portuguese.

## Layout

- Site: `index.html`, `privacidade.html`, `script.js`, `styles.css`, `data/products.json`, `assets/products/`.
- Scraper (not published): `scripts/update-products.mjs` (Playwright + Tesseract OCR, no LLMs), `scripts/vtex-sunscreens.mjs` (VTEX catalog API), `scripts/nutrition-*.mjs`.

## Commands

- `make update-products`: refresh `data/products.json` and images. `SOURCE=<brand>` refreshes one source.
- `make serve`: local server on port 8001, no caching.
- `make build`: copy only the public site into `dist/`.
- `npm test`: OCR parser tests.

## Hosting

- Domain: https://compensaprecos.com.br (registered at Registro.br on 2026-10-16); DNS on Cloudflare (`garret.ns.cloudflare.com`, `joan.ns.cloudflare.com`).
- Hosted as a Cloudflare Worker with static assets (`wrangler.jsonc` serves `dist/`). Build: `npm run build`; deploy: `npx wrangler deploy`.
- Every push to `main` on `github.com/henesaud/compensa` (private repo) redeploys.
- Build variables: `SITE_URL` (absolute URL for the social preview image), `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`.

## Conventions

- Bump `?v=N` on `styles.css` and `script.js` in `index.html` after changing them, so browsers stop using the cached copy.
- Google Analytics `G-VXZPZ6TDW4` loads directly (no cookie banner, by choice).
