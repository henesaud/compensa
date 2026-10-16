import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fatDetails } from './nutrition-table.mjs';

const table = (...rows) => ({ rows: rows.map(([label, ...values]) => ({ label, cells: [label, ...values] })) });

test('reads total and saturated fat, ignoring other fat rows', () => {
  assert.deepEqual(fatDetails(table(
    ['Gorduras totais (g)', '1,7', '3'],
    ['Gorduras monoinsaturadas (g)', '0,9', '5'],
    ['Gorduras saturadas / Saturated fat (g)', '0,5', '3'],
  )), { totalFatGrams: 1.7, saturatedFatGrams: 0.5 });
});

test('repairs or drops saturated fat larger than total fat', () => {
  // Top Whey 3W + Sabor: "1,7" g of saturated fat read as 17.
  assert.equal(fatDetails(table(['Gorduras totais (g)', '2,9'], ['Gorduras saturadas (g)', '17'])).saturatedFatGrams, 1.7);
  assert.equal(fatDetails(table(['Gorduras totais (g)', '0,5'], ['Gorduras saturadas (g)', '17'])).saturatedFatGrams, null);
});

test('returns nulls when the table has no fat rows', () => {
  assert.deepEqual(fatDetails(null), { totalFatGrams: null, saturatedFatGrams: null });
});
