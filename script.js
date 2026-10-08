const categoryButtons = document.querySelectorAll('.category-button');
const filterControls = document.querySelector('#filter-controls');
const productGrid = document.querySelector('#product-grid');
const resultCount = document.querySelector('#result-count');
const catalogStatus = document.querySelector('#catalog-status');
const insightsToggle = document.querySelector('#insights-toggle');
const insightsPanel = document.querySelector('#insights-panel');
let activeCategory = 'whey';
let products = { whey: [] };
let insightsOpen = false;

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function normalizedAmount(product) {
  return ['kg', 'l'].includes(product.unit) ? product.amount * 1000 : product.amount;
}

function getUnitPrice(product) {
  const divisor = normalizedAmount(product);
  const unitValue = product.price / divisor;
  return ['ml', 'l'].includes(product.unit) ? unitValue * 100 : unitValue * 1000;
}

function getUnitLabel(category) {
  return category === 'whey' ? 'kg' : '100 ml';
}

function formatAmount(product) {
  return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(product.amount)} ${product.unit}`;
}

function formatRatio(value) {
  return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(value * 10)}:10`;
}

function renderInsights(visibleProducts) {
  insightsToggle.setAttribute('aria-expanded', String(insightsOpen));
  insightsPanel.hidden = !insightsOpen;
  if (!insightsOpen) return;

  const withRatio = visibleProducts.filter((product) => Number.isFinite(product.carbProteinRatio));
  const insights = [];
  if (visibleProducts.length >= 4 && withRatio.length === visibleProducts.length) {
    const byPrice = [...visibleProducts].sort((a, b) => a.unitPrice - b.unitPrice);
    const midpoint = Math.floor(byPrice.length / 2);
    const cheaperHalf = byPrice.slice(0, midpoint);
    const moreExpensiveHalf = byPrice.slice(midpoint);
    const averageRatio = (group) => group.reduce((sum, product) => sum + product.carbProteinRatio, 0) / group.length;
    const cheaperAverage = averageRatio(cheaperHalf);
    const expensiveAverage = averageRatio(moreExpensiveHalf);
    const relationship = cheaperAverage > expensiveAverage
      ? `Na metade mais barata, a proporção média é ${formatRatio(cheaperAverage)}; na metade mais cara, ${formatRatio(expensiveAverage)}. Nesta seleção, os produtos mais baratos têm mais carboidrato para cada 10 g de proteína, em média.`
      : `Na metade mais barata, a proporção média é ${formatRatio(cheaperAverage)}; na metade mais cara, ${formatRatio(expensiveAverage)}. Nesta seleção, a metade mais barata não tem uma média maior de carboidrato para cada 10 g de proteína.`;
    insights.push({ title: 'Preço e carboidratos', text: `${relationship} É uma observação desta seleção, não uma regra sobre todos os wheys.` });
  }

  if (withRatio.length) {
    const lowestRatio = [...withRatio].sort((a, b) => a.carbProteinRatio - b.carbProteinRatio)[0];
    insights.push({ title: 'Menor proporção carbo/proteína', text: `${lowestRatio.name}: ${formatRatio(lowestRatio.carbProteinRatio)} (${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(lowestRatio.carbohydrateGrams)} g de carboidratos e ${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(lowestRatio.proteinGrams)} g de proteína por porção).` });
  }

  const withProtein = visibleProducts.filter((product) => Number.isFinite(product.proteinGrams));
  if (withProtein.length) {
    const highestProtein = [...withProtein].sort((a, b) => b.proteinGrams - a.proteinGrams)[0];
    insights.push({ title: 'Mais proteína por porção', text: `${highestProtein.name}: ${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(highestProtein.proteinGrams)} g por porção.` });
  }

  if (!insights.length) {
    insightsPanel.innerHTML = '<p class="insights-empty">São necessários mais produtos com informação nutricional para comparar esta seleção.</p>';
    return;
  }

  insightsPanel.innerHTML = `
    <div class="insights-intro"><strong>O que os dados mostram</strong><span>Baseado nos ${visibleProducts.length} produtos exibidos</span></div>
    <div class="insights-list">${insights.map((insight) => `
      <article class="insight-card"><span class="insight-mark" aria-hidden="true">↗</span><div><h3>${escapeHtml(insight.title)}</h3><p>${escapeHtml(insight.text)}</p></div></article>
    `).join('')}</div>`;
}

function addFilter(label, key, values, allLabel = 'Qualquer') {
  const options = values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('');
  return `<div class="filter-control"><label for="filter-${key}">${label}</label><select id="filter-${key}" data-filter="${key}"><option value="">${allLabel}</option>${options}</select></div>`;
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

  filterControls.innerHTML = markup;
}

function renderProducts() {
  const selectedFilters = Object.fromEntries([...filterControls.querySelectorAll('[data-filter]')]
    .map((select) => [select.dataset.filter, select.value]));
  const linkedProducts = products[activeCategory].filter((product) => {
    try {
      const url = new URL(product.url);
      return url.hostname === 'www.gsuplementos.com.br' && /-p\d+$/i.test(url.pathname);
    } catch {
      return false;
    }
  });
  const filtered = linkedProducts
    .filter((product) => Object.entries(selectedFilters).every(([key, value]) => {
      if (!value) return true;
      return product[key] === value;
    }))
    .map((product) => ({ ...product, unitPrice: getUnitPrice(product) }))
    .sort((a, b) => a.unitPrice - b.unitPrice);

  renderInsights(filtered);

  if (filtered.length === 0) {
    const message = products[activeCategory].length
      ? 'Nenhum produto encontrado com esses filtros.'
      : 'Nenhum produto no catálogo. Atualize o catálogo local e publique o arquivo.';
    productGrid.innerHTML = `<p class="empty-state">${message}</p>`;
    resultCount.textContent = '0 produtos';
    return;
  }

  const bestPrice = filtered[0].unitPrice;
  const unitLabel = getUnitLabel(activeCategory);
  productGrid.innerHTML = filtered.map((product) => {
    const isBest = product.unitPrice === bestPrice;
    const productLink = `<a class="product-link" href="${escapeHtml(product.url)}" target="_blank" rel="noopener noreferrer">Ver produto ↗</a>`;
    const productImage = product.image
      ? `<img class="product-image" src="${escapeHtml(product.image)}" alt="${escapeHtml(product.name)}" loading="lazy" width="88" height="88">`
      : '';
    const ratio = Number.isFinite(product.carbProteinRatio)
      ? formatRatio(product.carbProteinRatio)
      : 'não informado';
    const ratioHelp = Number.isFinite(product.carbProteinRatio)
      ? `Por porção: ${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(product.carbohydrateGrams)} g de carboidratos e ${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(product.proteinGrams)} g de proteína. A proporção mostra quantos gramas de carboidrato há para cada 10 g de proteína. Ajuda a comparar a composição, mas não determina sozinho qual produto é melhor para você.`
      : 'A informação nutricional deste produto não estava disponível para calcular a proporção.';
    return `
      <article class="product-card${isBest ? ' best-value' : ''}">
        ${isBest ? '<span class="best-label">MENOR PREÇO</span>' : ''}
        <div class="product-info">
          ${productImage}
          <div class="product-copy">
            <p class="product-brand">${escapeHtml(product.brand)}</p>
            <h3 class="product-name">${escapeHtml(product.name)}</h3>
            ${productLink}
            <div class="nutrition-ratio" tabindex="0" aria-label="Carboidratos por proteína: ${ratio}">
              <span>Carbo/proteína</span><strong>${ratio}</strong>
              <span class="nutrition-tooltip" role="tooltip">${ratioHelp}</span>
            </div>
          </div>
        </div>
        <div class="price-block">
          <div class="unit-price">${currency.format(product.unitPrice)}</div>
          <div class="unit-caption">por ${unitLabel}</div>
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
        ? catalog.products.whey.filter((product) => {
          try {
            const url = new URL(product.url);
            return url.hostname === 'www.gsuplementos.com.br' && /-p\d+$/i.test(url.pathname);
          } catch {
            return false;
          }
        })
        : [],
    };
    catalogStatus.textContent = catalog.updatedAt
      ? `Atualizado em ${new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(catalog.updatedAt))}`
      : 'Catálogo ainda não atualizado';
    renderFilters();
    renderProducts();
  } catch (error) {
    catalogStatus.textContent = 'Catálogo não carregado';
    productGrid.innerHTML = '<p class="empty-state">Não foi possível carregar o catálogo. Inicie o site com <strong>make serve</strong> e abra <strong>http://localhost:8000</strong>.</p>';
    resultCount.textContent = '0 produtos';
    console.error('Failed to load product catalog:', error);
  }
}

categoryButtons.forEach((button) => {
  button.addEventListener('click', () => {
    activeCategory = button.dataset.category;
    categoryButtons.forEach((item) => {
      const selected = item === button;
      item.classList.toggle('is-active', selected);
      item.setAttribute('aria-pressed', String(selected));
    });
    renderFilters();
    renderProducts();
  });
});

filterControls.addEventListener('change', renderProducts);
insightsToggle.addEventListener('click', () => {
  insightsOpen = !insightsOpen;
  renderProducts();
});
renderFilters();
loadCatalog();
