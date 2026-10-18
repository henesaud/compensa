// Catalog helpers shared by the site (script.js) and the build
// (scripts/build-site.mjs, which runs this file to prerender the category
// pages). No DOM access here.

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

// Product page paths of stores without a shared platform pattern; keep in
// sync with productPath in scripts/update-products.mjs.
const OTHER_PRODUCT_PATHS = {
  'duxhumanhealth.com': /^\/produtos\/[^/]+\/?$/,
  'www.adaptogen.com.br': /^\/produto\/[^/]+$/,
  'www.newnutrition.com.br': /^\/[^/]+\/p$/,
};

function isDirectProductUrl(value) {
  try {
    const url = new URL(value);
    const growthProduct = url.hostname === 'www.gsuplementos.com.br' && /-p\d+$/i.test(url.pathname);
    const maxTitaniumProduct = url.hostname === 'www.maxtitanium.com.br' && /\/p$/i.test(url.pathname);
    const essentialNutritionProduct = url.hostname === 'www.essentialnutrition.com.br' && /^\/[^/]*whey[^/]*\/?$/i.test(url.pathname);
    const lojaDoMecanicoProduct = url.hostname === 'www.lojadomecanico.com.br' && /^\/produto\/\d+\//.test(url.pathname);
    const vtexProduct = ['www.lojaadcos.com.br', 'www.dermage.com.br', 'www.drogariasaopaulo.com.br', 'www.probiotica.com.br',
      'www.nutrify.com.br', 'www.vitafor.com.br', 'www.atlheticanutrition.com.br', 'www.blackskullusa.com.br'].includes(url.hostname)
      && /\/p$/i.test(url.pathname);
    const shopifyProduct = ['vivatrue.com.br', 'soldiersnutrition.com.br', 'darklabsuplementos.com.br', 'ftw.com.br'].includes(url.hostname)
      && /^\/products\/[^/]+$/.test(url.pathname);
    const otherProduct = OTHER_PRODUCT_PATHS[url.hostname]?.test(url.pathname);
    return growthProduct || maxTitaniumProduct || essentialNutritionProduct || lojaDoMecanicoProduct || vtexProduct || shopifyProduct || Boolean(otherProduct);
  } catch {
    return false;
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function normalizedAmount(product) {
  return ['kg', 'l'].includes(product.unit) ? product.amount * 1000 : product.amount;
}

function proteinServingMass(product) {
  const storedValue = product.nutritionDetails?.servingMassGrams;
  if (Number.isFinite(storedValue) && storedValue > 0) return storedValue;
  const portionRow = product.nutritionTable?.rows?.find((row) => /por[cç][aã]o/i.test(row.label || row.text || ''));
  const match = String(portionRow?.label || portionRow?.text || '').match(/\b(\d+(?:[.,]\d+)?)\s*g\b/i);
  return match ? Number(match[1].replace(',', '.')) : null;
}

// The cheapest way to buy the product: the store, or the best Mercado Livre
// offer (new, free shipping, well-rated seller; scripts/mercadolivre-catalog.mjs).
// Affiliate links made by hand in the Mercado Livre affiliate portal, keyed by
// the offer's listing URL. An offer that changes listing falls back to its plain URL.
const MERCADO_LIVRE_AFFILIATE_LINKS = {
  'https://produto.mercadolivre.com.br/MLB-4251412720': 'https://meli.la/2DBiyUb',
  'https://produto.mercadolivre.com.br/MLB-2670330699': 'https://meli.la/2P6Xdk8',
  'https://produto.mercadolivre.com.br/MLB-7095989254': 'https://meli.la/1G6Ciez',
};
const mercadoLivreOffer = (product) => {
  const offer = product.mercadoLivre?.offer;
  const affiliateUrl = offer && MERCADO_LIVRE_AFFILIATE_LINKS[offer.url];
  return affiliateUrl ? { ...offer, url: affiliateUrl, affiliate: true } : offer;
};
const mercadoLivreIsCheaper = (product) => mercadoLivreOffer(product)?.price < product.price;
const buyPrice = (product) => (mercadoLivreIsCheaper(product) ? mercadoLivreOffer(product).price : product.price);

// Price per 100 g of creatine itself: flavored powders carry less of it.
const CREATINE_DOSE_GRAMS = 3;
const creatineUnitPrice = (product) => (product.creatineShare > 0
  ? (buyPrice(product) / (normalizedAmount(product) * product.creatineShare)) * 100 : null);

function getUnitPrice(product, category) {
  if (category === 'creatine') return creatineUnitPrice(product);
  if (category === 'whey') {
    const servingMass = proteinServingMass(product);
    if (!Number.isFinite(product.proteinGrams) || product.proteinGrams <= 0
      || !Number.isFinite(servingMass) || servingMass <= 0) return null;
    const packageProtein = normalizedAmount(product) * (product.proteinGrams / servingMass);
    return packageProtein > 0 ? (buyPrice(product) / packageProtein) * 100 : null;
  }
  const divisor = normalizedAmount(product);
  const unitValue = buyPrice(product) / divisor;
  // Sunscreens are sold by ml or g; both are compared per 100.
  return ['ml', 'l'].includes(product.unit) || category === 'sunscreen' ? unitValue * 100 : unitValue * 1000;
}

// Sunscreens sold by volume and by weight are compared separately.
const sunscreenMeasure = (product) => (product.unit === 'g' ? 'g' : 'ml');

function getUnitLabel(category, product) {
  if (category === 'creatine') return '100 g de creatina';
  return category === 'whey' ? '100 g de proteína' : `100 ${sunscreenMeasure(product)}`;
}

function formatAmount(product) {
  return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(product.amount)} ${product.unit}`;
}

// Products the site can compare: a direct product link and a price per quantity.
const comparableProducts = (catalog, category) => (Array.isArray(catalog.products?.[category]) ? catalog.products[category] : [])
  .filter((product) => isDirectProductUrl(product.url) && Number.isFinite(getUnitPrice(product, category)));

// Each category has its own page, so search engines can list it on its own.
// The build writes these into the page head; the site swaps them when the
// category changes without a reload.
const ROOT_PAGE = {
  path: '/',
  title: 'Compensa? — compare preços',
  description: 'Compare preços por peso ou volume e encontre o melhor custo-benefício.',
  heading: 'Compare preços',
};
const CATEGORY_PAGES = {
  whey: {
    path: '/whey',
    title: 'Whey protein mais barato por grama de proteína | Compensa?',
    description: 'Compare whey protein pelo preço por 100 g de proteína, calculado pela tabela nutricional de cada produto, com rótulo, glúten e lactose.',
    heading: 'Whey protein: preço por 100 g de proteína',
    listTitle: 'Os 10 whey protein com menor preço por 100 g de proteína',
    method: 'Cada whey tem uma quantidade diferente de proteína por porção. Por isso o preço é dividido pela proteína do pote inteiro, calculada pela tabela nutricional: proteína da porção ÷ peso da porção × peso do pote. Assim, um pote mais barato com menos proteína não parece vantagem. Os preços vêm das lojas oficiais das marcas.',
  },
  creatine: {
    path: '/creatina',
    title: 'Creatina mais barata por grama de creatina | Compensa?',
    description: 'Compare creatina pelo preço por 100 g de creatina pura. Creatinas com sabor contam só a parte de creatina da tabela nutricional.',
    heading: 'Creatina: preço por 100 g de creatina',
    listTitle: 'As 10 creatinas com menor preço por 100 g de creatina',
    method: 'O preço é dividido pela creatina do pote. Em creatinas com sabor, a parte de creatina vem da tabela nutricional; creatina pura conta o pote inteiro. Cápsulas, kits e misturas ficam de fora. Os preços vêm das lojas oficiais das marcas.',
  },
  sunscreen: {
    path: '/protetor-solar',
    title: 'Protetor solar com melhor preço por ml | Compensa?',
    description: 'Compare protetor solar pelo preço por 100 ml ou 100 g, com FPS, textura, características e o que dizem as avaliações de clientes.',
    heading: 'Protetor solar: preço por 100 ml',
    listTitle: 'Os 10 protetores solares com menor preço por 100 ml',
    method: 'O preço é dividido pelo tamanho da embalagem e mostrado por 100 ml (loções, fluidos e sprays) ou por 100 g (cremes e géis). Quando o mesmo produto sai mais barato no Mercado Livre, com frete grátis e vendedor bem avaliado, o cálculo usa esse preço.',
  },
};

const categoryForPath = (pathname) => Object.keys(CATEGORY_PAGES)
  .find((category) => CATEGORY_PAGES[category].path === pathname.replace(/\.html$|\/$/, '')) || null;

// The cheapest products in text, with how the price is compared. Prerendered
// by the build so the page has content without running JavaScript.
function renderCategorySummary(category, catalog) {
  const page = CATEGORY_PAGES[category];
  const top = comparableProducts(catalog, category)
    .filter((product) => category !== 'sunscreen' || sunscreenMeasure(product) === 'ml')
    .map((product) => ({ product, unitPrice: getUnitPrice(product, category) }))
    .sort((a, b) => a.unitPrice - b.unitPrice)
    .slice(0, 10);
  const items = top.map(({ product, unitPrice }) => `<li><strong>${escapeHtml(product.name)}</strong> (${escapeHtml(product.brand)}, ${formatAmount(product)}): ${currency.format(unitPrice)} por ${getUnitLabel(category, product)} · ${currency.format(buyPrice(product))} ${mercadoLivreIsCheaper(product) ? 'no Mercado Livre' : 'na loja'}</li>`).join('');
  const updated = catalog.updatedAt
    ? ` Preços de ${new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long', timeZone: 'America/Sao_Paulo' }).format(new Date(catalog.updatedAt))}.`
    : '';
  return `${items ? `<h2>${page.listTitle}</h2><ol class="summary-list">${items}</ol>` : ''}
    <h2>Como comparamos</h2><p>${page.method}${updated}</p>`;
}
