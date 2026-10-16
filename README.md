# Compensa?

A Portuguese-language product comparison site for whey protein and sunscreen. It runs as a static site on GitHub Pages.

Live site: <https://henesaud.github.io/compensa/>

## Preview locally

```sh
make serve
```

Open <http://localhost:8001>.

## Update the catalog

```sh
npm install
npx playwright install chromium
make update-products
```

The updater collects whey products from Growth Supplements, Max Titanium, and Essential Nutrition, plus sunscreens: Nutriex from Dutra, Adcos and Dermage from their official stores, and Sundown, Episol, Cenoura e Bronze, Principia and Sallve from Drogaria São Paulo (read through the VTEX catalog API, see `scripts/vtex-sunscreens.mjs`). It saves prices, images, and available nutrition tables into `data/products.json`. When protein or serving-size data is missing from a page, it tries Portuguese OCR on product images. The first OCR run downloads the language data. OCR readings are checked against the label's energy value (4/4/9 kcal per gram of carbs, protein and fat); entries with `nutritionOcrVerified: false` could not be checked and should be reviewed before publishing. Run `npm test` after changing the OCR parser.

Review and push the updated catalog and images to GitHub to publish them.



**Under construction:** more products will be added soon.

## Publishing

`make build` copies only the public site (HTML, CSS, JS, catalog and the product images it uses) into `dist/`. Scraper scripts and OCR data are not published.
