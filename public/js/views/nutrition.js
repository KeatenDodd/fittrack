'use strict';
import { api } from '../api.js';
import { h, mount, num, toast, openSheet, confirmAction, guard, todayISO } from '../ui.js';
import { nutrientCatalog, factsList } from './foodfacts.js';

const MEALS = ['breakfast', 'lunch', 'dinner', 'snack'];
const MACROS = [
  { key: 'protein_g', label: 'Protein', unit: 'g' },
  { key: 'carbs_g', label: 'Carbs', unit: 'g' },
  { key: 'fat_g', label: 'Fat', unit: 'g' },
  { key: 'fiber_g', label: 'Fiber', unit: 'g' },
];

function shiftDate(sIso, iDays) {
  const [iY, iM, iD] = sIso.split('-').map(Number);
  const oDate = new Date(iY, iM - 1, iD + iDays); // local arithmetic
  return oDate.getFullYear() + '-'
    + String(oDate.getMonth() + 1).padStart(2, '0') + '-'
    + String(oDate.getDate()).padStart(2, '0');
}
function prettyDate(sIso) {
  const sToday = todayISO();
  if (sIso === sToday) return 'Today';
  if (sIso === shiftDate(sToday, -1)) return 'Yesterday';
  return new Date(sIso + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

export async function render(tRoot, tArgs, tCtx) {
  let sDate = /^\d{4}-\d{2}-\d{2}$/.test(tArgs[0] || '') ? tArgs[0] : todayISO();
  let isMicroOpen = false;

  async function paint() {
    mount(tRoot, h('div.empty', { text: 'Loading…' }));
    const [oLog, oSummary] = await Promise.all([api.foodLog(sDate), api.summary(sDate)]);

    const oByKey = {};
    for (const oRow of oSummary.totals) oByKey[oRow.key] = oRow;
    const oKcal = oByKey.energy_kcal || { total: 0, goal: null };

    const oMealRoot = h('div');
    paintMeals(oMealRoot, oLog.entries);

    function paintMeals(tEl, oEntries) {
      const oByMeal = {};
      for (const sMeal of MEALS) oByMeal[sMeal] = [];
      for (const oEntry of oEntries) (oByMeal[oEntry.meal_type] || oByMeal.snack).push(oEntry);

      mount(tEl, MEALS.map((sMeal) => {
        const oItems = oByMeal[sMeal];
        const fMealKcal = oItems.reduce((fSum, oE) => fSum + (oE.nutrients.energy_kcal || 0), 0);
        return h('div', {}, [
          h('div.meal-head', {}, [
            h('span.name', { text: sMeal }),
            h('span', {}, [h('span.kcal.num', { text: num(fMealKcal) }), h('span.faint', { text: ' kcal' })]),
          ]),
          h('div.card.tight', {}, [
            ...oItems.map((oEntry) => h('div.row', {}, [
              h('div', { style: 'flex:1' }, [
                h('div.label', { text: oEntry.name }),
                h('div.sub', {}, [h('span.num', { text: num(oEntry.quantity) }), ' ' + oEntry.unit + ' · ',
                  h('span.num', { text: num(oEntry.nutrients.energy_kcal) }), ' kcal']),
              ]),
              h('button.icon-btn', { type: 'button', text: '\u00d7',
                onclick: async () => { await guard(api.deleteLog(oEntry.id)); paint(); } }),
            ])),
            h('div.row.list-link', { onclick: () => openAddFood(sMeal, sDate, paint) }, [
              h('span.faint', { text: '+ Add food' }),
            ]),
          ]),
        ]);
      }));
    }

    let oMicroEl = null;
    function microRoot() { oMicroEl = h('div'); paintMicros(); return oMicroEl; }
    function paintMicros() {
      if (!oMicroEl) return;
      if (!isMicroOpen) { mount(oMicroEl, null); return; }
      const oMicros = oSummary.totals.filter((oR) => oR.category !== 'macro' && oR.category !== 'energy');
      mount(oMicroEl, h('div', { style: 'margin-top:12px;border-top:1px solid var(--line);padding-top:10px' },
        oMicros.length ? oMicros.map((oR) => h('div', { style: 'display:flex;justify-content:space-between;padding:4px 0;font-size:13px' }, [
          h('span.muted', { text: oR.name }),
          h('span.num', {}, [num(oR.total, 1) + ' ' + oR.unit, oR.goal ? h('span.faint', { text: ' / ' + num(oR.goal) }) : null]),
        ])) : h('p.faint', { style: 'font-size:13px', text: 'No micronutrient data for the foods logged.' })));
    }

    mount(tRoot, [
      h('div.page-head', { style: 'display:flex;justify-content:space-between;align-items:center' }, [
        h('div', {}, [h('div.eyebrow', { text: 'Nutrition' }), h('h1', { text: prettyDate(sDate) })]),
        h('div.btn-row', {}, [
          h('button.btn.btn-ghost.btn-sm', { type: 'button', text: '🍲 Recipes', onclick: () => tCtx.navigate('/recipes') }),
          h('button.btn.btn-ghost.btn-sm', { type: 'button', text: '‹', onclick: () => { sDate = shiftDate(sDate, -1); isMicroOpen = false; paint(); } }),
          h('button.btn.btn-ghost.btn-sm', { type: 'button', text: '›', onclick: () => { sDate = shiftDate(sDate, 1); isMicroOpen = false; paint(); } }),
        ]),
      ]),

      // totals — calorie ring + macro bars (actual vs goal)
      h('div.card', {}, [
        h('div.intake-top', {}, [
          kcalRing(oKcal.total, oKcal.goal),
          h('div.intake-side', {}, [
            oKcal.goal != null
              ? (() => { const fLeft = Number(oKcal.goal) - Number(oKcal.total);
                  return h('div.intake-rem' + (fLeft < 0 ? '.over' : ''), {}, [
                    h('span.num', { text: num(Math.abs(fLeft)) }),
                    ' kcal ' + (fLeft < 0 ? 'over' : 'left'),
                  ]); })()
              : h('button.btn.btn-ghost.btn-sm', { type: 'button', text: 'Set a goal', onclick: () => openGoals(paint) }),
            ...MACROS.map((tM) => {
              const oRow = oByKey[tM.key] || { total: 0, goal: null };
              const fT = Number(oRow.total) || 0;
              const fG = oRow.goal != null ? Number(oRow.goal) : null;
              const fPct = fG > 0 ? (fT / fG) * 100 : 0;
              return h('div.mbar', {}, [
                h('div.mbar-head', {}, [
                  h('span.k', { text: tM.label }),
                  h('span.v.num', {}, [num(fT), tM.unit,
                    fG != null ? h('small', { text: ' / ' + num(fG) + tM.unit }) : null]),
                ]),
                h('div.bar' + (fPct > 100 ? '.over' : ''), {}, [h('span', { style: 'width:' + Math.min(fPct, 100) + '%' })]),
              ]);
            }),
          ]),
        ]),
        h('div', { style: 'margin-top:14px;display:flex;justify-content:space-between;align-items:center' }, [
          h('button', { type: 'button', text: isMicroOpen ? 'Hide micronutrients' : 'Show micronutrients',
            style: 'background:none;border:0;color:var(--accent);cursor:pointer;font-size:13px;padding:0',
            onclick: () => { isMicroOpen = !isMicroOpen; paintMicros(); } }),
          h('button', { type: 'button', text: 'Edit goals',
            style: 'background:none;border:0;color:var(--faint);cursor:pointer;font-size:13px;padding:0', onclick: () => openGoals(paint) }),
        ]),
        microRoot(),
      ]),

      oMealRoot,
    ]);
  }

  await paint();
}

function bar(tValue, tGoal) {
  const fPct = tGoal > 0 ? (tValue / tGoal) * 100 : 0;
  return h('div.bar' + (fPct > 100 ? '.over' : ''), {}, [h('span', { style: 'width:' + Math.min(fPct, 100) + '%' })]);
}

// SVG progress ring for calories, with the consumed number in the centre.
function kcalRing(fTotal, fGoal) {
  const NS = 'http://www.w3.org/2000/svg';
  const iR = 52, iCx = 60, iCy = 60, fCirc = 2 * Math.PI * iR;
  const fHas = fGoal != null && Number(fGoal) > 0;
  const fPct = fHas ? Math.min(Number(fTotal) / Number(fGoal), 1) : 0;
  const bOver = fHas && Number(fTotal) > Number(fGoal);

  const set = (oEl, oAttrs) => { for (const k of Object.keys(oAttrs)) oEl.setAttribute(k, oAttrs[k]); return oEl; };
  const make = (sTag, oAttrs) => set(document.createElementNS(NS, sTag), oAttrs);

  const oSvg = make('svg', { viewBox: '0 0 120 120', class: 'kcal-ring' });
  oSvg.appendChild(make('circle', { cx: iCx, cy: iCy, r: iR, fill: 'none', stroke: 'var(--line)', 'stroke-width': 10 }));
  oSvg.appendChild(make('circle', {
    cx: iCx, cy: iCy, r: iR, fill: 'none', 'stroke-width': 10, 'stroke-linecap': 'round',
    stroke: bOver ? 'var(--warn)' : 'var(--accent)',
    'stroke-dasharray': fCirc, 'stroke-dashoffset': fCirc * (1 - fPct),
    transform: 'rotate(-90 ' + iCx + ' ' + iCy + ')',
  }));
  const oBig = make('text', { x: iCx, y: 56, 'text-anchor': 'middle', class: 'rk-big' });
  oBig.textContent = num(fTotal);
  const oSmall = make('text', { x: iCx, y: 74, 'text-anchor': 'middle', class: 'rk-small' });
  oSmall.textContent = fHas ? '/ ' + num(fGoal) : 'kcal';
  oSvg.appendChild(oBig); oSvg.appendChild(oSmall);
  return oSvg;
}

// ---- add food flow -----------------------------------------------------------
// Everything lives in ONE bottom sheet (search ⇄ scanner ⇄ custom ⇄ quantity),
// because the app has a single modal root — opening a nested sheet would detach
// this one and the "Log food" step would render into nothing.
function openAddFood(sMeal, sDate, tOnDone) {
  let oActiveScanner = null;
  async function stopScanner() {
    const oScanner = oActiveScanner;
    oActiveScanner = null;
    if (oScanner) {
      try { await oScanner.stop(); } catch (tErr) { /* ignore */ }
      try { oScanner.clear(); } catch (tErr) { /* ignore */ }
    }
  }

  openSheet('Add to ' + sMeal, (tBody, tClose) => {
    function backBtn() {
      return h('button', { type: 'button', text: '‹ Back to search', onclick: goSearch,
        style: 'background:none;border:0;color:var(--accent);cursor:pointer;padding:0;margin-bottom:10px;font-size:13px' });
    }

    // step: pick an amount + meal, then log (persisting an OFF/custom food first)
    function goQuantity(tFood) {
      stopScanner();
      mount(tBody, [renderQuantity(tFood, sMeal, sDate, tClose, tOnDone, goSearch)]);
    }

    // step: search local + Open Food Facts
    function goSearch() {
      stopScanner();
      const oSearch = h('input', { type: 'search', placeholder: 'Search foods…' });
      const oResults = h('div', { style: 'max-height:42vh;overflow-y:auto' });
      const oActions = h('div.btn-row', { style: 'margin:12px 0' }, [
        h('button.btn.btn-ghost.btn-sm', { type: 'button', text: '📷 Scan barcode', onclick: goScanner }),
        h('button.btn.btn-ghost.btn-sm', { type: 'button', text: '🍲 Recipes', onclick: goRecipes }),
        h('button.btn.btn-ghost.btn-sm', { type: 'button', text: '+ Custom food', onclick: goCustom }),
      ]);
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
        const oRows = [];
        for (const oLocal of oData.local) {
          oRows.push(resultRow(oLocal.name, oLocal.brand, 'saved',
            async () => { const oD = await guard(api.food(oLocal.id)); goQuantity(oD.food); }));
        }
        for (const oRemote of oData.remote) {
          oRows.push(resultRow(oRemote.name, oRemote.brand, 'open food facts', () => goQuantity(oRemote)));
        }
        mount(oResults, oRows.length ? oRows : h('p.muted', { style: 'padding:10px 4px', text: 'No matches found.' }));
      }
      mount(tBody, [oSearch, oActions, oResults]);
      oSearch.focus();
    }

    // step: scan a barcode
    function goScanner() {
      stopScanner();
      const oHint = h('p.faint', { style: 'font-size:13px', text: 'Point your camera at a product barcode.' });
      let isHandling = false;

      // Shared lookup — used by both the camera and the manual entry below.
      async function lookup(sCode) {
        if (isHandling) return;
        isHandling = true;
        oHint.textContent = 'Looking up ' + sCode + '…';
        try {
          const oData = await api.foodByBarcode(sCode);
          goQuantity(oData.food);          // stops the camera + shows the Log step
        } catch (tErr) {
          oHint.textContent = (tErr.message || 'No product found') + ' — try again, or use search / custom food.';
          isHandling = false;              // keep scanning / let them retry
        }
      }

      // Manual barcode entry: works when the camera can't read the code or isn't available.
      const oManual = h('input', { type: 'text', inputmode: 'numeric', placeholder: 'or type the barcode digits' });
      const oManualRow = h('div.inline-fields', { style: 'margin-top:10px' }, [
        h('div', { style: 'flex:1' }, [oManual]),
        h('button.btn.btn-sm', { type: 'button', text: 'Look up', style: 'flex:0 0 auto',
          onclick: () => { const s = oManual.value.replace(/\D/g, ''); if (!s) { toast('Enter a barcode'); return; } lookup(s); } }),
      ]);
      oManual.addEventListener('keydown', (tEvent) => { if (tEvent.key === 'Enter') { const s = oManual.value.replace(/\D/g, ''); if (s) lookup(s); } });

      const bCanScan = !!window.Html5Qrcode && window.isSecureContext;
      const oReader = h('div', { id: 'bc-reader', style: 'width:100%' });
      mount(tBody, [
        backBtn(),
        bCanScan ? oReader : h('p.muted', { style: 'font-size:13px', text:
          !window.isSecureContext
            ? 'Camera needs HTTPS — open the app over https:// (the mkcert certificate). You can still type the barcode below.'
            : 'Scanner library not loaded (needs internet for the CDN). You can still type the barcode below.' }),
        oHint,
        oManualRow,
      ]);

      if (bCanScan) {
        const oScanner = new window.Html5Qrcode('bc-reader');
        oActiveScanner = oScanner;
        const oCfg = { fps: 10, qrbox: { width: 250, height: 160 } };
        oScanner.start({ facingMode: 'environment' }, oCfg, (s) => lookup(s), () => {})
          .catch((tErr) => {
            oActiveScanner = null;
            oHint.textContent = 'Could not start the camera (' + tErr + '). Type the barcode above instead.';
          });
      } else {
        setTimeout(() => oManual.focus(), 50);
      }
    }

    // step: pick one of the user's recipes to log (its derived food)
    function goRecipes() {
      stopScanner();
      const oList = h('div', { style: 'max-height:48vh;overflow-y:auto' }, [h('p.muted', { style: 'padding:10px 4px', text: 'Loading…' })]);
      mount(tBody, [backBtn(), oList]);
      api.recipes().then((oData) => {
        const aRecipes = oData.recipes || [];
        if (!aRecipes.length) {
          mount(oList, h('p.muted', { style: 'padding:10px 4px' }, [
            'No recipes yet. ', h('a', { href: '#/recipes', text: 'Create one', style: 'color:var(--accent)' }), '.']));
          return;
        }
        mount(oList, aRecipes.map((oR) => {
          const oPS = oR.perServing || {};
          return h('div.result', { onclick: async () => {
            const oD = await guard(api.food(oR.foodId)); goQuantity(oD.food);
          } }, [
            h('div', {}, [h('div.nm', { text: oR.name }),
              h('div.br', { text: num(oPS.energy_kcal || 0) + ' kcal · ' + num(oR.servings) + (Number(oR.servings) === 1 ? ' serving' : ' servings') })]),
            h('div.src', { text: 'recipe' }),
          ]);
        }));
      }).catch(() => mount(oList, h('p.muted', { style: 'padding:10px 4px', text: 'Could not load recipes.' })));
    }

    // step: enter a custom food, then go to quantity
    function goCustom() {
      stopScanner();
      const oName = h('input', { type: 'text', placeholder: 'e.g. Homemade granola' });
      const oBasis = h('select', {}, [h('option', { value: '100', text: 'per 100 g' }), h('option', { value: 'serving', text: 'per serving' })]);
      const oServing = h('input.num', { type: 'number', step: 'any', placeholder: 'serving size (g)' });
      const oFields = {};
      function macro(sKey, sLabel) {
        const oInput = h('input.num', { type: 'number', step: 'any', placeholder: '0' });
        oFields[sKey] = oInput;
        return h('label.field', { style: 'flex:1' }, [h('span.lbl', { text: sLabel }), oInput]);
      }
      function next() {
        if (!oName.value.trim()) { toast('Name the food'); return; }
        const fBasis = oBasis.value === 'serving' ? Number(oServing.value) : 100;
        if (!Number.isFinite(fBasis) || fBasis <= 0) { toast('Enter the serving size in grams'); return; }
        const oNut = {};
        for (const sKey of Object.keys(oFields)) {
          const fVal = Number(oFields[sKey].value);
          if (Number.isFinite(fVal) && fVal !== 0) oNut[sKey] = fVal * (100 / fBasis); // store per 100g
        }
        goQuantity({
          name: oName.value.trim(), source: 'custom', baseUnit: 'g',
          servingSize: oBasis.value === 'serving' ? fBasis : null, nutrients: oNut,
        });
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
        h('div.inline-fields', {}, [macro('sugar_g', 'Sugar g'), macro('sodium_mg', 'Sodium mg')]),
        h('button.btn.btn-block', { type: 'button', text: 'Continue', onclick: next, style: 'margin-top:6px' }),
      ]);
      oName.focus();
    }

    goSearch();
  }, stopScanner);
}

function resultRow(sName, sBrand, sSrc, tOnClick) {
  return h('div.result', { onclick: tOnClick }, [
    h('div', {}, [h('div.nm', { text: sName }), sBrand ? h('div.br', { text: sBrand }) : null]),
    h('div.src', { text: sSrc }),
  ]);
}

function renderQuantity(tFood, sMeal, sDate, tClose, tOnDone, tBack) {
  const hasServing = Number(tFood.serving_size || tFood.servingSize) > 0;
  const fServing = Number(tFood.serving_size || tFood.servingSize) || 0;
  const oQty = h('input.num', { type: 'number', inputmode: 'decimal', step: 'any', value: hasServing ? fServing : 100 });
  const oMeal = h('select', {}, MEALS.map((s) => h('option', { value: s, text: s, selected: s === sMeal })));

  async function log() {
    const fQty = Number(oQty.value);
    if (!Number.isFinite(fQty) || fQty <= 0) { toast('Enter an amount'); return; }
    // ensure the food exists server-side; saved foods carry an id
    let iFoodId = tFood.id;
    if (!iFoodId) {
      const oSaved = await guard(api.saveFood(normalizeFood(tFood)));
      iFoodId = oSaved.food.id;
    }
    await guard(api.logFood({ foodId: iFoodId, mealType: oMeal.value, quantity: fQty, unit: 'g' }));
    toast('Logged');
    tClose();
    tOnDone();
  }

  const oNut = tFood.nutrients || {};
  const fKcalPer100 = Number(oNut.energy_kcal || 0);

  // Live nutrition facts that recompute as the grams change.
  const FACTS = [
    { key: 'energy_kcal', label: 'Calories', unit: '', dp: 0 },
    { key: 'protein_g', label: 'Protein', unit: 'g', dp: 1 },
    { key: 'carbs_g', label: 'Carbs', unit: 'g', dp: 1 },
    { key: 'fat_g', label: 'Fat', unit: 'g', dp: 1 },
  ];
  const oFacts = h('div.macro-grid', { style: 'margin-top:12px' });
  function paintFacts() {
    const fGrams = Number(oQty.value) || 0;
    const fFactor = fGrams / 100;
    mount(oFacts, FACTS.map((oF) => h('div.macro', {}, [
      h('div.k', { text: oF.label }),
      h('div.v', {}, [h('span.num', { text: num((Number(oNut[oF.key]) || 0) * fFactor, oF.dp) }),
        oF.unit ? (' ' + oF.unit) : '']),
    ])));
  }
  oQty.addEventListener('input', paintFacts);
  function setQty(fVal) { oQty.value = fVal; paintFacts(); }
  paintFacts();

  return h('div', {}, [
    h('button', { type: 'button', text: '‹ Back to search', style: 'background:none;border:0;color:var(--accent);cursor:pointer;padding:0;margin-bottom:10px;font-size:13px', onclick: tBack }),
    h('div.card', {}, [
      h('strong', { text: tFood.name }),
      tFood.brand ? h('div.faint', { text: tFood.brand }) : null,
      h('div.faint', { style: 'font-size:12.5px;margin-top:4px', text: num(fKcalPer100) + ' kcal per 100 g' }),
    ]),
    h('div.inline-fields', {}, [
      h('label.field', { style: 'flex:1' }, [h('span.lbl', { text: 'Amount (grams)' }), oQty]),
      h('label.field', { style: 'flex:1' }, [h('span.lbl', { text: 'Meal' }), oMeal]),
    ]),
    h('div.btn-row', { style: 'margin:10px 0 4px' }, [
      hasServing ? h('button.btn.btn-ghost.btn-sm', { type: 'button', text: '1 serving (' + num(fServing) + ' g)', onclick: () => setQty(fServing) }) : null,
      h('button.btn.btn-ghost.btn-sm', { type: 'button', text: '100 g', onclick: () => setQty(100) }),
      h('button.btn.btn-ghost.btn-sm', { type: 'button', text: '50 g', onclick: () => setQty(50) }),
    ]),
    h('div.card', { style: 'margin-bottom:14px' }, [
      h('div.faint', { style: 'font-size:12px;margin-bottom:2px', text: 'In this amount' }),
      oFacts,
      fullFacts(tFood, oQty),
    ]),
    h('button.btn.btn-block', { type: 'button', text: 'Log food', onclick: log }),
  ]);
}

// "Dive deeper" — an expander showing every macro + micro for the current
// amount, recomputed from the per-100 nutrients via the nutrient catalog.
function fullFacts(tFood, oQty) {
  const oWrap = h('div', { style: 'margin-top:8px' });
  let bOpen = false;
  let oCatalog = null;
  const oBtn = h('button', { type: 'button', text: 'Show full nutrition facts',
    style: 'background:none;border:0;color:var(--accent);cursor:pointer;padding:0;font-size:13px',
    onclick: async () => {
      bOpen = !bOpen;
      oBtn.textContent = bOpen ? 'Hide full nutrition facts' : 'Show full nutrition facts';
      if (!bOpen) { mount(oWrap, null); return; }
      if (!oCatalog) oCatalog = await nutrientCatalog();
      mount(oWrap, factsList(tFood, Number(oQty.value) || 0, oCatalog));
    } });
  // keep the open breakdown in sync as the amount changes
  oQty.addEventListener('input', () => {
    if (bOpen && oCatalog) mount(oWrap, factsList(tFood, Number(oQty.value) || 0, oCatalog));
  });
  return h('div', {}, [oBtn, oWrap]);
}

export function normalizeFood(tFood) {
  return {
    name: tFood.name, brand: tFood.brand || null, barcode: tFood.barcode || null,
    source: tFood.source || 'off', sourceRef: tFood.sourceRef || tFood.barcode || null,
    baseUnit: tFood.baseUnit || tFood.base_unit || 'g',
    servingSize: tFood.servingSize || tFood.serving_size || null,
    servingDesc: tFood.servingDesc || tFood.serving_desc || null,
    nutrients: tFood.nutrients || {},
  };
}

// ---- goals -------------------------------------------------------------------
// Activity multipliers and goal presets for the macro calculator. Protein is in
// grams per kg of bodyweight; calorie factor is applied to maintenance (TDEE).
const ACTIVITY = [
  { v: 1.2, label: 'Sedentary — desk job, little exercise' },
  { v: 1.375, label: 'Light — train 1–3 days/week' },
  { v: 1.55, label: 'Moderate — train 3–5 days/week' },
  { v: 1.725, label: 'Very active — train 6–7 days/week' },
  { v: 1.9, label: 'Athlete — hard training 2×/day' },
];
const GOAL_PRESETS = [
  { key: 'gain', label: 'Gain muscle (lean bulk)', kcalFactor: 1.10, proteinPerKg: 2.0,
    blurb: '~10% surplus, high protein to build with minimal fat gain.' },
  { key: 'recomp', label: 'Maintain / recomp', kcalFactor: 1.0, proteinPerKg: 1.8,
    blurb: 'Eat at maintenance; build slowly while staying lean.' },
  { key: 'cut', label: 'Lose fat (cut)', kcalFactor: 0.80, proteinPerKg: 2.4,
    blurb: '~20% deficit, very high protein to preserve muscle.' },
];
const CALC_KEY = 'fittrack.macroCalc';
function loadCalcPrefs() { try { return JSON.parse(localStorage.getItem(CALC_KEY)) || {}; } catch (e) { return {}; } }
function saveCalcPrefs(o) { try { localStorage.setItem(CALC_KEY, JSON.stringify(o)); } catch (e) { /* ignore */ } }

// Mifflin-St Jeor BMR -> TDEE -> goal-adjusted calories, then macros.
// protein from g/kg, fat at 25% of calories, carbs fill the remainder,
// fiber at ~14 g per 1000 kcal (Institute of Medicine guidance).
function computeMacros(oIn, oPreset) {
  const fKg = oIn.kg, fCm = oIn.cm, iAge = oIn.age;
  const fBmr = 10 * fKg + 6.25 * fCm - 5 * iAge + (oIn.sex === 'female' ? -161 : 5);
  const fTdee = fBmr * oIn.activity;
  let fKcal = fTdee * oPreset.kcalFactor;
  if (fKcal < fBmr) fKcal = fBmr; // never prescribe below BMR
  fKcal = Math.round(fKcal / 10) * 10;
  const iProtein = Math.round(oPreset.proteinPerKg * fKg);
  const iFat = Math.round((0.25 * fKcal) / 9);
  const iCarbs = Math.max(0, Math.round((fKcal - iProtein * 4 - iFat * 9) / 4));
  const iFiber = Math.round((fKcal / 1000) * 14);
  return {
    tdee: Math.round(fTdee),
    energy_kcal: fKcal, protein_g: iProtein, carbs_g: iCarbs, fat_g: iFat, fiber_g: iFiber,
  };
}

function openGoals(tOnDone) {
  openSheet('Daily goals', async (tBody, tClose) => {
    mount(tBody, h('p.muted', { text: 'Loading…' }));
    const [oGoalsRes, oOverview] = await Promise.all([
      api.goals(), api.overview().catch(() => ({ latestWeight: null })),
    ]);
    const oGoals = oGoalsRes.goals;
    const oLatest = oOverview.latestWeight; // { weight, unit } or null

    // ---- step: manual goal form (optionally pre-filled by the calculator) ----
    function goForm(oPrefill, sBasis) {
      const oVals = Object.assign({}, oGoals, oPrefill || {});
      const oFields = {};
      function row(sKey, sLabel, sUnit) {
        const oInput = h('input.num', { type: 'number', step: 'any', value: oVals[sKey] != null ? oVals[sKey] : '' });
        oFields[sKey] = oInput;
        return h('label.field', { style: 'flex:1' }, [h('span.lbl', { text: sLabel + (sUnit ? ' (' + sUnit + ')' : '') }), oInput]);
      }
      async function save() {
        const oOut = {};
        for (const sKey of Object.keys(oFields)) {
          const fVal = Number(oFields[sKey].value);
          if (Number.isFinite(fVal) && oFields[sKey].value !== '') oOut[sKey] = fVal;
        }
        await guard(api.setGoals(oOut));
        toast('Goals saved'); tClose(); tOnDone();
      }
      mount(tBody, [
        h('button.btn.btn-ghost.btn-block', { type: 'button', text: '✨ Auto-calculate from a goal',
          onclick: goCalc, style: 'margin-bottom:14px' }),
        sBasis ? h('p.faint', { style: 'font-size:12.5px;margin:-6px 0 12px', text: sBasis }) : null,
        h('div.inline-fields', {}, [row('energy_kcal', 'Calories', 'kcal'), row('protein_g', 'Protein', 'g')]),
        h('div.inline-fields', {}, [row('carbs_g', 'Carbs', 'g'), row('fat_g', 'Fat', 'g')]),
        h('div.inline-fields', {}, [row('fiber_g', 'Fiber', 'g'), row('sodium_mg', 'Sodium', 'mg')]),
        h('button.btn.btn-block', { type: 'button', text: 'Save goals', onclick: save, style: 'margin-top:6px' }),
      ]);
    }

    // ---- step: the calculator ----
    function goCalc() {
      const oP = loadCalcPrefs();
      // prefill weight in lb from the latest logged body weight
      let fLbPrefill = oP.lb;
      if (fLbPrefill == null && oLatest && oLatest.weight != null) {
        fLbPrefill = oLatest.unit === 'kg' ? Math.round(Number(oLatest.weight) * 2.2046) : Number(oLatest.weight);
      }

      const oSex = h('select', {}, [['male', 'Male'], ['female', 'Female']].map(([v, t]) =>
        h('option', { value: v, text: t, selected: (oP.sex || 'male') === v })));
      const oAge = h('input.num', { type: 'number', inputmode: 'numeric', placeholder: 'years', value: oP.age != null ? oP.age : '' });
      const oFt = h('input.num', { type: 'number', inputmode: 'numeric', placeholder: 'ft', value: oP.ft != null ? oP.ft : '' });
      const oIn = h('input.num', { type: 'number', inputmode: 'numeric', placeholder: 'in', value: oP.in != null ? oP.in : '' });
      const oLb = h('input.num', { type: 'number', inputmode: 'decimal', step: 'any', placeholder: 'lb', value: fLbPrefill != null ? fLbPrefill : '' });
      const oAct = h('select', {}, ACTIVITY.map((a) =>
        h('option', { value: a.v, text: a.label, selected: Number(oP.activity || 1.55) === a.v })));
      const oGoal = h('select', {}, GOAL_PRESETS.map((g) =>
        h('option', { value: g.key, text: g.label, selected: (oP.goal || 'gain') === g.key })));

      const oBlurb = h('p.faint', { style: 'font-size:12.5px;margin:2px 0 10px' });
      function paintBlurb() {
        const oPreset = GOAL_PRESETS.find((g) => g.key === oGoal.value) || GOAL_PRESETS[0];
        oBlurb.textContent = oPreset.blurb;
      }
      oGoal.addEventListener('change', paintBlurb); paintBlurb();

      function calculate() {
        const iAge = parseInt(oAge.value, 10);
        const fLb = Number(oLb.value);
        const iFt = parseInt(oFt.value, 10) || 0;
        const iInch = parseInt(oIn.value, 10) || 0;
        const fCm = (iFt * 12 + iInch) * 2.54;
        if (!iAge || iAge < 12 || iAge > 100) { toast('Enter a valid age'); return; }
        if (!fLb || fLb <= 0) { toast('Enter your weight in lb'); return; }
        if (fCm <= 0) { toast('Enter your height'); return; }
        const oPreset = GOAL_PRESETS.find((g) => g.key === oGoal.value) || GOAL_PRESETS[0];
        const oRes = computeMacros(
          { kg: fLb / 2.2046, cm: fCm, age: iAge, sex: oSex.value, activity: Number(oAct.value) }, oPreset);
        saveCalcPrefs({ sex: oSex.value, age: iAge, ft: iFt, in: iInch, lb: fLb, activity: Number(oAct.value), goal: oGoal.value });
        const sBasis = oPreset.label + ' · maintenance ≈ ' + oRes.tdee + ' kcal → target '
          + oRes.energy_kcal + ' kcal. Review and Save below.';
        goForm({ energy_kcal: oRes.energy_kcal, protein_g: oRes.protein_g, carbs_g: oRes.carbs_g,
          fat_g: oRes.fat_g, fiber_g: oRes.fiber_g }, sBasis);
      }

      mount(tBody, [
        h('button', { type: 'button', text: '‹ Back to goals', onclick: () => goForm(),
          style: 'background:none;border:0;color:var(--accent);cursor:pointer;padding:0;margin-bottom:10px;font-size:13px' }),
        h('div.inline-fields', {}, [
          h('label.field', { style: 'flex:1' }, [h('span.lbl', { text: 'Sex' }), oSex]),
          h('label.field', { style: 'flex:1' }, [h('span.lbl', { text: 'Age' }), oAge]),
        ]),
        h('div.inline-fields', {}, [
          h('label.field', { style: 'flex:1' }, [h('span.lbl', { text: 'Height' }), h('div.inline-fields', {}, [oFt, oIn])]),
          h('label.field', { style: 'flex:1' }, [h('span.lbl', { text: 'Weight (lb)' }), oLb]),
        ]),
        h('label.field', {}, [h('span.lbl', { text: 'Activity level' }), oAct]),
        h('label.field', {}, [h('span.lbl', { text: 'Goal' }), oGoal]),
        oBlurb,
        h('button.btn.btn-accent.btn-block', { type: 'button', text: 'Calculate macros', onclick: calculate }),
      ]);
    }

    goForm();
  });
}
