# Compensa?

A Portuguese-language price and nutrition comparison site for whey protein. It runs as a static site on GitHub Pages.

Live site: <https://henesaud.github.io/compensa/>

## Preview locally

```sh
make serve
```

Open <http://localhost:8000>.

## Update the catalog

```sh
npm install
npx playwright install chromium
make update-products
```

The updater collects product prices, images, and available nutrition tables into `data/products.json`. Review and push the updated catalog and images to GitHub to publish them.
