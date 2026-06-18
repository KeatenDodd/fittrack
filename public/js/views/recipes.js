'use strict';
// Recipe builder: combine several foods (barcode, saved, or manually-entered
// macros) into a named recipe that makes N servings. Macros AND micros are
// totalled from the ingredients and divided by the serving size, then saved as
// a derived food so the recipe logs and breaks down like any other food.
import { api } from '../api.js';
import { h, mount, num, toast, openSheet, confirmAction, guard } from '../ui.js';
import { normalizeFood } from './nutrition.js';
import { nutrientCatalog, factsList, openFoodFacts } from './foodfacts.js';

const LINK = 'background:none;border:0;color:var(--accent);cursor:pointer;padding:0;font-size:13px';

export async function render(tRoot) {
  await showList();

  // ---- list -----------------------------------------------------------------
  async function showList() {
    mount(tRoot, h('div.empty', { text: 'Loading…' }));
    const oData = await api.recipes();
    const aRecipes = oData.recipes;
    mount(tRoot, [
      h('div.page-head', { style: 'display:flex;justify-content:space-between;align-items:center' }, [
        h('div', {}, [h('div.eyebrow', { text: 'Nutrition' }), h('h1', { text: 'Recipes' })]),
        h('div.btn-row', {}, [
          h('button.btn.btn-ghost.btn-sm', { type: 'button', text: '🔗 Import', onclick: () => openImportSheet(showBuilder) }),
          h('button.btn.btn-accent.btn-sm', { type: 'button', text: '+ New', onclick: () => showBuilder(null) }),
        ]),
      ]),
      h('p.faint', { style: 'font-size:13px;margin:-4px 0 14px',
        text: 'Build one by hand or import from a recipe URL; every macro and micro auto-totals per serving.' }),
      aRecipes.length
        ? h('div', {}, aRecipes.map(recipeCard))
        : h('div.empty', {}, [h('p', { text: 'No recipes yet.' }),
            h('p.faint', { text: 'Build one and log it in a single tap.' })]),
      h('div', { style: 'margin-top:18px' }, [
        h('a', { href: '#/nutrition', text: '‹ Back to food log', style: 'color:var(--accent);font-size:13px' }),
      ]),
    ]);
  }

  function recipeCard(oR) {
    const oPS = oR.perServing || {};
    return h('div.card', { style: 'cursor:pointer', onclick: () => showBuilder(oR.id) }, [
      h('div', { style: 'display:flex;justify-content:space-between;align-items:baseline' }, [
        h('strong', { text: oR.name }),
        h('span.faint', { style: 'font-size:12.5px', text: num(oR.servings) + (Number(oR.servings) === 1 ? ' serving' : ' servings') }),
      ]),
      h('div.faint', { style: 'font-size:13px;margin-top:4px' }, [
        h('span.num', { text: num(oPS.energy_kcal || 0) }), ' kcal · P ',
        h('span.num', { text: num(oPS.protein_g || 0) }), ' · C ',
        h('span.num', { text: num(oPS.carbs_g || 0) }), ' · F ',
        h('span.num', { text: num(oPS.fat_g || 0) }), ' per serving',
      ]),
    ]);
  }

  // ---- builder --------------------------------------------------------------
  // oImported (optional): a recipe parsed from a URL — { name, servings,
  // ingredientLines, nutrition, sourceUrl }. Its lines land in oDraft.pending
  // for the user to match to foods.
  async function showBuilder(iId, oImported) {
    mount(tRoot, h('div.empty', { text: 'Loading…' }));
    const oCatalog = await nutrientCatalog();
    let oDraft;
    if (iId) {
      const oR = (await api.recipe(iId)).recipe;
      oDraft = {
        id: oR.id, name: oR.name, servings: oR.servings,
        ingredients: oR.ingredients.map((oI) => ({
          foodId: oI.foodId, name: oI.name, brand: oI.brand, grams: oI.grams,
          nutrients: per100From(oI.nutrients, oI.grams),
        })),
        pending: [],
      };
    } else if (oImported) {
      oDraft = {
        id: null, name: oImported.name || '', servings: oImported.servings || 1,
        ingredients: [], pending: (oImported.ingredientLines || []).slice(),
        nutritionRef: oImported.nutrition || null, sourceUrl: oImported.sourceUrl || null,
      };
    } else {
      oDraft = { id: null, name: '', servings: 1, ingredients: [], pending: [] };
    }
    paintBuilder(oDraft, oCatalog);
  }

  function paintBuilder(oDraft, oCatalog) {
    const oName = h('input', { type: 'text', placeholder: 'e.g. Overnight oats', value: oDraft.name });
    oName.addEventListener('input', () => { oDraft.name = oName.value; });
    const oServings = h('input.num', { type: 'number', step: 'any', min: '1', value: oDraft.servings });
    oServings.addEventListener('input', () => { oDraft.servings = Number(oServings.value) || 1; repaintTotals(); });

    const oIngList = h('div.card.tight');
    const oTotalsEl = h('div');
    const oPendingEl = h('div');

    // Imported ingredient lines awaiting a food match. Tapping one opens the
    // picker pre-seeded with the parsed name + grams, so it's a one-tap confirm.
    function repaintPending() {
      const aPending = oDraft.pending || [];
      if (!aPending.length) { mount(oPendingEl, null); return; }
      mount(oPendingEl, [
        h('div.meal-head', { style: 'margin-top:8px' }, [
          h('span.name', { text: 'From import — match each' }),
          h('span.faint', { text: aPending.length + ' left' }),
        ]),
        oDraft.nutritionRef && oDraft.nutritionRef.energy_kcal
          ? h('p.faint', { style: 'font-size:12px;margin:0 0 6px',
              text: 'Site lists ~' + num(oDraft.nutritionRef.energy_kcal) + ' kcal/serving — match ingredients below to compute ours.' })
          : null,
        h('div.card.tight', {}, aPending.map((oLine, iIdx) => h('div.row', {}, [
          h('div', { style: 'flex:1;min-width:0' }, [
            h('div.label', { text: oLine.raw }),
            h('div.sub', { text: oLine.grams ? num(oLine.grams) + ' g · tap Match' : 'tap Match to pick the food & amount' }),
          ]),
          h('button.btn.btn-sm', { type: 'button', text: 'Match', style: 'flex:0 0 auto',
            onclick: () => openIngredientPicker((oIng) => {
              oDraft.ingredients.push(oIng);
              oDraft.pending.splice(iIdx, 1);
              repaintIngredients(); repaintPending(); repaintTotals();
            }, { query: oLine.name, grams: oLine.grams }) }),
          h('button.icon-btn', { type: 'button', text: '×', title: 'Skip this line',
            onclick: () => { oDraft.pending.splice(iIdx, 1); repaintPending(); } }),
        ]))),
      ]);
    }

    function repaintIngredients() {
      mount(oIngList, [
        ...oDraft.ingredients.map((oIng, iIdx) => ingredientRow(oIng, iIdx)),
        h('div.row.list-link', { onclick: () => openIngredientPicker((oIng) => {
          oDraft.ingredients.push(oIng); repaintIngredients(); repaintTotals();
        }) }, [h('span.faint', { text: '+ Add ingredient' })]),
      ]);
    }

    function ingredientRow(oIng, iIdx) {
      const oG = h('input.num', { type: 'number', step: 'any', value: oIng.grams, style: 'width:70px' });
      const oKcal = h('span.num');
      const repaintKcal = () => { oKcal.textContent = num((oIng.nutrients.energy_kcal || 0) * (Number(oIng.grams) || 0) / 100); };
      oG.addEventListener('input', () => { oIng.grams = Number(oG.value) || 0; repaintKcal(); repaintTotals(); });
      repaintKcal();
      return h('div.row', {}, [
        h('div', { style: 'flex:1;min-width:0' }, [
          h('div.label', { text: oIng.name }),
          h('div.sub', {}, [oKcal, ' kcal · ',
            h('span', { text: 'facts', style: 'color:var(--accent);cursor:pointer',
              onclick: () => openFoodFacts({ name: oIng.name, brand: oIng.brand, nutrients: oIng.nutrients }, oIng.grams) })]),
        ]),
        oG, h('span.faint', { style: 'margin:0 2px', text: 'g' }),
        h('button.icon-btn', { type: 'button', text: '×',
          onclick: () => { oDraft.ingredients.splice(iIdx, 1); repaintIngredients(); repaintTotals(); } }),
      ]);
    }

    function repaintTotals() {
      const { totals, weight } = totalsOf(oDraft);
      const fServ = Number(oDraft.servings) > 0 ? Number(oDraft.servings) : 1;
      const fServGrams = weight / fServ;
      const oPer100 = {};
      if (weight > 0) for (const sKey of Object.keys(totals)) oPer100[sKey] = totals[sKey] / weight * 100;

      let bFactsOpen = false;
      const oFactsWrap = h('div', { style: 'margin-top:8px' });
      const oFactsBtn = h('button', { type: 'button', text: 'Show full nutrition facts', style: LINK + ';margin-top:6px',
        onclick: () => {
          bFactsOpen = !bFactsOpen;
          oFactsBtn.textContent = bFactsOpen ? 'Hide full nutrition facts' : 'Show full nutrition facts';
          mount(oFactsWrap, bFactsOpen ? factsList({ nutrients: oPer100 }, fServGrams, oCatalog) : null);
        } });

      mount(oTotalsEl, h('div.card', {}, [
        h('div.faint', { style: 'font-size:12px',
          text: 'Per serving · ' + num(fServGrams) + ' g · makes ' + num(fServ) }),
        h('div', { style: 'display:flex;gap:16px;margin-top:6px;flex-wrap:wrap' }, [
          chip('Calories', num((totals.energy_kcal || 0) / fServ)),
          chip('Protein', num((totals.protein_g || 0) / fServ) + ' g'),
          chip('Carbs', num((totals.carbs_g || 0) / fServ) + ' g'),
          chip('Fat', num((totals.fat_g || 0) / fServ) + ' g'),
        ]),
        oFactsBtn, oFactsWrap,
      ]));
    }

    async function save() {
      if (!oDraft.name.trim()) { toast('Name the recipe'); return; }
      if (!oDraft.ingredients.length) { toast('Add at least one ingredient'); return; }
      const oBody = {
        name: oDraft.name.trim(),
        servings: Number(oDraft.servings) || 1,
        ingredients: oDraft.ingredients.map((oI) => ({ foodId: oI.foodId, grams: Number(oI.grams) })),
      };
      if (oDraft.id) await guard(api.updateRecipe(oDraft.id, oBody));
      else await guard(api.createRecipe(oBody));
      toast('Recipe saved');
      showList();
    }

    mount(tRoot, [
      h('div.page-head', {}, [
        h('div.eyebrow', { text: 'Recipes' }),
        h('h1', { text: oDraft.id ? 'Edit recipe' : 'New recipe' }),
      ]),
      h('label.field', {}, [h('span.lbl', { text: 'Name' }), oName]),
      h('label.field', { style: 'max-width:180px' }, [h('span.lbl', { text: 'Servings it makes' }), oServings]),
      oPendingEl,
      h('div.meal-head', { style: 'margin-top:8px' }, [h('span.name', { text: 'Ingredients' })]),
      oIngList,
      h('div.meal-head', { style: 'margin-top:8px' }, [h('span.name', { text: 'Totals' })]),
      oTotalsEl,
      h('div.btn-row', { style: 'margin-top:16px' }, [
        h('button.btn.btn-accent', { type: 'button', text: oDraft.id ? 'Save changes' : 'Create recipe', onclick: save }),
        h('button.btn.btn-ghost', { type: 'button', text: 'Cancel', onclick: showList }),
        oDraft.id ? h('button.btn.btn-ghost', { type: 'button', text: 'Delete',
          onclick: () => confirmAction('Delete this recipe?', async () => {
            await guard(api.deleteRecipe(oDraft.id)); toast('Deleted'); showList();
          }) }) : null,
      ]),
    ]);
    repaintPending();
    repaintIngredients();
    repaintTotals();
  }
}

// URL import sheet: paste a recipe link, fetch its structured data, then hand
// the parsed recipe to the builder for ingredient matching.
function openImportSheet(tToBuilder) {
  openSheet('Import from URL', (tBody, tClose) => {
    const oUrl = h('input', { type: 'url', inputmode: 'url', placeholder: 'https://…recipe page' });
    const oStatus = h('p.faint', { style: 'font-size:12.5px;margin:8px 0 0' });
    async function go() {
      const sUrl = oUrl.value.trim();
      if (!sUrl) { toast('Paste a recipe URL'); return; }
      oStatus.textContent = 'Fetching recipe…';
      try {
        const oData = await api.importRecipe(sUrl);
        tClose();
        tToBuilder(null, oData.recipe);
      } catch (tErr) {
        oStatus.textContent = tErr.message || 'Could not import that page.';
      }
    }
    oUrl.addEventListener('keydown', (tEvent) => { if (tEvent.key === 'Enter') go(); });
    mount(tBody, [
      h('label.field', {}, [h('span.lbl', { text: 'Recipe URL' }), oUrl]),
      h('p.faint', { style: 'font-size:12.5px;margin:2px 0 0',
        text: 'Pulls the name, servings, ingredients and nutrition from the page. You’ll match each ingredient to a food to total the macros.' }),
      h('button.btn.btn-accent.btn-block', { type: 'button', text: 'Import', onclick: go, style: 'margin-top:10px' }),
      oStatus,
    ]);
    oUrl.focus();
  });
}

// ---- ingredient picker (own bottom sheet — opened from the full page) --------
// oSeed (optional): { query, grams } to pre-run the search and default the
// amount, so matching an imported line is a one-tap confirm.
function openIngredientPicker(tOnAdd, oSeed) {
  openSheet('Add ingredient', (tBody, tClose) => {
    const backBtn = () => h('button', { type: 'button', text: '‹ Back to search', onclick: goSearch,
      style: LINK + ';margin-bottom:10px' });

    // pick a resolved food (has .nutrients per 100), then ask grams
    function goGrams(oFood) {
      const fServing = Number(oFood.serving_size || oFood.servingSize) || 0;
      const fDefault = (oSeed && oSeed.grams) || (fServing > 0 ? fServing : 100);
      const oG = h('input.num', { type: 'number', step: 'any', value: fDefault });
      async function add() {
        const fGrams = Number(oG.value);
        if (!Number.isFinite(fGrams) || fGrams <= 0) { toast('Enter grams'); return; }
        let oResolved = oFood;
        if (!oResolved.id) {
          const oSaved = await guard(api.saveFood(normalizeFood(oFood)));
          oResolved = oSaved.food;
        }
        tOnAdd({ foodId: oResolved.id, name: oResolved.name, brand: oResolved.brand || null,
          grams: fGrams, nutrients: oResolved.nutrients || oFood.nutrients || {} });
        tClose();
      }
      mount(tBody, [
        backBtn(),
        h('div.card', {}, [h('strong', { text: oFood.name }), oFood.brand ? h('div.faint', { text: oFood.brand }) : null]),
        h('label.field', {}, [h('span.lbl', { text: 'Amount (grams)' }), oG]),
        h('button.btn.btn-block', { type: 'button', text: 'Add ingredient', onclick: add }),
      ]);
    }

    function goSearch() {
      const oSearch = h('input', { type: 'search', placeholder: 'Search foods…' });
      const oResults = h('div', { style: 'max-height:42vh;overflow-y:auto' });
      let oTimer = null;
      oSearch.addEventListener('input', () => {
        clearTimeout(oTimer);
        const sQuery = oSearch.value.trim();
        if (sQuery.length < 2) { mount(oResults, null); return; }
        oTimer = setTimeout(() => runSearch(sQuery), 280);
      });
      async function runSearch(sQuery) {
        mount(oResults, h('p.muted', { style: 'padding:10px 4px', text: 'Searching…' }));
        let oData;
        try { oData = await api.searchFoods(sQuery); }
        catch (tErr) { mount(oResults, h('p.muted', { style: 'padding:10px 4px', text: 'Search failed.' })); return; }
        const aRows = [];
        for (const oLocal of oData.local) {
          aRows.push(resultRow(oLocal.name, oLocal.brand, oLocal.source === 'recipe' ? 'recipe' : 'saved',
            async () => { const oD = await guard(api.food(oLocal.id)); goGrams(oD.food); }));
        }
        for (const oRemote of oData.remote) {
          aRows.push(resultRow(oRemote.name, oRemote.brand, 'open food facts', () => goGrams(oRemote)));
        }
        mount(oResults, aRows.length ? aRows : h('p.muted', { style: 'padding:10px 4px', text: 'No matches found.' }));
      }
      mount(tBody, [
        oSearch,
        h('div.btn-row', { style: 'margin:12px 0' }, [
          h('button.btn.btn-ghost.btn-sm', { type: 'button', text: '+ Manual macros', onclick: goCustom }),
        ]),
        oResults,
      ]);
      // Seeded from an imported line: prefill the query and search immediately.
      if (oSeed && oSeed.query) { oSearch.value = oSeed.query; runSearch(oSeed.query); }
      oSearch.focus();
    }

    // a non-barcode item with manually-entered macros
    function goCustom() {
      const oName = h('input', { type: 'text', placeholder: 'e.g. Grandma’s sauce' });
      const oBasis = h('select', {}, [h('option', { value: '100', text: 'per 100 g' }), h('option', { value: 'serving', text: 'per serving' })]);
      const oServing = h('input.num', { type: 'number', step: 'any', placeholder: 'serving size (g)' });
      const oFields = {};
      function macro(sKey, sLabel) {
        const oInput = h('input.num', { type: 'number', step: 'any', placeholder: '0' });
        oFields[sKey] = oInput;
        return h('label.field', { style: 'flex:1' }, [h('span.lbl', { text: sLabel }), oInput]);
      }
      function next() {
        if (!oName.value.trim()) { toast('Name the item'); return; }
        const fBasis = oBasis.value === 'serving' ? Number(oServing.value) : 100;
        if (!Number.isFinite(fBasis) || fBasis <= 0) { toast('Enter the serving size in grams'); return; }
        const oNut = {};
        for (const sKey of Object.keys(oFields)) {
          const fVal = Number(oFields[sKey].value);
          if (Number.isFinite(fVal) && fVal !== 0) oNut[sKey] = fVal * (100 / fBasis); // store per 100 g
        }
        goGrams({ name: oName.value.trim(), source: 'custom', baseUnit: 'g',
          servingSize: oBasis.value === 'serving' ? fBasis : null, nutrients: oNut });
      }
      mount(tBody, [
        backBtn(),
        h('label.field', {}, [h('span.lbl', { text: 'Name' }), oName]),
        h('div.inline-fields', {}, [
          h('label.field', { style: 'flex:1' }, [h('span.lbl', { text: 'Values are' }), oBasis]),
          h('label.field', { style: 'flex:1' }, [h('span.lbl', { text: 'Serving (g)' }), oServing]),
        ]),
        h('div.inline-fields', {}, [macro('energy_kcal', 'Calories'), macro('protein_g', 'Protein g')]),
        h('div.inline-fields', {}, [macro('carbs_g', 'Carbs g'), macro('fat_g', 'Fat g')]),
        h('div.inline-fields', {}, [macro('fiber_g', 'Fiber g'), macro('sugar_g', 'Sugar g')]),
        h('button.btn.btn-block', { type: 'button', text: 'Continue', onclick: next, style: 'margin-top:6px' }),
      ]);
      oName.focus();
    }

    goSearch();
  });
}

function resultRow(sName, sBrand, sSrc, tOnClick) {
  return h('div.result', { onclick: tOnClick }, [
    h('div', {}, [h('div.nm', { text: sName }), sBrand ? h('div.br', { text: sBrand }) : null]),
    h('div.src', { text: sSrc }),
  ]);
}

function chip(sLabel, sValue) {
  return h('div', {}, [
    h('div.faint', { style: 'font-size:11px;text-transform:uppercase;letter-spacing:.04em', text: sLabel }),
    h('div.num', { style: 'font-size:17px', text: sValue }),
  ]);
}

function totalsOf(oDraft) {
  const oTotals = {};
  let fWeight = 0;
  for (const oIng of oDraft.ingredients) {
    const fG = Number(oIng.grams) || 0;
    fWeight += fG;
    for (const sKey of Object.keys(oIng.nutrients || {})) {
      oTotals[sKey] = (oTotals[sKey] || 0) + Number(oIng.nutrients[sKey]) * fG / 100;
    }
  }
  return { totals: oTotals, weight: fWeight };
}

// Recover per-100 amounts from a saved ingredient's contribution (amount × g/100).
function per100From(oContribution, fGrams) {
  const oOut = {};
  const fG = Number(fGrams) || 0;
  if (fG > 0) for (const sKey of Object.keys(oContribution || {})) oOut[sKey] = Number(oContribution[sKey]) * 100 / fG;
  return oOut;
}
