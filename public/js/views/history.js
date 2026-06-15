'use strict';
import { api } from '../api.js';
import { h, mount, num, fmtDay, clock, confirmAction, guard, openSheet } from '../ui.js';

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

async function renderDetail(tRoot, tCtx, tId) {
  mount(tRoot, h('div.empty', { text: 'Loading…' }));
  const oSession = (await api.session(tId)).session;

  let iVolume = 0, iSets = 0;
  for (const oEx of oSession.exercises)
    for (const oSet of oEx.sets) { if (!oSet.is_warmup && oSet.weight && oSet.reps) iVolume += oSet.weight * oSet.reps; iSets += 1; }

  const iDuration = oSession.ended_at
    ? Math.floor((new Date(oSession.ended_at) - new Date(oSession.started_at)) / 1000) : null;

  mount(tRoot, [
    h('div.page-head', {}, [
      h('a.eyebrow', { href: '#/history', text: '← History' }),
      h('h1', { text: oSession.name || 'Workout' }),
      h('p', { text: fmtDay(oSession.started_at) }),
    ]),
    h('div.stat-grid', {}, [
      stat('Volume', num(iVolume), 'lb'),
      stat('Sets', String(iSets), ''),
      stat('Duration', iDuration != null ? clock(iDuration) : '–', ''),
    ]),
    ...oSession.exercises.map((oEx) => h('div.card', {}, [
      h('div', { style: 'margin-bottom:8px' }, [h('strong', { text: oEx.exercise_name }),
        oEx.muscle_group ? h('span.faint', { text: '  ' + oEx.muscle_group }) : null]),
      oEx.notes ? h('p.ex-note', { text: '✎ ' + oEx.notes }) : null,
      oEx.sets.length ? h('table.set-table', {}, [
        h('thead', {}, h('tr', {}, [h('th.n', { text: '#' }), h('th', { text: 'Weight' }), h('th', { text: 'Reps' })])),
        h('tbody', {}, oEx.sets.map((oSet) => h('tr', {}, [
          h('td.n' + (oSet.is_warmup ? '.warm' : ''), { text: oSet.is_warmup ? 'W' : String(oSet.set_number) }),
          h('td.num', { text: oSet.weight != null ? num(oSet.weight, oSet.weight % 1 ? 1 : 0) : '–' }),
          h('td.num', { text: oSet.reps != null ? String(oSet.reps) : '–' }),
        ]))),
      ]) : h('p.faint', { text: 'No sets recorded.' }),
    ])),
    h('button.btn.btn-block', { type: 'button', text: 'Delete workout',
      style: 'margin-top:8px;background:none;color:var(--danger);box-shadow:inset 0 0 0 1px var(--line-strong)',
      onclick: () => confirmAction('Delete this workout permanently?', async () => {
        await guard(api.deleteSession(tId)); tCtx.navigate('/history');
      }) }),
  ]);
}

function stat(sLabel, sValue, sUnit) {
  return h('div.stat', {}, [h('div.k', { text: sLabel }),
    h('div.v', {}, [h('span.num', { text: sValue }), sUnit ? h('small', { text: ' ' + sUnit }) : null])]);
}
