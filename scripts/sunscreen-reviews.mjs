// Reads customer reviews from Trustvox (the review widget some VTEX stores
// use) and counts how many mention each sunscreen trait, keeping "não arde os
// olhos" apart from "arde os olhos".

const MAX_REVIEW_PAGES = 10;
const HEADERS = { 'user-agent': 'Mozilla/5.0', accept: 'application/vnd.trustvox-v2+json' };

const TRAITS = {
  eyeSting: /(ard|queim|irrit|lacrim)\w*\s.{0,40}olho|olhos?\s.{0,40}(ard|queim|irrit|lacrim)/,
  sticky: /pegajos|melequent|melad|grudent|grudand/,
  oily: /oleos|brilh|engordur|gordur/,
  dryTouch: /toque seco|sequinh|seca rapid|absorve rapid|\bmatte\b/,
  whiteCast: /esbranqui|branquinh|efeito branco|mancha branca|(deixa|fica|ficou)\s(a pele\s|o rosto\s)?branc/,
  pilling: /empelot|esfarel|bolinha/,
};

const NEGATION = /\b(nao|nem|sem|zero|nada|nunca)\b/;
// Reviewers describe their own skin ("tenho pele oleosa"), which says nothing
// about the product.
const SKIN_TYPE = /\b(tenho|tendo|ter|tem|minha|para|pra|de|com)\s+(a\s+)?peles?\s+(?:(?:mist|oleos|sec|normal|sensive|acne)\w*(?:\s*(?:\/|,|\ba\b|\be\b|\bpara\b)\s*)?)+/g;
// "Controla a oleosidade" is praise, the same as "não deixa oleoso".
const OIL_CONTROL = /\b(segur|control|reduz|diminu|tir|absorv|evit|segura)\w*\s+(a\s+|o\s+)?(oleosidade|brilho)/g;
// Clauses comparing with other sunscreens ("normalmente não gosto de protetor
// pela sensação pegajosa") are not about this product.
const COMPARISON = /\b(outros|outras|demais|maioria|normalmente|geralmente|costum\w*)\b/;

const normalize = (value) => String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Returns { trait: 'yes' | 'no' } for the traits a review mentions. A trait
// counts as 'no' only when every mention of it is negated.
export function reviewTraits(text) {
  const clauses = normalize(text).replace(SKIN_TYPE, ' ').replace(OIL_CONTROL, ' nao oleoso ')
    .split(/[.,!?;\n]|\bmas\b|\bporem\b/).filter((clause) => !COMPARISON.test(clause));
  const traits = {};
  for (const [trait, pattern] of Object.entries(TRAITS)) {
    for (const clause of clauses) {
      const match = clause.match(pattern);
      if (!match) continue;
      const before = clause.slice(Math.max(0, match.index - 35), match.index);
      const negated = NEGATION.test(before) || NEGATION.test(match[0]);
      if (!negated) traits[trait] = 'yes';
      else traits[trait] ||= 'no';
    }
  }
  return traits;
}

// Counts trait mentions across review texts.
function countMentions(texts) {
  const mentions = Object.fromEntries(Object.keys(TRAITS).map((trait) => [trait, { yes: 0, no: 0 }]));
  const withText = texts.filter((text) => /\w/.test(text));
  for (const text of withText) {
    for (const [trait, value] of Object.entries(reviewTraits(text))) mentions[trait][value] += 1;
  }
  return { read: texts.length, withText: withText.length, mentions };
}

async function getJson(url, what) {
  const response = await fetch(url, { headers: HEADERS });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${what}`);
  return response.json();
}

const trustvox = (path, params) => getJson(`https://trustvox.com.br/widget/${path}?${new URLSearchParams(params)}`, `Trustvox ${path}`);

// Returns null when the product has no reviews.
export async function fetchTrustvoxReviews(storeId, productId) {
  const { rate } = await trustvox('root', { code: productId, store_id: storeId });
  if (!rate?.count) return null;
  const texts = [];
  for (let page = 1; page <= MAX_REVIEW_PAGES; page += 1) {
    const { items } = await trustvox('opinions', { code: productId, store_id: storeId, page });
    if (!items?.length) break;
    texts.push(...items.map((item) => `${item.opinion_title || ''}. ${item.opinion || ''}`));
  }
  return {
    source: 'Trustvox',
    average: Number(rate.average),
    count: Number(rate.count),
    histogram: rate.histogram,
    ...countMentions(texts),
  };
}

// Konfidency (Drogaria São Paulo) keys reviews by SKU id and returns the
// summary and up to 50 reviews per page, newest first.
const KONFIDENCY_PAGE_SIZE = 50;
const KONFIDENCY_MAX_PAGES = 3;

export async function fetchKonfidencyReviews(customer, skuId) {
  const texts = [];
  let summary;
  for (let page = 1; page <= KONFIDENCY_MAX_PAGES; page += 1) {
    const url = `https://reviews-api.konfidency.com.br/${customer}/${skuId}/summary/created,desc?pageSize=${KONFIDENCY_PAGE_SIZE}&page=${page}`;
    const data = (await getJson(url, 'Konfidency')).reviews?.[0];
    summary ||= data;
    if (!summary?.reviewCount || !data?.reviews?.length) break;
    texts.push(...data.reviews.map((review) => `${review.title || ''}. ${review.text || ''}`));
    if (data.reviews.length < KONFIDENCY_PAGE_SIZE) break;
  }
  if (!summary?.reviewCount) return null;
  return {
    source: 'Konfidency',
    average: Number(summary.aggregateRating),
    count: Number(summary.reviewCount),
    recommendedPercentage: Number(summary.recommendedPercentage),
    ...countMentions(texts),
  };
}
