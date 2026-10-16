import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agreeingReading, hasSaturatedFat, mergeMissingRows, ocrNutritionTable, parseOcrNutritionTable, summarizeOcrNutrition, validateOcrNutrition } from './nutrition-ocr.mjs';

// Tesseract (PSM 4) output for Max Titanium's "100% Whey 900g Baunilha" table.
const wheyTable = `
INFORMAÇÃO 9a 18 anos / Years > 19 anos / Years
SUPPLEMENT FACTS Porção: 30g (2 dosadores) — Porção: 30g (2 dosadores)
Serving size: 2 scoops (309) Serving size: 2 scoops (30g)
Valor energético / Calories (Kcal) 126 5 126 6
Carboidratos / Carbohyarate (g) 5,8 2 5,8 2
Aç adicionados / Added sugars (9) 0,2 o 0,2 o
Açúcares totais / Total sugars (g) 51 3 5,7 3
Proteínas / Protein (g) 21 35 21 42
Arginina / Arginine (mg) 1,565 1,565
Leucina / Leucine (mg) 2.181 2.181
Gorduras totais / Total fat (g) 21 3 2,1 3
`;

test('parses rows, serving size and common OCR slips', () => {
  const parsed = parseOcrNutritionTable(wheyTable);
  assert.equal(parsed.servingMassGrams, 30);
  const cells = Object.fromEntries(parsed.rows.map((row) => [row.label.split(' /')[0], row.cells[1]]));
  assert.equal(cells['Valor energético'], '126');
  assert.equal(cells['Aç adicionados'], '0,2');
  assert.equal(cells.Arginina, '1.565');
  assert.equal(cells.Leucina, '2.181');
  // The dropped decimal comma in the first column is recovered from the second.
  assert.equal(cells['Gorduras totais'], '2,1');
  // Rows whose two columns disagree are dropped instead of guessed.
  assert.equal(cells['Açúcares totais'], undefined);
  assert.deepEqual(summarizeOcrNutrition(parsed), {
    servingMassGrams: 30, energyKcal: 126, carbohydrateGrams: 5.8, proteinGrams: 21, fatGrams: 2.1,
  });
  assert.equal(validateOcrNutrition(summarizeOcrNutrition(parsed)).status, 'verified');
});

test('reads serving sizes written in different ways', () => {
  for (const [line, grams] of [
    ['Porção / Serving size: 30 g (2 dosadores / scoops)', 30],
    ['Porção: 40 9 (2 dosadores) — Porção: 40 g (2 dosadores)', 40],
    ['Serving size: 2 scoops (409) Serving size: 2 scoops (409)', 40],
  ]) assert.equal(parseOcrNutritionTable(line).servingMassGrams, grams, line);
});

test('repairs dropped decimal commas only when the energy value confirms it', () => {
  // Femini Whey: "7,4" g carbs and "2,8" g fat were read as 74 and 28.
  const result = validateOcrNutrition({ servingMassGrams: 40, energyKcal: 163, carbohydrateGrams: 74, proteinGrams: 27, fatGrams: 28 });
  assert.deepEqual(result, {
    status: 'verified',
    summary: { servingMassGrams: 40, energyKcal: 163, carbohydrateGrams: 7.4, proteinGrams: 27, fatGrams: 2.8 },
  });
  const parsed = parseOcrNutritionTable('Carboidratos / Carbohydrate (g) 74 2 74 2\nGorduras totais / Total fat (g) 28 4 28 5');
  const table = ocrNutritionTable(parsed, result.summary);
  assert.deepEqual(table.rows.map((row) => row.cells[1]), [undefined, '7,4', '2,8']);
});

test('drops two-column rows where OCR shifted or garbled a cell', () => {
  // Dr. Peanut label (13 g carbs, 20 g protein) read at two different scales.
  const shifted = parseOcrNutritionTable(`Valor energético / Calories (Kcal) 162 6 162 8
Carboidratos / Carbohydrate (g) 3 13 4
Proteínas / Protein (g) 33 20 40
Gorduras totais / Total fat (9) 4 3,1 5
Leucina / Leucine (mg) 2.181 2.181`);
  assert.deepEqual(shifted.rows.map((row) => row.label.split(' /')[0]), ['Valor energético', 'Leucina']);
  const garbled = summarizeOcrNutrition(parseOcrNutritionTable(`Valor energético / Calories (Kcal) 162 6 162 8
Carboidratos / Carbohydrate (g) 138 3 13 4
Proteínas / Protein (g) 20 33 20 40`));
  assert.equal(garbled.carbohydrateGrams, null);
  assert.equal(garbled.proteinGrams, 20);
});

test('rejects a reading whose macros do not match the energy value', () => {
  // OCR read "11" g of carbohydrates as "1" on a 157 kcal serving.
  const misread = { servingMassGrams: 40, energyKcal: 157, carbohydrateGrams: 1, proteinGrams: 25, fatGrams: 1.4 };
  assert.equal(validateOcrNutrition(misread), null);
  assert.equal(validateOcrNutrition({ ...misread, carbohydrateGrams: 11 }).status, 'verified');
});

test('marks readings without energy or fat rows as plausible only', () => {
  assert.equal(validateOcrNutrition({ servingMassGrams: 30, energyKcal: null, carbohydrateGrams: 3, proteinGrams: 21, fatGrams: null }).status, 'plausible');
  assert.equal(validateOcrNutrition({ servingMassGrams: 30, energyKcal: null, carbohydrateGrams: 3, proteinGrams: 209, fatGrams: null }), null);
});

test('accepts a missing fat row only when carbs and protein explain the energy', () => {
  // Iso Clear: 87 kcal, "1,8" g carbs read as 18, 20 g protein, fat cells lost.
  const result = validateOcrNutrition({ servingMassGrams: 27, energyKcal: 87, carbohydrateGrams: 18, proteinGrams: 20, fatGrams: null });
  assert.equal(result.status, 'verified');
  assert.equal(result.summary.carbohydrateGrams, 1.8);
  assert.equal(result.summary.fatGrams, null);
  assert.equal(validateOcrNutrition({ servingMassGrams: 40, energyKcal: 157, carbohydrateGrams: 3, proteinGrams: 25, fatGrams: null }), null);
});

test('trusts unverified readings only when two passes agree', () => {
  const first = { servingMassGrams: 40, proteinGrams: 25, carbohydrateGrams: null, fatGrams: 14, energyKcal: 157 };
  assert.equal(agreeingReading([first, { ...first, proteinGrams: 45 }]), null);
  assert.deepEqual(agreeingReading([first, { ...first, fatGrams: 2, energyKcal: 6 }]),
    { ...first, fatGrams: null, energyKcal: null });
});

test('reads "(q)" as grams', () => {
  const parsed = parseOcrNutritionTable('Gorduras saturadas / Saturated fat (q) 1,2 4 1,2 6');
  assert.deepEqual(parsed.rows[0].cells, ['Gorduras saturadas / Saturated fat (g)', '1,2', '4', '1,2', '6']);
});

test('fills rows one pass lost from another pass of the same table', () => {
  const first = { rows: [{ label: 'Proteínas / Protein (g)', cells: [], text: 'p' }], text: 'p' };
  const second = { rows: [{ label: 'Proteínas (g)', cells: [], text: 'p2' }, { label: 'Gorduras saturadas / Saturated fat (g)', cells: [], text: 's' }] };
  const merged = mergeMissingRows(first, second);
  assert.deepEqual(merged.rows.map((row) => row.text), ['p', 's']);
  assert.equal(hasSaturatedFat(first), false);
  assert.equal(hasSaturatedFat(merged), true);
});
