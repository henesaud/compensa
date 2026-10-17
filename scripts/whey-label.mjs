// Reads the label statements Brazilian rules require on food pages: the
// ingredient list, "ALÉRGICOS: CONTÉM DERIVADOS DE ...", "PODE CONTER ...",
// "(NÃO) CONTÉM GLÚTEN" and "CONTÉM LACTOSE". Store pages with several flavors
// repeat them per flavor, so the answers can be "depends" (on the flavor).

const ALLERGENS = {
  leite: /^leite/,
  soja: /^soja/,
  ovo: /^ovos?$/,
  trigo: /^trigo/,
  aveia: /^aveia/,
  centeio: /^centeio/,
  cevada: /^cevada/,
  amendoim: /^amendoim/,
  amendoa: /^amendoas?$/,
  avela: /^avelas?$/,
  'castanha-de-caju': /^castanha.de.caju/,
  'castanha-do-para': /^castanha.do.para/,
  macadamia: /^macadamias?$/,
  nozes: /^noz(es)?$/,
  peixe: /^peixes?$/,
  crustaceos: /^crustaceos?$/,
};

const plain = (value) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function allergenList(text) {
  return plain(text).split(/,|\be\b/).map((item) => item.trim().replace(/^(de|do|da|dos|das)\s+/, ''))
    .map((item) => Object.keys(ALLERGENS).find((key) => ALLERGENS[key].test(item))).filter(Boolean);
}

// 'yes' when every statement says it contains it, 'no' when every one says it
// does not, 'depends' when flavors disagree, null without a statement.
function answer(statements) {
  if (!statements.length) return null;
  if (statements.every(Boolean)) return 'yes';
  if (!statements.some(Boolean)) return 'no';
  return 'depends';
}

const GLUTEN = /\b(N[ÃA]O\s+)?CONT[ÉE]M\s+GL[ÚU]TEN\b/gi;

// The ingredient list starts at "Ingredientes" and ends at the gluten
// statement that closes it. Per-flavor lists follow one another, so later
// statements close to the previous one are kept too. Lower-case
// "ingredientes" is marketing ("ingredientes de alta qualidade").
function ingredientText(text) {
  for (const start of text.matchAll(/\b(?:Ingredientes|INGREDIENTES)\b/g)) {
    const rest = text.slice(start.index);
    let end = 0;
    for (const match of rest.matchAll(GLUTEN)) {
      if (match.index > (end ? end + 700 : 1500)) break;
      end = match.index + match[0].length;
    }
    if (end) return rest.slice(0, end).replace(/^\w+\b:?\s*/, '').trim() || null;
  }
  return null;
}

// Returns { ingredients, allergens: { contains, mayContain }, gluten, lactose }.
export function labelInfo(pageText) {
  const text = String(pageText || '').replace(/\s+/g, ' ');
  const contains = new Set();
  const mayContain = new Set();
  // "CONTÉM DERIVADOS DE LEITE E SOJA" or, on some pages, "CONTÉM LEITE E SOJA".
  const containsLists = [
    ...text.matchAll(/cont[ée]m\s+derivados\s+(?:de|do|da|dos|das)\s+([^.]{2,200})/gi),
    ...text.matchAll(/\bCONT[ÉE]M\s+((?:LEITE|SOJA|OVOS?|TRIGO)\b[^.a-z]{0,200})/g),
  ];
  for (const [, list] of containsLists) {
    allergenList(list.split(/\bPODE\b|\bCONT[ÉE]M\b/i)[0]).forEach((item) => contains.add(item));
  }
  for (const [, list] of text.matchAll(/\bPODE\s+CONTER\s+([^.]{2,300})/g)) {
    allergenList(list).forEach((item) => mayContain.add(item));
  }
  contains.forEach((item) => mayContain.delete(item));
  // Lactose only counts in upper case ("CONTÉM LACTOSE", "LACTOSE: Contém"),
  // as the label prints it; menus and Q&A mention "zero lactose" in passing.
  const lactose = [...text.matchAll(/\b(N[ÃA]O\s+)?CONT[ÉE]M\s+LACTOSE\b|\bLACTOSE:\s*(N[ãa]o\s+)?[Cc]ont[ée]m\b/g)]
    .map((match) => !(match[1] || match[2]));
  return {
    ingredients: ingredientText(text),
    allergens: { contains: [...contains], mayContain: [...mayContain] },
    gluten: answer([...text.matchAll(GLUTEN)].map((match) => !match[1])),
    lactose: answer(lactose),
  };
}
