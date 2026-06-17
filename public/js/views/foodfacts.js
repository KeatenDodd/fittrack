'use strict';
// Shared "dive deeper into the food facts" helper: a full macro + micro
// breakdown for a food, scaled to a given amount. Used by the food log, the
// add-food quantity step and the recipe builder. `food.nutrients` holds the
// per-100 amounts (the same shape loadFood / OFF / custom foods all produce).
import { api } from '../api.js';
import { h, num, openSheet } from '../ui.js';

const CAT_LABEL = { macro: 'Macronutrients', lipid: 'Fats', mineral: 'Minerals', vitamin: 'Vitamins' };

let oCatalogCache = null;
export async function nutrientCatalog() {
  if (!oCatalogCache) oCatalogCache = (await api.nutrients()).nutrients;
  return oCatalogCache;
}

// Build the grouped facts list. `oCatalog` comes from nutrientCatalog().
export function factsList(oFood, fGrams, oCatalog) {
  const oNut = oFood.nutrients || {};
  const fFactor = (Number(fGrams) || 0) / 100;
  const aRows = [];
  let sLastCat = null;
  for (const oN of oCatalog) {
    const fRaw = oNut[oN.key];
    if (fRaw == null) continue;
    if (oN.category !== sLastCat) {
      aRows.push(h('div.facts-cat', { text: CAT_LABEL[oN.category] || oN.category }));
      sLastCat = oN.category;
    }
    const iDp = oN.unit === 'kcal' ? 0 : (oN.unit === 'g' ? 1 : 1);
    aRows.push(h('div.facts-row', {}, [
      h('span', { text: oN.name }),
      h('span.num', { text: num(Number(fRaw) * fFactor, iDp) + (oN.unit ? ' ' + oN.unit : '') }),
    ]));
  }
  return h('div.facts', {}, aRows.length ? aRows : [h('p.faint', { style: 'font-size:13px', text: 'No nutrient data for this item.' })]);
}

// Open a bottom sheet with the full breakdown. Safe to call from full-page
// views (not from inside another sheet — the app has a single modal root).
export async function openFoodFacts(oFood, fGrams) {
  const oCatalog = await nutrientCatalog();
  openSheet(oFood.name || 'Nutrition facts', (tBody) => {
    mountFacts(tBody, oFood, fGrams, oCatalog);
  });
}

function mountFacts(tBody, oFood, fGrams, oCatalog) {
  tBody.appendChild(h('div.faint', { style: 'font-size:12.5px;margin-bottom:8px',
    text: 'Per ' + num(fGrams) + ' g' + (oFood.brand ? ' · ' + oFood.brand : '') }));
  tBody.appendChild(factsList(oFood, fGrams, oCatalog));
}
