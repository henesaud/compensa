import test from 'node:test';
import assert from 'node:assert/strict';
import { compareProducts, shrinkage } from './update-checks.mjs';

test('shrinkage flags empty and halved sources', () => {
  assert.equal(shrinkage(10, 0), null);
  assert.equal(shrinkage(6, 10), null);
  assert.match(shrinkage(0, 10), /found no products/);
  assert.match(shrinkage(4, 10), /found only 4/);
});

test('compareProducts reports lost nutrition and price jumps', () => {
  const previous = [
    { name: 'A', url: 'u/a', price: 100, carbProteinRatio: 0.2, nutritionDetails: { saturatedFatGrams: 1 } },
    { name: 'B', url: 'u/b', price: 100 },
    { name: 'C', url: 'u/c', price: 100, carbProteinRatio: 0.2 },
  ];
  const current = [
    { name: 'A', url: 'u/a', price: 110, carbProteinRatio: null, nutritionDetails: null },
    { name: 'B', url: 'u/b', price: 250 },
    { name: 'C', url: 'u/c', price: 90, carbProteinRatio: 0.3 },
    { name: 'D', url: 'u/d', price: 5 },
  ];
  const problems = compareProducts(previous, current);
  assert.equal(problems.length, 2);
  assert.match(problems[0], /A: lost carb\/protein ratio, saturated fat/);
  assert.match(problems[1], /B: price went from R\$ 100 to R\$ 250/);
});
