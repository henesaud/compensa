import assert from 'node:assert/strict';
import test from 'node:test';
import { reviewTraits } from './sunscreen-reviews.mjs';

test('separates negated mentions', () => {
  assert.deepEqual(reviewTraits('Não arde os olhos e não fica pegajoso'), { eyeSting: 'no', sticky: 'no' });
  assert.deepEqual(reviewTraits('Os olhos não ardem, nem deixa oleoso'), { eyeSting: 'no', oily: 'no' });
  assert.deepEqual(reviewTraits('Arde muito os olhos.'), { eyeSting: 'yes' });
  assert.deepEqual(reviewTraits('Não deixa sensação de pele pegajosa'), { sticky: 'no' });
  assert.deepEqual(reviewTraits('Não tem odor forte, fica sequinho na pele'), { dryTouch: 'yes' });
});

test('a complaint wins over a negated mention', () => {
  assert.deepEqual(reviewTraits('Não arde no rosto mas arde os olhos'), { eyeSting: 'yes' });
});

test('ignores the reviewer describing their skin type', () => {
  assert.deepEqual(reviewTraits('Tenho pele mista a oleosa e amei, toque seco'), { dryTouch: 'yes' });
  assert.deepEqual(reviewTraits('Deixa a pele oleosa'), { oily: 'yes' });
  assert.deepEqual(reviewTraits('Por ter pele oleosa, gostei'), {});
  assert.deepEqual(reviewTraits('Ideal para quem tem pele oleosa. Obs.: tenho pele mista para oleosa'), {});
  assert.deepEqual(reviewTraits('Mesmo tendo a pele oleosa, segura a oleosidade'), { oily: 'no' });
});

test('ignores comparisons with other sunscreens', () => {
  assert.deepEqual(reviewTraits('Normalmente não gosto de protetor pela sensação pegajosa, esse é ótimo'), {});
});

test('negation in an earlier clause does not carry over', () => {
  assert.deepEqual(reviewTraits('Não gostei. Ficou branco no rosto'), { whiteCast: 'yes' });
});
