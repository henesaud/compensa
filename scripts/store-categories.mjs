// Categories read straight from store catalogs (VTEX catalog search API):
// the name, size and price are enough to compare them, so no product page is
// opened. Each category says which stores to search, which listings count and
// how to read the quantity it is compared by (scripts/update-products.mjs
// saves them; catalog.js turns the quantity into a unit price).

import { searchStore, vtexSunscreenSources } from './vtex-sunscreens.mjs';
import { fetchKonfidencyReviews, fetchTrustvoxReviews } from './sunscreen-reviews.mjs';

const DROGARIA_SAO_PAULO = vtexSunscreenSources.find((source) => source.store === 'Drogaria São Paulo');
const ADCOS = vtexSunscreenSources.find((source) => source.store === 'Adcos');
const DERMAGE = vtexSunscreenSources.find((source) => source.store === 'Dermage');
const PAGUE_MENOS = { store: 'Pague Menos', origin: 'https://www.paguemenos.com.br' };
const SAVEGNAGO = { store: 'Savegnago', origin: 'https://www.savegnago.com.br' };
const ZONA_SUL = { store: 'Zona Sul', origin: 'https://www.zonasul.com.br' };
const COBASI = { store: 'Cobasi', origin: 'https://www.cobasi.com.br' };
// Supplement brand stores on VTEX (also in `sources` in update-products.mjs).
// Their product pages have the nutrition table (`nutritionPages`); drugstore
// pages don't, so those are never opened.
const SUPPLEMENT_STORES = [
  { store: 'Probiótica', origin: 'https://www.probiotica.com.br' },
  { store: 'Nutrify', origin: 'https://www.nutrify.com.br' },
  { store: 'Vitafor', origin: 'https://www.vitafor.com.br' },
  { store: 'Atlhetica Nutrition', origin: 'https://www.atlheticanutrition.com.br' },
  { store: 'Black Skull', origin: 'https://www.blackskullusa.com.br' },
  { store: 'Max Titanium', origin: 'https://www.maxtitanium.com.br' },
].map((store) => ({ ...store, nutritionPages: true }));

export const normalize = (value) => String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/\s+/g, ' ').trim();
const number = (value) => Number(String(value).replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'));

// Kits, gifts and multi-packs priced as one listing.
const BUNDLE = /\bkit\b|\bcombo\b|\+|\bpresente\b|\bestojo\b|\bleve\s*\d+\s*pague\b(?!.*\brolos?\b)|\b\d+\s*x\s+\D|\b\d+x\b|\bpack\s*\d/i;

// "80 Unidades", "c/ 60", "48un", "260 Tiras".
export function parseCount(text, words = 'unidades?|unid\\.?|un\\b|und\\b|tiras|fraldas') {
  const match = String(text).match(new RegExp(`\\(?(\\d+)\\)?\\s*(?:${words})`, 'i')) || String(text).match(/\bc(?:om|\/)\s*(\d+)\b/i);
  const count = match ? Number(match[1]) : null;
  return count > 0 ? count : null;
}

// "2,5kg", "900 g", "1,7L", "500ml": the size in g or ml.
export function parseMass(text, { volume = true, mass = true } = {}) {
  const units = [mass && 'kg|g', volume && 'l|lt|litros?|ml'].filter(Boolean).join('|');
  const match = String(text).match(new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*(${units})\\b`, 'i'));
  if (!match) return null;
  const value = number(match[1]);
  const unit = match[2].toLowerCase();
  if (!(value > 0)) return null;
  if (unit === 'kg') return { amount: value * 1000, unit: 'g' };
  if (unit === 'g') return { amount: value, unit: 'g' };
  if (unit === 'ml') return { amount: value, unit: 'ml' };
  return { amount: value * 1000, unit: 'ml' };
}

const DIAPER_SIZES = ['RN', 'PP', 'P', 'M', 'G', 'XG', 'XXG', 'XXXG'];
// "EG" (extra grande) is the adult name for XG.
export function diaperSize(name) {
  const tokens = String(name).toUpperCase().replace(/[()]/g, ' ').split(/[\s,-]+/);
  const found = tokens.map((token) => (token === 'EG' ? 'XG' : token === 'EXG' ? 'XXG' : token))
    .find((token) => DIAPER_SIZES.includes(token) || /^(P|M|G|XG)\/(M|G|XG|XXG)$/.test(token));
  return found || null;
}

// "12 rolos de 30 metros", "60m com 4 rolos", "Leve 24 Pague 21": total meters.
// The roll length may be only in the description ("rolos de 30 metros").
export function toiletPaperLength(name, description = '') {
  const text = String(name);
  const metersIn = (value) => String(value).replace(/<[^>]+>/g, ' ').match(/(\d+(?:[.,]\d+)?)\s*(?:m|metros)\b/i);
  const meters = metersIn(text) || metersIn(description);
  const rolls = text.match(/\bleve\s*(\d+)/i) || text.match(/(\d+)\s*(?:rolos|unidades|un)\b/i) || text.match(/\bcom\s*(\d+)\b/i);
  if (!meters || !rolls) return null;
  return { amount: number(meters[1]) * Number(rolls[1]), unit: 'm', rolls: Number(rolls[1]), metersPerRoll: number(meters[1]) };
}

const PLY = [['Quádrupla', /qu[aá]drupla|4 folhas/], ['Tripla', /tripla|3 folhas/], ['Dupla', /dupla|2 folhas/], ['Simples', /simples|simpl\b/]];

// EPA + DHA in mg per capsule, from text such as "540mg EPA e 360mg DHA" with
// "porção de 3 cápsulas" (or "por cápsula"). Without the serving size the
// amount can't be split per capsule, so the product is left out.
export function omegaPerCapsule(text) {
  const plain = normalize(String(text).replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, (entity) => ({ '&aacute;': 'á', '&ccedil;': 'ç', '&atilde;': 'ã', '&oacute;': 'ó', '&eacute;': 'é', '&iacute;': 'í', '&nbsp;': ' ' })[entity] || ' '));
  // "540mg EPA", "EPA 540 mg", or a table row "EPA (mg) | 540".
  const nutrient = (name) => new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*mg\\s*(?:de\\s*)?${name}\\b|\\b${name}\\b[^\\d]{0,30}?(\\d+(?:[.,]\\d+)?)\\s*mg|\\b${name}\\b[^\\d\\n]{0,40}\\(mg\\)\\s*[|:]?\\s*(\\d+(?:[.,]\\d+)?)`);
  const grams = (pattern) => {
    const match = plain.match(pattern);
    return match ? number(match[1] || match[2] || match[3]) : null;
  };
  const epa = grams(nutrient('epa'));
  const dha = grams(nutrient('dha'));
  if (!(epa > 0) || !(dha > 0)) return null;
  const perCapsule = /por\s+capsula|cada\s+capsula|em\s+1\s+capsula/.test(plain);
  const serving = plain.match(/porcao\s*(?:de|:)?\s*(\d+)\s*(?:capsulas?|caps|softgels?)/) || plain.match(/porcao[^\n]{0,25}?\(\s*(\d+)\s*(?:capsulas?|caps|softgels?)/)
    || plain.match(/\b(\d+)\s*(?:capsulas?|caps|softgels?)\s*(?:por dia|ao dia|diarias)/);
  // "Tomar 1 cápsula 3 vezes ao dia" is a serving of 3.
  const timesADay = plain.match(/\b(\d+)\s*(?:capsulas?|caps|softgels?)\s*,?\s*(\d+)\s*vezes\s*(?:ao|por)\s*dia/);
  const capsules = timesADay ? Number(timesADay[1]) * Number(timesADay[2]) : serving ? Number(serving[1]) : perCapsule ? 1 : null;
  if (!capsules) return null;
  const mg = (epa + dha) / capsules;
  // More than 1 g of EPA+DHA in one capsule means the numbers were misread.
  if (!(mg > 0 && mg <= 1000)) return null;
  return {
    epaDhaMgPerCapsule: Math.round(mg),
    epaMgPerCapsule: Math.round(epa / capsules),
    dhaMgPerCapsule: Math.round(dha / capsules),
    capsulesPerServing: capsules,
  };
}

// Quality seals fish oils print on the label, and the oil's chemical form:
// triglyceride (TG, as in fish) or ethyl ester (EE, cheaper to concentrate).
const OMEGA_SEALS = [['IFOS', /\bifos\b/], ['Friend of the Sea', /friend of the sea/], ['MEG-3', /\bmeg-?3\b/], ['GOED', /\bgoed\b/]];
export function omegaQuality(text) {
  const plain = normalize(String(text).replace(/<[^>]+>/g, ' '));
  const seals = OMEGA_SEALS.filter(([, pattern]) => pattern.test(plain)).map(([label]) => label);
  const form = /\btg\b|triglicer|triglycer/.test(plain) ? 'TG' : /etil.?ester|ethyl.?ester|\bee\b/.test(plain) ? 'EE' : null;
  return { seals: seals.length ? seals : undefined, oilForm: form || undefined };
}

// "Vitamina C 10%", "Improve C 20", "15% de vitamina C": the concentration.
export function vitaminCPercent(name, description = '') {
  const read = (text) => {
    const plain = normalize(String(text).replace(/<[^>]+>/g, ' '));
    const match = plain.match(/vitamina\s*c[^%\d]{0,25}(\d{1,2}(?:[.,]\d+)?)\s*%/) || plain.match(/(\d{1,2}(?:[.,]\d+)?)\s*%\s*(?:de\s*)?(?:vitamina\s*c|acido ascorbico)/)
      || plain.match(/\b(?:improve|pure|vitamina|vit\.?)\s*c\s*-?\s*(\d{1,2})\b(?!\s*(?:ml|g|un|mg)\b)/);
    const value = match ? number(match[1]) : null;
    return value >= 1 && value <= 30 ? value : null;
  };
  return read(name) ?? read(description);
}

const SUGAR_FREE = /zero\s*a[cç][uú]car|sem\s*a[cç][uú]car|sugar.?free|\bzero\b/;

// Protein per bar: "14g de Proteína", "Whey Bar 12g", or the description.
export function barProtein(name, description) {
  const fromName = String(name).match(/(\d+(?:[.,]\d+)?)\s*g\s*(?:de\s*)?prote(?:[íi]na|in)/i);
  if (fromName) return number(fromName[1]);
  const fromText = normalize(String(description).replace(/<[^>]+>/g, ' ')).match(/(\d+(?:[.,]\d+)?)\s*g\s*de\s*proteinas?\b/);
  return fromText ? number(fromText[1]) : null;
}

// Category definitions. `quantity(listing)` returns { amount, unit } in the
// unit the category is compared by (catalog.js CATEGORY_UNITS), or null to
// skip the listing; `attributes(listing)` returns the values filters use.
export const STORE_CATEGORIES = {
  diapers: {
    stores: [DROGARIA_SAO_PAULO, PAGUE_MENOS],
    queries: ['fralda'],
    include: /fralda|roupa [íi]ntima descart/i,
    exclude: /lixeira|len[çc]o|pomada|creme|c[ãa]es|cachorro|\bdogs?\b|\bpet\b|absorvente|tapete|trocador|bolsa|porta.?fralda|de pano|reutiliz|ecol[óo]gica|nata[çc][ãa]o|piscina|\bswim|fralda de boca|fraldinha|cueiro|ombro/i,
    quantity: ({ name }) => {
      const count = parseCount(name);
      return count ? { amount: count, unit: 'un' } : null;
    },
    attributes: ({ name, categoryPath }) => {
      const text = normalize(`${name} ${categoryPath}`);
      const adult = /geriatric|adult|roupa intima|incontin|cuidados adultos|plenitud|tena\b|bigfral|ever care|confort master/.test(text);
      const pants = /pants|roupinha|calca|roupa intima/.test(text);
      return { type: adult ? 'Adulto' : pants ? 'Infantil calça' : 'Infantil', size: diaperSize(name) };
    },
  },
  toiletPaper: {
    stores: [SAVEGNAGO, ZONA_SUL, DROGARIA_SAO_PAULO, PAGUE_MENOS],
    queries: ['papel higiênico'],
    include: /papel\s+higi?[eê]n?[iíeê]co/i,
    exclude: /[úu]mido|umedecido|toalha|guardanapo|len[çc]o|suporte|porta.?papel|dispenser|interfolha|\bcai.?cai\b|rol[ãa]o/i,
    quantity: ({ name, description }) => toiletPaperLength(name, description),
    attributes: ({ name }) => ({ type: PLY.find(([, pattern]) => pattern.test(normalize(name)))?.[0] || 'Não informada' }),
  },
  laundry: {
    stores: [SAVEGNAGO, ZONA_SUL],
    queries: ['lava roupas', 'sabão em pó', 'sabão líquido'],
    include: /lava.?roupas?|sab[ãa]o\s+(?:em\s+)?(?:p[óo]|l[íi]quido)|detergente.{0,15}roupas?/i,
    exclude: /porta.?sab|amaciante|tira.?manchas|alvejante|\bbarra\b|sach[êe]|c[áa]psula|\bpods?\b|lou[çc]a|desinfet|sabonete|diluir|\bcoco em barra\b|pedra/i,
    quantity: ({ name }) => parseMass(name),
    attributes: ({ name }, quantity) => ({ type: quantity.unit === 'ml' ? 'Líquido' : 'Pó', concentrated: /concentrad/i.test(name) || undefined }),
  },
  petFood: {
    stores: [COBASI],
    queries: ['ração seca cães', 'ração seca gatos'],
    // Only dry food: wet food (sachets, cans) is bought by the unit.
    categoryPath: /ra[çc][ãa]o seca/i,
    include: /ra[çc][ãa]o/i,
    exclude: /[úu]mida|sach[êe]|\blata\b|pat[êe]|petisco|bifinho|snack/i,
    skuSizes: true,
    quantity: ({ name }) => parseMass(name, { volume: false }),
    attributes: ({ name, categoryPath, description, specs = {} }) => {
      const text = normalize(`${name} ${categoryPath}`);
      const species = /\bgat|cat\b|felin/.test(text) ? 'Gatos' : /\bcaes\b|\bcao\b|cachorro|\bdog/.test(text) ? 'Cães' : null;
      const age = /filhote|puppy|kitten|junior/.test(text) ? 'Filhote'
        : /senior|idoso|\b7\+|mature|ageing/.test(text) && !/adultos? e (idosos|senior)/.test(text) ? 'Sênior' : 'Adulto';
      const sizes = [['Pequeno', /\bmini\b|pequen|x-?small|\bsmall\b|toy/], ['Médio', /\bmedi[ao]s?\b|medium/], ['Grande', /grande|\bmaxi\b|\bgiant\b|gigante|large/]]
        .filter(([, pattern]) => pattern.test(text)).map(([label]) => label);
      // The store's own fields: tier ("Tipo da Ração"), dye and GMO.
      const tier = { standard: 'Standard', premium: 'Premium', 'premium especial': 'Premium especial', 'super premium': 'Super premium' }[normalize(specs['Tipo da Ração'] || specs['customLabel3 Classif Ração'])];
      const protein = normalize(description).match(/(\d{2}(?:[.,]\d)?)\s*%\s*(?:de\s*)?proteinas?\b|proteina bruta[^\d%]{0,25}(\d{2}(?:[.,]\d)?)\s*%/);
      const proteinPercent = protein ? number(protein[1] || protein[2]) : null;
      return {
        species, age, breedSize: sizes.length ? sizes : undefined, neutered: /castrad|neutered|sterili/.test(text) || undefined,
        tier,
        proteinPercent: proteinPercent >= 15 && proteinPercent <= 60 ? proteinPercent : undefined,
        noDye: /^sem/i.test(specs.Corante || '') || undefined,
        noGmo: /^sem/i.test(specs['Transgênico'] || '') || undefined,
      };
    },
  },
  moisturizer: {
    stores: [DROGARIA_SAO_PAULO, ADCOS, DERMAGE],
    queries: ['hidratante'],
    include: /hidrat/i,
    exclude: /col[íi]rio|ouvido|otodrat|seios|p[óo]s.?barba|banho|shower|\bfps\b|protetor|labial|l[áa]bios|batom|m[ãa]os|\bp[ée]s(?![\wÀ-ÿ])|cabelo|capilar|condicionador|shampoo|m[áa]scara|leave|[íi]ntim|sabonete|desodorante|[óo]leo|esfoliante|demaquil|t[ôo]nico|\bbase\b|primer|bruma|spray|maquiagem|olhos|olheiras|suplemento|c[áa]psulas|refil|\bpet\b|c[ãa]es|cachorro|gatos?\b|ampola|s[ée]rum|vitamina c/i,
    // Under 10 ml or g is a sample or a lip balm.
    quantity: ({ name, text }) => {
      const size = parseMass(name) || parseMass(text);
      return size?.amount >= 10 ? size : null;
    },
    attributes: ({ name }) => {
      const text = normalize(name);
      const face = /facial|rosto|\bface\b/.test(text);
      const body = /corpo|corporal|\bbody\b/.test(text);
      const type = face && body ? 'Facial e corporal'
        : face || (!body && /antissinais|anti-?idade|antiacne|acneic/.test(text)) ? 'Facial'
          : body || /locao/.test(text) ? 'Corporal' : 'Uso geral';
      // Actives named on the package, which say what the cream is for.
      const urea = text.match(/ureia\s*(\d{1,2})\s*%|(\d{1,2})\s*%\s*(?:de\s*)?ureia/);
      const actives = [urea ? `Ureia ${urea[1] || urea[2]}%` : /ureia/.test(text) && 'Ureia', /hialuron|hyalu/.test(text) && 'Ácido hialurônico',
        /ceramida|ceramide/.test(text) && 'Ceramidas', /niacinamida|niacinamide/.test(text) && 'Niacinamida', /pantenol|\bb5\b/.test(text) && 'Pantenol (B5)',
        /retinol/.test(text) && 'Retinol'].filter(Boolean);
      return { type, actives: actives.length ? actives : undefined };
    },
    reviews: true,
  },
  vitaminC: {
    stores: [DROGARIA_SAO_PAULO, ADCOS, DERMAGE],
    queries: ['vitamina c sérum', 'vitamina c facial', 'sérum vitamina c'],
    include: /vitamina\s*c\b|vit\.?\s*c\b|\bvit c\b|ascorbi|\bc\s*\d+\b.*s[ée]rum|s[ée]rum.*\bc\s*\d+\b/i,
    exclude: /shampoo|condicionador|pentear|cabelo|capilar|m[áa]scara|sabonete|esfoliante|micelar|limpeza|t[ôo]nico|apetit|xarope|desodorante|corporal|comprimid|c[áa]psula|efervesc|gotas|suplemento|mastig|xarope|zinco|pr[óo]polis|vitamina d|polivitam|imunid|sach[êe]|\d+\s*mg\b|\b1g\b|gomas?|bala|tablete|\bfps\b|protetor|labial/i,
    // Some names leave the size out; the description's first size is used,
    // within the range a facial product comes in.
    quantity: ({ name, text, description }) => {
      const size = parseMass(name) || parseMass(text) || parseMass(String(description).replace(/<[^>]+>/g, ' '));
      return size?.amount >= 5 && size.amount <= 200 ? size : null;
    },
    attributes: ({ name, description }) => {
      const text = normalize(name);
      return { type: /serum|ampola|booster|concentrado/.test(text) ? 'Sérum' : /creme|gel/.test(text) ? 'Creme ou gel' : 'Outros', vitaminCPercent: vitaminCPercent(name, description) ?? undefined };
    },
    reviews: true,
  },
  peanutButter: {
    stores: [DROGARIA_SAO_PAULO, SAVEGNAGO, ZONA_SUL, PAGUE_MENOS, ...SUPPLEMENT_STORES],
    queries: ['pasta de amendoim'],
    include: /(?:pasta|creme)\s+de\s+amendoim/i,
    exclude: /\bp[óo](?![\wÀ-ÿ])|^chocolate|granola|snack|barra|bombom|cookie|biscoito|pa[çc]oca|wafer|alfajor|sach[êe]|\bbar\b|\bshot\b/i,
    quantity: ({ name }) => parseMass(name, { volume: false }),
    attributes: ({ name }) => {
      const text = normalize(name);
      const sugarFree = SUGAR_FREE.test(text) || undefined;
      if (/whey|protein|proteina/.test(text)) return { type: 'Com whey', sugarFree };
      return { sugarFree, type: /avela|pistache|chocolate|cacau|doce de leite|leite em po|caramelo|cookies|brigadeiro|coco|morango|canela|mel\b|beijinho|buenissimo|prestigio|banana/.test(text) ? 'Com sabor' : 'Tradicional' };
    },
  },
  proteinBars: {
    stores: [DROGARIA_SAO_PAULO, ...SUPPLEMENT_STORES],
    queries: ['barra de proteína', 'protein bar'],
    include: /\bbarr?a\b|\bbar\b/i,
    exclude: /cereal|granola|chocolate ao leite \d|nuts\b(?!.*prote)|\bcoqueteleira|\bcereais|\bfibra\b(?!.*prote)/i,
    // Boxes ("12 unidades de 45 g") count as bars; the protein comes per bar.
    allowCount: true,
    // Brand stores sell boxes under a single bar's name; no bar costs this much.
    maxPricePerUnit: 30,
    // Without the protein in the name or description, the brand store's
    // product page gives it (scaled from the serving to one bar).
    pageFallback: true,
    quantity: ({ name, description, page }) => {
      const barGrams = number(String(name).match(/(\d+(?:[.,]\d+)?)\s*g\b(?!\s*(?:de\s*)?prote)/i)?.[1]);
      const fromPage = page?.proteinGrams > 0 && (page.servingMassGrams > 0 && barGrams > 0 ? page.proteinGrams * (barGrams / page.servingMassGrams) : page.proteinGrams);
      const protein = barProtein(name, description) || fromPage;
      const bars = parseCount(name, 'unidades?|unid\\.?|un\\b|und\\b|barras') || 1;
      const plausible = protein > 0 && protein < 40 && !(barGrams > 0 && protein > barGrams * 0.6);
      return plausible ? { amount: protein * bars, unit: 'g', bars, proteinPerBarGrams: Math.round(protein * 10) / 10 } : null;
    },
    attributes: ({ name }) => ({
      type: /\b(?:cx|caixa|display|\d+\s*(?:un|unid|unidades|und)\b)/i.test(name) ? 'Caixa' : 'Unidade',
      sugarFree: SUGAR_FREE.test(normalize(name)) || undefined,
    }),
  },
  omega3: {
    stores: [DROGARIA_SAO_PAULO, PAGUE_MENOS, ...SUPPLEMENT_STORES],
    queries: ['ômega 3'],
    include: /[ôo]mega\s*-?\s*3|\bomegafor|\bmeg-?3\b|\bdha\b|[óo]leo de peixe|fish oil/i,
    // Brand store listings often leave EPA and DHA out; their product page has them.
    pageFallback: true,
    exclude: /kids|infantil|gotas|l[íi]quido|\bpet\b|c[ãa]es|gatos|mastig|gomas?\b|[ôo]mega\s*3[-\s]6[-\s]9|linha[çc]a|chia|vegano|vegan|algas?\b|krill|\bcreme\b/i,
    quantity: ({ name, description }) => {
      const capsules = parseCount(name, 'c[áa]psulas?|caps\\b|c[áa]ps\\.?|softgels?');
      const omega = omegaPerCapsule(`${name} ${description}`);
      return capsules && omega ? { amount: (capsules * omega.epaDhaMgPerCapsule) / 1000, unit: 'g', capsules, ...omega } : null;
    },
    attributes: ({ name, description }) => omegaQuality(`${name} ${description}`),
  },
};

// The package size written in a name, to tell whether a Mercado Livre catalog
// product found by barcode is the same package (not a kit or another size).
const massPack = (name) => parseMass(name)?.amount ?? null;
const PACK_SIZES = {
  diapers: (name) => parseCount(name),
  toiletPaper: (name) => toiletPaperLength(name)?.rolls ?? parseCount(name, 'rolos|unidades|un\\b'),
  laundry: massPack,
  petFood: massPack,
  moisturizer: massPack,
  vitaminC: massPack,
  peanutButter: massPack,
  proteinBars: (name) => (/\bkit\b|\bcaixa\b|\bcx\b|display/i.test(name) ? parseCount(name, 'unidades?|unid\\.?|un\\b|und\\b|barras') : parseCount(name, 'unidades?|unid\\.?|un\\b|und\\b|barras') || 1),
  omega3: (name) => parseCount(name, 'c[áa]psulas?|caps\\b|c[áa]ps\\.?|softgels?'),
};
// Our package size in the same terms as PACK_SIZES.
const OUR_PACK = {
  diapers: (product) => product.amount,
  toiletPaper: (product) => product.rolls,
  proteinBars: (product) => product.bars,
  omega3: (product) => product.capsules,
};
export function samePackage(category, product, catalogName) {
  const theirs = PACK_SIZES[category]?.(catalogName);
  const ours = OUR_PACK[category] ? OUR_PACK[category](product) : product.amount;
  return Number.isFinite(theirs) && ours > 0 && Math.abs(theirs - ours) / ours < 0.02;
}

function plainText(item) {
  return [item.description, ...(item['Descrição longa'] || []), ...(item['Informação Nutricional'] || []), item.metaTagDescription]
    .filter(Boolean).join(' ');
}

async function reviews(source, item, sku) {
  try {
    if (source.trustvoxStoreId) return await fetchTrustvoxReviews(source.trustvoxStoreId, item.productId) || undefined;
    if (source.konfidencyCustomer) return await fetchKonfidencyReviews(source.konfidencyCustomer, sku.itemId) || undefined;
  } catch (error) {
    console.warn(`Could not read reviews for ${item.productName}: ${error.message}`);
  }
  return undefined;
}

const inStock = (sku) => sku.sellers?.find((seller) => seller.commertialOffer?.AvailableQuantity > 0)?.commertialOffer;

// Returns the store's products in the category. A product sold in several
// sizes (pet food) becomes one product per size. Listings of the category
// whose quantity could not be read go in `unread`, for the update log.
// readPage(url) returns { text, proteinGrams, servingMassGrams } from the
// product page, for categories with `pageFallback`.
export async function fetchStoreCategory(category, source, { unread = [], readPage } = {}) {
  const rule = STORE_CATEGORIES[category];
  const products = new Map();
  for (const query of rule.queries) {
    for (const item of await searchStore(source.origin, query, { maxPages: 20 })) {
      const baseName = String(item.productName || '').replace(/\s+/g, ' ').trim();
      const categoryPath = (item.categories || []).join(' ');
      if (!rule.include.test(baseName) || rule.exclude.test(baseName)) continue;
      if (rule.categoryPath && !rule.categoryPath.test(categoryPath)) continue;
      if (BUNDLE.test(baseName) && !(rule.allowCount && !/\bkit\b|\+|combo/i.test(baseName))) continue;
      const skus = rule.skuSizes ? (item.items || []) : [(item.items || []).find(inStock)].filter(Boolean);
      for (const sku of skus) {
        const offer = inStock(sku);
        if (!offer?.Price) continue;
        // A size option ("2,5kg") is added to the product name.
        const name = rule.skuSizes && sku.name && !baseName.includes(sku.name) ? `${baseName} ${sku.name}` : baseName;
        const specs = Object.fromEntries((item.allSpecifications || []).map((key) => [key, (item[key] || []).join(', ')]));
        const listing = { name, text: sku.nameComplete || sku.name || '', categoryPath, description: plainText(item), specs };
        const url = `${source.origin}/${item.linkText}/p`;
        let quantity = rule.quantity(listing);
        if (!quantity && rule.pageFallback && source.nutritionPages && readPage) {
          listing.page = await readPage(url);
          listing.description += ` ${listing.page.text}`;
          quantity = rule.quantity(listing);
        }
        if (!quantity) {
          unread.push(name);
          continue;
        }
        const key = `${url} ${quantity.amount}${quantity.unit}`;
        if (products.has(key)) continue;
        const { amount, unit, ...measures } = quantity;
        if (rule.maxPricePerUnit && offer.Price / (measures.bars || 1) > rule.maxPricePerUnit) {
          unread.push(`${name} (R$ ${offer.Price}: price of a box?)`);
          continue;
        }
        const product = {
          brand: String(item.brand || '').trim(),
          name,
          amount: Math.round(amount * 1000) / 1000,
          unit,
          ...measures,
          price: offer.Price,
          url: skus.length > 1 ? `${url}?skuId=${sku.itemId}` : url,
          imageUrl: sku.images?.[0]?.imageUrl,
          store: source.store,
          barcode: /^\d{8,14}$/.test(sku.ean || '') && !/^0+1?$/.test(sku.ean) ? sku.ean : undefined,
        };
        for (const [key, value] of Object.entries(rule.attributes(listing, quantity))) if (value !== undefined && value !== null) product[key] = value;
        if (rule.reviews) product.reviews = await reviews(source, item, sku);
        products.set(key, product);
      }
    }
  }
  return [...products.values()];
}

// Brand names come from each store in its own case ("NEVE", "Neve").
export function tidyBrands(products) {
  const spelling = new Map();
  for (const product of products) {
    const key = normalize(product.brand);
    const current = spelling.get(key);
    const better = !current || (current === current.toUpperCase() && product.brand !== product.brand.toUpperCase());
    if (better) spelling.set(key, product.brand);
  }
  const title = (brand) => (brand === brand.toUpperCase() && brand.length > 3
    ? brand.toLowerCase().replace(/(^|[\s&-])(\p{L})/gu, (_, before, letter) => before + letter.toUpperCase()) : brand);
  for (const product of products) product.brand = title(spelling.get(normalize(product.brand)) || product.brand);
}
