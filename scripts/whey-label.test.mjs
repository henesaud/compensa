import assert from 'node:assert/strict';
import test from 'node:test';
import { labelInfo } from './whey-label.mjs';

test('reads a single-flavor label', () => {
  const label = labelInfo('Desenvolvido com ingredientes de alta qualidade. INGREDIENTES: Proteína de soro do leite concentrada e emulsificante lecitina. ALÉRGICOS: CONTÉM DERIVADOS DE SOJA E LEITE. PODE CONTER OVO. CONTÉM LACTOSE. NÃO CONTÉM GLÚTEN Recomendação');
  assert.deepEqual(label, {
    ingredients: 'Proteína de soro do leite concentrada e emulsificante lecitina. ALÉRGICOS: CONTÉM DERIVADOS DE SOJA E LEITE. PODE CONTER OVO. CONTÉM LACTOSE. NÃO CONTÉM GLÚTEN',
    allergens: { contains: ['soja', 'leite'], mayContain: ['ovo'] },
    gluten: 'no',
    lactose: 'yes',
  });
});

test('flavors that disagree give "depends"', () => {
  const label = labelInfo('Ingredientes Sabor Baunilha Proteína, aromatizante. NÃO CONTÉM GLÚTEN. Sabor Cookies Proteína, biscoito. CONTÉM GLÚTEN. Alergênicos Sabor Baunilha CONTÉM LEITE E SOJA PODE CONTER OVO');
  assert.equal(label.gluten, 'depends');
  assert.match(label.ingredients, /Cookies/);
  assert.deepEqual(label.allergens, { contains: ['leite', 'soja'], mayContain: ['ovo'] });
});

test('ignores lactose mentioned in passing', () => {
  const label = labelInfo('Whey Zero Lactose COMPRAR. Esse whey tem lactose? Pessoas com intolerância à lactose devem evitar');
  assert.equal(label.lactose, null);
  assert.equal(label.ingredients, null);
});
