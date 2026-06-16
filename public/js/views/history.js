'use strict';
import { api } from '../api.js';
import { h, mount, num, fmtDay, clock, confirmAction, guard, openSheet, restGap } from '../ui.js';
import { pickExercise } from './_pickers.js';

const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

export async function render(tRoot, tArgs, tCtx) {
  if (tArgs[0]) return renderDetail(tRoot, tCtx, tArgs[0]);
  return renderList(tRoot, tCtx);
}

async function renderList(tRoot, tCtx) {
  const oCalRoot = h('div');
  const oListRoot = h('div');
  mount(tRoot, [
    h('div.page-head', {}, [h('div.eyebrow', { text: 'Workout' }), h('h1', { text: 'History' })]),
    oCalRoot,
    h('h2', { style: 'margin-top:22px', text: 'Recent' }),
    oListRoot,
  ]);

  // ---- calendar (its own month state; navigating re-fetches just the calendar)
  let sMonth = new Date().toISOString().slice(0, 7);
  async function paintCalendar() {
    mount(oCalRoot, h('div.card', {}, [h('p.muted', { style: 'margin:0', text: 'Loading…' })]));
    const oData = await api.sessionCalendar(sMonth);
    mount(oCalRoot, calendarCard(oData, tCtx, (sNew) => { sMonth = sNew; paintCalendar(); }));
  }
  await paintCalendar();

  // ---- recent list
  const oSessions = (await api.sessions()).sessions;
  mount(oListRoot, h('div.card.tight', {}, oSessions.length
    ? oSessions.map((oS) => h('div.row.list-link', { onclick: () => tCtx.navigate('/history/' + oS.id) }, [
        h('div', {}, [h('div.label', { text: oS.name || 'Workout' }),
          h('div.sub', { text: fmtDay(oS.started_at) + ' · ' + oS.exercise_count + ' exercises' })]),
        h('div', { style: 'text-align:right' }, [
          h('div.num', { text: num(oS.total_volume) }),
          h('div.sub', { text: oS.set_count + ' sets' })]),
      ]))
    : [h('div.empty', {}, [h('p', { text: 'No workouts logged yet.' })])]));
}

function shiftMonth(sMonth, iDelta) {
  const [iY, iM] = sMonth.split('-').map(Number);
  const oDate = new Date(iY, iM - 1 + iDelta, 1);
  return oDate.getFullYear() + '-' + String(oDate.getMonth() + 1).padStart(2, '0');
}

function calendarCard(oData, tCtx, tOnNav) {
  const [iY, iM] = oData.month.split('-').map(Number);

  // group workouts by day-of-month (local date)
  const oByDay = {};
  for (const oS of oData.sessions) {
    const iDay = new Date(oS.started_at).getDate();
    (oByDay[iDay] = oByDay[iDay] || []).push(oS);
  }

  const oNow = new Date();
  const bThisMonth = oNow.getFullYear() === iY && oNow.getMonth() === iM - 1;
  const iToday = oNow.getDate();

  const iFirstWeekday = new Date(iY, iM - 1, 1).getDay();
  const iDaysInMonth = new Date(iY, iM, 0).getDate();

  const aCells = [];
  for (let i = 0; i < iFirstWeekday; i += 1) aCells.push(h('div.cal-day.blank'));
  for (let d = 1; d <= iDaysInMonth; d += 1) {
    const aSessions = oByDay[d];
    const bHas = !!aSessions;
    const sClass = 'div.cal-day' + (bHas ? '.has' : '') + (bThisMonth && d === iToday ? '.today' : '');
    aCells.push(h(sClass, {
      onclick: bHas ? () => openDay(aSessions, tCtx) : null,
    }, [
      h('span.cal-n', { text: String(d) }),
      bHas ? h('span.cal-dot') : null,
    ]));
  }

  const iCount = oData.sessions.length;
  return h('div.card', {}, [
    h('div.cal-head', {}, [
      h('button.cal-nav', { type: 'button', text: '‹', onclick: () => tOnNav(shiftMonth(oData.month, -1)) }),
      h('div', { style: 'text-align:center' }, [
        h('div.cal-title', { text: MONTHS[iM - 1] + ' ' + iY }),
        h('div.faint', { style: 'font-size:12px', text: iCount + (iCount === 1 ? ' workout' : ' workouts') }),
      ]),
      h('button.cal-nav', { type: 'button', text: '›', onclick: () => tOnNav(shiftMonth(oData.month, 1)) }),
    ]),
    h('div.cal-grid', {}, DOW.map((s) => h('div.cal-dow', { text: s }))),
    h('div.cal-grid', {}, aCells),
  ]);
}

// Tapping a day: one workout -> straight there; several -> pick one.
function openDay(aSessions, tCtx) {
  if (aSessions.length === 1) { tCtx.navigate('/history/' + aSessions[0].id); return; }
  openSheet('Workouts that day', (tBody, tClose) => {
    mount(tBody, h('div.card.tight', {}, aSessions.map((oS) =>
      h('div.row.list-link', { onclick: () => { tClose(); tCtx.navigate('/history/' + oS.id); } }, [
        h('div', {}, [h('div.label', { text: oS.name || 'Workout' }),
          h('div.sub', { text: new Date(oS.started_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) })]),
        h('span.faint', { text: 'Open →' }),
      ]))));
  });
}

const HIST_MARK = { warmup: { t: 'W', c: '.warm' }, myo: { t: 'M', c: '.myo' }, drop: { t: 'D', c: '.drop' } };
const SET_CYCLE = ['normal', 'warmup', 'myo', 'drop'];
function typeOf(oSet) { return oSet.set_type || (oSet.is_warmup ? 'warmup' : 'normal'); }

async function renderDetail(tRoot, tCtx, tId) {
  let bEdit = false;
  let oSession = null;

  async function load() { oSession = (await api.session(tId)).session; paint(); }

  function paint() {
    let iVolume = 0; let iSets = 0;
    for (const oEx of oSession.exercises) {
      for (const oSet of oEx.sets) { if (!oSet.is_warmup && oSet.weight && oSet.reps) iVolume += oSet.weight * oSet.reps; iSets += 1; }
    }
    const iDuration = oSession.ended_at
      ? Math.floor((new Date(oSession.ended_at) - new Date(oSession.started_at)) / 1000) : null;

    mount(tRoot, [
      h('div.page-head', { style: 'display:flex;justify-content:space-between;align-items:flex-start' }, [
        h('div', {}, [
          h('a.eyebrow', { href: '#/history', text: '← History' }),
          h('h1', { text: oSession.name || 'Workout' }),
          h('p', { text: fmtDay(oSession.started_at) }),
        ]),
        h('button.btn' + (bEdit ? '.btn-accent' : '.btn-ghost') + '.btn-sm', { type: 'button',
          text: bEdit ? 'Done' : 'Edit', onclick: () => { bEdit = !bEdit; paint(); } }),
      ]),
      h('div.stat-grid', {}, [
        stat('Volume', num(iVolume), 'lb'),
        stat('Sets', String(iSets), ''),
        stat('Duration', iDuration != null ? clock(iDuration) : '–', ''),
      ]),
      ...oSession.exercises.map(exCard),
      bEdit ? h('button.btn.btn-ghost.btn-block', { type: 'button', text: '+ Add exercise', style: 'margin-top:6px',
        onclick: () => pickExercise(async (oEx) => { await guard(api.addSessionExercise(tId, oEx.id)); load(); }) }) : null,
      h('button.btn.btn-block', { type: 'button', text: 'Delete workout',
        style: 'margin-top:10px;background:none;color:var(--danger);box-shadow:inset 0 0 0 1px var(--line-strong)',
        onclick: () => confirmAction('Delete this workout permanently?', async () => {
          await guard(api.deleteSession(tId)); tCtx.navigate('/history');
        }) }),
    ]);
  }

  function exCard(oEx) {
    const oHeader = h('div', { style: 'display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px' }, [
      h('strong', { text: oEx.exercise_name }),
      bEdit
        ? h('button.icon-btn', { type: 'button', text: '×', title: 'Remove exercise',
            onclick: () => confirmAction('Remove ' + oEx.exercise_name + ' from this workout?', async () => {
              await guard(api.removeSessionExercise(oEx.id)); load(); }) })
        : (oEx.muscle_group ? h('span.faint', { text: oEx.muscle_group }) : null),
    ]);

    let oNoteEl = oEx.notes ? h('p.ex-note', { text: '✎ ' + oEx.notes }) : null;
    if (bEdit) {
      const oIn = h('input.note-input', { type: 'text', value: oEx.notes || '', placeholder: 'Note…' });
      let sSaved = oEx.notes || '';
      oIn.addEventListener('blur', async () => {
        const sVal = oIn.value.trim(); if (sVal === sSaved) return; sSaved = sVal;
        try { await api.setSessionExerciseNote(oEx.id, sVal); } catch (tErr) { /* ignore */ }
      });
      oNoteEl = h('div', { style: 'margin:6px 0 8px' }, [oIn]);
    }

    const oMedia = (oEx.media && oEx.media.length)
      ? h('div.clip-row', {}, oEx.media.map((oM) =>
          h('div.clip', { onclick: () => openClip(oM, oEx.exercise_name) }, [h('span.clip-play', { text: '▶' })])))
      : null;

    const oRows = oEx.sets.map((oSet, i) => {
      const sRest = (i > 0 && restGap(oEx.sets[i - 1], oSet)) || '–';
      if (!bEdit) {
        return h('tr', {}, [
          setMark(oSet),
          h('td.num', { text: oSet.weight != null ? num(oSet.weight, oSet.weight % 1 ? 1 : 0) : '–' }),
          h('td.num', { text: oSet.reps != null ? String(oSet.reps) : '–' }),
          h('td.num.rest', { text: sRest }),
        ]);
      }
      // editable row
      const oW = h('input.num', { type: 'number', step: 'any', value: oSet.weight != null ? oSet.weight : '' });
      const oR = h('input.num', { type: 'number', value: oSet.reps != null ? oSet.reps : '' });
      const saveSet = async (sType) => {
        await guard(api.updateSet(oSet.id, {
          weight: oW.value === '' ? null : Number(oW.value),
          reps: oR.value === '' ? null : Number(oR.value),
          restSeconds: oSet.rest_seconds, rpe: oSet.rpe, notes: oSet.notes,
          setType: sType || typeOf(oSet),
        }));
        load();
      };
      oW.addEventListener('change', () => saveSet());
      oR.addEventListener('change', () => saveSet());
      const oM = HIST_MARK[typeOf(oSet)];
      return h('tr', {}, [
        h('td.n' + (oM ? oM.c : ''), { style: 'cursor:pointer', title: 'Tap to change set type',
          text: oM ? oM.t : String(oSet.set_number),
          onclick: () => saveSet(SET_CYCLE[(SET_CYCLE.indexOf(typeOf(oSet)) + 1) % SET_CYCLE.length]) }),
        h('td', {}, [oW]),
        h('td', {}, [oR]),
        h('td.num.rest', { text: sRest }),
        h('td', { style: 'text-align:right' }, [
          h('button.icon-btn', { type: 'button', text: '×', title: 'Delete set',
            onclick: async () => { await guard(api.deleteSet(oSet.id)); load(); } }),
        ]),
      ]);
    });

    let oAddRow = null;
    if (bEdit) {
      const oW = h('input.num', { type: 'number', step: 'any', placeholder: 'lb' });
      const oR = h('input.num', { type: 'number', placeholder: 'reps' });
      const oLast = oEx.sets[oEx.sets.length - 1];
      if (oLast) { if (oLast.weight != null) oW.value = oLast.weight; if (oLast.reps != null) oR.value = oLast.reps; }
      oAddRow = h('div.inline-fields', { style: 'margin-top:10px' }, [
        h('div', { style: 'flex:1' }, [oW]), h('div', { style: 'flex:1' }, [oR]),
        h('button.btn.btn-sm', { type: 'button', text: 'Add set', style: 'flex:0 0 auto',
          onclick: async () => {
            await guard(api.addSet(oEx.id, { weight: oW.value === '' ? null : Number(oW.value), reps: oR.value === '' ? null : Number(oR.value) }));
            load();
          } }),
      ]);
    }

    const oHead = bEdit
      ? h('tr', {}, [h('th.n', { text: '#' }), h('th', { text: 'Weight' }), h('th', { text: 'Reps' }), h('th', { text: 'Rest' }), h('th', {})])
      : h('tr', {}, [h('th.n', { text: '#' }), h('th', { text: 'Weight' }), h('th', { text: 'Reps' }), h('th', { text: 'Rest' })]);

    return h('div.card', {}, [
      oHeader, oNoteEl, oMedia,
      oEx.sets.length ? h('table.set-table', {}, [h('thead', {}, oHead), h('tbody', {}, oRows)]) : h('p.faint', { text: 'No sets recorded.' }),
      oAddRow,
    ]);
  }

  mount(tRoot, h('div.empty', { text: 'Loading…' }));
  await load();
}

function stat(sLabel, sValue, sUnit) {
  return h('div.stat', {}, [h('div.k', { text: sLabel }),
    h('div.v', {}, [h('span.num', { text: sValue }), sUnit ? h('small', { text: ' ' + sUnit }) : null])]);
}

function openClip(oM, sTitle) {
  openSheet(sTitle || 'Clip', (tBody) => {
    mount(tBody, h('video', { src: oM.url, controls: true, playsinline: true, style: 'width:100%;border-radius:8px' }));
  });
}

// Read-only set-type marker (W / M / D, else the set number).
function setMark(oSet) {
  const oM = HIST_MARK[typeOf(oSet)];
  return h('td.n' + (oM ? oM.c : ''), { text: oM ? oM.t : String(oSet.set_number) });
}
