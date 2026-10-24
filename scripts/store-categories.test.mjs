import assert from 'node:assert/strict';
import test from 'node:test';
import { STORE_CATEGORIES, barProtein, diaperSize, omegaPerCapsule, omegaQuality, parseCount, parseMass, samePackage, toiletPaperLength, vitaminCPercent } from './store-categories.mjs';

test('reads counts and sizes from names', () => {
  assert.equal(parseCount('Fralda Pampers Confort Sec G 128 Unidades'), 128);
  assert.equal(parseCount('Fralda Huggies Tripla Proteção Meguinha Xxg (26) Unidades'), 26);
  assert.equal(parseCount('Fralda Tena Slip G 48un'), 48);
  assert.equal(parseCount('Fralda Geriatex Clássica Tam M - 18 fraldas'), 18);
  assert.deepEqual(parseMass('Ração Golden 10,1 kg'), { amount: 10100, unit: 'g' });
  assert.deepEqual(parseMass('Sabão Líquido Surf 3 LT'), { amount: 3000, unit: 'ml' });
  assert.deepEqual(parseMass('Lava Roupas Líquido Uau Active 1,7L'), { amount: 1700, unit: 'ml' });
  assert.equal(parseMass('Ração 2 L', { volume: false }), null);
});

test('reads diaper sizes, including adult names', () => {
  assert.equal(diaperSize('Fralda Baby&Baby Mega (G) 48 Unidades'), 'G');
  assert.equal(diaperSize('Fralda Pampers Confort Sec Tamanho XXXG 70 Unidades'), 'XXXG');
  assert.equal(diaperSize('Fralda Descartável Adulto Tena Confort EG 18 Unidades'), 'XG');
  assert.equal(diaperSize('Roupa Íntima Plenitud G/XG 14 Unidades'), 'G/XG');
});

test('counts toilet paper meters from rolls and roll length', () => {
  assert.equal(toiletPaperLength('Papel Higiênico Personal Vip Folha Dupla com 16 rolos de 30 metros').amount, 480);
  assert.equal(toiletPaperLength('Papel Higiênico Neve Supreme 20m Leve 24 Pague 21').amount, 480);
  assert.equal(toiletPaperLength('Papel higiênico folha dupla Mili 60m com 4 rolos').amount, 240);
  assert.equal(toiletPaperLength('Papel Higiênico Neve Toque de Seda 4 Rolos', 'Rolos com 30 metros cada').amount, 120);
  assert.equal(toiletPaperLength('Papel Higiênico Neve 12 Rolos'), null);
});

test('splits EPA and DHA per capsule only when the serving is known', () => {
  assert.deepEqual(omegaPerCapsule('Ômega 3 1000mg – 100 Cápsulas | 540mg EPA e 360mg DHA. Porção de 3 cápsulas'), { epaDhaMgPerCapsule: 300, epaMgPerCapsule: 180, dhaMgPerCapsule: 120, capsulesPerServing: 3 });
  assert.deepEqual(omegaPerCapsule('Porção: 2 g (2 cápsulas)\nEPA (mg) | 660\nDHA (mg) | 440'), { epaDhaMgPerCapsule: 550, epaMgPerCapsule: 330, dhaMgPerCapsule: 220, capsulesPerServing: 2 });
  assert.deepEqual(omegaPerCapsule('540mg de EPA e 360mg de DHA por porção. SUGESTÃO DE USO: Tomar 1 cápsula 3 vezes ao dia'), { epaDhaMgPerCapsule: 300, epaMgPerCapsule: 180, dhaMgPerCapsule: 120, capsulesPerServing: 3 });
  assert.equal(omegaPerCapsule('Ômega 3 EPA 540 mg + DHA 360 mg por porção'), null);
});

test('reads protein per bar', () => {
  assert.equal(barProtein('Barra de Proteína Bold Chocomalte 14g de Proteína 40g'), 14);
  assert.equal(barProtein('BEST WHEY BAR 15G PROTEIN (62 G) CHEESECAKE'), 15);
  assert.equal(barProtein('Barra Bold 60g', '<p>Com 21g de proteína por unidade</p>'), 21);
  const bars = STORE_CATEGORIES.proteinBars.quantity({ name: 'Best Whey Bar (Display com 12 Barras de 32g)', description: '', page: { proteinGrams: 10, servingMassGrams: 32 } });
  assert.equal(bars.amount, 120);
});

test('keeps listings out of the wrong category', () => {
  const matches = (category, name) => STORE_CATEGORIES[category].include.test(name) && !STORE_CATEGORIES[category].exclude.test(name);
  assert.equal(matches('diapers', 'FRALDA HIGIÊNICA DESCARTÁVEL DOGS CARE G 6 UN PARA CÃES FÊMEAS'), false);
  assert.equal(matches('laundry', 'Amaciante Downy 1,5L'), false);
  assert.equal(matches('laundry', 'Lava Roupas Líquido Omo para Diluir 500ml'), false);
  assert.equal(matches('vitaminC', 'Vitamina C 1g Drogarias São Paulo 30 Comprimidos Eferve'), false);
  assert.equal(matches('vitaminC', 'Sérum Antioxidante Skinceuticals com Vitamina C Serum 15ml'), true);
  assert.equal(matches('moisturizer', 'Colírio Lubrificante e Hidratante Plenigell 5ml'), false);
  assert.equal(matches('toiletPaper', 'Papel Higiênico Folha Dupla Neve 30m Com 4'), true);
  assert.equal(matches('petFood', 'Ração Úmida Pedigree Sachê Cães Adultos'), false);
  assert.equal(matches('peanutButter', 'Pasta de Amendoim em Pó Tradicional BetterPB 210g'), false);
  assert.equal(matches('peanutButter', 'Pasta de Amendoim Dr Peanut Avelã 250g'), true);
  assert.equal(matches('moisturizer', 'Creme Hidratante para os Pés 60g'), false);
  assert.equal(matches('vitaminC', 'Shampoo Seda Colágeno e Vitamina C 300ml'), false);
});

test('reads omega 3 seals and oil form', () => {
  assert.deepEqual(omegaQuality('Ômega 3 TG com selo IFOS 5 estrelas, óleo MEG-3'), { seals: ['IFOS', 'MEG-3'], oilForm: 'TG' });
  assert.deepEqual(omegaQuality('Ômega 3 Friend of the Sea, forma etil éster'), { seals: ['Friend of the Sea'], oilForm: 'EE' });
  assert.deepEqual(omegaQuality('Ômega 3 1000mg 120 cápsulas'), { seals: undefined, oilForm: undefined });
});

test('reads the vitamin C concentration', () => {
  assert.equal(vitaminCPercent('Sérum Dermage Improve C 10 15g'), 10);
  assert.equal(vitaminCPercent('Sérum Facial Antioxidante com 15% de Vitamina C Pura'), 15);
  assert.equal(vitaminCPercent('Vitamina C 15 Aqua Stick'), 15);
  assert.equal(vitaminCPercent('Sérum Vult Vitamina C Pura 30g'), null);
  assert.equal(vitaminCPercent('Gel Creme Facial Nivea Vitamina C 7 Em 1 Ultra leve 100g'), null);
});

test('matches Mercado Livre catalog products of the same package only', () => {
  assert.equal(samePackage('omega3', { capsules: 100 }, 'Ômega 3 Omix EPA DHA + Vitamina E - 120 Cápsulas'), false);
  assert.equal(samePackage('proteinBars', { bars: 1 }, 'Kit 6 Unid Barrinha De Proteína Charge 45g'), false);
  assert.equal(samePackage('proteinBars', { bars: 1 }, 'Barra De Proteína Bold Bombom Crocante 40g'), true);
  assert.equal(samePackage('petFood', { amount: 10100 }, 'Ração Magnus Todo Dia cães adultos saco 10,1kg'), true);
  assert.equal(samePackage('petFood', { amount: 2000 }, 'Ração Vet Care Cães Mini 10,1kg'), false);
  assert.equal(samePackage('diapers', { amount: 68 }, 'Fralda Pampers Premium Care Tamanho G 68 Unidades'), true);
});
