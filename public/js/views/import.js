'use strict';
import { api } from '../api.js';
import { h, mount } from '../ui.js';

export function render(tRoot, tArgs, tCtx) {
  const oFile = h('input', { type: 'file', accept: '.csv,text/csv' });
  const oStatus = h('p.faint', { style: 'min-height:18px' });
  const oResult = h('div');

  const oButton = h('button.btn.btn-block', { type: 'button', text: 'Import workouts', onclick: doImport });

  async function doImport() {
    const oPicked = oFile.files && oFile.files[0];
    if (!oPicked) { oStatus.textContent = 'Choose your Strong export CSV first.'; return; }
    oButton.disabled = true;
    oStatus.style.color = 'var(--muted)';
    oStatus.textContent = 'Reading ' + oPicked.name + '…';
    mount(oResult, []);
    try {
      const sText = await oPicked.text();
      oStatus.textContent = 'Importing… this can take a few seconds for large files.';
      const oData = await api.importStrong(sText);
      oStatus.textContent = '';
      mount(oResult, h('div.card', {}, [
        h('div', {}, [h('strong', { text: 'Import complete' })]),
        h('p.muted', { style: 'margin:8px 0 0', html:
          oData.workoutsImported + ' workout' + (oData.workoutsImported === 1 ? '' : 's') + ' imported · ' +
          oData.setsImported + ' sets · ' +
          oData.newExercises + ' new exercises added' +
          (oData.workoutsSkipped ? '<br>' + oData.workoutsSkipped + ' already-imported workout' +
            (oData.workoutsSkipped === 1 ? '' : 's') + ' skipped' : '') }),
        h('a.btn.btn-block', { href: '#/history', text: 'View workout history', style: 'margin-top:12px;text-align:center' }),
      ]));
    } catch (tErr) {
      oStatus.style.color = 'var(--danger)';
      oStatus.textContent = tErr.message || 'Import failed.';
    } finally {
      oButton.disabled = false;
    }
  }

  mount(tRoot, [
    h('div.page-head', {}, [h('div.eyebrow', { text: 'Settings' }), h('h1', { text: 'Import data' })]),
    h('div.card', {}, [
      h('p.muted', { style: 'margin-top:0', text:
        'Bring in your history from the Strong app. In Strong: Profile → Settings → Export Data, then choose the CSV file here.' }),
      h('label.field', {}, [h('span.lbl', { text: 'Strong export (.csv)' }), oFile]),
      oStatus,
      oButton,
      h('p.faint', { style: 'margin-bottom:0', text:
        'Re-importing the same file is safe — workouts already imported are skipped.' }),
    ]),
    oResult,
  ]);
}
