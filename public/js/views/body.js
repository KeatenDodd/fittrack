'use strict';
import { api } from '../api.js';
import { h, mount, num, fmtDate, todayISO, toast, confirmAction, guard, openSheet } from '../ui.js';
import { lineChart } from '../charts.js';

const ANGLES = ['front', 'side', 'back', 'other'];

export async function render(tRoot, tArgs, tCtx) {
  const TABS = ['weight', 'measurements', 'photos'];
  let sTab = TABS.includes(tArgs[0]) ? tArgs[0] : 'weight';

  function header() {
    return h('div', {}, [
      h('div.page-head', {}, [h('div.eyebrow', { text: 'Body' }), h('h1', { text: 'Measurements' })]),
      h('div.seg', {}, [
        segBtn('Weight', sTab === 'weight', () => { sTab = 'weight'; paint(); }),
        segBtn('Measurements', sTab === 'measurements', () => { sTab = 'measurements'; paint(); }),
        segBtn('Photos', sTab === 'photos', () => { sTab = 'photos'; paint(); }),
      ]),
    ]);
  }

  async function paint() {
    mount(tRoot, [header(), h('div.empty', { text: 'Loading…' })]);
    const oContent = h('div');
    mount(tRoot, [header(), oContent]);
    if (sTab === 'weight') await paintWeight(oContent);
    else if (sTab === 'measurements') await paintMeasurements(oContent);
    else await paintPhotos(oContent);
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

// ---- progress photos ---------------------------------------------------------
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function prettyDay(sIso) { return new Date(sIso + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); }

function pickImage(sDate, sAngle, tOnDone) {
  const oInput = h('input', { type: 'file', accept: 'image/*', style: 'display:none' });
  oInput.addEventListener('change', async () => {
    const oFile = oInput.files && oInput.files[0];
    if (!oFile) return;
    toast('Uploading…');
    try { await api.uploadProgressPhoto(oFile, sDate, sAngle); toast('Photo added'); tOnDone(); }
    catch (tErr) { toast(tErr.message || 'Upload failed'); }
  });
  oInput.click();
}

function openMedia(sUrl, sMime, sTitle) {
  openSheet(sTitle || 'Photo', (tBody) => {
    mount(tBody, sMime && sMime.startsWith('video')
      ? h('video', { src: sUrl, controls: true, playsinline: true, style: 'width:100%;border-radius:8px' })
      : h('img', { src: sUrl, style: 'width:100%;border-radius:8px;display:block' }));
  });
}

async function paintPhotos(tRoot) {
  let aPhotos = (await api.progressPhotos()).photos;
  let sView = 'gallery';
  let sCmpAngle = 'front';

  const oDate = h('input', { type: 'date', value: todayISO() });
  const oAngle = h('select', {}, ANGLES.map((a) => h('option', { value: a, text: cap(a) })));
  const oBody = h('div');

  async function refresh() { aPhotos = (await api.progressPhotos()).photos; paintBody(); }
  function paintBody() { if (sView === 'gallery') paintGallery(); else paintCompare(); }

  function thumb(oP) {
    return h('div.photo-thumb', {}, [
      h('img', { src: oP.url, loading: 'lazy', onclick: () => openMedia(oP.url, oP.mime, prettyDay(oP.takenOn) + ' · ' + cap(oP.angle)) }),
      h('span.photo-tag', { text: oP.angle }),
      h('button.photo-del', { type: 'button', text: '×',
        onclick: () => confirmAction('Delete this photo?', async () => { await guard(api.deleteProgressPhoto(oP.id)); toast('Deleted'); refresh(); }) }),
    ]);
  }

  function paintGallery() {
    if (!aPhotos.length) { mount(oBody, h('div.empty', {}, [h('p', { text: 'No progress photos yet. Add one above to start tracking.' })])); return; }
    const oByDate = {};
    for (const oP of aPhotos) (oByDate[oP.takenOn] = oByDate[oP.takenOn] || []).push(oP);
    const aDates = Object.keys(oByDate).sort().reverse();
    mount(oBody, aDates.map((sD) => h('div', {}, [
      h('div.meal-head', {}, [h('span.name', { text: prettyDay(sD) }),
        h('span.faint', { text: oByDate[sD].length + ' photo' + (oByDate[sD].length === 1 ? '' : 's') })]),
      h('div.photo-grid', {}, oByDate[sD].map(thumb)),
    ])));
  }

  function paintCompare() {
    const oTabs = h('div.seg', {}, ANGLES.map((a) =>
      segBtn(cap(a), sCmpAngle === a, () => { sCmpAngle = a; paintCompare(); })));
    const aList = aPhotos.filter((oP) => oP.angle === sCmpAngle).sort((a, b) => (a.takenOn < b.takenOn ? -1 : 1));
    const oRow = aList.length
      ? h('div.cmp-row', {}, aList.map((oP) => h('div.cmp-item', {}, [
          h('img', { src: oP.url, loading: 'lazy', onclick: () => openMedia(oP.url, oP.mime, prettyDay(oP.takenOn) + ' · ' + cap(oP.angle)) }),
          h('div.cmp-date', { text: prettyDay(oP.takenOn) }),
        ])))
      : h('div.empty', {}, [h('p', { text: 'No ' + sCmpAngle + ' photos yet.' })]);
    mount(oBody, [oTabs,
      h('p.faint', { style: 'font-size:12.5px;margin:10px 0', text: 'Swipe across to compare your ' + sCmpAngle + ' shots over time.' }),
      oRow]);
  }

  mount(tRoot, [
    h('div.card', {}, [
      h('div.inline-fields', {}, [
        h('label.field', { style: 'flex:1' }, [h('span.lbl', { text: 'Date' }), oDate]),
        h('label.field', { style: 'flex:1' }, [h('span.lbl', { text: 'Angle' }), oAngle]),
      ]),
      h('button.btn.btn-accent.btn-block', { type: 'button', text: '+ Add photo',
        onclick: () => pickImage(oDate.value || todayISO(), oAngle.value, refresh) }),
    ]),
    h('div.seg', { style: 'margin-bottom:14px' }, [
      segBtn('Gallery', sView === 'gallery', () => { sView = 'gallery'; paintBody(); }),
      segBtn('Compare', sView === 'compare', () => { sView = 'compare'; paintBody(); }),
    ]),
    oBody,
  ]);
  paintBody();
}
