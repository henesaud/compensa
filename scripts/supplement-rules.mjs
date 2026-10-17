// Which store listings count as each supplement category. Kits, combos,
// bars, snacks, gainers and single servings can't be compared by quantity.

const BUNDLE = /\bkit\b|\bduo\b|combo|\+|\||amostra|presente|\bpack\b|\b\d+\s*x\b|unidades|coqueteleira|camiseta/i;

export const SUPPLEMENT_RULES = {
  whey: {
    query: 'whey',
    include: /whey/i,
    exclude: /\bbarr?a\b|\bbar\b|crisp|gainer|\bmass\b|wheyzinho|wafer|granola|pr[ée].?treino|creatina|caf[ée]|whey nerd/i,
  },
  creatine: {
    query: 'creatina',
    include: /creatin/i,
    // Capsules are sold by count, not weight; mixes with whey, beta-alanine
    // or HMB are other products.
    exclude: /^sach[êe](?!s)|c[áa]psula|\bcaps\b|tablete|\bbarr?a\b|\bbar\b|whey|prote[íi]n|beta|hmb|cafe[íi]na|pr[ée].?treino|gainer|\bmass\b|hipercal/i,
  },
};

// True when a listing name belongs to the category.
export const matchesCategory = (name, category) => {
  const rule = SUPPLEMENT_RULES[category];
  return rule.include.test(name) && !rule.exclude.test(name) && !BUNDLE.test(name);
};

export const sizeOf = (name) => {
  const match = String(name).toLowerCase().match(/(\d+(?:[.,]\d+)?)\s*(kg|g)\b/);
  return match ? `${match[1]}${match[2]}` : null;
};

// "Whey 900g | Probiótica", "Whey 900g - FTW Suplementos": the store name at
// the end repeats the brand column.
export const withoutStoreSuffix = (name, brand) => name
  .replace(new RegExp(`\\s+[-–|]\\s+${brand.split(' ')[0]}\\b.*$`, 'i'), '').replace(/\s+\|\s*[^|]*$/, '').trim();

// Creatine share of the powder when the nutrition table doesn't give it: an
// ingredient list of creatine alone, or a name for plain monohydrate (or
// Creapure, a monohydrate) without a flavor, counts as pure.
const CREATINE_ONLY = /^\s*(?:100\s*%\s*)?(?:creatina|creatine)(?:\s+(?:monohidratada|monohydrate|micronizada|micronized|pura|\(?creapure®?\)?))*\s*\.?\s*$/i;
const FLAVORED = /sabor|flavou?r|lim[ãa]o|laranja|uva|frutas|morango|maracuj|cereja|turbo|\bmix\b|tasty/i;
export function creatineShareFromText(name, ingredients) {
  const ingredientList = String(ingredients || '').split(/\b(?:N[ÃA]O\s+)?CONT[ÉE]M\b|AL[ÉE]RG/i)[0];
  if (CREATINE_ONLY.test(ingredientList)) return { creatineShare: 1, creatineSource: 'ingredients' };
  if (!FLAVORED.test(name) && /100\s*%\s*pur|\bpura\b|\bpure\b|monohidratada|monohydrate|creapure/i.test(name)) {
    return { creatineShare: 1, creatineSource: 'name' };
  }
  return { creatineShare: null, creatineSource: null };
}
