'use strict';
import { api } from '../api.js';
import { oStore } from '../store.js';
import { h, mount, num, fmtDay, todayISO, guard } from '../ui.js';

const MACROS = [
  { key: 'protein_g', label: 'Protein' },
  { key: 'carbs_g', label: 'Carbs' },
  { key: 'fat_g', label: 'Fat' },
  { key: 'fiber_g', label: 'Fiber' },
];

const PHASE_LABEL = { menstrual: 'Menstrual', follicular: 'Follicular', fertile: 'Fertile window', ovulation: 'Ovulation', luteal: 'Luteal' };

export async function render(tRoot, tArgs, tCtx) {
  mount(tRoot, h('div.empty', { text: 'Loading…' }));

  const bFemale = (oStore.user || {}).sex === 'female';
  const [oOverview, oSummary, oSessions, oActivity, oCycle] = await Promise.all([
    api.overview(),
    api.summary(todayISO()),
    api.sessions(),
    api.activityToday().catch(() => ({ activity: {} })),
    bFemale ? api.cycle().catch(() => null) : Promise.resolve(null),
  ]);

  const oUser = oStore.user || {};
  const oByKey = {};
  for (const oRow of oSummary.totals) oByKey[oRow.key] = oRow;
  const oKcal = oByKey.energy_kcal || { total: 0, goal: null };

  const oWeight = oOverview.latestWeight;
  const oRawAct = oActivity.activity || {};
  const oAct = { steps: oRawAct.steps, calories: oRawAct.calories_burned };

  const oStatGrid = h('div.stat-grid', {}, [
    stat('This week', String(oOverview.workouts.this_week), 'workouts'),
    stat('Week volume', num(oOverview.weekVolume), 'lb'),
    stat('Body weight', oWeight ? num(oWeight.weight, 1) : '–', oWeight ? oWeight.unit : ''),
  ]);

  // today's nutrition
  const oKcalLine = h('div', {}, [
    h('div', { style: 'display:flex;justify-content:space-between;align-items:baseline' }, [
      h('span', {}, [h('span.num', { style: 'font-size:24px;font-weight:600', text: num(oKcal.total) }),
        h('span.muted', { text: ' kcal' })]),
      oKcal.goal ? h('span.faint.num', { text: 'of ' + num(oKcal.goal) }) : h('span.faint', { text: 'no goal set' }),
    ]),
    oKcal.goal ? bar(oKcal.total, oKcal.goal) : null,
  ]);

  const oMacroGrid = h('div.macro-grid', { style: 'margin-top:14px' },
    MACROS.map((tM) => {
      const oRow = oByKey[tM.key] || { total: 0, goal: null };
      return h('div.macro', {}, [
        h('div.k', { text: tM.label }),
        h('div.v', {}, [h('span.num', { text: num(oRow.total) }), 'g',
          oRow.goal ? h('small', { text: ' / ' + num(oRow.goal) }) : null]),
      ]);
    }));

  // Cycle card (female profiles): current phase + next period, taps through to /cycle.
  let oCycleCard = null;
  if (bFemale) {
    const oS = oCycle && oCycle.stats;
    let oInner;
    if (oS && oS.hasData) {
      const iToNext = daysBetween(todayISO(), oS.predictedNext);
      const sWhen = iToNext === 0 ? 'today' : iToNext > 0 ? 'in ' + iToNext + (iToNext === 1 ? ' day' : ' days')
        : Math.abs(iToNext) + (iToNext === -1 ? ' day late' : ' days late');
      oInner = [
        h('div', {}, [
          h('span.num', { style: 'font-size:22px;font-weight:600', text: oS.cycleDay ? 'Day ' + oS.cycleDay : '–' }),
          h('span.muted', { text: '  ' + (PHASE_LABEL[oS.phase] || '') }),
        ]),
        h('div', { style: 'text-align:right' }, [
          h('div.sub', { text: 'Next period' }),
          h('div.num', { text: sWhen }),
        ]),
      ];
    } else {
      oInner = [h('div', {}, [h('div.label', { text: 'Track your cycle' }),
        h('div.sub', { text: 'Log period days for predictions' })]), h('span.faint', { text: 'Open →' })];
    }
    oCycleCard = [
      h('h2', {}, ['Cycle', h('a.h2-link', { href: '#/cycle', text: 'Open' })]),
      h('div.card.list-link', { onclick: () => tCtx.navigate('/cycle'),
        style: 'display:flex;justify-content:space-between;align-items:center' }, oInner),
    ];
  }

  const oRecent = oSessions.sessions.slice(0, 4);
  const oRecentCard = h('div.card.tight', {}, oRecent.length
    ? oRecent.map((oS) => h('div.row.list-link', { onclick: () => tCtx.navigate('/history/' + oS.id) }, [
        h('div', {}, [
          h('div.label', { text: oS.name || 'Workout' }),
          h('div.sub', { text: fmtDay(oS.started_at) + (oS.ended_at ? '' : ' · in progress') }),
        ]),
        h('div', { style: 'text-align:right' }, [
          h('div.num', { text: num(oS.total_volume) }),
          h('div.sub', { text: oS.set_count + ' sets' }),
        ]),
      ]))
    : [h('div.empty', {}, [h('p', { text: 'No workouts logged yet.' })])]);

  mount(tRoot, [
    h('div.page-head', {}, [
      h('div.eyebrow', { text: greeting() }),
      h('h1', { text: oUser.displayName || oUser.username || 'Welcome' }),
    ]),
    oStatGrid,
    h('div.btn-row', { style: 'margin-bottom:20px' }, [
      h('button.btn.btn-accent', { type: 'button', text: oStore.activeSessionId ? 'Resume workout' : 'Start workout',
        onclick: () => tCtx.navigate(oStore.activeSessionId ? '/workout' : '/program') }),
      h('button.btn.btn-ghost', { type: 'button', text: 'Log food', onclick: () => tCtx.navigate('/nutrition') }),
    ]),
    h('h2', {}, ["Today's activity", h('a.h2-link', { href: '#/activity', text: 'Sync / log' })]),
    h('div.card.list-link', { onclick: () => tCtx.navigate('/activity'), style: 'display:flex;justify-content:space-between;align-items:center' }, [
      h('div', {}, [
        h('span.num', { style: 'font-size:22px;font-weight:600', text: oAct.steps != null ? num(oAct.steps) : '–' }),
        h('span.muted', { text: ' steps' }),
      ]),
      h('div', { style: 'text-align:right' }, [
        h('span.num', { style: 'font-size:22px;font-weight:600', text: oAct.calories != null ? num(oAct.calories) : '–' }),
        h('span.muted', { text: ' kcal burned' }),
      ]),
    ]),
    h('h2', { text: "Today's nutrition" }),
    h('div.card', {}, [oKcalLine, oMacroGrid]),
    ...(oCycleCard || []),
    h('h2', { text: 'Recent workouts' }),
    oRecentCard,
  ]);
}

function stat(sLabel, sValue, sUnit) {
  return h('div.stat', {}, [
    h('div.k', { text: sLabel }),
    h('div.v', {}, [h('span.num', { text: sValue }), sUnit ? h('small', { text: ' ' + sUnit }) : null]),
  ]);
}

function bar(tValue, tGoal) {
  const fPct = tGoal > 0 ? (tValue / tGoal) * 100 : 0;
  const oBar = h('div.bar' + (fPct > 100 ? '.over' : ''), {}, [h('span', { style: 'width:' + Math.min(fPct, 100) + '%' })]);
  return oBar;
}

// whole-day difference between two YYYY-MM-DD strings (b - a), UTC-safe
function daysBetween(sA, sB) {
  const p = (s) => { const a = s.split('-').map(Number); return Date.UTC(a[0], a[1] - 1, a[2]); };
  return Math.round((p(sB) - p(sA)) / 86400000);
}

function greeting() {
  const iHour = new Date().getHours();
  if (iHour < 12) return 'Good morning';
  if (iHour < 18) return 'Good afternoon';
  return 'Good evening';
}
