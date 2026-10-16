// Parses nutrition tables read by Tesseract (page segmentation mode 4, which
// keeps each table row on one line) and validates them before they are used.

const normalize = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export function parseNumber(value) {
  if (value == null) return null;
  const number = Number(String(value).replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(number) ? number : null;
}

// Brazilian labels often print two identical columns (9 to 18 years and 19+),
// so each row reads "amount %VD amount %VD" (or "amount amount" for amino
// acids). Returns the amount both columns agree on, or null when OCR lost or
// garbled a cell ("138 3 13 4", "3 13 4"). When one column dropped a decimal
// comma ("21" vs "2,1"), the column that kept it wins.
function twoColumnAmount(values) {
  const [first, second] = values.length === 4 ? [values[0], values[2]] : values.length === 2 ? values : [];
  if (!first) return null;
  if (first === second) return first;
  if (first.replace(',', '') === second.replace(',', '')) return first.includes(',') ? first : second;
  return null;
}

// Serving sizes appear as "Porção: 30g", "Porção / Serving size: 30 g" or
// "Serving size: 2 scoops (40g)"; OCR regularly turns the "g" into a "9".
function parseServingMass(line) {
  const text = normalize(line);
  const portion = text.match(/porcao[^:\d]*:\s*(\d{1,3}(?:,\d+)?)\s*[g9]\b/);
  if (portion) return parseNumber(portion[1]);
  const scoops = text.match(/serving size[^(]*\(\s*(\d{2,3})\s*g\s*\)/) || text.match(/serving size[^(]*\(\s*(\d{2,3})9\s*\)/);
  return scoops ? parseNumber(scoops[1]) : null;
}

export function parseOcrNutritionTable(text) {
  const lines = String(text || '').split(/\r?\n/).map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const rows = [];
  let servingMassGrams = null;
  for (const line of lines) {
    servingMassGrams ||= parseServingMass(line);
    // Table labels end with their unit in parentheses; OCR often reads "g" as "9" or "q".
    const unit = [...line.matchAll(/\(\s*(kcal|kj|g|9|q|mg|mcg|µg)\s*\)/gi)].pop();
    if (!unit) continue;
    const label = line.slice(0, unit.index).trim();
    if (!/[a-z]{3}/.test(normalize(label))) continue;
    const unitLabel = ['9', 'q', 'Q'].includes(unit[1]) ? 'g' : unit[1].toLowerCase();
    const values = (line.slice(unit.index + unit[0].length)
      .replace(/(^|\s)[oO](?=\s|$)/g, '$10')
      .match(/\d+(?:[.,]\d+)*/g) || [])
      // Milligram amounts use "." for thousands; OCR sometimes reads it as ",".
      .map((value) => (unitLabel === 'mg' && /^\d,\d{3}$/.test(value) ? value.replace(',', '.') : value));
    if (!values.length) continue;
    rows.push({ label: `${label} (${unitLabel})`, values });
  }
  const twoColumns = rows.filter(({ values }) => (values.length === 4 && values[0] === values[2])
    || (values.length === 2 && values[0] === values[1])).length >= 2;
  return {
    servingMassGrams,
    rows: rows.flatMap(({ label, values }) => {
      const amount = twoColumns ? twoColumnAmount(values) : values[0];
      if (!amount) return [];
      const cells = [label, amount, ...values.slice(1)];
      return [{ label, cells, text: cells.join(' | ') }];
    }),
  };
}

function rowAmount(rows, pattern) {
  const row = rows.find((candidate) => pattern.test(normalize(candidate.label)));
  return row ? parseNumber(row.cells[1]) : null;
}

export function summarizeOcrNutrition(parsed) {
  return {
    servingMassGrams: parsed.servingMassGrams,
    energyKcal: rowAmount(parsed.rows, /^valor energetico/),
    carbohydrateGrams: rowAmount(parsed.rows, /^carboidratos?\b/),
    proteinGrams: rowAmount(parsed.rows, /^proteinas?\b/),
    fatGrams: rowAmount(parsed.rows, /^gorduras totais/),
  };
}

function energyMatches({ energyKcal, carbohydrateGrams, proteinGrams, fatGrams }) {
  const expectedKcal = 4 * carbohydrateGrams + 4 * proteinGrams + 9 * fatGrams;
  return Math.abs(expectedKcal - energyKcal) <= Math.max(6, energyKcal * 0.05);
}

function plausible({ servingMassGrams, carbohydrateGrams, proteinGrams, fatGrams }) {
  if (!Number.isFinite(proteinGrams) || !Number.isFinite(servingMassGrams)) return false;
  if (servingMassGrams < 10 || servingMassGrams > 200) return false;
  if (proteinGrams < 5 || proteinGrams > servingMassGrams) return false;
  const macros = [carbohydrateGrams, proteinGrams, fatGrams].filter(Number.isFinite).reduce((sum, value) => sum + value, 0);
  return macros <= servingMassGrams * 1.05;
}

// Labels follow 4/4/9 kcal per gram of carbs, protein and fat, which lets us
// check the OCR reading. OCR often drops decimal commas in carbs and fat
// ("7,4" -> "74"), so those readings are also tried divided by ten; a repair is
// only accepted when exactly one combination matches the energy value. OCR
// also tends to lose "0" cells, so a missing fat row passes only when carbs
// and protein alone account for the energy.
// Returns { summary, status } with status 'verified', or 'plausible' when a
// missing row prevents the check, or null when the numbers are inconsistent.
export function validateOcrNutrition(summary) {
  const { energyKcal, carbohydrateGrams, fatGrams } = summary;
  if (![energyKcal, carbohydrateGrams].every(Number.isFinite)) {
    return plausible(summary) ? { summary, status: 'plausible' } : null;
  }
  const options = (value) => (Number.isInteger(value) && value >= 10 ? [value, value / 10] : [value]);
  const candidates = options(carbohydrateGrams).flatMap((carbs) => (Number.isFinite(fatGrams) ? options(fatGrams) : [null])
    .map((fat) => ({ ...summary, carbohydrateGrams: carbs, fatGrams: fat })))
    .filter((candidate) => plausible(candidate) && energyMatches({ ...candidate, fatGrams: candidate.fatGrams ?? 0 }));
  return candidates.length === 1 ? { summary: candidates[0], status: 'verified' } : null;
}

// Readings that could not be checked against the energy value are only
// trusted when two independent OCR passes agree on protein and serving size.
export function agreeingReading(readings) {
  for (const [index, reading] of readings.entries()) {
    const match = readings.slice(index + 1).find((other) => other.proteinGrams === reading.proteinGrams
      && other.servingMassGrams === reading.servingMassGrams);
    if (!match) continue;
    const agreed = (key) => (reading[key] === match[key] ? reading[key] : null);
    return { ...reading, carbohydrateGrams: agreed('carbohydrateGrams'), fatGrams: agreed('fatGrams'), energyKcal: agreed('energyKcal') };
  }
  return null;
}

export function ocrNutritionTable(parsed, summary) {
  const format = (value) => String(value).replace('.', ',');
  const repaired = [[/^carboidratos?\b/, summary.carbohydrateGrams], [/^gorduras totais/, summary.fatGrams]];
  const tableRows = parsed.rows.map((row) => {
    const fix = repaired.find(([pattern, value]) => pattern.test(normalize(row.label)) && Number.isFinite(value)
      && parseNumber(row.cells[1]) !== value);
    if (!fix) return row;
    const cells = [row.cells[0], format(fix[1]), ...row.cells.slice(2)];
    return { ...row, cells, text: cells.join(' | ') };
  });
  const portion = `Porção: ${summary.servingMassGrams} g`;
  const rows = [{ label: portion, cells: [portion], text: portion }, ...tableRows];
  return {
    servingSize: `${summary.servingMassGrams} g`,
    rows,
    text: rows.map((row) => row.text).join('\n'),
  };
}

const rowKey = (row) => normalize(row.label).split(/\s[/|[(]/)[0].trim();

export function sameReading(a, b) {
  return a.proteinGrams === b.proteinGrams && a.carbohydrateGrams === b.carbohydrateGrams
    && a.servingMassGrams === b.servingMassGrams;
}

// Adds rows that one OCR pass lost but another verified pass of the same table
// read (for example saturated fat, which the energy check does not cover).
export function mergeMissingRows(table, otherTable) {
  const present = new Set(table.rows.map(rowKey));
  const missing = otherTable.rows.filter((row) => !present.has(rowKey(row)));
  if (!missing.length) return table;
  const rows = [...table.rows, ...missing];
  return { ...table, rows, text: rows.map((row) => row.text).join('\n') };
}

export const hasSaturatedFat = (table) => table.rows.some((row) => /^gorduras? saturadas?\b/.test(rowKey(row)));
