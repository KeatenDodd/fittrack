'use strict';
import { api } from '../api.js';
import { h, mount, num, fmtDate, toast, confirmAction, guard } from '../ui.js';
import { lineChart } from '../charts.js';

export async function render(tRoot, tArgs, tCtx) {
  let sTab = tArgs[0] === 'measurements' ? 'measurements' : 'weight';

  function header() {
    return h('div', {}, [
      h('div.page-head', {}, [h('div.eyebrow', { text: 'Body' }), h('h1', { text: 'Measurements' })]),
      h('div.seg', {}, [
        segBtn('Weight', sTab === 'weight', () => { sTab = 'weight'; paint(); }),
        segBtn('Measurements', sTab === 'measurements', () => { sTab = 'measurements'; paint(); }),
      ]),
    ]);
  }

  async function paint() {
    mount(tRoot, [header(), h('div.empty', { text: 'Loading…' })]);
    const oContent = h('div');
    mount(tRoot, [header(), oContent]);
    if (sTab === 'weight') await paintWeight(oContent);
    else await paintMeasurements(oContent);
  }

  await paint();
}

function segBtn(sLabel, isActive, tOnClick) {
  return h('button' + (isActive ? '.active' : ''), { type: 'button', text: sLabel, onclick: tOnClick });
}

// ---- weight ------------------------------------------------------------------
async function paintWeight(tRoot) {
  const oEntries = (await api.weight()).entries;

  const oWeight = h('input.num', { type: 'number', inputmode: 'decimal', step: 'any', placeholder: 'weight' });
  const oUnit = h('select', {}, [h('option', { value: 'lb', text: 'lb' }), h('option', { value: 'kg', text: 'kg' })]);

  async function add() {
    if (oWeight.value === '') { toast('Enter a weight'); return; }
    await guard(api.addWeight({ weight: Number(oWeight.value), unit: oUnit.value }));
    toast('Logged'); render2();
  }
  function render2() { paintWeight(tRoot); }

  const oCanvas = h('canvas', { height: '200' });
  const oLatest = oEntries[oEntries.length - 1];

  mount(tRoot, [
    h('div.card', {}, [
      h('div.inline-fields', {}, [
        h('div', { style: 'flex:2' }, [oWeight]),
        h('div', { style: 'flex:1' }, [oUnit]),
        h('button.btn', { type: 'button', text: 'Log', onclick: add, style: 'flex:0 0 auto' }),
      ]),
    ]),
    oLatest ? h('div.stat-grid', {}, [
      stat('Latest', num(oLatest.weight, 1), oLatest.unit),
      stat('Entries', String(oEntries.length), ''),
      stat('Change', changeLabel(oEntries), oLatest.unit),
    ]) : null,
    oEntries.length > 1 ? h('div.card', {}, [oCanvas]) : null,
    h('div.card.tight', {}, oEntries.length
      ? oEntries.slice().reverse().slice(0, 30).map((oE) => h('div.row', {}, [
          h('div', {}, [h('div.label.num', { text: num(oE.weight, 1) + ' ' + oE.unit }),
            h('div.sub', { text: fmtDate(oE.logged_at) })]),
          h('button.icon-btn', { type: 'button', text: '\u00d7',
            onclick: async () => { await guard(api.deleteWeight(oE.id)); render2(); } }),
        ]))
      : [h('div.empty', {}, [h('p', { text: 'No weigh-ins yet.' })])]),
  ]);

  if (oEntries.length > 1) {
    lineChart(oCanvas,
      oEntries.map((oE) => fmtDate(oE.logged_at)),
      oEntries.map((oE) => Number(oE.weight)),
      { accent: true });
  }
}

function changeLabel(oEntries) {
  if (oEntries.length < 2) return '–';
  const fDiff = Number(oEntries[oEntries.length - 1].weight) - Number(oEntries[0].weight);
  return (fDiff > 0 ? '+' : '') + num(fDiff, 1);
}

// ---- measurements ------------------------------------------------------------
async function paintMeasurements(tRoot) {
  const oTypes = (await api.measurementTypes()).types;
  let iTypeId = oTypes[0] ? oTypes[0].id : null;

  const oSelect = h('select', {}, oTypes.map((oT) => h('option', { value: oT.id, text: oT.name })));
  const oValue = h('input.num', { type: 'number', inputmode: 'decimal', step: 'any', placeholder: 'value' });
  const oBody = h('div');

  async function load() {
    iTypeId = Number(oSelect.value);
    const oEntries = (await api.measurements(iTypeId)).entries;
    const oType = oTypes.find((oT) => oT.id === iTypeId) || {};
    const oCanvas = h('canvas', { height: '200' });

    mount(oBody, [
      oEntries.length > 1 ? h('div.card', {}, [oCanvas]) : null,
      h('div.card.tight', {}, oEntries.length
        ? oEntries.slice().reverse().slice(0, 30).map((oE) => h('div.row', {}, [
            h('div', {}, [h('div.label.num', { text: num(oE.value, 1) + ' ' + oE.unit }),
              h('div.sub', { text: fmtDate(oE.logged_at) })]),
            h('button.icon-btn', { type: 'button', text: '\u00d7',
              onclick: async () => { await guard(api.deleteMeasurement(oE.id)); load(); } }),
          ]))
        : [h('div.empty', {}, [h('p', { text: 'No entries for ' + (oType.name || 'this measurement') + ' yet.' })])]),
    ]);

    if (oEntries.length > 1) {
      lineChart(oCanvas, oEntries.map((oE) => fmtDate(oE.logged_at)),
        oEntries.map((oE) => Number(oE.value)), { accent: true });
    }
  }

  async function add() {
    if (oValue.value === '') { toast('Enter a value'); return; }
    const oType = oTypes.find((oT) => oT.id === Number(oSelect.value)) || {};
    await guard(api.addMeasurement({ measurementTypeId: Number(oSelect.value), value: Number(oValue.value), unit: oType.unit || 'in' }));
    oValue.value = ''; toast('Logged'); load();
  }

  oSelect.addEventListener('change', load);

  mount(tRoot, [
    h('div.card', {}, [
      h('label.field', {}, [h('span.lbl', { text: 'Measurement' }), oSelect]),
      h('div.inline-fields', {}, [
        h('div', { style: 'flex:2' }, [oValue]),
        h('button.btn', { type: 'button', text: 'Log', onclick: add, style: 'flex:0 0 auto' }),
      ]),
    ]),
    oBody,
  ]);
  await load();
}

function stat(sLabel, sValue, sUnit) {
  return h('div.stat', {}, [h('div.k', { text: sLabel }),
    h('div.v', {}, [h('span.num', { text: sValue }), sUnit ? h('small', { text: ' ' + sUnit }) : null])]);
}
