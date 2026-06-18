'use strict';
const express = require('express');
const oDb = require('../db');
const oAuth = require('../auth');
const oConfig = require('../config');
const { wrap, httpError } = require('../util');

const oRouter = express.Router();
oRouter.use(oAuth.requireAuth);

// --- Open Food Facts mapping --------------------------------------------------
// Maps our nutrient key -> { off: <OFF nutriment base key>, mult: <factor to our unit> }.
// OFF reports *_100g values; macros are grams, most minerals/vitamins are grams
// too, so we convert to mg/mcg. Best-effort; whole-food micros refine via USDA later.
const oOffMap = {
  energy_kcal:    { off: 'energy-kcal', mult: 1 },
  protein_g:      { off: 'proteins', mult: 1 },
  carbs_g:        { off: 'carbohydrates', mult: 1 },
  sugar_g:        { off: 'sugars', mult: 1 },
  fiber_g:        { off: 'fiber', mult: 1 },
  fat_g:          { off: 'fat', mult: 1 },
  sat_fat_g:      { off: 'saturated-fat', mult: 1 },
  mono_fat_g:     { off: 'monounsaturated-fat', mult: 1 },
  poly_fat_g:     { off: 'polyunsaturated-fat', mult: 1 },
  trans_fat_g:    { off: 'trans-fat', mult: 1 },
  cholesterol_mg: { off: 'cholesterol', mult: 1000 },
  sodium_mg:      { off: 'sodium', mult: 1000 },
  potassium_mg:   { off: 'potassium', mult: 1000 },
  calcium_mg:     { off: 'calcium', mult: 1000 },
  iron_mg:        { off: 'iron', mult: 1000 },
  magnesium_mg:   { off: 'magnesium', mult: 1000 },
  zinc_mg:        { off: 'zinc', mult: 1000 },
  phosphorus_mg:  { off: 'phosphorus', mult: 1000 },
  vit_a_mcg:      { off: 'vitamin-a', mult: 1000000 },
  vit_c_mg:       { off: 'vitamin-c', mult: 1000 },
  vit_d_mcg:      { off: 'vitamin-d', mult: 1000000 },
  vit_e_mg:       { off: 'vitamin-e', mult: 1000 },
  vit_k_mcg:      { off: 'vitamin-k', mult: 1000000 },
  b1_mg:          { off: 'vitamin-b1', mult: 1000 },
  b2_mg:          { off: 'vitamin-b2', mult: 1000 },
  b3_mg:          { off: 'vitamin-pp', mult: 1000 },
  b6_mg:          { off: 'vitamin-b6', mult: 1000 },
  b12_mcg:        { off: 'vitamin-b12', mult: 1000000 },
  folate_mcg:     { off: 'vitamin-b9', mult: 1000000 },
};

function mapOffProduct(tProduct) {
  const oNut = tProduct.nutriments || {};
  const oNutrients = {};
  for (const sKey of Object.keys(oOffMap)) {
    const oRule = oOffMap[sKey];
    const fRaw = oNut[`${oRule.off}_100g`];
    if (fRaw != null && Number.isFinite(Number(fRaw))) {
      oNutrients[sKey] = Number(fRaw) * oRule.mult;
    }
  }
  return {
    name: tProduct.product_name || tProduct.generic_name || 'Unknown product',
    brand: (tProduct.brands || '').split(',')[0].trim() || null,
    barcode: tProduct.code || null,
    source: 'off',
    sourceRef: tProduct.code || null,
    baseUnit: 'g',
    servingSize: Number(tProduct.serving_quantity) || null,
    servingDesc: tProduct.serving_size || null,
    nutrients: oNutrients,
  };
}

async function offFetch(tPath) {
  const sUrl = `${oConfig.sOffBase}${tPath}`;
  const oResponse = await fetch(sUrl, {
    headers: { 'User-Agent': 'FitTrack/0.1 (self-hosted home use)' },
  });
  if (!oResponse.ok) throw httpError(502, 'Food database is unreachable right now');
  return oResponse.json();
}

// Insert/refresh a food + its nutrients, deduping by (source, source_ref) or barcode.
async function upsertFood(tFood, tUserId) {
  let oExisting = null;
  if (tFood.sourceRef) {
    oExisting = await oDb.one(
      'SELECT id FROM foods WHERE source = $1 AND source_ref = $2',
      [tFood.source, tFood.sourceRef]
    );
  }
  if (!oExisting && tFood.barcode) {
    oExisting = await oDb.one('SELECT id FROM foods WHERE barcode = $1', [tFood.barcode]);
  }

  let iFoodId;
  if (oExisting) {
    iFoodId = oExisting.id;
    await oDb.query(
      `UPDATE foods SET name = $1, brand = $2, barcode = $3, base_unit = $4,
         serving_size = $5, serving_desc = $6 WHERE id = $7`,
      [tFood.name, tFood.brand || null, tFood.barcode || null, tFood.baseUnit || 'g',
       tFood.servingSize || null, tFood.servingDesc || null, iFoodId]
    );
  } else {
    const oRow = await oDb.one(
      `INSERT INTO foods (name, brand, barcode, source, source_ref, base_unit, serving_size, serving_desc, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [tFood.name, tFood.brand || null, tFood.barcode || null, tFood.source || 'custom',
       tFood.sourceRef || null, tFood.baseUnit || 'g', tFood.servingSize || null,
       tFood.servingDesc || null, tUserId]
    );
    iFoodId = oRow.id;
  }

  // Replace nutrient rows.
  const oNutrients = tFood.nutrients || {};
  await oDb.query('DELETE FROM food_nutrients WHERE food_id = $1', [iFoodId]);
  const oCatalog = await oDb.many('SELECT id, key FROM nutrients', []);
  const oByKey = Object.fromEntries(oCatalog.map((tRow) => [tRow.key, tRow.id]));
  for (const sKey of Object.keys(oNutrients)) {
    if (oByKey[sKey] == null) continue;
    const fAmount = Number(oNutrients[sKey]);
    if (!Number.isFinite(fAmount)) continue;
    await oDb.query(
      'INSERT INTO food_nutrients (food_id, nutrient_id, amount) VALUES ($1, $2, $3)',
      [iFoodId, oByKey[sKey], fAmount]
    );
  }
  return iFoodId;
}

async function loadFood(tFoodId) {
  if (tFoodId == null) return null;
  const oFood = await oDb.one('SELECT * FROM foods WHERE id = $1', [tFoodId]);
  if (!oFood) return null;
  const oRows = await oDb.many(
    `SELECT n.key, n.name, n.unit, fn.amount
     FROM food_nutrients fn JOIN nutrients n ON n.id = fn.nutrient_id
     WHERE fn.food_id = $1`,
    [tFoodId]
  );
  oFood.nutrients = {};
  for (const tRow of oRows) oFood.nutrients[tRow.key] = Number(tRow.amount);
  return oFood;
}

// --- recipes ------------------------------------------------------------------
// A recipe rolls its ingredients up into a derived "food" (source='recipe') so
// that logging, daily summaries and the facts breakdown all flow through the
// existing food machinery. The recipe + ingredient rows let us re-edit it and
// show the per-ingredient contribution; the derived food carries the totals.

// Sum every nutrient across ingredients (each amount is per-100 of that food).
async function recipeTotals(aIngredients) {
  const oTotals = {};
  let fWeight = 0;
  for (const oIng of aIngredients) {
    const fGrams = Number(oIng.grams) || 0;
    fWeight += fGrams;
    const aRows = await oDb.many(
      `SELECT n.key, fn.amount FROM food_nutrients fn
       JOIN nutrients n ON n.id = fn.nutrient_id WHERE fn.food_id = $1`,
      [oIng.food_id]
    );
    for (const oRow of aRows) {
      oTotals[oRow.key] = (oTotals[oRow.key] || 0) + Number(oRow.amount) * fGrams / 100;
    }
  }
  return { totals: oTotals, weight: fWeight };
}

// Recompute the derived food for a recipe. With a manual per-serving override we
// store a nominal food (1 serving = 100 units = the override macros) so logging a
// serving yields exactly those numbers; otherwise we total the matched
// ingredients by weight as before.
async function syncRecipeFood(iRecipeId, sName, fServings, aIngredients, oOverride, iUserId) {
  let oFoodArgs;
  if (oOverride && Object.keys(oOverride).length) {
    oFoodArgs = { servingSize: 100, nutrients: oOverride };
  } else {
    const { totals, weight } = await recipeTotals(aIngredients);
    const oPer100 = {};
    if (weight > 0) for (const sKey of Object.keys(totals)) oPer100[sKey] = totals[sKey] / weight * 100;
    oFoodArgs = { servingSize: Math.round((fServings > 0 ? weight / fServings : weight) * 100) / 100, nutrients: oPer100 };
  }
  const iFoodId = await upsertFood({
    name: sName, source: 'recipe', sourceRef: 'recipe:' + iRecipeId,
    baseUnit: 'g', servingDesc: '1 serving', ...oFoodArgs,
  }, iUserId);
  await oDb.query('UPDATE recipes SET food_id = $1 WHERE id = $2', [iFoodId, iRecipeId]);
  return { foodId: iFoodId };
}

function cleanIngredients(aRaw) {
  return (Array.isArray(aRaw) ? aRaw : [])
    .map((oI) => ({ food_id: Number(oI.foodId ?? oI.food_id), grams: Number(oI.grams) }))
    .filter((oI) => Number.isFinite(oI.food_id) && Number.isFinite(oI.grams) && oI.grams > 0);
}

// Accepted-but-unmatched ingredient names (display only, no macros).
function cleanText(aRaw) {
  return (Array.isArray(aRaw) ? aRaw : [])
    .map((s) => String(s || '').trim()).filter(Boolean).slice(0, 100);
}

// Manual per-serving macro override: keep only finite numeric nutrient values.
function cleanOverride(oRaw) {
  if (!oRaw || typeof oRaw !== 'object') return null;
  const oOut = {};
  for (const sKey of Object.keys(oRaw)) {
    const f = Number(oRaw[sKey]);
    if (Number.isFinite(f)) oOut[sKey] = f;
  }
  return Object.keys(oOut).length ? oOut : null;
}

async function saveIngredients(iRecipeId, aIngredients) {
  await oDb.query('DELETE FROM recipe_ingredients WHERE recipe_id = $1', [iRecipeId]);
  let iOrder = 0;
  for (const oIng of aIngredients) {
    await oDb.query(
      `INSERT INTO recipe_ingredients (recipe_id, food_id, grams, order_index)
       VALUES ($1, $2, $3, $4)`,
      [iRecipeId, oIng.food_id, oIng.grams, iOrder++]
    );
  }
}

// Per-serving macro snapshot for recipe list rows (energy + the three macros).
async function recipeMacros(iFoodId) {
  if (!iFoodId) return {};
  const oFood = await oDb.one('SELECT serving_size FROM foods WHERE id = $1', [iFoodId]);
  const fServ = oFood && oFood.serving_size ? Number(oFood.serving_size) : 0;
  const aRows = await oDb.many(
    `SELECT n.key, fn.amount FROM food_nutrients fn
     JOIN nutrients n ON n.id = fn.nutrient_id
     WHERE fn.food_id = $1 AND n.key IN ('energy_kcal','protein_g','carbs_g','fat_g')`,
    [iFoodId]
  );
  const oOut = {};
  for (const oRow of aRows) oOut[oRow.key] = Number(oRow.amount) * fServ / 100;
  return oOut;
}

// GET /api/nutrition/recipes
oRouter.get('/recipes', wrap(async (tReq, tRes) => {
  const aRecipes = await oDb.many(
    'SELECT id, name, servings, food_id FROM recipes WHERE user_id = $1 ORDER BY lower(name) ASC',
    [tReq.iUserId]
  );
  for (const oR of aRecipes) {
    oR.servings = Number(oR.servings);
    oR.foodId = oR.food_id;
    oR.perServing = await recipeMacros(oR.food_id);
    delete oR.food_id;
  }
  tRes.json({ recipes: aRecipes });
}));

// GET /api/nutrition/recipes/:id  -> full recipe with per-ingredient breakdown
oRouter.get('/recipes/:id', wrap(async (tReq, tRes) => {
  const oR = await oDb.one(
    'SELECT * FROM recipes WHERE id = $1 AND user_id = $2',
    [tReq.params.id, tReq.iUserId]
  );
  if (!oR) throw httpError(404, 'Recipe not found');
  const aIng = await oDb.many(
    `SELECT ri.id, ri.food_id, ri.grams, f.name, f.brand
     FROM recipe_ingredients ri JOIN foods f ON f.id = ri.food_id
     WHERE ri.recipe_id = $1 ORDER BY ri.order_index ASC, ri.id ASC`,
    [oR.id]
  );
  for (const oIng of aIng) {
    oIng.grams = Number(oIng.grams);
    oIng.foodId = oIng.food_id;
    const aRows = await oDb.many(
      `SELECT n.key, fn.amount FROM food_nutrients fn
       JOIN nutrients n ON n.id = fn.nutrient_id WHERE fn.food_id = $1`,
      [oIng.food_id]
    );
    oIng.nutrients = {};
    for (const oRow of aRows) oIng.nutrients[oRow.key] = Number(oRow.amount) * oIng.grams / 100;
    delete oIng.food_id;
  }
  const { totals, weight } = await recipeTotals(aIng.map((i) => ({ food_id: i.foodId, grams: i.grams })));
  const fServings = Number(oR.servings) || 1;
  let aText = []; let oOverride = null;
  try { aText = JSON.parse(oR.text_ingredients || '[]'); } catch (tErr) { /* ignore */ }
  try { oOverride = oR.override_nutrients ? JSON.parse(oR.override_nutrients) : null; } catch (tErr) { /* ignore */ }
  tRes.json({
    recipe: {
      id: oR.id, name: oR.name, servings: fServings, foodId: oR.food_id,
      ingredients: aIng, textIngredients: aText, override: oOverride, totals, weight,
      servingGrams: fServings > 0 ? weight / fServings : weight,
    },
  });
}));

// POST /api/nutrition/recipes  body: { name, servings, ingredients:[{foodId, grams}] }
oRouter.post('/recipes', wrap(async (tReq, tRes) => {
  const sName = String(tReq.body.name || '').trim();
  if (!sName) throw httpError(400, 'Recipe name is required');
  const fServings = Number(tReq.body.servings) || 1;
  const aIng = cleanIngredients(tReq.body.ingredients);
  const aText = cleanText(tReq.body.textIngredients);
  const oOverride = cleanOverride(tReq.body.override);
  if (!aIng.length && !aText.length) throw httpError(400, 'Add at least one ingredient');

  const oRow = await oDb.one(
    `INSERT INTO recipes (user_id, name, servings, text_ingredients, override_nutrients)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [tReq.iUserId, sName, fServings, JSON.stringify(aText), oOverride ? JSON.stringify(oOverride) : null]
  );
  await saveIngredients(oRow.id, aIng);
  await syncRecipeFood(oRow.id, sName, fServings, aIng, oOverride, tReq.iUserId);
  tRes.status(201).json({ id: oRow.id });
}));

// PUT /api/nutrition/recipes/:id
oRouter.put('/recipes/:id', wrap(async (tReq, tRes) => {
  const oR = await oDb.one(
    'SELECT id FROM recipes WHERE id = $1 AND user_id = $2',
    [tReq.params.id, tReq.iUserId]
  );
  if (!oR) throw httpError(404, 'Recipe not found');
  const sName = String(tReq.body.name || '').trim();
  if (!sName) throw httpError(400, 'Recipe name is required');
  const fServings = Number(tReq.body.servings) || 1;
  const aIng = cleanIngredients(tReq.body.ingredients);
  const aText = cleanText(tReq.body.textIngredients);
  const oOverride = cleanOverride(tReq.body.override);
  if (!aIng.length && !aText.length) throw httpError(400, 'Add at least one ingredient');

  await oDb.query(
    'UPDATE recipes SET name = $1, servings = $2, text_ingredients = $3, override_nutrients = $4 WHERE id = $5',
    [sName, fServings, JSON.stringify(aText), oOverride ? JSON.stringify(oOverride) : null, oR.id]
  );
  await saveIngredients(oR.id, aIng);
  await syncRecipeFood(oR.id, sName, fServings, aIng, oOverride, tReq.iUserId);
  tRes.json({ id: oR.id });
}));

// DELETE /api/nutrition/recipes/:id  (leaves the derived food so past logs survive)
oRouter.delete('/recipes/:id', wrap(async (tReq, tRes) => {
  const oRow = await oDb.one(
    'DELETE FROM recipes WHERE id = $1 AND user_id = $2 RETURNING id',
    [tReq.params.id, tReq.iUserId]
  );
  if (!oRow) throw httpError(404, 'Recipe not found');
  tRes.json({ ok: true });
}));

// --- import a recipe from a URL ----------------------------------------------
// Most recipe sites embed schema.org Recipe JSON-LD (for Google rich results).
// We fetch the page, pull that structured data out and return name, servings,
// the ingredient lines (with grams parsed where the unit is a mass), and the
// site's per-serving nutrition if present. The user then matches each line to a
// food in the builder — that's where our accurate per-ingredient macros come from.

const MASS_TO_G = { g: 1, gram: 1, grams: 1, gr: 1, kg: 1000, kilogram: 1000, kilograms: 1000,
  oz: 28.3495, ounce: 28.3495, ounces: 28.3495, lb: 453.592, lbs: 453.592, pound: 453.592, pounds: 453.592 };

function parseQty(sTok) {
  // "1 1/2" | "1/2" | "2" | "0.5"
  const oMixed = sTok.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (oMixed) return Number(oMixed[1]) + Number(oMixed[2]) / Number(oMixed[3]);
  const oFrac = sTok.match(/^(\d+)\/(\d+)$/);
  if (oFrac) return Number(oFrac[1]) / Number(oFrac[2]);
  const f = Number(sTok);
  return Number.isFinite(f) ? f : null;
}

function parseIngredientLine(sRaw) {
  let s = String(sRaw || '').trim()
    .replace(/¼/g, ' 1/4').replace(/½/g, ' 1/2').replace(/¾/g, ' 3/4')
    .replace(/⅓/g, ' 1/3').replace(/⅔/g, ' 2/3').replace(/⅛/g, ' 1/8')
    .replace(/\s+/g, ' ').trim();
  let qty = null; let sUnit = null; let sName = s;
  const oM = s.match(/^(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?)\s*([a-zA-Z]+)?\.?\s*(.*)$/);
  if (oM) {
    qty = parseQty(oM[1]);
    const sTok = (oM[2] || '').toLowerCase();
    if (sTok && (MASS_TO_G[sTok] != null || ['ml','milliliter','milliliters','l','liter','liters','cup','cups','tbsp','tbsps','tablespoon','tablespoons','tsp','tsps','teaspoon','teaspoons','clove','cloves','can','cans','slice','slices','pinch','stick','sticks'].includes(sTok))) {
      sUnit = sTok; sName = oM[3] || '';
    } else {
      // the token belongs to the name (e.g. "2 eggs", "3 large onions")
      sName = ((oM[2] || '') + ' ' + (oM[3] || '')).trim();
    }
  }
  // tidy the name: drop a leading parenthetical and trailing prep notes
  sName = sName.replace(/^\([^)]*\)\s*/, '').replace(/,\s*(chopped|diced|minced|sliced|grated|melted|softened|to taste|optional).*$/i, '').trim();
  const fGrams = (qty != null && sUnit && MASS_TO_G[sUnit] != null) ? Math.round(qty * MASS_TO_G[sUnit] * 10) / 10 : null;
  return { raw: String(sRaw).trim(), name: sName || String(sRaw).trim(), qty, unit: sUnit, grams: fGrams };
}

function numFrom(tVal) {
  if (tVal == null) return null;
  const oM = String(tVal).replace(',', '.').match(/-?\d+(?:\.\d+)?/);
  return oM ? Number(oM[0]) : null;
}

function parseServings(tYield) {
  let sY = tYield;
  if (Array.isArray(tYield)) sY = tYield.find((x) => /\d/.test(String(x))) || tYield[0];
  const n = numFrom(sY);
  return n && n > 0 ? Math.round(n) : 1;
}

function mapNutrition(oN) {
  if (!oN || typeof oN !== 'object') return {};
  const oOut = {};
  const set = (sKey, tRaw, fMult) => { const n = numFrom(tRaw); if (n != null) oOut[sKey] = n * (fMult || 1); };
  set('energy_kcal', oN.calories, 1);
  set('protein_g', oN.proteinContent, 1);
  set('carbs_g', oN.carbohydrateContent, 1);
  set('fat_g', oN.fatContent, 1);
  set('fiber_g', oN.fiberContent, 1);
  set('sugar_g', oN.sugarContent, 1);
  set('sat_fat_g', oN.saturatedFatContent, 1);
  set('cholesterol_mg', oN.cholesterolContent, 1);
  // sodium often comes in grams; convert if the string says g (not mg)
  if (oN.sodiumContent != null) {
    const n = numFrom(oN.sodiumContent);
    if (n != null) oOut.sodium_mg = /\bmg\b/i.test(String(oN.sodiumContent)) ? n : n * (n < 5 ? 1000 : 1);
  }
  return oOut;
}

// Walk arbitrary JSON-LD (object / array / @graph) to find a Recipe node.
function findRecipeNode(tData) {
  const aFound = [];
  const visit = (o) => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) { o.forEach(visit); return; }
    const tType = o['@type'];
    const bRecipe = tType === 'Recipe' || (Array.isArray(tType) && tType.includes('Recipe'));
    if (bRecipe && Array.isArray(o.recipeIngredient || o.ingredients)) aFound.push(o);
    if (Array.isArray(o['@graph'])) o['@graph'].forEach(visit);
  };
  visit(tData);
  return aFound[0] || null;
}

function extractRecipe(sHtml) {
  const oRe = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let oMatch;
  while ((oMatch = oRe.exec(sHtml)) !== null) {
    let oData;
    try { oData = JSON.parse(oMatch[1].trim()); } catch (tErr) { continue; }
    const oNode = findRecipeNode(oData);
    if (oNode) return oNode;
  }
  return null;
}

// POST /api/nutrition/recipes/import  body: { url }
oRouter.post('/recipes/import', wrap(async (tReq, tRes) => {
  let oUrl;
  try { oUrl = new URL(String(tReq.body.url || '').trim()); } catch (tErr) { throw httpError(400, 'Enter a valid URL'); }
  if (!/^https?:$/.test(oUrl.protocol)) throw httpError(400, 'Only http(s) links are supported');
  if (/^(localhost|127\.|0\.0\.0\.0|169\.254\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(oUrl.hostname)) {
    throw httpError(400, 'That address is not allowed');
  }

  let sHtml;
  try {
    const oRes = await fetch(oUrl.href, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FitTrack/1.0; +recipe-import)', Accept: 'text/html' },
      redirect: 'follow',
    });
    if (!oRes.ok) throw httpError(502, 'Could not load that page (' + oRes.status + ')');
    sHtml = await oRes.text();
  } catch (tErr) {
    if (tErr.statusCode) throw tErr;
    throw httpError(502, 'Could not reach that website');
  }

  const oNode = extractRecipe(sHtml);
  if (!oNode) throw httpError(422, 'No recipe data found on that page. Try a different recipe URL.');

  const aRawIng = oNode.recipeIngredient || oNode.ingredients || [];
  const aLines = aRawIng.map(parseIngredientLine);
  tRes.json({
    recipe: {
      name: typeof oNode.name === 'string' ? oNode.name.trim() : 'Imported recipe',
      servings: parseServings(oNode.recipeYield),
      sourceUrl: oUrl.href,
      ingredientLines: aLines,
      nutrition: mapNutrition(oNode.nutrition),
    },
  });
}));

// --- nutrient catalog ---------------------------------------------------------
oRouter.get('/nutrients', wrap(async (tReq, tRes) => {
  const oNutrients = await oDb.many('SELECT * FROM nutrients ORDER BY sort_order ASC', []);
  tRes.json({ nutrients: oNutrients });
}));

// --- food search --------------------------------------------------------------
// GET /api/nutrition/foods/search?q=
oRouter.get('/foods/search', wrap(async (tReq, tRes) => {
  const sQuery = String(tReq.query.q || '').trim();
  if (sQuery.length < 2) return tRes.json({ local: [], remote: [] });

  const oLocal = await oDb.many(
    `SELECT id, name, brand, barcode, source FROM foods
     WHERE lower(name) LIKE $1 ORDER BY name ASC LIMIT 20`,
    [`%${sQuery.toLowerCase()}%`]
  );

  let oRemote = [];
  try {
    const oData = await offFetch(
      `/cgi/search.pl?search_terms=${encodeURIComponent(sQuery)}` +
      '&search_simple=1&action=process&json=1&page_size=15' +
      '&fields=code,product_name,brands,nutriments,serving_quantity,serving_size'
    );
    oRemote = (oData.products || [])
      .filter((tP) => tP.product_name)
      .map((tP) => mapOffProduct(tP));
  } catch (tErr) {
    oRemote = []; // offline / unreachable: local results still work
  }
  tRes.json({ local: oLocal, remote: oRemote });
}));

// GET /api/nutrition/foods/barcode/:code
oRouter.get('/foods/barcode/:code', wrap(async (tReq, tRes) => {
  const sCode = String(tReq.params.code).replace(/\D/g, '');
  if (!sCode) throw httpError(400, 'That barcode could not be read');

  const oExisting = await oDb.one('SELECT id FROM foods WHERE barcode = $1', [sCode]);
  if (oExisting) return tRes.json({ food: await loadFood(oExisting.id), cached: true });

  const oData = await offFetch(`/api/v2/product/${sCode}.json?fields=code,product_name,generic_name,brands,nutriments,serving_quantity,serving_size`);
  if (!oData || oData.status !== 1 || !oData.product) throw httpError(404, 'No product found for that barcode');
  tRes.json({ food: mapOffProduct(oData.product), cached: false });
}));

// GET /api/nutrition/foods/:id
oRouter.get('/foods/:id', wrap(async (tReq, tRes) => {
  const oFood = await loadFood(tReq.params.id);
  if (!oFood) throw httpError(404, 'Food not found');
  tRes.json({ food: oFood });
}));

// POST /api/nutrition/foods  -> create custom OR persist an OFF result; returns id
oRouter.post('/foods', wrap(async (tReq, tRes) => {
  if (!String(tReq.body.name || '').trim()) throw httpError(400, 'Food name is required');
  const iId = await upsertFood(tReq.body, tReq.iUserId);
  tRes.status(201).json({ food: await loadFood(iId) });
}));

// --- food log -----------------------------------------------------------------
// GET /api/nutrition/log?date=YYYY-MM-DD
oRouter.get('/log', wrap(async (tReq, tRes) => {
  const sDate = String(tReq.query.date || new Date().toISOString().slice(0, 10));
  const oRows = await oDb.many(
    `SELECT l.id, l.meal_type, l.quantity, l.unit, l.logged_at,
            f.id AS food_id, f.name, f.brand, f.base_unit, f.serving_size
     FROM food_log l JOIN foods f ON f.id = l.food_id
     WHERE l.user_id = $1 AND date(l.logged_at) = date($2)
     ORDER BY l.logged_at ASC`,
    [tReq.iUserId, sDate]
  );
  // attach per-entry nutrient contribution (scaled from per-100 amounts)
  for (const oEntry of oRows) {
    const oNut = await oDb.many(
      `SELECT n.key, fn.amount FROM food_nutrients fn
       JOIN nutrients n ON n.id = fn.nutrient_id WHERE fn.food_id = $1`,
      [oEntry.food_id]
    );
    const fFactor = Number(oEntry.quantity) / 100;
    oEntry.nutrients = {};
    for (const tRow of oNut) oEntry.nutrients[tRow.key] = Number(tRow.amount) * fFactor;
  }
  tRes.json({ date: sDate, entries: oRows });
}));

// POST /api/nutrition/log
oRouter.post('/log', wrap(async (tReq, tRes) => {
  const fQuantity = Number(tReq.body.quantity);
  if (!Number.isFinite(fQuantity) || fQuantity <= 0) throw httpError(400, 'Enter a valid amount');
  const oFood = await oDb.one('SELECT id FROM foods WHERE id = $1', [tReq.body.foodId]);
  if (!oFood) throw httpError(404, 'Food not found — save it first');
  const oRow = await oDb.one(
    `INSERT INTO food_log (user_id, food_id, meal_type, quantity, unit, logged_at)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6, datetime('now','localtime'))) RETURNING *`,
    [tReq.iUserId, tReq.body.foodId, tReq.body.mealType || 'snack', fQuantity,
     tReq.body.unit || 'g', tReq.body.loggedAt || null]
  );
  await recordUsage(tReq.iUserId, tReq.body.foodId);
  tRes.status(201).json({ entry: oRow });
}));

// --- recents & favorites ------------------------------------------------------
// Bump a food's usage when it's logged: surfaces it in Recents and auto-adds it
// to Favorites once logged more than 3 times (unless the user dismissed it).
// Recipe-derived foods are skipped — favorites are for food entries, not recipes.
async function recordUsage(iUserId, iFoodId) {
  const oFood = await oDb.one('SELECT source FROM foods WHERE id = $1', [iFoodId]);
  if (!oFood || oFood.source === 'recipe') return;
  await oDb.query(
    `INSERT INTO food_usage (user_id, food_id, uses, last_used_at, hidden)
     VALUES ($1, $2, 1, datetime('now','localtime'), 0)
     ON CONFLICT (user_id, food_id) DO UPDATE SET
       uses = uses + 1,
       last_used_at = excluded.last_used_at,
       hidden = 0,
       favorite = CASE WHEN fav_dismissed = 0 AND uses + 1 > 3 THEN 1 ELSE favorite END`,
    [iUserId, iFoodId]
  );
}

// Shared SELECT for recents/favorites rows (id, name, brand + per-100 energy).
const USAGE_COLS =
  `f.id, f.name, f.brand, f.source, u.uses, u.favorite,
   (SELECT fn.amount FROM food_nutrients fn JOIN nutrients n ON n.id = fn.nutrient_id
    WHERE fn.food_id = f.id AND n.key = 'energy_kcal') AS kcal100`;

oRouter.get('/recents', wrap(async (tReq, tRes) => {
  const aRows = await oDb.many(
    `SELECT ${USAGE_COLS} FROM food_usage u JOIN foods f ON f.id = u.food_id
     WHERE u.user_id = $1 AND u.hidden = 0 AND u.last_used_at IS NOT NULL AND f.source != 'recipe'
     ORDER BY u.last_used_at DESC LIMIT 20`,
    [tReq.iUserId]
  );
  tRes.json({ recents: aRows });
}));

oRouter.get('/favorites', wrap(async (tReq, tRes) => {
  const aRows = await oDb.many(
    `SELECT ${USAGE_COLS} FROM food_usage u JOIN foods f ON f.id = u.food_id
     WHERE u.user_id = $1 AND u.favorite = 1 AND f.source != 'recipe'
     ORDER BY lower(f.name) ASC`,
    [tReq.iUserId]
  );
  tRes.json({ favorites: aRows });
}));

// Manually add a food to favorites (creating a usage row if needed).
oRouter.post('/favorites', wrap(async (tReq, tRes) => {
  const oFood = await oDb.one("SELECT id, source FROM foods WHERE id = $1", [tReq.body.foodId]);
  if (!oFood) throw httpError(404, 'Food not found');
  if (oFood.source === 'recipe') throw httpError(400, 'Recipes can’t be favorited here');
  await oDb.query(
    `INSERT INTO food_usage (user_id, food_id, favorite, fav_dismissed)
     VALUES ($1, $2, 1, 0)
     ON CONFLICT (user_id, food_id) DO UPDATE SET favorite = 1, fav_dismissed = 0`,
    [tReq.iUserId, oFood.id]
  );
  tRes.status(201).json({ ok: true });
}));

// Remove from favorites (and remember the choice so it won't auto-re-add).
oRouter.delete('/favorites/:foodId', wrap(async (tReq, tRes) => {
  await oDb.query(
    'UPDATE food_usage SET favorite = 0, fav_dismissed = 1 WHERE user_id = $1 AND food_id = $2',
    [tReq.iUserId, tReq.params.foodId]
  );
  tRes.json({ ok: true });
}));

// Remove from Recents (keeps favorite status; re-logging brings it back).
oRouter.delete('/recents/:foodId', wrap(async (tReq, tRes) => {
  await oDb.query(
    'UPDATE food_usage SET hidden = 1 WHERE user_id = $1 AND food_id = $2',
    [tReq.iUserId, tReq.params.foodId]
  );
  tRes.json({ ok: true });
}));

// PUT /api/nutrition/log/:id
oRouter.put('/log/:id', wrap(async (tReq, tRes) => {
  const oRow = await oDb.one(
    `UPDATE food_log SET quantity = $1, unit = $2, meal_type = $3
     WHERE id = $4 AND user_id = $5 RETURNING *`,
    [Number(tReq.body.quantity), tReq.body.unit || 'g', tReq.body.mealType || 'snack',
     tReq.params.id, tReq.iUserId]
  );
  if (!oRow) throw httpError(404, 'Log entry not found');
  tRes.json({ entry: oRow });
}));

// DELETE /api/nutrition/log/:id
oRouter.delete('/log/:id', wrap(async (tReq, tRes) => {
  const oRow = await oDb.one(
    'DELETE FROM food_log WHERE id = $1 AND user_id = $2 RETURNING id',
    [tReq.params.id, tReq.iUserId]
  );
  if (!oRow) throw httpError(404, 'Log entry not found');
  tRes.json({ ok: true });
}));

// GET /api/nutrition/summary?date=  -> totals per nutrient vs goals
oRouter.get('/summary', wrap(async (tReq, tRes) => {
  const sDate = String(tReq.query.date || new Date().toISOString().slice(0, 10));
  const oTotals = await oDb.many(
    `SELECT n.key, n.name, n.unit, n.category,
            SUM(fn.amount * l.quantity / 100.0) AS total
     FROM food_log l
     JOIN food_nutrients fn ON fn.food_id = l.food_id
     JOIN nutrients n ON n.id = fn.nutrient_id
     WHERE l.user_id = $1 AND date(l.logged_at) = date($2)
     GROUP BY n.id, n.key, n.name, n.unit, n.category`,
    [tReq.iUserId, sDate]
  );
  const oGoals = await oDb.many(
    `SELECT n.key, n.name, n.unit, n.category, g.target FROM nutrition_goals g
     JOIN nutrients n ON n.id = g.nutrient_id WHERE g.user_id = $1`,
    [tReq.iUserId]
  );
  const oGoalByKey = Object.fromEntries(oGoals.map((tRow) => [tRow.key, Number(tRow.target)]));
  const oResult = oTotals.map((tRow) => ({
    key: tRow.key, name: tRow.name, unit: tRow.unit, category: tRow.category,
    total: Number(tRow.total), goal: oGoalByKey[tRow.key] ?? null,
  }));
  // Include nutrients that have a goal but no intake yet, so the page can show
  // "0 / goal" instead of dropping the goal entirely on an empty/partial day.
  const oSeen = new Set(oResult.map((tRow) => tRow.key));
  for (const tRow of oGoals) {
    if (oSeen.has(tRow.key)) continue;
    oResult.push({ key: tRow.key, name: tRow.name, unit: tRow.unit, category: tRow.category,
      total: 0, goal: Number(tRow.target) });
  }
  tRes.json({ date: sDate, totals: oResult });
}));

// GET /api/nutrition/trend?from=&to=  -> daily macro totals for charts
oRouter.get('/trend', wrap(async (tReq, tRes) => {
  const sTo = String(tReq.query.to || new Date().toISOString().slice(0, 10));
  const sFrom = String(tReq.query.from || '');
  const oRows = await oDb.many(
    `SELECT date(l.logged_at) AS day, n.key, SUM(fn.amount * l.quantity / 100.0) AS total
     FROM food_log l
     JOIN food_nutrients fn ON fn.food_id = l.food_id
     JOIN nutrients n ON n.id = fn.nutrient_id
     WHERE l.user_id = $1
       AND n.key IN ('energy_kcal','protein_g','carbs_g','fat_g')
       AND date(l.logged_at) <= date($2)
       AND ($3 = '' OR date(l.logged_at) >= date($3))
     GROUP BY day, n.key ORDER BY day ASC`,
    [tReq.iUserId, sTo, sFrom]
  );
  tRes.json({ rows: oRows });
}));

// --- goals --------------------------------------------------------------------
oRouter.get('/goals', wrap(async (tReq, tRes) => {
  const oRows = await oDb.many(
    `SELECT n.key, g.target FROM nutrition_goals g
     JOIN nutrients n ON n.id = g.nutrient_id WHERE g.user_id = $1`,
    [tReq.iUserId]
  );
  const oGoals = {};
  for (const tRow of oRows) oGoals[tRow.key] = Number(tRow.target);
  tRes.json({ goals: oGoals });
}));

// PUT /api/nutrition/goals  body: { goals: { energy_kcal: 2400, protein_g: 180, ... } }
oRouter.put('/goals', wrap(async (tReq, tRes) => {
  const oGoals = tReq.body.goals || {};
  const oCatalog = await oDb.many('SELECT id, key FROM nutrients', []);
  const oByKey = Object.fromEntries(oCatalog.map((tRow) => [tRow.key, tRow.id]));
  for (const sKey of Object.keys(oGoals)) {
    if (oByKey[sKey] == null) continue;
    const fTarget = Number(oGoals[sKey]);
    if (!Number.isFinite(fTarget)) continue;
    await oDb.query(
      `INSERT INTO nutrition_goals (user_id, nutrient_id, target)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, nutrient_id) DO UPDATE SET target = EXCLUDED.target`,
      [tReq.iUserId, oByKey[sKey], fTarget]
    );
  }
  tRes.json({ ok: true });
}));

module.exports = oRouter;
