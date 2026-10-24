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
      'www.nutrify.com.br', 'www.vitafor.com.br', 'www.atlheticanutrition.com.br', 'www.blackskullusa.com.br', 'www.maxtitanium.com.br',
      'www.paguemenos.com.br', 'www.savegnago.com.br', 'www.zonasul.com.br', 'www.cobasi.com.br'].includes(url.hostname)
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

const buyPrice = (product) => product.price;

// Price per 100 g of creatine itself: flavored powders carry less of it.
const CREATINE_DOSE_GRAMS = 3;
const creatineUnitPrice = (product) => (product.creatineShare > 0
  ? (buyPrice(product) / (normalizedAmount(product) * product.creatineShare)) * 100 : null);

// Categories read from store catalogs (scripts/store-categories.mjs) keep
// their amount in the unit they are compared by: the unit price is the price
// per `per` of it.
const CATEGORY_UNITS = {
  diapers: { per: 1, label: () => 'fralda' },
  toiletPaper: { per: 10, label: () => '10 m' },
  laundry: { per: 1000, label: (product) => (product.unit === 'ml' ? 'litro' : 'kg') },
  petFood: { per: 1000, label: () => 'kg' },
  moisturizer: { per: 100, label: (product) => `100 ${product.unit}` },
  vitaminC: { per: 10, label: (product) => `10 ${product.unit}` },
  peanutButter: { per: 1000, label: () => 'kg' },
  proteinBars: { per: 100, label: () => '100 g de proteína' },
  omega3: { per: 1, label: () => '1 g de EPA+DHA' },
};

// Categories sold by volume and by weight compare each apart; the first is
// shown first.
const MEASURES = [{ value: 'ml', label: 'ml', title: 'Loções, fluidos, sprays' }, { value: 'g', label: 'g', title: 'Cremes, géis, bastões' }];
const CATEGORY_MEASURES = {
  sunscreen: MEASURES,
  moisturizer: MEASURES,
  vitaminC: MEASURES,
  laundry: [{ value: 'ml', label: 'Líquido', title: 'Preço por litro' }, { value: 'g', label: 'Pó', title: 'Preço por kg' }],
};
const productMeasure = (product) => (product.unit === 'g' ? 'g' : 'ml');

function getUnitPrice(product, category) {
  const unit = CATEGORY_UNITS[category];
  if (unit) return product.amount > 0 ? (buyPrice(product) / product.amount) * unit.per : null;
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

function getUnitLabel(category, product) {
  if (CATEGORY_UNITS[category]) return CATEGORY_UNITS[category].label(product);
  if (category === 'creatine') return '100 g de creatina';
  return category === 'whey' ? '100 g de proteína' : `100 ${productMeasure(product)}`;
}

const plainAmount = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
const plural = (count, one, many) => `${plainAmount.format(count)} ${count === 1 ? one : many}`;
// Store-category amounts are in g or ml even for kilos and liters.
const formatMass = (amount, unit) => (amount >= 1000 ? `${plainAmount.format(amount / 1000)} ${unit === 'g' ? 'kg' : 'L'}` : `${plainAmount.format(amount)} ${unit}`);

// The package size as the store sells it.
function formatAmount(product, category) {
  if (category === 'diapers') return plural(product.amount, 'fralda', 'fraldas');
  if (category === 'toiletPaper') return `${plural(product.rolls, 'rolo', 'rolos')} de ${plainAmount.format(product.metersPerRoll)} m`;
  if (category === 'proteinBars') return plural(product.bars, 'barra', 'barras');
  if (category === 'omega3') return plural(product.capsules, 'cápsula', 'cápsulas');
  if (CATEGORY_UNITS[category]) return formatMass(product.amount, product.unit);
  return `${plainAmount.format(product.amount)} ${product.unit}`;
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
  description: 'Compare preços por quantidade: suplementos, cuidados com a pele, fraldas, produtos de casa e ração. Encontre o melhor custo-benefício.',
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
  proteinBars: {
    path: '/barra-de-proteina',
    tab: 'Barra de proteína',
    title: 'Barra de proteína mais barata por grama de proteína | Compensa?',
    description: 'Compare barras de proteína pelo preço por 100 g de proteína, avulsas ou em caixa, de farmácias e lojas das marcas.',
    heading: 'Barra de proteína: preço por 100 g de proteína',
    listTitle: 'As 10 barras de proteína com menor preço por 100 g de proteína',
    method: 'O preço é dividido pela proteína da embalagem: proteína de cada barra (do nome, da descrição ou da tabela nutricional) × número de barras. Barras avulsas e caixas entram na mesma conta.',
  },
  omega3: {
    path: '/omega-3',
    tab: 'Ômega 3',
    title: 'Ômega 3 mais barato por grama de EPA e DHA | Compensa?',
    description: 'Compare ômega 3 pelo preço por grama de EPA + DHA, os ácidos graxos que importam, e não pelo número de cápsulas.',
    heading: 'Ômega 3: preço por grama de EPA + DHA',
    listTitle: 'Os 10 ômega 3 com menor preço por grama de EPA + DHA',
    method: 'Uma cápsula de "1000 mg" de óleo de peixe pode ter de 300 mg a 900 mg de EPA + DHA. Por isso o preço é dividido pelo EPA + DHA do frasco: quantidade por porção ÷ cápsulas da porção × cápsulas do frasco. Produtos que não informam EPA e DHA ficam de fora. Os selos (IFOS, Friend of the Sea, MEG-3, GOED) e a forma do óleo (TG ou EE) vêm do nome e da descrição do produto.',
  },
  peanutButter: {
    path: '/pasta-de-amendoim',
    tab: 'Pasta de amendoim',
    title: 'Pasta de amendoim mais barata por kg | Compensa?',
    description: 'Compare pasta de amendoim pelo preço por kg em farmácias e supermercados: integral, com sabor ou com whey.',
    heading: 'Pasta de amendoim: preço por kg',
    listTitle: 'As 10 pastas de amendoim com menor preço por kg',
    method: 'O preço é dividido pelo peso do pote e mostrado por kg. Pastas em pó, barras e paçocas ficam de fora.',
  },
  moisturizer: {
    path: '/hidratante',
    tab: 'Hidratante',
    title: 'Hidratante facial e corporal com melhor preço por ml | Compensa?',
    description: 'Compare hidratantes faciais e corporais pelo preço por 100 ml ou 100 g, com o que dizem as avaliações de clientes.',
    heading: 'Hidratante: preço por 100 ml',
    listTitle: 'Os 10 hidratantes com menor preço por 100 ml',
    method: 'O preço é dividido pelo tamanho da embalagem e mostrado por 100 ml (loções e fluidos) ou por 100 g (cremes e géis). Hidratantes com FPS estão em protetor solar.',
  },
  vitaminC: {
    path: '/vitamina-c',
    tab: 'Vitamina C',
    title: 'Sérum de vitamina C com melhor preço por ml | Compensa?',
    description: 'Compare séruns e cremes de vitamina C para o rosto pelo preço por 10 ml ou 10 g, com avaliações de clientes.',
    heading: 'Vitamina C para o rosto: preço por 10 ml',
    listTitle: 'Os 10 produtos de vitamina C com menor preço por 10 ml',
    method: 'O preço é dividido pelo tamanho da embalagem e mostrado por 10 ml (séruns e fluidos) ou por 10 g (cremes e géis). Suplementos de vitamina C ficam de fora.',
  },
  diapers: {
    path: '/fraldas',
    tab: 'Fraldas',
    title: 'Fralda mais barata por unidade | Compensa?',
    description: 'Compare fraldas infantis e geriátricas pelo preço por fralda, por tamanho, em farmácias.',
    heading: 'Fraldas: preço por fralda',
    listTitle: 'As 10 fraldas com menor preço por unidade',
    method: 'O preço é dividido pelo número de fraldas do pacote. Compare dentro do mesmo tamanho: fraldas maiores custam mais por unidade.',
  },
  toiletPaper: {
    path: '/papel-higienico',
    tab: 'Papel higiênico',
    title: 'Papel higiênico mais barato por metro | Compensa?',
    description: 'Compare papel higiênico pelo preço por 10 metros, por tipo de folha, em supermercados e farmácias.',
    heading: 'Papel higiênico: preço por 10 metros',
    listTitle: 'Os 10 papéis higiênicos com menor preço por 10 metros',
    method: 'Rolos têm de 20 a 60 metros, então o preço por rolo engana. O preço é dividido pelos metros do pacote (rolos × metros por rolo). Compare dentro do mesmo tipo de folha: folha simples rende mais metros.',
  },
  laundry: {
    path: '/lava-roupas',
    tab: 'Lava-roupas',
    title: 'Sabão lava-roupas mais barato por litro e por kg | Compensa?',
    description: 'Compare sabão lava-roupas líquido pelo preço por litro e em pó pelo preço por kg, em supermercados.',
    heading: 'Lava-roupas: preço por litro',
    listTitle: 'Os 10 lava-roupas líquidos com menor preço por litro',
    method: 'O preço é dividido pelo tamanho da embalagem: por litro no líquido, por kg no pó. Versões concentradas rendem mais lavagens por litro; confira a dose no rótulo. Amaciantes, tira-manchas e cápsulas ficam de fora.',
  },
  petFood: {
    path: '/racao',
    tab: 'Ração',
    title: 'Ração seca para cães e gatos mais barata por kg | Compensa?',
    description: 'Compare ração seca para cães e gatos pelo preço por kg, por idade e porte, com todos os tamanhos de pacote.',
    heading: 'Ração seca: preço por kg',
    listTitle: 'As 10 rações secas com menor preço por kg',
    method: 'O preço é dividido pelo peso do pacote. Cada tamanho de pacote aparece separado, porque o preço por kg costuma cair nos maiores. Rações úmidas (sachês e latas) ficam de fora.',
  },
};
CATEGORY_PAGES.whey.tab = 'Whey protein';
CATEGORY_PAGES.creatine.tab = 'Creatina';
CATEGORY_PAGES.sunscreen.tab = 'Protetor solar';

// The tabs come in groups; a group's link opens its first category.
const CATEGORY_GROUPS = [
  { key: 'supplements', label: 'Suplementos', categories: ['whey', 'creatine', 'proteinBars', 'omega3', 'peanutButter'] },
  { key: 'care', label: 'Cuidados', categories: ['sunscreen', 'moisturizer', 'vitaminC'] },
  { key: 'home', label: 'Casa e bebê', categories: ['diapers', 'toiletPaper', 'laundry'] },
  { key: 'pet', label: 'Pet', categories: ['petFood'] },
];
const groupOf = (category) => CATEGORY_GROUPS.find((group) => group.categories.includes(category));

const categoryForPath = (pathname) => Object.keys(CATEGORY_PAGES)
  .find((category) => CATEGORY_PAGES[category].path === pathname.replace(/\.html$|\/$/, '')) || null;

// The cheapest products in text, with how the price is compared. Prerendered
// by the build so the page has content without running JavaScript.
function renderCategorySummary(category, catalog) {
  const page = CATEGORY_PAGES[category];
  const top = comparableProducts(catalog, category)
    .filter((product) => !CATEGORY_MEASURES[category] || productMeasure(product) === CATEGORY_MEASURES[category][0].value)
    .map((product) => ({ product, unitPrice: getUnitPrice(product, category) }))
    .sort((a, b) => a.unitPrice - b.unitPrice)
    .slice(0, 10);
  const items = top.map(({ product, unitPrice }) => `<li><strong>${escapeHtml(product.name)}</strong> (${escapeHtml(product.brand)}, ${formatAmount(product, category)}): ${currency.format(unitPrice)} por ${getUnitLabel(category, product)} · ${currency.format(buyPrice(product))} ${product.store ? `na ${escapeHtml(product.store)}` : 'na loja'}</li>`).join('');
  const updated = catalog.updatedAt
    ? ` Preços de ${new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long', timeZone: 'America/Sao_Paulo' }).format(new Date(catalog.updatedAt))}.`
    : '';
  return `${items ? `<h2>${page.listTitle}</h2><ol class="summary-list">${items}</ol>` : ''}
    <h2>Como comparamos</h2><p>${page.method}${updated}</p>`;
}
