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

// Recompute the derived food for a recipe from its current ingredients.
async function syncRecipeFood(iRecipeId, sName, fServings, aIngredients, iUserId) {
  const { totals, weight } = await recipeTotals(aIngredients);
  const oPer100 = {};
  if (weight > 0) {
    for (const sKey of Object.keys(totals)) oPer100[sKey] = totals[sKey] / weight * 100;
  }
  const fServingGrams = fServings > 0 ? weight / fServings : weight;
  const iFoodId = await upsertFood({
    name: sName,
    source: 'recipe',
    sourceRef: 'recipe:' + iRecipeId,
    baseUnit: 'g',
    servingSize: Math.round(fServingGrams * 100) / 100,
    servingDesc: '1 serving',
    nutrients: oPer100,
  }, iUserId);
  await oDb.query('UPDATE recipes SET food_id = $1 WHERE id = $2', [iFoodId, iRecipeId]);
  return { foodId: iFoodId, weight, servingGrams: fServingGrams, totals };
}

function cleanIngredients(aRaw) {
  return (Array.isArray(aRaw) ? aRaw : [])
    .map((oI) => ({ food_id: Number(oI.foodId ?? oI.food_id), grams: Number(oI.grams) }))
    .filter((oI) => Number.isFinite(oI.food_id) && Number.isFinite(oI.grams) && oI.grams > 0);
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
  tRes.json({
    recipe: {
      id: oR.id, name: oR.name, servings: fServings, foodId: oR.food_id,
      ingredients: aIng, totals, weight,
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
  if (!aIng.length) throw httpError(400, 'Add at least one ingredient');

  const oRow = await oDb.one(
    'INSERT INTO recipes (user_id, name, servings) VALUES ($1, $2, $3) RETURNING id',
    [tReq.iUserId, sName, fServings]
  );
  await saveIngredients(oRow.id, aIng);
  await syncRecipeFood(oRow.id, sName, fServings, aIng, tReq.iUserId);
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
  if (!aIng.length) throw httpError(400, 'Add at least one ingredient');

  await oDb.query('UPDATE recipes SET name = $1, servings = $2 WHERE id = $3',
    [sName, fServings, oR.id]);
  await saveIngredients(oR.id, aIng);
  await syncRecipeFood(oR.id, sName, fServings, aIng, tReq.iUserId);
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
  tRes.status(201).json({ entry: oRow });
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
