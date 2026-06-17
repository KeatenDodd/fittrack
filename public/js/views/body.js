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
  // Date defaults to today, but can be backdated to import historical weigh-ins.
  const oDate = h('input', { type: 'date', value: todayISO(), max: todayISO() });

  async function add() {
    if (oWeight.value === '') { toast('Enter a weight'); return; }
    const sDate = oDate.value || todayISO();
    // For today keep the real time (so multiple weigh-ins order correctly);
    // for a past date, anchor at noon so date bucketing is timezone-safe.
    const oBody = { weight: Number(oWeight.value), unit: oUnit.value };
    if (sDate !== todayISO()) oBody.loggedAt = sDate + ' 12:00:00';
    await guard(api.addWeight(oBody));
    toast(sDate === todayISO() ? 'Logged' : 'Logged for ' + fmtDate(sDate + 'T12:00:00')); render2();
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
      h('label.field', { style: 'margin-top:8px;margin-bottom:0' }, [
        h('span.lbl', { text: 'Date' }), oDate,
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

// Pick several photos at once, then review (assign an angle to each, shared
// date) and upload them all in one go.
function pickImages(sDefaultDate, tOnDone) {
  const oInput = h('input', { type: 'file', accept: 'image/*', multiple: true, style: 'display:none' });
  oInput.addEventListener('change', () => {
    const aFiles = oInput.files ? [...oInput.files] : [];
    if (aFiles.length) openReview(aFiles, sDefaultDate, tOnDone);
  });
  oInput.click();
}

function openReview(aFiles, sDefaultDate, tOnDone) {
  const aUrls = [];
  openSheet('Add ' + aFiles.length + ' photo' + (aFiles.length === 1 ? '' : 's'), (tBody, tClose) => {
    const oDate = h('input', { type: 'date', value: sDefaultDate });
    const aAngleSel = aFiles.map((oF, i) => {
      const oUrl = URL.createObjectURL(oF); aUrls.push(oUrl);
      // default angles cycle front → side → back → other for a quick batch
      return { sel: h('select', {}, ANGLES.map((a) =>
        h('option', { value: a, text: cap(a), selected: a === ANGLES[i % ANGLES.length] }))), url: oUrl };
    });
    const oStatus = h('p.faint', { style: 'font-size:12.5px;margin:0 0 8px' });

    async function uploadAll(tBtn) {
      tBtn.disabled = true;
      let iOk = 0;
      for (let i = 0; i < aFiles.length; i += 1) {
        oStatus.textContent = 'Uploading ' + (i + 1) + ' of ' + aFiles.length + '…';
        try { await api.uploadProgressPhoto(aFiles[i], oDate.value || sDefaultDate, aAngleSel[i].sel.value); iOk += 1; }
        catch (tErr) { /* keep going; report at end */ }
      }
      toast(iOk + ' photo' + (iOk === 1 ? '' : 's') + ' added' + (iOk < aFiles.length ? ' (' + (aFiles.length - iOk) + ' failed)' : ''));
      tClose(); tOnDone();
    }

    const oBtn = h('button.btn.btn-accent.btn-block', { type: 'button', text: 'Upload all', style: 'margin-top:6px' });
    oBtn.addEventListener('click', () => uploadAll(oBtn));

    mount(tBody, [
      h('label.field', {}, [h('span.lbl', { text: 'Date (applies to all)' }), oDate]),
      ...aAngleSel.map((oA) => h('div.rev-row', {}, [
        h('img.rev-thumb', { src: oA.url }),
        h('label.field', { style: 'flex:1;margin:0' }, [h('span.lbl', { text: 'Angle' }), oA.sel]),
      ])),
      oStatus, oBtn,
    ]);
  }, () => { aUrls.forEach((u) => URL.revokeObjectURL(u)); });
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
  let bSelect = false;          // two-photo compare selection mode
  let aSel = [];                // selected photo ids (max 2)

  const oBody = h('div');

  async function refresh() { aPhotos = (await api.progressPhotos()).photos; paintBody(); }
  function paintBody() { if (sView === 'gallery') paintGallery(); else paintCompare(); }

  function toggleSelect(iId) {
    const i = aSel.indexOf(iId);
    if (i >= 0) aSel.splice(i, 1);
    else { aSel.push(iId); if (aSel.length > 2) aSel.shift(); } // keep the latest two
    paintGallery();
  }

  function thumb(oP) {
    const bSel = aSel.includes(oP.id);
    return h('div.photo-thumb' + (bSel ? '.sel' : ''), {}, [
      h('img', { src: oP.url, loading: 'lazy',
        onclick: () => (bSelect
          ? toggleSelect(oP.id)
          : openMedia(oP.url, oP.mime, prettyDay(oP.takenOn) + ' · ' + cap(oP.angle))) }),
      h('span.photo-tag', { text: oP.angle }),
      bSelect
        ? (bSel ? h('span.photo-check', { text: String(aSel.indexOf(oP.id) + 1) }) : null)
        : h('button.photo-del', { type: 'button', text: '×',
            onclick: () => confirmAction('Delete this photo?', async () => { await guard(api.deleteProgressPhoto(oP.id)); toast('Deleted'); aSel = []; refresh(); }) }),
    ]);
  }

  function paintGallery() {
    if (!aPhotos.length) { mount(oBody, h('div.empty', {}, [h('p', { text: 'No progress photos yet. Add some above to start tracking.' })])); return; }

    const oBar = h('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:10px' }, [
      h('button.btn.btn-ghost.btn-sm', { type: 'button', text: bSelect ? 'Cancel' : '⇄ Compare two',
        onclick: () => { bSelect = !bSelect; aSel = []; paintGallery(); } }),
      bSelect ? h('button.btn.btn-sm' + (aSel.length === 2 ? '.btn-accent' : ''), {
        type: 'button', text: aSel.length === 2 ? 'Compare these two →' : 'Pick ' + (2 - aSel.length) + ' more',
        disabled: aSel.length !== 2,
        onclick: () => openCompareTwo(aPhotos.find((p) => p.id === aSel[0]), aPhotos.find((p) => p.id === aSel[1])) }) : null,
    ]);

    const oByDate = {};
    for (const oP of aPhotos) (oByDate[oP.takenOn] = oByDate[oP.takenOn] || []).push(oP);
    const aDates = Object.keys(oByDate).sort().reverse();
    mount(oBody, [oBar, ...aDates.map((sD) => h('div', {}, [
      h('div.meal-head', {}, [h('span.name', { text: prettyDay(sD) }),
        h('span.faint', { text: oByDate[sD].length + ' photo' + (oByDate[sD].length === 1 ? '' : 's') })]),
      h('div.photo-grid', {}, oByDate[sD].map(thumb)),
    ]))]);
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
      h('button.btn.btn-accent.btn-block', { type: 'button', text: '+ Add photos',
        onclick: () => pickImages(todayISO(), () => { aSel = []; refresh(); }) }),
      h('p.faint', { style: 'font-size:12px;margin:8px 0 0', text: 'Pick several at once — you’ll set the angle for each before uploading.' }),
    ]),
    h('div.seg', { style: 'margin-bottom:14px' }, [
      segBtn('Gallery', sView === 'gallery', () => { sView = 'gallery'; bSelect = false; aSel = []; paintBody(); }),
      segBtn('By angle', sView === 'compare', () => { sView = 'compare'; paintBody(); }),
    ]),
    oBody,
  ]);
  paintBody();
}

// Focused side-by-side comparison of exactly two photos.
function openCompareTwo(oA, oB) {
  if (!oA || !oB) return;
  openSheet('Compare', (tBody) => {
    const col = (oP) => h('div', {}, [
      h('img', { src: oP.url, style: 'width:100%;aspect-ratio:3/4;object-fit:cover;border-radius:8px;display:block' }),
      h('div.cmp-date', { text: prettyDay(oP.takenOn) + ' · ' + cap(oP.angle) }),
    ]);
    mount(tBody, h('div.cmp-two', {}, [col(oA), col(oB)]));
  });
}
