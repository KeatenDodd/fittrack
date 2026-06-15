'use strict';
import { api } from '../api.js';
import { h, mount, num, fmtDate } from '../ui.js';
import { lineChart, barChart } from '../charts.js';

export async function render(tRoot, tArgs, tCtx) {
  mount(tRoot, h('div.empty', { text: 'Loading…' }));

  const [oExResp, oWeight, oTrendData] = await Promise.all([
    api.exercisesWithHistory(),
    api.weight(),
    api.trend(daysAgo(30), todayStr()),
  ]);
  const oExercises = oExResp.exercises;

  // Only exercises with logged sets appear in the picker.
  const oSelect = h('select', {}, [h('option', { value: '', text: 'Choose an exercise…' })]
    .concat(oExercises.map((oE) => h('option', { value: oE.id, text: oE.name }))));
  const oStrengthRoot = h('div');
  const oStrengthPicker = oExercises.length
    ? h('label.field', {}, [oSelect])
    : h('p.faint', { style: 'padding:8px 2px', text: 'Log a workout with weights to see strength trends here.' });

  // Progression isn't just weight — let the user chart 1RM / volume / top set /
  // total reps / sets over time.
  const METRICS = [
    { key: 'est_one_rm', label: '1RM', unit: 'lb', round: true },
    { key: 'volume', label: 'Volume', unit: 'lb', round: true },
    { key: 'top_weight', label: 'Top set', unit: 'lb', round: false },
    { key: 'total_reps', label: 'Reps', unit: '', round: false },
    { key: 'total_sets', label: 'Sets', unit: '', round: false },
  ];
  let sMetric = 'est_one_rm';

  async function loadStrength() {
    if (!oSelect.value) { mount(oStrengthRoot, h('p.faint', { style: 'padding:8px 2px', text: 'Pick an exercise to see weight, reps, sets and volume over time.' })); return; }
    mount(oStrengthRoot, h('p.muted', { style: 'padding:8px 2px', text: 'Loading…' }));
    const oHistory = (await api.exerciseStats(oSelect.value)).history;
    if (oHistory.length < 1) { mount(oStrengthRoot, h('p.faint', { style: 'padding:8px 2px', text: 'No sets logged for this exercise yet.' })); return; }

    const oCanvas = h('canvas', { height: '220' });
    const oLast = oHistory[oHistory.length - 1];
    const aNoted = oHistory.filter((oH) => oH.note);
    const aLabels = oHistory.map((oH) => fmtDate(oH.day));
    const aNotes = oHistory.map((oH) => oH.note || null);

    function draw() {
      const oM = METRICS.find((m) => m.key === sMetric);
      const aData = oHistory.map((oH) => {
        const f = Number(oH[oM.key]);
        if (!Number.isFinite(f)) return null;
        return oM.round ? Math.round(f) : f;
      });
      lineChart(oCanvas, aLabels, aData, { accent: true, notes: aNotes });
    }

    const oSeg = h('div.seg', { style: 'display:flex' }, METRICS.map((oM) =>
      h('button', { type: 'button', text: oM.label,
        class: oM.key === sMetric ? 'active' : '',
        onclick: (tEvent) => {
          sMetric = oM.key;
          for (const oBtn of oSeg.children) oBtn.classList.remove('active');
          tEvent.currentTarget.classList.add('active');
          draw();
        } })));

    mount(oStrengthRoot, [
      h('div.stat-grid', {}, [
        stat('Est. 1RM', num(oLast.est_one_rm), 'lb'),
        stat('Top reps', oLast.top_reps != null ? num(oLast.top_reps) : '–', '@ ' + num(oLast.top_weight) + 'lb'),
        stat('Volume', num(oLast.volume), 'lb'),
      ]),
      oSeg,
      h('div.card', {}, [oCanvas]),
      aNoted.length ? h('div.card', {}, [
        h('div.meal-head', { style: 'margin-bottom:6px' }, [h('span.name', { text: 'Notes' })]),
        ...aNoted.map((oH) => h('div.note-row', {}, [
          h('span.note-date', { text: fmtDate(oH.day) }),
          h('span.note-text', { text: oH.note }),
        ])),
      ]) : null,
    ]);
    draw();
  }

  if (oExercises.length) oSelect.addEventListener('change', loadStrength);

  // body weight chart
  const oWeightCanvas = h('canvas', { height: '200' });

  // calorie trend (last 30 days) -> bar chart of daily kcal
  const oByDay = {};
  for (const oRow of oTrendData.rows) {
    const sDay = oRow.day.slice(0, 10);
    if (!oByDay[sDay]) oByDay[sDay] = {};
    oByDay[sDay][oRow.key] = Number(oRow.total);
  }
  const aDays = Object.keys(oByDay).sort();
  const oKcalCanvas = h('canvas', { height: '200' });

  mount(tRoot, [
    h('div.page-head', {}, [h('div.eyebrow', { text: 'Progress' }), h('h1', { text: 'Trends' })]),

    h('h2', { text: 'Strength' }),
    oStrengthPicker,
    oStrengthRoot,

    h('h2', { style: 'margin-top:24px', text: 'Body weight' }),
    oWeight.entries.length > 1
      ? h('div.card', {}, [oWeightCanvas])
      : h('div.card', {}, [h('p.faint', { style: 'margin:0', text: 'Log at least two weigh-ins to see a trend.' })]),

    h('h2', { style: 'margin-top:24px', text: 'Calories · last 30 days' }),
    aDays.length
      ? h('div.card', {}, [oKcalCanvas])
      : h('div.card', {}, [h('p.faint', { style: 'margin:0', text: 'No food logged in the last 30 days.' })]),
  ]);

  if (oExercises.length) await loadStrength();
  if (oWeight.entries.length > 1) {
    lineChart(oWeightCanvas, oWeight.entries.map((oE) => fmtDate(oE.logged_at)), oWeight.entries.map((oE) => Number(oE.weight)), { accent: true });
  }
  if (aDays.length) {
    barChart(oKcalCanvas, aDays.map((s) => fmtDate(s)), aDays.map((s) => Math.round(oByDay[s].energy_kcal || 0)));
  }
}

function stat(sLabel, sValue, sUnit) {
  return h('div.stat', {}, [h('div.k', { text: sLabel }),
    h('div.v', {}, [h('span.num', { text: sValue }), sUnit ? h('small', { text: ' ' + sUnit }) : null])]);
}
function todayStr() { return new Date().toISOString().slice(0, 10); }
function daysAgo(iDays) { const o = new Date(); o.setDate(o.getDate() - iDays); return o.toISOString().slice(0, 10); }
