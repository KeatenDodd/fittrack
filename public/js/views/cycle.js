'use strict';
import { api } from '../api.js';
import { oStore } from '../store.js';
import { h, mount, toast, guard, openSheet, todayISO } from '../ui.js';

const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const FLOWS = ['spotting', 'light', 'medium', 'heavy'];
const SYMPTOMS = ['cramps', 'headache', 'bloating', 'fatigue', 'backache', 'nausea', 'tender breasts', 'acne', 'cravings'];
const MOODS = ['great', 'good', 'okay', 'low', 'irritable', 'anxious'];
const PHASE_LABEL = { menstrual: 'Menstrual', follicular: 'Follicular', fertile: 'Fertile window', ovulation: 'Ovulation', luteal: 'Luteal' };

// date-only helpers (UTC, matching the server's prediction math)
function pad(n) { return String(n).padStart(2, '0'); }
function toDate(s) { const a = s.split('-').map(Number); return new Date(Date.UTC(a[0], a[1] - 1, a[2])); }
function toIso(dt) { return dt.toISOString().slice(0, 10); }
function addDays(s, n) { const dt = toDate(s); dt.setUTCDate(dt.getUTCDate() + n); return toIso(dt); }
function diffDays(a, b) { return Math.round((toDate(b) - toDate(a)) / 86400000); }
function prettyDate(s) { return toDate(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }); }

export async function render(tRoot, tArgs, tCtx) {
  const oUser = oStore.user || {};
  if (oUser.sex !== 'female') {
    mount(tRoot, [
      h('div.page-head', {}, [h('div.eyebrow', { text: 'Health' }), h('h1', { text: 'Cycle' })]),
      h('div.empty', {}, [
        h('p', { text: 'Cycle tracking is available for profiles set to Female. You can change this in Settings.' }),
        h('a.btn.btn-ghost', { href: '#/settings', text: 'Open Settings' }),
      ]),
    ]);
    return;
  }

  mount(tRoot, h('div.empty', { text: 'Loading…' }));
  let oData = await api.cycle();
  let oLogByDate = {};
  let oPred = new Set(), oFert = new Set(), oOvul = new Set();
  let sMonth = todayISO().slice(0, 7);

  function ingest(oNew) {
    oData = oNew;
    oLogByDate = {};
    for (const oL of oData.logs) oLogByDate[oL.date] = oL;
    oPred = new Set(); oFert = new Set(); oOvul = new Set();
    const oS = oData.stats;
    if (oS.hasData && oS.lastStart) {
      for (let k = 1; k <= 6; k += 1) {
        const sStart = addDays(oS.lastStart, oS.avgCycle * k);
        for (let i = 0; i < oS.avgPeriod; i += 1) oPred.add(addDays(sStart, i));
        const sOv = addDays(sStart, -14);
        oOvul.add(sOv);
        for (let i = -5; i <= 1; i += 1) oFert.add(addDays(sOv, i));
      }
    }
  }
  ingest(oData);

  function classify(sIso) {
    const oL = oLogByDate[sIso];
    if (oL && oL.flow) return { cls: 'period ' + oL.flow, dot: true };
    if (oPred.has(sIso)) return { cls: 'pred', dot: false };
    if (oOvul.has(sIso)) return { cls: 'ovul', dot: false };
    if (oFert.has(sIso)) return { cls: 'fertile', dot: false };
    if (oL) return { cls: 'logged', dot: true };
    return { cls: '', dot: false };
  }

  const oCalRoot = h('div');
  const oSummaryRoot = h('div');

  function paintAll() { paintSummary(); paintCalendar(); }

  function paintSummary() {
    const oS = oData.stats;
    const sToday = todayISO();
    let oHeadline;
    if (!oS.hasData) {
      oHeadline = h('div', {}, [
        h('div.cyc-phase', { text: 'No predictions yet' }),
        h('p.muted', { style: 'margin:4px 0 0', text: 'Log a few period days and FitTrack will predict your next period and fertile window.' }),
      ]);
    } else {
      const iToNext = diffDays(sToday, oS.predictedNext);
      const sWhen = iToNext === 0 ? 'today' : iToNext > 0 ? 'in ' + iToNext + (iToNext === 1 ? ' day' : ' days')
        : Math.abs(iToNext) + (iToNext === -1 ? ' day late' : ' days late');
      oHeadline = h('div', {}, [
        h('div.cyc-phase', { text: (oS.cycleDay ? 'Day ' + oS.cycleDay + ' · ' : '') + (PHASE_LABEL[oS.phase] || '') }),
        h('div', { style: 'margin-top:8px;display:flex;justify-content:space-between;align-items:baseline' }, [
          h('span.muted', { text: 'Next period' }),
          h('span', {}, [h('strong', { text: prettyDate(oS.predictedNext) }), h('span.faint', { text: ' · ' + sWhen })]),
        ]),
        h('div', { style: 'margin-top:4px;display:flex;justify-content:space-between;align-items:baseline' }, [
          h('span.muted', { text: 'Fertile window' }),
          h('span.faint', { text: prettyDate(oS.fertileStart) + ' – ' + prettyDate(oS.fertileEnd) }),
        ]),
        h('div.cyc-mini', { style: 'margin-top:12px' }, [
          h('div', {}, [h('span.num', { text: String(oS.avgCycle) }), h('small', { text: ' day cycle' })]),
          h('div', {}, [h('span.num', { text: String(oS.avgPeriod) }), h('small', { text: ' day period' })]),
        ]),
      ]);
    }
    mount(oSummaryRoot, h('div.card', {}, [
      oHeadline,
      h('div.btn-row', { style: 'margin-top:14px' }, [
        h('button.btn.btn-accent', { type: 'button', text: 'Log today', onclick: () => openLog(todayISO()) }),
        h('button.btn.btn-ghost', { type: 'button', text: 'Log a period', onclick: openPeriodRange }),
      ]),
    ]));
  }

  // ---- log a whole period as a start→end range ----
  function openPeriodRange() {
    const sToday = todayISO();
    openSheet('Log a period', (tBody, tClose) => {
      const oStart = h('input', { type: 'date', value: sToday, max: sToday });
      const oEnd = h('input', { type: 'date', value: sToday, max: sToday });
      const oFlow = h('select', {}, FLOWS.map((f) =>
        h('option', { value: f, text: f.charAt(0).toUpperCase() + f.slice(1), selected: f === 'medium' })));
      const oHint = h('p.faint', { style: 'font-size:12.5px;margin:2px 0 6px' });
      function paintHint() {
        if (oStart.value && oEnd.value && oEnd.value >= oStart.value) {
          const n = diffDays(oStart.value, oEnd.value) + 1;
          oHint.textContent = n + (n === 1 ? ' day will be marked.' : ' days will be marked as your period.');
        } else { oHint.textContent = 'Pick a start and end date.'; }
      }
      oStart.addEventListener('change', () => { if (oEnd.value < oStart.value) oEnd.value = oStart.value; paintHint(); });
      oEnd.addEventListener('change', paintHint);
      paintHint();

      async function save() {
        if (!oStart.value || !oEnd.value) { toast('Pick both dates'); return; }
        if (oEnd.value < oStart.value) { toast('End date is before start'); return; }
        const oResp = await guard(api.saveCyclePeriod({ start: oStart.value, end: oEnd.value, flow: oFlow.value }));
        ingest(oResp); paintAll(); tClose(); toast('Period logged');
      }

      mount(tBody, [
        h('div.inline-fields', {}, [
          h('label.field', { style: 'flex:1' }, [h('span.lbl', { text: 'Start date' }), oStart]),
          h('label.field', { style: 'flex:1' }, [h('span.lbl', { text: 'End date' }), oEnd]),
        ]),
        h('label.field', {}, [h('span.lbl', { text: 'Flow' }), oFlow]),
        oHint,
        h('button.btn.btn-accent.btn-block', { type: 'button', text: 'Log period', onclick: save }),
      ]);
    });
  }

  function paintCalendar() {
    const [iY, iM] = sMonth.split('-').map(Number);
    const iFirstWeekday = new Date(iY, iM - 1, 1).getDay();
    const iDaysInMonth = new Date(iY, iM, 0).getDate();
    const sToday = todayISO();

    const aCells = [];
    for (let i = 0; i < iFirstWeekday; i += 1) aCells.push(h('div.cyc-day.blank'));
    for (let d = 1; d <= iDaysInMonth; d += 1) {
      const sIso = iY + '-' + pad(iM) + '-' + pad(d);
      const oC = classify(sIso);
      const sCls = 'div.cyc-day' + (oC.cls ? '.' + oC.cls.split(' ').join('.') : '') + (sIso === sToday ? '.today' : '');
      aCells.push(h(sCls, { onclick: () => openLog(sIso) }, [
        h('span.cyc-n', { text: String(d) }),
        oC.dot ? h('span.cyc-dot') : null,
      ]));
    }

    mount(oCalRoot, h('div.card', {}, [
      h('div.cal-head', {}, [
        h('button.cal-nav', { type: 'button', text: '‹', onclick: () => { sMonth = shiftMonth(sMonth, -1); paintCalendar(); } }),
        h('div.cal-title', { text: MONTHS[iM - 1] + ' ' + iY }),
        h('button.cal-nav', { type: 'button', text: '›', onclick: () => { sMonth = shiftMonth(sMonth, 1); paintCalendar(); } }),
      ]),
      h('div.cal-grid', {}, DOW.map((s) => h('div.cal-dow', { text: s }))),
      h('div.cal-grid', {}, aCells),
      h('div.cyc-legend', {}, [
        legend('period', 'Period'), legend('pred', 'Predicted'),
        legend('fertile', 'Fertile'), legend('ovul', 'Ovulation'),
      ]),
    ]));
  }

  function legend(sCls, sLabel) {
    return h('span.cyc-leg', {}, [h('span.cyc-sw.' + sCls), sLabel]);
  }

  // ---- log sheet ----
  function openLog(sIso) {
    const oL = oLogByDate[sIso] || {};
    let sFlow = oL.flow || null;
    const oSel = new Set((oL.symptoms ? oL.symptoms.split(',') : []).map((s) => s.trim()).filter(Boolean));
    let sMood = oL.mood || '';

    openSheet(toDate(sIso).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }), (tBody, tClose) => {
      const oFlowRow = h('div.seg');
      function paintFlow() {
        mount(oFlowRow, [['none', 'None']].concat(FLOWS.map((f) => [f, f]))
          .map(([v, t]) => h('button.seg-btn' + ((sFlow || 'none') === v ? '.on' : ''), {
            type: 'button', text: t.charAt(0).toUpperCase() + t.slice(1),
            onclick: () => { sFlow = v === 'none' ? null : v; paintFlow(); },
          })));
      }
      paintFlow();

      const oSymRoot = h('div.chips');
      function paintSym() {
        mount(oSymRoot, SYMPTOMS.map((s) => h('button.chip' + (oSel.has(s) ? '.on' : ''), {
          type: 'button', text: s, onclick: () => { if (oSel.has(s)) oSel.delete(s); else oSel.add(s); paintSym(); },
        })));
      }
      paintSym();

      const oMood = h('select', {}, [['', '—']].concat(MOODS.map((m) => [m, m]))
        .map(([v, t]) => h('option', { value: v, text: t, selected: sMood === v })));
      const oNotes = h('textarea', { rows: '2', placeholder: 'Notes…' });
      oNotes.value = oL.notes || '';

      async function save() {
        const oResp = await guard(api.saveCycleDay(sIso, {
          flow: sFlow, symptoms: [...oSel], mood: oMood.value || null, notes: oNotes.value.trim() || null,
        }));
        ingest(oResp); paintAll(); tClose(); toast('Saved');
      }

      mount(tBody, [
        h('span.lbl', { text: 'Flow' }), oFlowRow,
        h('span.lbl', { style: 'margin-top:12px;display:block', text: 'Symptoms' }), oSymRoot,
        h('label.field', { style: 'margin-top:12px' }, [h('span.lbl', { text: 'Mood' }), oMood]),
        h('label.field', {}, [h('span.lbl', { text: 'Notes' }), oNotes]),
        h('button.btn.btn-accent.btn-block', { type: 'button', text: 'Save', onclick: save, style: 'margin-top:6px' }),
      ]);
    });
  }

  mount(tRoot, [
    h('div.page-head', {}, [h('div.eyebrow', { text: 'Health' }), h('h1', { text: 'Cycle' })]),
    oSummaryRoot,
    oCalRoot,
  ]);
  paintAll();
}

function shiftMonth(sMonth, iDelta) {
  const [iY, iM] = sMonth.split('-').map(Number);
  const oDate = new Date(iY, iM - 1 + iDelta, 1);
  return oDate.getFullYear() + '-' + pad(oDate.getMonth() + 1);
}
