---
name: check-catalog
description: Check the Compensa? catalog and site for data bugs (misread sizes, prices, SPF, protein or creatine content, bundles, items that are not the category) and fix them. Use after `make update-products`, after adding a store or category, or when the user asks to look for bugs in the products or the site.
---

# Check the catalog

Bugs here are usually values that parse but make no sense: "FPS 70 L'Oréal" read as 70 liters, a R$ 13,90 price for 500 g of creatine, a 3 g sachet listed as a package, a lip balm compared per 100 g with body lotions. One of them at the top of a ranking misleads every visitor, so treat each finding as real until checked.

## 1. Run the checks

```sh
npm run check                      # data only
make serve &                       # then, for the site too:
npm run check -- --site
```

`scripts/check-catalog.mjs` prints `ERROR` and `WARN` lines per product, then the totals. It checks:

- package size against the category's range and against the sizes written in the name
- price range, and unit prices far from the category median (a misread size or price)
- whey: protein share of the serving, carb/protein, energy vs. macros
- creatine: creatine share; sunscreen: SPF range and SPF vs. the name, review summaries
- bundles (kit, combo, duo, 2x), duplicates, missing images and bad URLs
- with `--site`: every tab renders, no card without a unit price, no browser errors

## 2. Investigate each finding

For each line, open the product URL (or read the store's API/page) and decide:

- **Real data bug** (the store page says something else): fix the parser or filter that produced it, not just the value. Scraper code: `scripts/update-products.mjs` (`parseAmount`, `parsePrice`, `parseSpf`, `toProduct`), `scripts/supplement-rules.mjs` (what counts as whey/creatine), `scripts/vtex-sunscreens.mjs` (sunscreen filters). Add a test next to the module when the rule is subtle. Then correct `data/products.json` with the same rule (a short node script reusing the module), or re-run that source with `node scripts/update-products.mjs --source "<brand>"`.
- **Not the category** (makeup with SPF, lip balm, capsules, kits): extend the exclude pattern and remove the products.
- **Real but unusual** (a cheap 4 l refill, a low-protein whey that its own table confirms): leave it. If the check keeps flagging true values, adjust its threshold in `check-catalog.mjs` and say why in a comment.

Also look beyond the script: open the site (`make serve`, http://localhost:8001) with Playwright, go through every tab, sort by each column and open the dialogs (details, label, compare). Look at the first and last cards of each ranking; misreads end up there.

## 3. Report

Tell the user what was wrong, what caused it and what was changed, plus the warnings left on purpose and why. Keep every field in `data/products.json` except for products removed as not belonging to the category. Bump `?v=N` in `index.html` if `script.js` or `styles.css` changed.
