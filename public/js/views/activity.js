'use strict';
import { api } from '../api.js';
import { h, mount, num, fmtDay, todayISO, toast, guard } from '../ui.js';

export async function render(tRoot, tArgs, tCtx) {
  mount(tRoot, h('div.empty', { text: 'Loading…' }));
  const [oToday, oRange] = await Promise.all([api.activityToday(), api.activityRange()]);
  let aDays = oRange.days;

  const oTodayRoot = h('div');
  function paintToday(oAct) {
    mount(oTodayRoot, h('div.stat-grid', {}, [
      stat('Steps today', oAct.steps != null ? num(oAct.steps) : '–', ''),
      stat('Burned today', oAct.calories_burned != null ? num(oAct.calories_burned) : '–', 'kcal'),
    ]));
  }
  paintToday(oToday.activity);

  // ---- manual / correction entry ----
  const oDate = h('input', { type: 'date', value: todayISO() });
  const oSteps = h('input.num', { type: 'number', inputmode: 'numeric', placeholder: 'steps' });
  const oCals = h('input.num', { type: 'number', inputmode: 'decimal', placeholder: 'kcal', step: 'any' });

  const oHistoryRoot = h('div');
  function paintHistory() {
    mount(oHistoryRoot, h('div.card.tight', {}, aDays.length
      ? aDays.map((oD) => h('div.row', {}, [
          h('div', {}, [h('div.label', { text: fmtDay(oD.day) }),
            h('div.sub', { text: oD.source && oD.source !== 'manual' ? oD.source.replace('_', ' ') : 'manual' })]),
          h('div', { style: 'text-align:right' }, [
            h('div.num', { text: oD.steps != null ? num(oD.steps) + ' steps' : '–' }),
            h('div.sub', { text: oD.calories_burned != null ? num(oD.calories_burned) + ' kcal' : '' })]),
        ]))
      : [h('div.empty', {}, [h('p', { text: 'No activity logged yet.' })])]));
  }
  paintHistory();

  async function saveManual() {
    if (oSteps.value === '' && oCals.value === '') { toast('Enter steps or calories'); return; }
    await guard(api.saveActivity({
      date: oDate.value || todayISO(),
      steps: oSteps.value === '' ? null : Number(oSteps.value),
      caloriesBurned: oCals.value === '' ? null : Number(oCals.value),
      source: 'manual',
    }));
    toast('Saved');
    oSteps.value = ''; oCals.value = '';
    const [oT, oR] = await Promise.all([api.activityToday(), api.activityRange()]);
    paintToday(oT.activity); aDays = oR.days; paintHistory();
  }

  mount(tRoot, [
    h('div.page-head', { style: 'display:flex;justify-content:space-between;align-items:center' }, [
      h('div', {}, [h('div.eyebrow', { text: 'Activity' }), h('h1', { text: 'Steps & calories' })]),
      h('a.h2-link', { href: '#/settings', text: 'Set up watch sync' }),
    ]),
    oTodayRoot,

    h('h2', { style: 'margin-top:20px', text: 'Add / correct a day' }),
    h('div.card', {}, [
      h('label.field', {}, [h('span.lbl', { text: 'Date' }), oDate]),
      h('div.inline-fields', {}, [
        h('div', { style: 'flex:1' }, [h('span.lbl', { text: 'Steps' }), oSteps]),
        h('div', { style: 'flex:1' }, [h('span.lbl', { text: 'Calories burned' }), oCals]),
      ]),
      h('button.btn.btn-block', { type: 'button', text: 'Save', onclick: saveManual, style: 'margin-top:10px' }),
    ]),

    h('h2', { style: 'margin-top:20px', text: 'Recent days' }),
    oHistoryRoot,
  ]);
}

function stat(sLabel, sValue, sUnit) {
  return h('div.stat', {}, [h('div.k', { text: sLabel }),
    h('div.v', {}, [h('span.num', { text: sValue }), sUnit ? h('small', { text: ' ' + sUnit }) : null])]);
}
