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
const categorySummary = document.querySelector('#category-summary');
let activeCategory = categoryForPath(location.pathname) || 'whey';
let catalogData = null;
let products = { whey: [], sunscreen: [], creatine: [] };
let visibleProducts = [];

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
  { value: 'water', label: 'Resistente à água', help: 'Continua protegendo por até 40 minutos na água ou suando. Se o rótulo disser "muito resistente à água", por até 80 minutos. Depois disso, ou ao se secar com a toalha, passe de novo.', attribute: 'IS_WATER_RESISTANT', test: (product) => catalogSays(product, 'IS_WATER_RESISTANT') === 'Sim' },
  { value: 'oil-free', label: 'Oil free', help: 'Sem óleos na fórmula. Costuma deixar menos brilho, bom para pele oleosa ou com acne.', attribute: 'IS_OIL_FREE', test: (product) => catalogSays(product, 'IS_OIL_FREE') === 'Sim' || /oil.?free|livre de oleo/.test(plainName(product)) },
  { value: 'tinted', label: 'Com cor', attribute: 'WITH_COLOR', test: (product) => catalogSays(product, 'WITH_COLOR') === 'Sim' || TINTED_NAME.test(plainName(product)) },
  { value: 'untinted', label: 'Sem cor', card: false, test: (product) => catalogSays(product, 'WITH_COLOR') === 'Não' && !TINTED_NAME.test(plainName(product)) },
  { value: 'eyes', label: 'Indicado para perto dos olhos', attribute: 'IS_SUITABLE_FOR_EYE_CONTOUR', test: (product) => catalogSays(product, 'IS_SUITABLE_FOR_EYE_CONTOUR') === 'Sim' },
  { value: 'kids', label: 'Infantil', attribute: 'IS_INFANT', test: (product) => catalogSays(product, 'IS_INFANT') === 'Sim' || /\bkids\b|infantil|\bbaby\b|\bbebe|crianc/.test(plainName(product)) },
  { value: 'hypoallergenic', label: 'Hipoalergênico', help: 'Fórmula feita para reduzir o risco de alergia. Não garante que não haverá reação.', attribute: 'IS_HYPOALLERGENIC_PRODUCT', test: (product) => catalogSays(product, 'IS_HYPOALLERGENIC_PRODUCT') === 'Sim' },
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

const ALLERGEN_NAMES = {
  leite: 'leite', soja: 'soja', ovo: 'ovo', trigo: 'trigo', aveia: 'aveia', centeio: 'centeio', cevada: 'cevada',
  amendoim: 'amendoim', amendoa: 'amêndoa', avela: 'avelã', 'castanha-de-caju': 'castanha-de-caju',
  'castanha-do-para': 'castanha-do-pará', macadamia: 'macadâmia', nozes: 'nozes', peixe: 'peixe', crustaceos: 'crustáceos',
};
const allergenNames = (keys = []) => keys.map((key) => ALLERGEN_NAMES[key] || key).join(', ');
const LABEL_ANSWERS = { yes: 'Contém', no: 'Não contém', depends: 'Depende do sabor' };
const hasAllergen = (product, key) => [...(product.allergens?.contains || []), ...(product.allergens?.mayContain || [])].includes(key);
// Label filters; an option shows only when some product matches it.
const WHEY_RESTRICTIONS = [
  { value: 'gluten-free', label: 'Sem glúten', test: (product) => product.gluten === 'no' },
  { value: 'lactose-free', label: 'Sem lactose', test: (product) => product.lactose === 'no' },
  { value: 'soy-free', label: 'Sem soja', test: (product) => Boolean(product.allergens) && !hasAllergen(product, 'soja') },
  { value: 'egg-free', label: 'Sem ovo', test: (product) => Boolean(product.allergens) && !hasAllergen(product, 'ovo') },
];

function labelLine(product) {
  const labels = [
    product.gluten === 'no' ? 'Sem glúten' : product.gluten === 'yes' ? 'Contém glúten' : product.gluten === 'depends' ? 'Glúten depende do sabor' : '',
    product.lactose === 'no' ? 'Sem lactose' : product.lactose === 'yes' ? 'Contém lactose' : '',
    ...(product.allergens?.contains || []).filter((key) => key !== 'leite').map((key) => `Contém ${ALLERGEN_NAMES[key] || key}`),
  ].filter(Boolean);
  return labels.length ? `<p class="product-features">${labels.map(escapeHtml).join(' <span>·</span> ')}</p>` : '';
}

function renderLabelDialog(product) {
  const answer = (value) => LABEL_ANSWERS[value] || '';
  return `
    <section class="details-section">
      <h3>Alergênicos</h3>
      <dl class="details-list">
        ${detailRow('Glúten', answer(product.gluten))}
        ${detailRow('Lactose', answer(product.lactose))}
        ${detailRow('Contém', allergenNames(product.allergens?.contains))}
        ${product.allergens?.mayContain?.length ? detailRow('Pode conter', allergenNames(product.allergens.mayContain)) : ''}
      </dl>
    </section>
    ${product.ingredients ? `<section class="details-section"><details open><summary>Ingredientes</summary><p class="details-text details-ingredients">${escapeHtml(product.ingredients)}</p></details></section>` : ''}
    <p class="nutrition-modal-note">Lido automaticamente do texto do rótulo na página da loja e pode ter erros. "Sem dado" quando a página não diz. Confira na embalagem.</p>`;
}

// How much of the powder is creatine, and where that came from.
function creatineDetails(product, productIndex) {
  const percent = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format((product.creatineShare || 0) * 100);
  const share = !product.creatineShare ? 'Teor de creatina: sem dado'
    : product.creatineSource === 'table'
      ? `${formatNutritionAmount(product.creatinePerServingGrams)} g de creatina a cada ${formatNutritionAmount(product.servingMassGrams)} g (${percent}%)`
      : `${percent}% creatina (pela ${product.creatineSource === 'ingredients' ? 'lista de ingredientes' : 'descrição do produto'})`;
  const unitPrice = creatineUnitPrice(product);
  const dose = Number.isFinite(unitPrice) ? ` <span>·</span> Dose de ${CREATINE_DOSE_GRAMS} g: ${currency.format((unitPrice / 100) * CREATINE_DOSE_GRAMS)}` : '';
  return `<p class="product-meta">${escapeHtml(product.type)}${dose}</p>
    <p class="product-features">${escapeHtml(share)}</p>
    ${product.ingredients || product.allergens ? `<button class="details-button" type="button" data-whey-label data-product-index="${productIndex}" aria-haspopup="dialog">Rótulo</button>` : ''}`;
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

// What each product type means; the type comes from words in the name.
const TYPE_HELP = {
  Concentrado: 'O mais comum e barato. Tem de 70% a 80% de proteína e mantém um pouco de gordura e lactose.',
  Isolado: 'Filtrado para chegar a 90% de proteína ou mais, com pouca gordura e lactose.',
  Hidrolisado: 'A proteína vem quebrada em partes menores, então é digerida mais rápido. O mais caro.',
  Blend: 'Mistura de tipos de proteína, como concentrado, isolado e hidrolisado ("3W") ou whey com ovo. Confira a proporção no rótulo.',
  'Whey protein': 'O nome não diz o tipo. Na maioria das vezes é concentrado.',
  'Uso geral': 'O nome não diz se é para rosto ou corpo.',
  Monohidratada: 'A forma de creatina estudada e recomendada. Funciona igual em qualquer marca de boa procedência.',
  Creapure: 'Creatina monohidratada fabricada na Alemanha pela AlzChem, com controle de pureza próprio. Mais cara; o efeito é o mesmo da monohidratada pura.',
};

// A dropdown of checkboxes. Filters in MATCH_ALL keep products that have
// every checked option; the others keep products that have any of them.
const MATCH_ALL = new Set(['feature', 'restriction']);

function addFilter(label, key, options, allLabel = 'Todos') {
  // An option with `help` gets an ⓘ button with a balloon, shown on hover or tap.
  const items = options.map((option) => (typeof option === 'string' ? { value: option, label: option } : option))
    .map((option, index) => {
      const helpId = `filter-${key}-help-${index}`;
      const checkbox = `<label class="filter-option"><input type="checkbox" data-filter="${key}" value="${escapeHtml(option.value)}" data-label="${escapeHtml(option.label)}"><span>${escapeHtml(option.label)}</span></label>`;
      if (!option.help) return checkbox;
      return `<div class="filter-option-row">${checkbox}<button class="filter-info" type="button" data-filter-help aria-expanded="false" aria-describedby="${helpId}" aria-label="O que é ${escapeHtml(option.label)}?">i</button><span class="filter-balloon" id="${helpId}" role="tooltip">${escapeHtml(option.help)}</span></div>`;
    }).join('');
  const hint = MATCH_ALL.has(key) ? 'Com todas as marcadas' : 'Com qualquer uma das marcadas';
  return `<div class="filter-control"><span class="filter-label" id="filter-${key}-label">${label}</span>
    <details class="filter-menu" data-filter-menu="${key}" data-all-label="${escapeHtml(allLabel)}">
      <summary class="filter-trigger" aria-labelledby="filter-${key}-label filter-${key}-value"><span class="filter-value" id="filter-${key}-value">${escapeHtml(allLabel)}</span><span class="filter-count" hidden></span></summary>
      <div class="filter-dropdown" role="group" aria-labelledby="filter-${key}-label">
        ${items}
        <div class="filter-dropdown-footer"><span>${hint}</span><button class="filter-clear" type="button" data-filter-clear="${key}">Limpar</button></div>
      </div>
    </details></div>`;
}

// Shows "Todas", the one checked option, or the first one and "+N".
function updateFilterSummaries() {
  for (const menu of filterControls.querySelectorAll('[data-filter-menu]')) {
    const checked = [...menu.querySelectorAll('input:checked')].map((input) => input.dataset.label);
    menu.classList.toggle('has-value', checked.length > 0);
    menu.querySelector('.filter-value').textContent = checked[0] || menu.dataset.allLabel;
    const count = menu.querySelector('.filter-count');
    count.hidden = checked.length < 2;
    count.textContent = `+${checked.length - 1}`;
  }
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
    price: { label: 'Preço', value: buyPrice },
  },
  creatine: {
    unitPrice: { label: 'Preço/100 g creatina', value: (product) => product.unitPrice },
    price: { label: 'Preço', value: buyPrice },
  },
  sunscreen: {
    unitPrice: { label: 'Preço por quantidade', value: (product) => product.unitPrice },
    spf: { label: 'FPS', value: (product) => product.spf, descending: true },
    price: { label: 'Preço', value: buyPrice },
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
  let markup = addFilter('Marca', 'brand', brands, 'Todas');

  markup += addFilter('Tipo', 'type', types.map((type) => ({ value: type, label: type, help: TYPE_HELP[type] })));
  if (activeCategory === 'whey') {
    const restrictions = WHEY_RESTRICTIONS.filter((restriction) => categoryProducts.some(restriction.test));
    if (restrictions.length) markup += addFilter('Restrição', 'restriction', restrictions, 'Nenhuma');
  }
  if (activeCategory === 'sunscreen') {
    const spfs = [...new Set(categoryProducts.map((product) => product.spf).filter(Number.isFinite))].sort((a, b) => a - b);
    markup += addFilter('FPS', 'spf', spfs.map(String));
    markup += addFilter('Característica', 'feature', FEATURES, 'Qualquer');
    // Prices per ml and per g can't be compared, so only one measure shows.
    markup += `<div class="filter-control"><span class="filter-label" id="filter-measure-label">Medida</span>
      <div class="filter-segmented" role="radiogroup" aria-labelledby="filter-measure-label">
        <label title="Loções, fluidos, sprays"><input type="radio" name="measure" data-filter="measure" value="ml" checked><span>ml</span></label>
        <label title="Cremes, géis, bastões"><input type="radio" name="measure" data-filter="measure" value="g"><span>g</span></label>
      </div></div>`;
  }
  markup += `<div class="filter-control sort-control"><span class="sort-label">Ordenar por</span><div class="sort-buttons" role="group" aria-label="Ordenar por">${renderSortButtons()}</div></div>`;

  filterControls.innerHTML = markup;
}

function renderProducts() {
  const selectedFilters = {};
  for (const input of filterControls.querySelectorAll('[data-filter]:checked')) (selectedFilters[input.dataset.filter] ||= []).push(input.value);
  const linkedProducts = products[activeCategory].filter((product) => isDirectProductUrl(product.url));
  const filtered = linkedProducts
    .filter((product) => Object.entries(selectedFilters).every(([key, values]) => {
      const matches = (value) => {
        if (key === 'feature') return FEATURES.find((feature) => feature.value === value).test(product);
        if (key === 'restriction') return WHEY_RESTRICTIONS.find((restriction) => restriction.value === value).test(product);
        return String(key === 'measure' ? sunscreenMeasure(product) : product[key]) === value;
      };
      return MATCH_ALL.has(key) ? values.every(matches) : values.some(matches);
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

  const bestUnitPrice = Math.min(...filtered.map((product) => product.unitPrice).filter(Number.isFinite));
  productGrid.innerHTML = filtered.map((product, productIndex) => {
    const unitLabel = getUnitLabel(activeCategory, product);
    const isBest = Number.isFinite(product.unitPrice) && product.unitPrice === bestUnitPrice;
    const offer = mercadoLivreOffer(product);
    const viaMercadoLivre = mercadoLivreIsCheaper(product);
    const offerRel = offer?.affiliate ? 'sponsored noopener noreferrer' : 'noopener noreferrer';
    const productLink = viaMercadoLivre
      ? `<a class="product-link" href="${escapeHtml(offer.url)}" target="_blank" rel="${offerRel}">Ver no Mercado Livre ↗</a>`
      : `<a class="product-link" href="${escapeHtml(product.url)}" target="_blank" rel="noopener noreferrer">Ver produto ↗</a>`;
    // The other place to buy, shown under the price.
    const otherOffer = !offer ? ''
      : viaMercadoLivre
        ? `<a class="other-offer" href="${escapeHtml(product.url)}" target="_blank" rel="noopener noreferrer">Na loja: ${currency.format(product.price)} ↗</a>`
        : `<a class="other-offer" href="${escapeHtml(offer.url)}" target="_blank" rel="${offerRel}">No Mercado Livre: ${currency.format(offer.price)} ↗</a>`;
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
        ${isBest ? `<span class="best-label">${activeCategory === 'sunscreen' ? 'MENOR PREÇO' : 'MELHOR VALOR'}</span>` : ''}
        <div class="product-info">
          ${productImage}
          <div class="product-copy">
            <p class="product-brand">${escapeHtml(product.brand)}${product.store ? ` · ${escapeHtml(product.store)}` : ''}</p>
            <h3 class="product-name">${escapeHtml(product.name)}</h3>
            ${productLink}
            ${activeCategory === 'creatine' ? creatineDetails(product, productIndex) : activeCategory === 'whey' ? `<div class="nutrition-actions">
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
            </div>${labelLine(product)}
            ${product.ingredients || product.allergens ? `<button class="details-button" type="button" data-whey-label data-product-index="${productIndex}" aria-haspopup="dialog">Rótulo</button>` : ''}` : `<p class="product-meta">FPS ${Number.isFinite(product.spf) ? product.spf : 'sem dado'} <span>·</span> ${escapeHtml(product.type)}${product.texture ? ` <span>·</span> ${escapeHtml(product.texture)}` : ''}</p>${featureLine(product)}${reviewSummary(product)}
            <button class="details-button" type="button" data-sunscreen-details data-product-index="${productIndex}" aria-haspopup="dialog">Características</button>`}
          </div>
        </div>
        <div class="price-block">
          <div class="unit-price">${Number.isFinite(product.unitPrice) ? currency.format(product.unitPrice) : '—'}</div>
          <div class="unit-caption"${product.nutritionDataSource === 'product image OCR' ? ' title="O peso da porção ou a proteína foi lido automaticamente da imagem do produto."' : ''}>${Number.isFinite(product.unitPrice) ? `por ${unitLabel}${product.paymentCondition && !viaMercadoLivre ? ` · ${escapeHtml(product.paymentCondition)}` : ''}${product.nutritionDataSource === 'product image OCR' ? ' · imagem' : ''}` : `por ${unitLabel}`}</div>
          <div class="package-price"><span>${formatAmount(product)}${viaMercadoLivre ? ' · Mercado Livre' : ''}</span><strong>${currency.format(buyPrice(product))}</strong></div>
          ${otherOffer}
          <label class="compare-toggle"><input type="checkbox" data-compare="${escapeHtml(compareKey(product))}"${compareSelection.includes(compareKey(product)) ? ' checked' : ''}> Comparar</label>
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
    // Products without a price per quantity (no protein or creatine data)
    // can't be compared, so they are not shown. They stay in the catalog in
    // case a later update reads their data.
    catalogData = catalog;
    products = { whey: comparableProducts(catalog, 'whey'), sunscreen: comparableProducts(catalog, 'sunscreen'), creatine: comparableProducts(catalog, 'creatine') };
    if (catalog.updatedAt) {
      document.querySelector('#footer-updated').textContent = `em ${new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long' }).format(new Date(catalog.updatedAt))}`;
    }
    catalogStatus.textContent = catalog.updatedAt
      ? `Atualizado em ${new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(catalog.updatedAt))}`
      : 'Catálogo ainda não atualizado';
    renderFilters();
    renderProducts();
    categorySummary.innerHTML = renderCategorySummary(activeCategory, catalog);
  } catch (error) {
    catalogStatus.textContent = 'Catálogo não carregado';
    productGrid.innerHTML = '<p class="empty-state">Não foi possível carregar o catálogo. Inicie o site com <strong>make serve</strong> e abra <strong>http://localhost:8001</strong>.</p>';
    resultCount.textContent = '0 produtos';
    console.error('Failed to load product catalog:', error);
  }
}

// Each category has its own address; switching changes it without a reload,
// since the catalog is already loaded.
function markCategory(category, page) {
  categoryButtons.forEach((item) => {
    const selected = item.dataset.category === category;
    item.classList.toggle('is-active', selected);
    if (selected) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  });
  document.title = page.title;
  document.querySelector('meta[name="description"]').content = page.description;
  document.querySelector('#comparison-title').textContent = page.heading;
  guideButton.hidden = category !== 'sunscreen';
}

function showCategory(category, page = CATEGORY_PAGES[category]) {
  activeCategory = category;
  sortState = defaultSort();
  markCategory(category, page);
  compareSelection = [];
  renderCompareBar();
  renderFilters();
  renderProducts();
  if (catalogData) categorySummary.innerHTML = renderCategorySummary(category, catalogData);
}

categoryButtons.forEach((button) => {
  button.addEventListener('click', (event) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (button.dataset.category === activeCategory && location.pathname === button.pathname) return;
    history.pushState(null, '', button.href);
    showCategory(button.dataset.category);
  });
});
window.addEventListener('popstate', () => {
  const category = categoryForPath(location.pathname);
  showCategory(category || 'whey', category ? CATEGORY_PAGES[category] : ROOT_PAGE);
});

filterControls.addEventListener('change', () => {
  updateFilterSummaries();
  renderProducts();
});
// Only one dropdown stays open; a click outside or Escape closes it.
filterControls.addEventListener('toggle', (event) => {
  event.target.querySelectorAll?.('[data-filter-help]').forEach((button) => button.setAttribute('aria-expanded', 'false'));
  if (!event.target.open) return;
  filterControls.querySelectorAll('[data-filter-menu][open]').forEach((menu) => { if (menu !== event.target) menu.open = false; });
}, true);
document.addEventListener('click', (event) => {
  filterControls.querySelectorAll('[data-filter-menu][open]').forEach((menu) => { if (!menu.contains(event.target)) menu.open = false; });
});
filterControls.addEventListener('keydown', (event) => {
  const menu = event.target.closest('[data-filter-menu][open]');
  if (event.key !== 'Escape' || !menu) return;
  menu.open = false;
  menu.querySelector('summary').focus();
});
filterControls.addEventListener('click', (event) => {
  const info = event.target.closest('[data-filter-help]');
  if (info) {
    const open = info.getAttribute('aria-expanded') !== 'true';
    filterControls.querySelectorAll('[data-filter-help]').forEach((button) => button.setAttribute('aria-expanded', 'false'));
    info.setAttribute('aria-expanded', String(open));
    return;
  }
  const clear = event.target.closest('[data-filter-clear]');
  if (clear) {
    clear.closest('[data-filter-menu]').querySelectorAll('input:checked').forEach((input) => { input.checked = false; });
    updateFilterSummaries();
    renderProducts();
    return;
  }
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
  const button = event.target.closest('[data-nutrition-detail], [data-sunscreen-details], [data-whey-label]');
  if (!button) return;
  const product = visibleProducts[Number(button.dataset.productIndex)];
  if (!product) return;
  nutritionDialogProduct.textContent = product.name;
  if (button.matches('[data-sunscreen-details]')) {
    nutritionDialogEyebrow.textContent = 'PROTETOR SOLAR';
    nutritionDialogTitle.textContent = 'Detalhes';
    nutritionDialogContent.innerHTML = renderSunscreenDialog(product);
  } else if (button.matches('[data-whey-label]')) {
    nutritionDialogEyebrow.textContent = activeCategory === 'creatine' ? 'CREATINA' : 'WHEY PROTEIN';
    nutritionDialogTitle.textContent = 'Rótulo';
    nutritionDialogContent.innerHTML = renderLabelDialog(product);
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
markCategory(activeCategory, categoryForPath(location.pathname) ? CATEGORY_PAGES[activeCategory] : ROOT_PAGE);
renderFilters();
loadCatalog();

// Compare two products side by side. The selection keeps working across
// filters and is cleared when the category changes.
const MAX_COMPARE = 2;
const compareBar = document.querySelector('#compare-bar');
const compareDialog = document.querySelector('#compare-dialog');
const compareDialogContent = document.querySelector('#compare-dialog-content');
let compareSelection = [];
let compareHint = '';

// Sizes sold on one page share its address, so the key adds size and name.
function compareKey(product) {
  return `${product.url}|${product.amount}${product.unit}|${product.name}`;
}

const selectedForCompare = () => compareSelection
  .map((key) => products[activeCategory].find((product) => compareKey(product) === key)).filter(Boolean);

function renderCompareBar() {
  const selected = selectedForCompare();
  compareBar.hidden = selected.length === 0;
  if (!selected.length) return;
  const chips = selected.map((product) => `<span class="compare-chip"><span>${escapeHtml(product.name)}</span><button type="button" data-compare-remove="${escapeHtml(compareKey(product))}" aria-label="Tirar ${escapeHtml(product.name)} da comparação">✕</button></span>`).join('');
  const hint = compareHint || (selected.length < MAX_COMPARE ? 'Escolha mais 1 produto' : '');
  compareBar.innerHTML = `<div class="compare-bar-inner">
    <div class="compare-chips">${chips}${hint ? `<span class="compare-hint">${escapeHtml(hint)}</span>` : ''}</div>
    <div class="compare-actions"><button class="compare-clear" type="button" data-compare-clear>Limpar</button>
    <button class="compare-open" type="button" data-compare-open${selected.length < MAX_COMPARE ? ' disabled' : ''}>Comparar</button></div>
  </div>`;
}

const plainNumber = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
const percentOf = (part, whole) => (part > 0 && whole > 0 ? (part / whole) * 100 : null);
const labelAnswer = (value) => LABEL_ANSWERS[value] || '';
const yesNo = (product, feature) => (feature.test(product) ? 'Sim' : catalogSays(product, feature.attribute) === 'Não' ? 'Não' : '');

// Each row: label, value(product) for picking the better one (lower or
// higher wins; none means just shown), and text(product) for the cell.
function compareRows(category, items) {
  const unitLabel = (product) => getUnitLabel(category, product);
  const common = [
    { label: 'Preço por quantidade', value: (product) => getUnitPrice(product, category), better: 'low',
      text: (product) => `${currency.format(getUnitPrice(product, category))} por ${unitLabel(product)}` },
    { label: 'Preço', value: buyPrice,
      text: (product) => `${currency.format(buyPrice(product))} (${formatAmount(product)})${mercadoLivreIsCheaper(product) ? ' no Mercado Livre' : ''}` },
    { label: 'Tipo', text: (product) => product.type },
  ];
  if (category === 'whey') {
    return [...common,
      { label: 'Proteína por dose', value: proteinPer100g, better: 'high',
        text: (product) => `${plainNumber.format(product.proteinGrams)} g em ${plainNumber.format(proteinServingMass(product))} g (${plainNumber.format(proteinPer100g(product))}%)` },
      { label: 'Carbo/proteína', value: (product) => product.carbProteinRatio, better: 'low', text: (product) => formatRatio(product.carbProteinRatio) },
      { label: 'Gordura saturada', value: (product) => saturatedFatPer100g(product.nutritionDetails), better: 'low',
        text: (product) => `${formatNutritionAmount(saturatedFatPer100g(product.nutritionDetails))} g/100 g` },
      { label: 'Energia', value: (product) => product.nutritionDetails?.energyKcalPer100g,
        text: (product) => `${formatNutritionAmount(product.nutritionDetails.energyKcalPer100g)} kcal/100 g` },
      { label: 'Aminoácidos essenciais', text: (product) => (product.nutritionDetails?.aminoAcids?.essential?.length ? `${product.nutritionDetails.aminoAcids.essential.length} listados` : '') },
      { label: 'Glúten', text: (product) => labelAnswer(product.gluten) },
      { label: 'Lactose', text: (product) => labelAnswer(product.lactose) },
      { label: 'Contém', text: (product) => allergenNames(product.allergens?.contains) },
    ];
  }
  if (category === 'creatine') {
    return [...common,
      { label: `Dose de ${CREATINE_DOSE_GRAMS} g`, value: creatineUnitPrice, better: 'low',
        text: (product) => currency.format((creatineUnitPrice(product) / 100) * CREATINE_DOSE_GRAMS) },
      { label: 'Teor de creatina', value: (product) => product.creatineShare, better: 'high',
        text: (product) => `${plainNumber.format(product.creatineShare * 100)}%` },
    ];
  }
  // Prices per ml and per g can't be ranked against each other.
  const sameMeasure = new Set(items.map(sunscreenMeasure)).size === 1;
  return [
    { ...common[0], better: sameMeasure ? 'low' : undefined },
    common[1], common[2],
    { label: 'FPS', value: (product) => product.spf, better: 'high', text: (product) => String(product.spf) },
    { label: 'Textura', text: (product) => product.texture || catalogSays(product, 'TEXTURE') },
    ...FEATURES.filter((feature) => feature.attribute).map((feature) => ({ label: feature.label, text: (product) => yesNo(product, feature) })),
    { label: 'Nota na loja', value: (product) => product.reviews?.average, better: 'high',
      text: (product) => (product.reviews?.count ? `${rating.format(product.reviews.average)} ★ (${product.reviews.count.toLocaleString('pt-BR')})` : '') },
    ...REVIEW_TRAITS.map(({ key, complaint, praise, yesIsPraise }) => ({
      label: `${yesIsPraise ? praise : complaint}?`,
      text: (product) => {
        const { yes = 0, no = 0 } = product.reviews?.mentions?.[key] || {};
        return yes || no ? `Sim: ${yes} · Não: ${no}` : '';
      },
    })),
  ];
}

function renderCompareDialog(items) {
  const header = `<div class="compare-row compare-head"><div class="compare-label"></div>${items.map((product) => `
    <div class="compare-cell">
      ${product.image ? `<img src="${escapeHtml(product.image)}" alt="" width="56" height="56" loading="lazy">` : ''}
      <p class="product-brand">${escapeHtml(product.brand)}${product.store ? ` · ${escapeHtml(product.store)}` : ''}</p>
      <p class="compare-name">${escapeHtml(product.name)}</p>
      ${mercadoLivreIsCheaper(product)
    ? `<a class="product-link" href="${escapeHtml(mercadoLivreOffer(product).url)}" target="_blank" rel="noopener noreferrer">Ver no Mercado Livre ↗</a>`
    : `<a class="product-link" href="${escapeHtml(product.url)}" target="_blank" rel="noopener noreferrer">Ver produto ↗</a>`}
    </div>`).join('')}</div>`;
  const rows = compareRows(activeCategory, items).map((row) => {
    const texts = items.map((product) => {
      try { return row.text(product) || ''; } catch { return ''; }
    });
    if (texts.every((text) => !text)) return '';
    const values = items.map((product) => (row.value ? row.value(product) : null));
    let best = -1;
    if (row.better && values.every(Number.isFinite) && values[0] !== values[1]) {
      best = row.better === 'low' ? (values[0] < values[1] ? 0 : 1) : (values[0] > values[1] ? 0 : 1);
    }
    return `<div class="compare-row"><div class="compare-label">${escapeHtml(row.label)}</div>${texts.map((text, index) => `
      <div class="compare-cell${index === best ? ' compare-better' : ''}${text ? '' : ' details-missing'}">${index === best ? '<span class="compare-check" aria-label="Melhor">✓</span> ' : ''}${escapeHtml(text || 'Sem dado')}</div>`).join('')}</div>`;
  }).join('');
  return `${header}<div class="compare-table">${rows}</div>
    <p class="nutrition-modal-note">✓ marca o melhor valor em cada linha. Dados das lojas e dos rótulos; confira na embalagem.</p>`;
}

productGrid.addEventListener('change', (event) => {
  const checkbox = event.target.closest('[data-compare]');
  if (!checkbox) return;
  const key = checkbox.dataset.compare;
  compareHint = '';
  if (!checkbox.checked) compareSelection = compareSelection.filter((item) => item !== key);
  else if (compareSelection.length >= MAX_COMPARE) {
    checkbox.checked = false;
    compareHint = `Máximo ${MAX_COMPARE} produtos. Tire um para escolher outro.`;
  } else compareSelection = [...compareSelection, key];
  renderCompareBar();
});

compareBar.addEventListener('click', (event) => {
  const remove = event.target.closest('[data-compare-remove]');
  if (remove || event.target.closest('[data-compare-clear]')) {
    compareSelection = remove ? compareSelection.filter((key) => key !== remove.dataset.compareRemove) : [];
    compareHint = '';
    productGrid.querySelectorAll('[data-compare]').forEach((checkbox) => { checkbox.checked = compareSelection.includes(checkbox.dataset.compare); });
    renderCompareBar();
    return;
  }
  if (!event.target.closest('[data-compare-open]')) return;
  const items = selectedForCompare();
  if (items.length < MAX_COMPARE) return;
  compareDialogContent.innerHTML = renderCompareDialog(items);
  compareDialog.showModal();
});
document.querySelector('#compare-dialog-close').addEventListener('click', () => compareDialog.close());
compareDialog.addEventListener('click', (event) => {
  if (event.target === compareDialog) compareDialog.close();
});
