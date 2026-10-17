import assert from 'node:assert/strict';
import test from 'node:test';
import { creatineShareFromText, matchesCategory } from './supplement-rules.mjs';

test('skips kits, capsules and mixes', () => {
  assert.equal(matchesCategory('Creatina Monohidratada 300g', 'creatine'), true);
  assert.equal(matchesCategory('Kit Creatina 300g + Whey 900g', 'creatine'), false);
  assert.equal(matchesCategory('Creatina em Cápsulas 120 caps', 'creatine'), false);
  assert.equal(matchesCategory('Creatina + Beta Alanina 300g', 'creatine'), false);
  assert.equal(matchesCategory('Whey Protein Concentrado 900g', 'whey'), true);
});

test('pure creatine from the ingredient list or the name', () => {
  assert.equal(creatineShareFromText('True Creatine 300 g', 'Creatina monohidratada micronizada. NÃO CONTÉM GLÚTEN').creatineSource, 'ingredients');
  assert.equal(creatineShareFromText('Creatina Monohidratada 300g', undefined).creatineShare, 1);
  assert.equal(creatineShareFromText('Creatina Delicious Limão 500g', 'Creatina, ácido cítrico, aromatizante').creatineShare, null);
  assert.equal(creatineShareFromText('Creatine Turbo 300g', undefined).creatineShare, null);
});
