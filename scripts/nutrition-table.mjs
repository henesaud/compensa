// Reads fat values from a scraped nutrition table ({ rows: [{ label, cells }] }).

const normalize = (value) => String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function rowGrams(rows, pattern) {
  const row = rows.find((candidate) => pattern.test(normalize(candidate.label || candidate.text)));
  const number = String(row?.cells?.[1] ?? '').match(/\d+(?:[.,]\d+)?/);
  return number ? Number(number[0].replace(',', '.')) : null;
}

// Saturated fat can never exceed total fat. OCR sometimes drops the decimal
// comma ("1,7" -> "17"), so an impossible value is retried divided by ten and
// discarded if it still does not fit.
export function fatDetails(table) {
  const rows = table?.rows || [];
  const totalFatGrams = rowGrams(rows, /^gorduras? (?:totais|total)\b/);
  let saturatedFatGrams = rowGrams(rows, /^gorduras? saturadas?\b/);
  if (Number.isFinite(saturatedFatGrams) && Number.isFinite(totalFatGrams) && saturatedFatGrams > totalFatGrams) {
    saturatedFatGrams = Number.isInteger(saturatedFatGrams) && saturatedFatGrams / 10 <= totalFatGrams ? saturatedFatGrams / 10 : null;
  }
  return { totalFatGrams, saturatedFatGrams };
}
