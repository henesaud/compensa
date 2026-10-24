# Compensa?

### 🌐 **[compensaprecos.com.br](https://compensaprecos.com.br)** — see it live

A Portuguese-language price comparison site. It compares products by unit price (per gram of protein, per 100 g of creatine, per ml, per diaper, etc.) across brand stores, pharmacies, supermarkets and Mercado Livre:

- Supplements: whey, creatine, protein bars, omega 3, peanut butter
- Skin care: sunscreen, moisturizer, vitamin C
- Home and baby: diapers, toilet paper, laundry detergent
- Pet food

## Preview locally

```sh
make serve
```

Open <http://localhost:8001>. Category pages (e.g. `/whey`, `/racao`) are served from `index.html`.

## Update the catalog

```sh
npm install
npx playwright install chromium
make update-products
npm run check
```

`SOURCE=<brand>`, `SOURCE=<category key>` (e.g. `petFood`) or `SOURCE=<store>` (e.g. `Cobasi`) refreshes only part of the catalog. Results go to `data/products.json` and `assets/products/`.

- Whey and creatine: brand stores (Growth, Max Titanium, Essential, Probiótica, Nutrify, True Source, Soldiers, Dux, Adaptogen, New Nutrition, and creatine-only stores), scraped with Playwright or read from VTEX and Shopify APIs. Nutrition tables, ingredients and allergens come from the product pages; Portuguese OCR (Tesseract) is used when the table is only an image, checked against the label's energy value.
- Sunscreen: Nutriex, Adcos, Dermage and Drogaria São Paulo, with store reviews keyword-counted per trait (stinging, sticky, oily, white cast…).
- Other categories: VTEX store catalogs (Drogaria São Paulo, Pague Menos, Savegnago, Zona Sul, Cobasi, Adcos, Dermage and the supplement brand stores).
- Mercado Livre: catalog attributes and the cheapest trusted offer for the same package, matched by barcode. Needs `ML_CLIENT_ID` and `ML_CLIENT_SECRET` in `.env`; without them the previous data is kept.

Run `npm test` after changing the OCR parser, review keywords or label parsing.

## Publishing

`make build` copies only the public site (HTML, CSS, JS, catalog, images, category pages and sitemap) into `dist/`. Scraper scripts and OCR data are not published.
