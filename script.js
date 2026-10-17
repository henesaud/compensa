const categoryButtons = document.querySelectorAll('.category-button');
const filterControls = document.querySelector('#filter-controls');
const productGrid = document.querySelector('#product-grid');
const resultCount = document.querySelector('#result-count');
const catalogStatus = document.querySelector('#catalog-status');
const nutritionDialog = document.querySelector('#nutrition-dialog');
const nutritionDialogEyebrow = document.querySelector('#nutrition-dialog-eyebrow');
const nutritionDialogTitle = document.querySelector('#nutrition-dialog-title');
const nutritionDialogProduct = document.querySelector('#nutrition-dialog-product');
const nutritionDialogContent = document.querySelector('#nutrition-dialog-content');
const guideButton = document.querySelector('#guide-button');
const guideDialog = document.querySelector('#guide-dialog');
let activeCategory = 'whey';
let products = { whey: [], sunscreen: [] };
let visibleProducts = [];

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function isDirectProductUrl(value) {
  try {
    const url = new URL(value);
    const growthProduct = url.hostname === 'www.gsuplementos.com.br' && /-p\d+$/i.test(url.pathname);
    const maxTitaniumProduct = url.hostname === 'www.maxtitanium.com.br' && /\/p$/i.test(url.pathname);
    const essentialNutritionProduct = url.hostname === 'www.essentialnutrition.com.br' && /^\/[^/]*whey[^/]*\/?$/i.test(url.pathname);
    const lojaDoMecanicoProduct = url.hostname === 'www.lojadomecanico.com.br' && /^\/produto\/\d+\//.test(url.pathname);
    const vtexSunscreenProduct = ['www.lojaadcos.com.br', 'www.dermage.com.br', 'www.drogariasaopaulo.com.br'].includes(url.hostname)
      && /\/p$/i.test(url.pathname);
    return growthProduct || maxTitaniumProduct || essentialNutritionProduct || lojaDoMecanicoProduct || vtexSunscreenProduct;
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

function getUnitPrice(product, category = activeCategory) {
  if (category === 'whey') {
    const servingMass = proteinServingMass(product);
    if (!Number.isFinite(product.proteinGrams) || product.proteinGrams <= 0
      || !Number.isFinite(servingMass) || servingMass <= 0) return null;
    const packageProtein = normalizedAmount(product) * (product.proteinGrams / servingMass);
    return packageProtein > 0 ? (product.price / packageProtein) * 100 : null;
  }
  const divisor = normalizedAmount(product);
  const unitValue = product.price / divisor;
  // Sunscreens are sold by ml or g; both are compared per 100.
  return ['ml', 'l'].includes(product.unit) || category === 'sunscreen' ? unitValue * 100 : unitValue * 1000;
}

// Sunscreens sold by volume and by weight are compared separately.
const sunscreenMeasure = (product) => (product.unit === 'g' ? 'g' : 'ml');

function getUnitLabel(category, product) {
  return category === 'whey' ? '100 g de proteína' : `100 ${sunscreenMeasure(product)}`;
}

function formatAmount(product) {
  return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(product.amount)} ${product.unit}`;
}

function formatRatio(value) {
  return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(value * 10)}:10`;
}

function formatNutritionAmount(value) {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(value);
}

// Warning levels, from mild (1) to severe (3). ANVISA (RDC 429/2020) labels
// solids "alto em gordura saturada" from 6 g/100 g, used here as level 3.
const WARNING_LEVELS = ['Atenção', 'Alto', 'Muito alto'];
const CARB_PROTEIN_WARNING_RATIOS = [0.3, 0.5, 1];
const SATURATED_FAT_WARNINGS_PER_100G = [2, 3, 6];

const warningLevel = (value, limits, inclusive) => limits.filter((limit) => (inclusive ? value >= limit : value > limit)).length;

function nutritionWarnings(product) {
  const warnings = {};
  const grams = (value) => `${formatNutritionAmount(value)} g`;
  if (Number.isFinite(product.carbProteinRatio)) {
    const level = warningLevel(product.carbProteinRatio, CARB_PROTEIN_WARNING_RATIOS, false);
    if (level) {
      warnings['carb-protein'] = {
        level,
        text: `Tem ${grams(product.carbProteinRatio * 10)} de carboidratos para cada 10 g de proteína.`,
      };
    }
  }
  const saturatedFat = saturatedFatPer100g(product.nutritionDetails);
  if (Number.isFinite(saturatedFat)) {
    const level = warningLevel(saturatedFat, SATURATED_FAT_WARNINGS_PER_100G, true);
    if (level) {
      warnings['saturated-fat'] = {
        level,
        text: `Tem ${grams(saturatedFat)} de gordura saturada em cada 100 g de produto.`,
        note: 'A ANVISA considera "alto em gordura saturada" a partir de 6 g por 100 g.',
      };
    }
  }
  return warnings;
}

function warningBox(product, detail) {
  const warning = nutritionWarnings(product)[detail];
  if (!warning) return '';
  return `<div class="nutrition-warning warning-level-${warning.level}"><span aria-hidden="true">⚠</span><div>
    <p><strong>${WARNING_LEVELS[warning.level - 1]}.</strong> ${escapeHtml(warning.text)}</p>
    ${warning.note ? `<p class="nutrition-warning-scale">${escapeHtml(warning.note)}</p>` : ''}
  </div></div>`;
}

function saturatedFatPer100g(details) {
  return Number.isFinite(details?.saturatedFatGrams) && Number.isFinite(details?.servingMassGrams) && details.servingMassGrams > 0
    ? (details.saturatedFatGrams / details.servingMassGrams) * 100
    : null;
}

// Tells apart a product whose nutrition table was not found from one whose
// table simply leaves the requested line out.
function missingNutritionData(details, what) {
  return details
    ? `<p class="nutrition-unavailable">A tabela nutricional deste produto não tem dado de ${what}.</p>`
    : `<p class="nutrition-unavailable">Não encontramos a tabela nutricional deste produto, então não há dado de ${what}.</p>`;
}

function renderNutritionDialog(product, detail) {
  const details = product.nutritionDetails;
  if (detail === 'energy') {
    nutritionDialogTitle.textContent = 'Energia';
    if (!Number.isFinite(details?.energyKcalPerServing)) {
      return missingNutritionData(details, 'energia');
    }
    const servingMass = Number.isFinite(details.servingMassGrams) ? `${formatNutritionAmount(details.servingMassGrams)} g` : 'porção da embalagem';
    return `
      <div class="energy-stats">
        <article class="energy-stat"><span>Por porção (${escapeHtml(servingMass)})</span><strong>${formatNutritionAmount(details.energyKcalPerServing)} <small>kcal</small></strong></article>
        <article class="energy-stat"><span>Densidade energética</span><strong>${Number.isFinite(details.energyKcalPer100g) ? formatNutritionAmount(details.energyKcalPer100g) : '—'} <small>kcal/100 g</small></strong></article>
      </div>
      <p class="nutrition-modal-note">O valor por 100 g é calculado a partir das calorias e do peso da porção informada na tabela.</p>`;
  }

  if (detail === 'saturated-fat') {
    nutritionDialogTitle.textContent = 'Gordura saturada';
    if (!Number.isFinite(details?.saturatedFatGrams)) {
      return missingNutritionData(details, 'gordura saturada');
    }
    const servingMass = Number.isFinite(details.servingMassGrams) ? `${formatNutritionAmount(details.servingMassGrams)} g` : 'porção da embalagem';
    const per100g = saturatedFatPer100g(details);
    const saturatedShare = Number.isFinite(details.totalFatGrams) && details.totalFatGrams > 0
      ? `${formatNutritionAmount((details.saturatedFatGrams / details.totalFatGrams) * 100)}%`
      : '—';
    return `
      ${warningBox(product, detail)}
      <div class="energy-stats">
        <article class="energy-stat"><span>Por 100 g de produto</span><strong>${Number.isFinite(per100g) ? formatNutritionAmount(per100g) : '—'} <small>g</small></strong></article>
        <article class="energy-stat"><span>Por porção (${escapeHtml(servingMass)})</span><strong>${formatNutritionAmount(details.saturatedFatGrams)} <small>g</small></strong></article>
      </div>
      <div class="ratio-stats">
        <article class="ratio-stat"><span>Gorduras totais por porção</span><strong>${Number.isFinite(details.totalFatGrams) ? `${formatNutritionAmount(details.totalFatGrams)} <small>g</small>` : '—'}</strong></article>
        <article class="ratio-stat"><span>Parte saturada da gordura total</span><strong>${saturatedShare}</strong></article>
      </div>
      <p class="nutrition-modal-note">Valores conforme a tabela nutricional. O valor por 100 g é calculado a partir do peso da porção informada.</p>`;
  }

  if (detail === 'carb-protein') {
    nutritionDialogTitle.textContent = 'Carboidratos e proteína';
    if (!Number.isFinite(product.carbProteinRatio)) {
      return missingNutritionData(details, 'carboidratos e proteína');
    }
    return `
      ${warningBox(product, detail)}
      <div class="ratio-summary"><span>Carboidratos para cada 10 g de proteína</span><strong>${formatRatio(product.carbProteinRatio)}</strong></div>
      <div class="ratio-stats">
        <article class="ratio-stat"><span>Carboidratos por porção</span><strong>${formatNutritionAmount(product.carbohydrateGrams)} <small>g</small></strong></article>
        <article class="ratio-stat"><span>Proteína por porção</span><strong>${formatNutritionAmount(product.proteinGrams)} <small>g</small></strong></article>
      </div>
      <p class="nutrition-modal-note">Uma proporção menor indica menos carboidratos para a mesma quantidade de proteína. É um dado de composição, não uma avaliação completa do produto.</p>`;
  }

  nutritionDialogTitle.textContent = 'Aminoácidos';
  const essential = details?.aminoAcids?.essential || [];
  const nonEssential = details?.aminoAcids?.nonEssential || [];
  if (!essential.length && !nonEssential.length) {
    return missingNutritionData(details, 'aminoácidos');
  }
  const maxAminoAmount = Math.max(1, ...[...essential, ...nonEssential].map((aminoAcid) => aminoAcid.amount));
  const aminoGroup = (title, aminoAcids) => `
    <section class="amino-group">
      <h3>${title} <span>${aminoAcids.length}</span></h3>
      ${aminoAcids.length
        ? `<ul>${aminoAcids.map((aminoAcid) => {
          const barWidth = Math.min(100, Math.max(0, (aminoAcid.amount / maxAminoAmount) * 100));
          return `<li class="amino-row"><div class="amino-row-data"><span>${escapeHtml(aminoAcid.name)}</span><strong>${formatNutritionAmount(aminoAcid.amount)} ${escapeHtml(aminoAcid.unit)}</strong></div><div class="amino-bar-track" role="meter" aria-valuemin="0" aria-valuemax="${maxAminoAmount}" aria-valuenow="${aminoAcid.amount}" aria-label="${escapeHtml(aminoAcid.name)}"><span class="amino-bar-fill" style="width:${barWidth}%"></span></div></li>`;
        }).join('')}</ul>`
        : '<p class="nutrition-unavailable">Sem dado.</p>'}
    </section>`;
  return `
    <div class="amino-groups">
      ${aminoGroup('Essenciais', essential)}
      ${aminoGroup('Não essenciais e condicionais', nonEssential)}
    </div>
    <p class="nutrition-modal-note">Valores por porção conforme a tabela nutricional. Alguns aminoácidos não essenciais podem ser condicionalmente essenciais.</p>`;
}

// Sunscreen features from the Mercado Livre catalog attributes
// (scripts/mercadolivre-catalog.mjs), with the product name as a fallback.
const plainName = (product) => product.name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const catalogSays = (product, attribute) => product.mercadoLivre?.attributes?.[attribute];
const TINTED_NAME = /com cor|colou?r|\btom\b|\bcor\b|tonaliz|\bfluido? cor/;
const FEATURES = [
  { value: 'water', label: 'Resistente à água', attribute: 'IS_WATER_RESISTANT', test: (product) => catalogSays(product, 'IS_WATER_RESISTANT') === 'Sim' },
  { value: 'oil-free', label: 'Oil free', attribute: 'IS_OIL_FREE', test: (product) => catalogSays(product, 'IS_OIL_FREE') === 'Sim' || /oil.?free|livre de oleo/.test(plainName(product)) },
  { value: 'tinted', label: 'Com cor', attribute: 'WITH_COLOR', test: (product) => catalogSays(product, 'WITH_COLOR') === 'Sim' || TINTED_NAME.test(plainName(product)) },
  { value: 'untinted', label: 'Sem cor', card: false, test: (product) => catalogSays(product, 'WITH_COLOR') === 'Não' && !TINTED_NAME.test(plainName(product)) },
  { value: 'eyes', label: 'Indicado para perto dos olhos', attribute: 'IS_SUITABLE_FOR_EYE_CONTOUR', test: (product) => catalogSays(product, 'IS_SUITABLE_FOR_EYE_CONTOUR') === 'Sim' },
  { value: 'kids', label: 'Infantil', attribute: 'IS_INFANT', test: (product) => catalogSays(product, 'IS_INFANT') === 'Sim' || /\bkids\b|infantil|\bbaby\b|\bbebe|crianc/.test(plainName(product)) },
  { value: 'hypoallergenic', label: 'Hipoalergênico', attribute: 'IS_HYPOALLERGENIC_PRODUCT', test: (product) => catalogSays(product, 'IS_HYPOALLERGENIC_PRODUCT') === 'Sim' },
  { value: 'fragrance-free', label: 'Sem fragrância', attribute: 'IS_FRAGRANCE_FREE', test: (product) => catalogSays(product, 'IS_FRAGRANCE_FREE') === 'Sim' },
];

// Review traits read from store reviews (scripts/sunscreen-reviews.mjs). yes
// counts complaints ("arde os olhos"), no counts denials ("não arde").
const REVIEW_TRAITS = [
  { key: 'eyeSting', complaint: 'Arde os olhos', praise: 'Não arde os olhos' },
  { key: 'sticky', complaint: 'Pegajoso', praise: 'Não fica pegajoso' },
  { key: 'oily', complaint: 'Deixa oleoso', praise: 'Não deixa oleoso' },
  { key: 'whiteCast', complaint: 'Esbranquiça', praise: 'Não esbranquiça' },
  { key: 'pilling', complaint: 'Esfarela', praise: 'Não esfarela' },
  { key: 'dryTouch', praise: 'Toque seco', yesIsPraise: true },
];
const MIN_TRAIT_MENTIONS = 3;
const rating = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

// Other catalog attributes shown in the details dialog, in this order.
const EXTRA_ATTRIBUTES = [
  ['SKIN_TYPE', 'Tipo de pele'],
  ['APPLICATION_ZONES', 'Onde aplicar'],
  ['SUNSCREEN_FORMAT', 'Formato'],
  ['TEXTURE', 'Textura'],
  ['SUNSCREEN_TONE', 'Tom'],
  ['IS_SWEAT_RESISTANT', 'Resistente ao suor'],
  ['MIN_RECOMMENDED_AGE', 'Idade mínima'],
  ['IS_PARABENS_FREE', 'Sem parabenos'],
  ['IS_COMEDOGENIC', 'Comedogênico'],
  ['IS_VEGAN', 'Vegano'],
  ['IS_CRUELTY_FREE', 'Não testado em animais'],
];

const detailRow = (label, value) => `<div class="details-row"><dt>${escapeHtml(label)}</dt><dd${value ? '' : ' class="details-missing"'}>${escapeHtml(value || 'Sem dado')}</dd></div>`;

function renderSunscreenDialog(product) {
  const featureRows = FEATURES.filter((feature) => feature.attribute).map((feature) => {
    const value = feature.test(product) ? 'Sim' : catalogSays(product, feature.attribute) === 'Não' ? 'Não' : '';
    return detailRow(feature.label, value);
  }).join('');
  const extraRows = EXTRA_ATTRIBUTES.map(([attribute, label]) => {
    const value = catalogSays(product, attribute) || (attribute === 'TEXTURE' ? product.texture : '');
    return value ? detailRow(label, value) : '';
  }).join('');
  const highlights = product.mercadoLivre?.mainFeatures || [];
  const reviews = product.reviews;
  const reviewRows = reviews?.withText ? REVIEW_TRAITS.map(({ key, complaint, praise, yesIsPraise }) => {
    const { yes = 0, no = 0 } = reviews.mentions?.[key] || {};
    if (!yes && !no) return '';
    return `<div class="details-row"><dt>${escapeHtml(yesIsPraise ? praise : complaint)}?</dt><dd>Sim: ${yes} · Não: ${no}</dd></div>`;
  }).join('') : '';
  return `
    <section class="details-section">
      <h3>Características</h3>
      <dl class="details-list">${featureRows}${extraRows}</dl>
    </section>
    ${highlights.length ? `<section class="details-section"><h3>Destaques do fabricante</h3><ul class="details-highlights">${highlights.map((text) => `<li>${escapeHtml(text)}</li>`).join('')}</ul></section>` : ''}
    ${reviews?.count ? `<section class="details-section">
      <h3>Avaliações na loja</h3>
      <p class="details-text"><strong>${rating.format(reviews.average)} ★</strong> em ${reviews.count.toLocaleString('pt-BR')} avaliações. Das ${reviews.read} mais recentes, ${reviews.withText} têm comentário${reviewRows ? '. Quantas dizem que o produto…' : '.'}</p>
      ${reviewRows ? `<dl class="details-list">${reviewRows}</dl>` : ''}
    </section>` : ''}
    ${product.ingredients ? `<section class="details-section"><details><summary>Ingredientes</summary><p class="details-text details-ingredients">${escapeHtml(product.ingredients)}</p></details></section>` : ''}
    <p class="nutrition-modal-note">As características vêm do catálogo do Mercado Livre${product.mercadoLivre ? '' : ' (este produto não foi encontrado lá)'} ou do nome do produto e podem ter erros. Confira na embalagem.</p>`;
}

function featureLine(product) {
  const labels = FEATURES.filter((feature) => feature.card !== false && feature.test(product)).map((feature) => feature.label);
  return labels.length ? `<p class="product-features">${labels.join(' <span>·</span> ')}</p>` : '';
}

function reviewSummary(product) {
  const reviews = product.reviews;
  if (!reviews?.count) return '';
  const tags = REVIEW_TRAITS.flatMap(({ key, complaint, praise, yesIsPraise }) => {
    const { yes = 0, no = 0 } = reviews.mentions?.[key] || {};
    const [count, label, kind] = yesIsPraise
      ? [yes - no >= MIN_TRAIT_MENTIONS ? yes : 0, praise, 'praise']
      : yes >= MIN_TRAIT_MENTIONS && yes > no ? [yes, complaint, 'complaint warning-level-2']
        : no >= MIN_TRAIT_MENTIONS && no > yes ? [no, praise, 'praise'] : [0];
    if (!count) return [];
    const tip = `${count} de ${reviews.withText} avaliações com comentário citam isso`;
    return [{ count, html: `<li class="review-tag review-${kind}" tabindex="0" data-tip="${tip}">${label} <span>${count}</span></li>` }];
  }).sort((a, b) => b.count - a.count).map((tag) => tag.html);
  return `
    <div class="review-summary">
      <p class="review-rating"><strong>${rating.format(reviews.average)} ★</strong> ${reviews.count.toLocaleString('pt-BR')} ${reviews.count === 1 ? 'avaliação' : 'avaliações'} na loja</p>
      ${tags.length ? `<ul class="review-tags">${tags.join('')}</ul>` : ''}
    </div>`;
}

function addFilter(label, key, values, allLabel = 'Qualquer') {
  const options = values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('');
  return `<div class="filter-control"><label for="filter-${key}">${label}</label><select id="filter-${key}" data-filter="${key}"><option value="">${allLabel}</option>${options}</select></div>`;
}

const proteinPer100g = (product) => {
  const mass = proteinServingMass(product);
  return Number.isFinite(product.proteinGrams) && mass > 0 ? (product.proteinGrams / mass) * 100 : null;
};

// Each sort returns the value to order by; `descending` marks metrics where
// more is better, which sets the first click's direction.
const SORTS = {
  whey: {
    unitPrice: { label: 'Preço/100 g proteína', value: (product) => product.unitPrice },
    carbProtein: { label: 'Carbo/proteína', value: (product) => product.carbProteinRatio },
    saturatedFat: { label: 'Gordura saturada', value: (product) => saturatedFatPer100g(product.nutritionDetails) },
    protein: { label: 'Proteína/100 g', value: proteinPer100g, descending: true },
    price: { label: 'Preço', value: (product) => product.price },
  },
  sunscreen: {
    unitPrice: { label: 'Preço por quantidade', value: (product) => product.unitPrice },
    spf: { label: 'FPS', value: (product) => product.spf, descending: true },
    price: { label: 'Preço', value: (product) => product.price },
  },
};
// Products are ordered by each chosen criterion in turn; a later one only
// breaks ties left by the earlier ones.
const defaultSort = () => [{ key: 'unitPrice', descending: false }];
let sortState = defaultSort();

function renderSortButtons() {
  return Object.entries(SORTS[activeCategory]).map(([key, sort]) => {
    const index = sortState.findIndex((criterion) => criterion.key === key);
    const criterion = sortState[index];
    const arrow = criterion ? (criterion.descending ? '↓' : '↑') : '↕';
    const title = criterion ? `${criterion.descending ? 'Maior' : 'Menor'} primeiro. Clique para inverter ou remover.` : 'Clique para ordenar também por este critério.';
    const order = criterion && sortState.length > 1 ? `<span class="sort-order">${index + 1}</span>` : '';
    return `<button class="sort-button${criterion ? ' is-active' : ''}" type="button" data-sort-key="${key}" aria-pressed="${Boolean(criterion)}" title="${title}">${order}${sort.label} <span class="sort-arrow" aria-hidden="true">${arrow}</span></button>`;
  }).join('');
}

function renderFilters() {
  const categoryProducts = products[activeCategory];
  if (categoryProducts.length === 0) {
    filterControls.replaceChildren();
    return;
  }
  const brands = [...new Set(categoryProducts.map((product) => product.brand))].sort();
  const types = [...new Set(categoryProducts.map((product) => product.type))].sort();
  let markup = addFilter('Marca', 'brand', brands, 'Todas as marcas');

  markup += addFilter('Tipo', 'type', types);
  if (activeCategory === 'sunscreen') {
    const spfs = [...new Set(categoryProducts.map((product) => product.spf).filter(Number.isFinite))].sort((a, b) => a - b);
    markup += addFilter('FPS', 'spf', spfs.map(String), 'Todos');
    markup += `<div class="filter-control"><label for="filter-feature">Característica</label><select id="filter-feature" data-filter="feature"><option value="">Qualquer</option>${FEATURES
      .map((feature) => `<option value="${feature.value}">${feature.label}</option>`).join('')}</select></div>`;
    markup += `<div class="filter-control"><label for="filter-measure">Medida</label><select id="filter-measure" data-filter="measure">
      <option value="ml">ml (loções, fluidos, sprays)</option><option value="g">g (cremes, géis, bastões)</option></select></div>`;
  }
  markup += `<div class="filter-control sort-control"><span class="sort-label">Ordenar por</span><div class="sort-buttons" role="group" aria-label="Ordenar por">${renderSortButtons()}</div></div>`;

  filterControls.innerHTML = markup;
}

function renderProducts() {
  const selectedFilters = Object.fromEntries([...filterControls.querySelectorAll('[data-filter]')]
    .map((select) => [select.dataset.filter, select.value]));
  const linkedProducts = products[activeCategory].filter((product) => isDirectProductUrl(product.url));
  const filtered = linkedProducts
    .filter((product) => Object.entries(selectedFilters).every(([key, value]) => {
      if (!value) return true;
      if (key === 'feature') return FEATURES.find((feature) => feature.value === value).test(product);
      return String(key === 'measure' ? sunscreenMeasure(product) : product[key]) === value;
    }))
    .map((product) => ({ ...product, unitPrice: getUnitPrice(product, activeCategory) }))
    .sort((a, b) => {
      for (const criterion of [...sortState, ...defaultSort()]) {
        const sort = SORTS[activeCategory][criterion.key];
        const key = (product) => {
          const value = sort.value(product);
          if (!Number.isFinite(value)) return Infinity;
          return criterion.descending ? -value : value;
        };
        const difference = key(a) - key(b);
        if (difference) return difference;
      }
      return 0;
    });

  visibleProducts = filtered;

  if (filtered.length === 0) {
    const message = products[activeCategory].length
      ? 'Nenhum produto encontrado com esses filtros.'
      : 'Nenhum produto no catálogo. Atualize o catálogo local e publique o arquivo.';
    productGrid.innerHTML = `<p class="empty-state">${message}</p>`;
    resultCount.textContent = '0 produtos';
    return;
  }

  const bestPrice = Math.min(...filtered.map((product) => product.unitPrice).filter(Number.isFinite));
  productGrid.innerHTML = filtered.map((product, productIndex) => {
    const unitLabel = getUnitLabel(activeCategory, product);
    const isBest = Number.isFinite(product.unitPrice) && product.unitPrice === bestPrice;
    const productLink = `<a class="product-link" href="${escapeHtml(product.url)}" target="_blank" rel="noopener noreferrer">Ver produto ↗</a>`;
    const productImage = product.image
      ? `<img class="product-image" src="${escapeHtml(product.image)}" alt="${escapeHtml(product.name)}" loading="lazy" width="88" height="88">`
      : '';
    const warnings = nutritionWarnings(product);
    const warningMark = (detail) => {
      const warning = warnings[detail];
      if (!warning) return '';
      const label = `${WARNING_LEVELS[warning.level - 1]}. ${warning.text}`;
      return `<span class="nutrition-warning-mark warning-level-${warning.level}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">⚠</span>`;
    };
    const ratio = Number.isFinite(product.carbProteinRatio)
      ? formatRatio(product.carbProteinRatio)
      : 'Sem dado';
    const essentialAminoAcidCount = product.nutritionDetails?.aminoAcids?.essential?.length || 0;
    const nonEssentialAminoAcidCount = product.nutritionDetails?.aminoAcids?.nonEssential?.length || 0;
    const hasAminoAcidData = essentialAminoAcidCount + nonEssentialAminoAcidCount > 0;
    const saturatedFatSummary = Number.isFinite(saturatedFatPer100g(product.nutritionDetails))
      ? `${formatNutritionAmount(saturatedFatPer100g(product.nutritionDetails))} g/100 g`
      : Number.isFinite(product.nutritionDetails?.saturatedFatGrams)
        ? `${formatNutritionAmount(product.nutritionDetails.saturatedFatGrams)} g/porção`
        : 'Sem dado';
    const energySummary = Number.isFinite(product.nutritionDetails?.energyKcalPer100g)
      ? `${formatNutritionAmount(product.nutritionDetails.energyKcalPer100g)} kcal/100 g`
      : Number.isFinite(product.nutritionDetails?.energyKcalPerServing)
        ? `${formatNutritionAmount(product.nutritionDetails.energyKcalPerServing)} kcal/porção`
        : 'Sem dado';
    return `
      <article class="product-card${isBest ? ' best-value' : ''}">
        ${isBest ? `<span class="best-label">${activeCategory === 'whey' ? 'MELHOR VALOR' : 'MENOR PREÇO'}</span>` : ''}
        <div class="product-info">
          ${productImage}
          <div class="product-copy">
            <p class="product-brand">${escapeHtml(product.brand)}${product.store ? ` · ${escapeHtml(product.store)}` : ''}</p>
            <h3 class="product-name">${escapeHtml(product.name)}</h3>
            ${productLink}
            ${activeCategory === 'whey' ? `<div class="nutrition-actions">
              <button class="nutrition-info-button${warnings['carb-protein'] ? ` warning-level-${warnings['carb-protein'].level}` : ''}" type="button" data-nutrition-detail="carb-protein" data-product-index="${productIndex}" aria-haspopup="dialog">
                <span>${warningMark('carb-protein')}Carbo/proteína</span><strong>${ratio}</strong>
              </button>
              <button class="nutrition-info-button" type="button" data-nutrition-detail="energy" data-product-index="${productIndex}" aria-haspopup="dialog">
                <span>Energia</span><strong>${energySummary}</strong>
              </button>
              <button class="nutrition-info-button" type="button" data-nutrition-detail="amino-acids" data-product-index="${productIndex}" aria-haspopup="dialog">
                <span>Aminoácidos</span><strong>${hasAminoAcidData ? `${essentialAminoAcidCount} essenciais` : 'Sem dado'}</strong>
              </button>
              <button class="nutrition-info-button${warnings['saturated-fat'] ? ` warning-level-${warnings['saturated-fat'].level}` : ''}" type="button" data-nutrition-detail="saturated-fat" data-product-index="${productIndex}" aria-haspopup="dialog">
                <span>${warningMark('saturated-fat')}Gordura saturada</span><strong>${saturatedFatSummary}</strong>
              </button>
            </div>` : `<p class="product-meta">FPS ${Number.isFinite(product.spf) ? product.spf : 'sem dado'} <span>·</span> ${escapeHtml(product.type)}${product.texture ? ` <span>·</span> ${escapeHtml(product.texture)}` : ''}</p>${featureLine(product)}${reviewSummary(product)}
            <button class="details-button" type="button" data-sunscreen-details data-product-index="${productIndex}" aria-haspopup="dialog">Características</button>`}
          </div>
        </div>
        <div class="price-block">
          <div class="unit-price">${Number.isFinite(product.unitPrice) ? currency.format(product.unitPrice) : '—'}</div>
          <div class="unit-caption"${product.nutritionDataSource === 'product image OCR' ? ' title="O peso da porção ou a proteína foi lido automaticamente da imagem do produto."' : ''}>${Number.isFinite(product.unitPrice) ? `por ${unitLabel}${product.paymentCondition ? ` · ${escapeHtml(product.paymentCondition)}` : ''}${product.nutritionDataSource === 'product image OCR' ? ' · imagem' : ''}` : (activeCategory === 'whey' ? 'sem dado de proteína' : `por ${unitLabel}`)}</div>
          <div class="package-price"><span>${formatAmount(product)}</span><strong>${currency.format(product.price)}</strong></div>
        </div>
      </article>`;
  }).join('');

  resultCount.textContent = `${filtered.length} ${filtered.length === 1 ? 'produto' : 'produtos'}`;
}

async function loadCatalog() {
  try {
    const response = await fetch('./data/products.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const catalog = await response.json();
    products = {
      whey: Array.isArray(catalog.products?.whey)
        ? catalog.products.whey.filter((product) => isDirectProductUrl(product.url))
        : [],
      sunscreen: Array.isArray(catalog.products?.sunscreen)
        ? catalog.products.sunscreen.filter((product) => isDirectProductUrl(product.url))
        : [],
    };
    if (catalog.updatedAt) {
      document.querySelector('#footer-updated').textContent = `em ${new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long' }).format(new Date(catalog.updatedAt))}`;
    }
    catalogStatus.textContent = catalog.updatedAt
      ? `Atualizado em ${new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(catalog.updatedAt))}`
      : 'Catálogo ainda não atualizado';
    renderFilters();
    renderProducts();
  } catch (error) {
    catalogStatus.textContent = 'Catálogo não carregado';
    productGrid.innerHTML = '<p class="empty-state">Não foi possível carregar o catálogo. Inicie o site com <strong>make serve</strong> e abra <strong>http://localhost:8001</strong>.</p>';
    resultCount.textContent = '0 produtos';
    console.error('Failed to load product catalog:', error);
  }
}

categoryButtons.forEach((button) => {
  button.addEventListener('click', () => {
    activeCategory = button.dataset.category;
    sortState = defaultSort();
    categoryButtons.forEach((item) => {
      const selected = item === button;
      item.classList.toggle('is-active', selected);
      item.setAttribute('aria-pressed', String(selected));
    });
    guideButton.hidden = activeCategory !== 'sunscreen';
    renderFilters();
    renderProducts();
  });
});

filterControls.addEventListener('change', renderProducts);
filterControls.addEventListener('click', (event) => {
  const button = event.target.closest('[data-sort-key]');
  if (!button) return;
  const key = button.dataset.sortKey;
  // Each click cycles a criterion: default direction, reversed, removed.
  const firstDirection = Boolean(SORTS[activeCategory][key].descending);
  const criterion = sortState.find((item) => item.key === key);
  if (!criterion) sortState = [...sortState, { key, descending: firstDirection }];
  else if (criterion.descending === firstDirection) criterion.descending = !firstDirection;
  else sortState = sortState.filter((item) => item !== criterion);
  filterControls.querySelector('.sort-buttons').innerHTML = renderSortButtons();
  renderProducts();
});
productGrid.addEventListener('click', (event) => {
  const button = event.target.closest('[data-nutrition-detail], [data-sunscreen-details]');
  if (!button) return;
  const product = visibleProducts[Number(button.dataset.productIndex)];
  if (!product) return;
  nutritionDialogProduct.textContent = product.name;
  if (button.matches('[data-sunscreen-details]')) {
    nutritionDialogEyebrow.textContent = 'PROTETOR SOLAR';
    nutritionDialogTitle.textContent = 'Detalhes';
    nutritionDialogContent.innerHTML = renderSunscreenDialog(product);
  } else {
    nutritionDialogEyebrow.textContent = 'DETALHES NUTRICIONAIS';
    nutritionDialogContent.innerHTML = renderNutritionDialog(product, button.dataset.nutritionDetail);
  }
  nutritionDialog.showModal();
});
document.querySelector('#nutrition-dialog-close').addEventListener('click', () => nutritionDialog.close());
nutritionDialog.addEventListener('click', (event) => {
  if (event.target === nutritionDialog) nutritionDialog.close();
});
guideButton.addEventListener('click', () => guideDialog.showModal());
document.querySelector('#guide-dialog-close').addEventListener('click', () => guideDialog.close());
guideDialog.addEventListener('click', (event) => {
  if (event.target === guideDialog) guideDialog.close();
});
renderFilters();
loadCatalog();
