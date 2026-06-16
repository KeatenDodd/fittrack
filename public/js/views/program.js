'use strict';
import { api } from '../api.js';
import { oStore } from '../store.js';
import { h, mount, num, toast, guard, confirmAction, openSheet } from '../ui.js';
import { pickExercise } from './_pickers.js';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function prettyDate(sIso) {
  return new Date(sIso + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

// Reusable schedule control (used in the builder and the edit sheet).
// getValue() -> { type:'none'|'interval'|'weekdays', interval?, weekdays? }
function scheduleControl(oInitial) {
  const oInit = oInitial || {};
  const oType = h('select', {}, [
    ['none', 'No fixed schedule (start whenever)'],
    ['eod', 'Every other day'],
    ['interval', 'Every N days'],
    ['weekdays', 'Specific days of the week'],
  ].map(([v, t]) => h('option', { value: v, text: t })));
  let sSel = 'none';
  if (oInit.type === 'interval') sSel = oInit.interval === 2 ? 'eod' : 'interval';
  else if (oInit.type === 'weekdays') sSel = 'weekdays';
  oType.value = sSel;

  const oN = h('input.num', { type: 'number', inputmode: 'numeric', min: '1', max: '14',
    value: oInit.interval || 2, style: 'width:90px' });
  const oNWrap = h('label.field', { style: 'margin:0' }, [h('span.lbl', { text: 'Every how many days' }), oN]);

  const oSelDays = new Set(oInit.weekdays || []);
  const oDaysWrap = h('div.chips', {});
  function paintDays() {
    mount(oDaysWrap, DOW.map((d, i) => h('button.chip' + (oSelDays.has(i) ? '.on' : ''), {
      type: 'button', text: d, onclick: () => { if (oSelDays.has(i)) oSelDays.delete(i); else oSelDays.add(i); paintDays(); } })));
  }
  paintDays();

  const oExtra = h('div', { style: 'margin-top:8px' });
  function paintExtra() {
    if (oType.value === 'interval') mount(oExtra, oNWrap);
    else if (oType.value === 'weekdays') mount(oExtra, [h('span.lbl', { style: 'display:block;margin-bottom:6px', text: 'Train on these days' }), oDaysWrap]);
    else mount(oExtra, null);
  }
  oType.addEventListener('change', paintExtra);
  paintExtra();

  const oEl = h('div', {}, [h('label.field', { style: 'margin-bottom:0' }, [h('span.lbl', { text: 'Schedule' }), oType]), oExtra]);
  function getValue() {
    if (oType.value === 'eod') return { type: 'interval', interval: 2 };
    if (oType.value === 'interval') return { type: 'interval', interval: parseInt(oN.value, 10) || 2 };
    if (oType.value === 'weekdays') return { type: 'weekdays', weekdays: [...oSelDays] };
    return { type: 'none' };
  }
  return { el: oEl, getValue };
}

function openScheduleSheet(oProgram, tReload) {
  openSheet('Workout schedule', (tBody, tClose) => {
    const oCtrl = scheduleControl({
      type: oProgram.schedule_type,
      interval: oProgram.schedule_interval,
      weekdays: oProgram.schedule_weekdays ? oProgram.schedule_weekdays.split(',').map(Number) : [],
    });
    mount(tBody, [
      h('p.muted', { style: 'margin-top:0', text: 'FitTrack will tell you whether today is a rest day or a workout day.' }),
      oCtrl.el,
      h('button.btn.btn-accent.btn-block', { type: 'button', text: 'Save schedule', style: 'margin-top:14px',
        onclick: async () => { await guard(api.setProgramSchedule(oProgram.id, oCtrl.getValue())); toast('Schedule saved'); tClose(); tReload(); } }),
    ]);
  });
}

// Today's status banner from the schedule (rest / workout / done).
function scheduleBanner(oProgram) {
  const oT = oProgram.today;
  if (!oT || oT.type === 'none') return null;
  if (oT.status === 'workout') {
    return h('div.sched-banner.work', {}, [h('strong', { text: 'Today is a workout day' })]);
  }
  if (oT.status === 'done') {
    return h('div.sched-banner.rest', {}, [h('strong', { text: 'Done for today' }),
      oT.nextDate ? h('div.faint', { style: 'margin-top:2px', text: 'Next workout: ' + prettyDate(oT.nextDate) }) : null]);
  }
  return h('div.sched-banner.rest', {}, [h('strong', { text: 'Today is a rest day' }),
    oT.nextDate ? h('div.faint', { style: 'margin-top:2px', text: 'Next workout: ' + prettyDate(oT.nextDate) }) : null]);
}

// Deload preview, mirrors targetsFor() on the server so the overview shows the
// same numbers the next workout will be generated with.
function roundTo5(f) { return Math.max(0, Math.round(f / 5) * 5); }
function previewTargets(oEx, bDeload) {
  const fW = oEx.current_weight != null ? Number(oEx.current_weight) : null;
  if (bDeload) {
    return {
      sets: Math.max(1, Math.round(oEx.target_sets * 0.6)),
      lo: oEx.rep_low, hi: oEx.rep_high,
      weight: fW != null ? roundTo5(fW * 0.9) : null,
    };
  }
  return { sets: oEx.target_sets, lo: oEx.rep_low, hi: oEx.rep_high, weight: fW };
}

function targetText(oT) {
  const sReps = oT.lo === oT.hi ? String(oT.lo) : oT.lo + '–' + oT.hi;
  const sW = oT.weight != null ? ' @ ' + num(oT.weight, oT.weight % 1 ? 1 : 0) + ' lb' : '';
  return oT.sets + ' × ' + sReps + sW;
}

// Common set/rep schemes. Fixed-rep schemes (low === high, e.g. 5×5) progress
// linearly: hit every rep at the target weight → weight goes up next time.
// Ranged schemes (e.g. 8–12) use double progression: hit the TOP of the range.
const SCHEMES = [
  { key: 'hyp',  label: '3 × 8–12  ·  Hypertrophy',          sets: 3, repLow: 8,  repHigh: 12, increment: 5 },
  { key: '5x5',  label: '5 × 5  ·  StrongLifts (linear)',    sets: 5, repLow: 5,  repHigh: 5,  increment: 5 },
  { key: '3x5',  label: '3 × 5  ·  Starting Strength',       sets: 3, repLow: 5,  repHigh: 5,  increment: 5 },
  { key: '5x3',  label: '5 × 3  ·  Strength',                sets: 5, repLow: 3,  repHigh: 3,  increment: 5 },
  { key: '4x68', label: '4 × 6–8  ·  Strength',              sets: 4, repLow: 6,  repHigh: 8,  increment: 5 },
  { key: '3x10', label: '3 × 10–15  ·  Pump / accessory',    sets: 3, repLow: 12, repHigh: 15, increment: 5 },
];
function schemeApply(oEx, sKey) {
  const oS = SCHEMES.find((s) => s.key === sKey);
  if (!oS) return;
  oEx.sets = oS.sets; oEx.repLow = oS.repLow; oEx.repHigh = oS.repHigh; oEx.increment = oS.increment;
}
function schemeMatch(oEx) {
  const oS = SCHEMES.find((s) => Number(oEx.sets) === s.sets
    && Number(oEx.repLow) === s.repLow && Number(oEx.repHigh) === s.repHigh);
  return oS ? oS.key : 'custom';
}

export async function render(tRoot, tArgs, tCtx) {
  if (tArgs[0] === 'new') return renderBuilder(tRoot, tCtx);

  mount(tRoot, h('div.empty', { text: 'Loading…' }));
  const [oProgRes, oTplRes] = await Promise.all([api.activeProgram(), api.templates()]);
  renderHub(tRoot, tCtx, oProgRes.program, oTplRes.templates);
}

// ---- hub: single workouts + program (the primary Train screen) ---------------
function renderHub(tRoot, tCtx, oProgram, aTemplates) {
  const reload = () => render(tRoot, [], tCtx);

  async function startEmpty() {
    const oData = await guard(api.startSession({ name: 'Quick workout' }));
    oStore.activeSessionId = oData.session.id; tCtx.navigate('/workout');
  }
  async function startFrom(tId) {
    const oData = await guard(api.startSession({ templateId: tId }));
    oStore.activeSessionId = oData.session.id; tCtx.navigate('/workout');
  }
  async function startNext() {
    const oData = await guard(api.startNextProgramDay(oProgram.id));
    oStore.activeSessionId = oData.sessionId; toast('Workout ready'); tCtx.navigate('/workout');
  }

  // --- single (individual) workout section ---
  const oSingle = h('div', {}, [
    h('h2', { text: 'Single workout' }),
    h('button.btn.btn-accent.btn-block', { type: 'button', text: 'Start empty workout', onclick: startEmpty, style: 'margin-bottom:14px' }),
    h('div.meal-head', {}, [h('span.name', { text: 'From a template' }), h('a', { href: '#/templates', text: 'Manage' })]),
    h('div.card.tight', {}, aTemplates.length
      ? aTemplates.map((oT) => h('div.row.list-link', { onclick: () => startFrom(oT.id) }, [
          h('div', {}, [h('div.label', { text: oT.name }), h('div.sub', { text: oT.exercise_count + ' exercises' })]),
          h('span.faint', { text: 'Start →' }),
        ]))
      : [h('div.empty', {}, [h('p', { text: 'No templates yet.' }), h('a.btn.btn-ghost', { href: '#/templates', text: 'Create one' })])]),
  ]);

  // --- program section ---
  const oProgramSection = oProgram
    ? programSection(tCtx, oProgram, startNext, reload)
    : h('div', {}, [
        h('h2', { text: 'Program' }),
        h('div.empty', {}, [
          h('p', { text: 'Run a structured mesocycle with automatic progressive overload and a deload week — your weights climb as you hit your rep targets, and progress is tracked here.' }),
          h('button.btn.btn-accent', { type: 'button', text: 'Build a program', onclick: () => tCtx.navigate('/program/new') }),
        ]),
      ]);

  mount(tRoot, [
    h('div.page-head', {}, [h('div.eyebrow', { text: 'Train' }), h('h1', { text: 'Start training' })]),
    oStore.activeSessionId
      ? h('button.btn.btn-accent.btn-block', { type: 'button', text: 'Resume current workout',
          onclick: () => tCtx.navigate('/workout'), style: 'margin-bottom:18px' })
      : null,
    oSingle,
    h('div', { style: 'margin-top:26px' }, [oProgramSection]),
  ]);
}

// ---- active program: next workout, metrics, working weights ------------------
function programSection(tCtx, oProgram, tStartNext, tReload) {
  const bDeload = !!oProgram.is_deload_week;
  const oNext = oProgram.next_day;

  const oNextCard = oNext
    ? h('div.card', {}, [
        h('div.meal-head', {}, [
          h('span.name', { text: 'Next: ' + oNext.name }),
          h('span.faint', { text: 'Week ' + oProgram.current_week + (bDeload ? ' · deload' : '') }),
        ]),
        h('div.tight', {}, (oNext.exercises || []).map((oEx) => {
          const oT = previewTargets(oEx, bDeload);
          return h('div.row', {}, [
            h('div', {}, [h('div.label', { text: oEx.exercise_name }),
              oEx.muscle_group ? h('div.sub', { text: oEx.muscle_group }) : null]),
            h('span.num', { text: targetText(oT) }),
          ]);
        })),
        h('button.btn.btn-accent.btn-block', { type: 'button', text: 'Start ' + oNext.name, onclick: tStartNext, style: 'margin-top:12px' }),
      ])
    : h('div.empty', { text: 'This program has no training days.' });

  // working weights = the progressive-overload metric (current weight per lift)
  const aLifts = [];
  for (const oDay of (oProgram.days || [])) for (const oEx of (oDay.exercises || [])) aLifts.push(oEx);
  const oWeights = h('div.card.tight', {}, aLifts.length
    ? aLifts.map((oEx) => h('div.row', {}, [
        h('div', {}, [h('div.label', { text: oEx.exercise_name }),
          h('div.sub', { text: oEx.target_sets + ' × ' + oEx.rep_low + '–' + oEx.rep_high })]),
        h('span.num', { text: oEx.current_weight != null ? num(oEx.current_weight, oEx.current_weight % 1 ? 1 : 0) + ' lb' : '—' }),
      ]))
    : [h('div.empty', { text: 'No exercises in this program.' })]);

  return h('div', {}, [
    h('h2', {}, ['Program', h('span.faint', { style: 'font-weight:400;font-size:13px', text: '  ' + oProgram.name })]),
    scheduleBanner(oProgram),
    h('div.stat-grid', {}, [
      stat('Week', oProgram.current_week + ' / ' + oProgram.weeks, ''),
      stat('Phase', bDeload ? 'Deload' : 'Build', ''),
      stat('Days', String((oProgram.days || []).length), ''),
    ]),
    oNextCard,
    h('h2', { style: 'margin-top:18px', text: 'Working weights' }),
    oWeights,
    h('div.btn-row', { style: 'margin-top:16px' }, [
      h('button.btn.btn-ghost', { type: 'button', text: 'Schedule', onclick: () => openScheduleSheet(oProgram, tReload) }),
      h('button.btn.btn-ghost', { type: 'button', text: 'Restart block',
        onclick: () => confirmAction('Restart at Week 1, Day 1? Your progressed weights are kept.', async () => {
          await guard(api.restartProgram(oProgram.id)); toast('Block restarted'); tReload();
        }) }),
      h('button.btn.btn-ghost', { type: 'button', text: 'New program', onclick: () => tCtx.navigate('/program/new') }),
    ]),
    h('button.btn.btn-block', { type: 'button', text: 'Delete program',
      style: 'margin-top:10px;background:none;color:var(--danger);box-shadow:inset 0 0 0 1px var(--line-strong)',
      onclick: () => confirmAction('Delete "' + oProgram.name + '"? This cannot be undone.', async () => {
        await guard(api.deleteProgram(oProgram.id)); toast('Program deleted'); tReload();
      }) }),
  ]);
}

function stat(sLabel, sValue, sUnit) {
  return h('div.stat', {}, [h('div.k', { text: sLabel }),
    h('div.v', {}, [h('span.num', { text: sValue }), sUnit ? h('small', { text: ' ' + sUnit }) : null])]);
}

// ---- builder -----------------------------------------------------------------
function renderBuilder(tRoot, tCtx) {
  const oDraft = {
    name: '',
    weeks: 5,
    deloadEnabled: true,
    defaultScheme: 'hyp',
    days: [{ name: 'Day 1', exercises: [] }],
  };

  const oName = h('input', { type: 'text', placeholder: 'e.g. StrongLifts 5×5' });
  oName.addEventListener('input', () => { oDraft.name = oName.value; });

  const oWeeks = h('input.num', { type: 'number', inputmode: 'numeric', value: '5', min: '2', max: '12', style: 'width:80px' });
  oWeeks.addEventListener('input', () => { oDraft.weeks = oWeeks.value; });

  const oDeload = h('input', { type: 'checkbox', checked: true });
  oDeload.addEventListener('change', () => { oDraft.deloadEnabled = oDeload.checked; });

  const oScheme = h('select', {}, SCHEMES.map((s) =>
    h('option', { value: s.key, text: s.label, selected: s.key === oDraft.defaultScheme })));
  oScheme.addEventListener('change', () => { oDraft.defaultScheme = oScheme.value; });

  const oSchedCtrl = scheduleControl(null);

  const oDaysRoot = h('div');

  function renderDays() {
    mount(oDaysRoot, oDraft.days.map((oDay, iDay) => dayCard(oDay, iDay)));
  }

  function dayCard(oDay, iDay) {
    const oDayName = h('input', { type: 'text', value: oDay.name, placeholder: 'Day name', style: 'font-weight:600' });
    oDayName.addEventListener('input', () => { oDay.name = oDayName.value; });

    const oExRoot = h('div');
    function renderExercises() {
      mount(oExRoot, oDay.exercises.length
        ? oDay.exercises.map((oEx, iEx) => exerciseRow(oDay, oEx, iEx, renderExercises))
        : h('p.muted', { style: 'padding:6px 2px', text: 'No exercises yet.' }));
    }
    renderExercises();

    return h('div.card', {}, [
      h('div', { style: 'display:flex;gap:8px;align-items:center;margin-bottom:8px' }, [
        h('div', { style: 'flex:1' }, [oDayName]),
        oDraft.days.length > 1 ? h('button.icon-btn', { type: 'button', text: '×', title: 'Remove day',
          onclick: () => { oDraft.days.splice(iDay, 1); renderDays(); } }) : null,
      ]),
      oExRoot,
      h('button.btn.btn-ghost.btn-block', { type: 'button', text: '+ Add exercise', style: 'margin-top:8px',
        onclick: () => pickExercise((oPicked) => {
          const oNew = {
            exerciseId: oPicked.id, exercise_name: oPicked.name, muscle_group: oPicked.muscle_group,
            sets: 3, repLow: 8, repHigh: 12, weight: '', increment: 5,
          };
          schemeApply(oNew, oDraft.defaultScheme);
          oDay.exercises.push(oNew);
          renderExercises();
        }) }),
    ]);
  }

  function exerciseRow(oDay, oEx, iEx, reRender) {
    const mk = (sKey, sPlaceholder, sWidth) => {
      const oInput = h('input.num', { type: 'number', inputmode: 'decimal', placeholder: sPlaceholder,
        value: oEx[sKey] === '' || oEx[sKey] == null ? '' : oEx[sKey], step: 'any', style: 'width:' + sWidth });
      oInput.addEventListener('input', () => { oEx[sKey] = oInput.value; });
      return oInput;
    };
    const oSchemeSel = h('select', {}, [
      ...SCHEMES.map((s) => h('option', { value: s.key, text: s.label })),
      h('option', { value: 'custom', text: 'Custom' }),
    ]);
    oSchemeSel.value = schemeMatch(oEx);
    oSchemeSel.addEventListener('change', () => {
      if (oSchemeSel.value !== 'custom') { schemeApply(oEx, oSchemeSel.value); reRender(); }
    });

    return h('div', { style: 'padding:8px 0;border-top:1px solid var(--line)' }, [
      h('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:6px' }, [
        h('strong', { text: oEx.exercise_name }),
        h('button.icon-btn', { type: 'button', text: '×', title: 'Remove',
          onclick: () => { oDay.exercises.splice(iEx, 1); reRender(); } }),
      ]),
      h('label.field', {}, [h('span.lbl', { text: 'Scheme' }), oSchemeSel]),
      h('div.inline-fields', { style: 'flex-wrap:wrap;gap:8px' }, [
        field('Sets', mk('sets', '3', '56px')),
        field('Rep low', mk('repLow', '8', '56px')),
        field('Rep high', mk('repHigh', '12', '56px')),
        field('Start lb', mk('weight', 'opt', '70px')),
        field('+lb / win', mk('increment', '5', '60px')),
      ]),
    ]);
  }

  function field(sLabel, oInput) {
    return h('label.field', { style: 'flex:0 0 auto' }, [h('span.lbl', { text: sLabel }), oInput]);
  }

  async function save() {
    if (!oName.value.trim()) { toast('Name your program'); return; }
    const aDays = oDraft.days
      .map((d) => ({ name: d.name, exercises: d.exercises }))
      .filter((d) => d.exercises.length);
    if (!aDays.length) { toast('Add at least one exercise'); return; }
    const oData = await guard(api.createProgram({
      name: oName.value.trim(),
      weeks: parseInt(oWeeks.value, 10) || 5,
      deloadEnabled: oDeload.checked,
      schedule: oSchedCtrl.getValue(),
      days: aDays,
    }));
    toast('Program created');
    tCtx.navigate('/program');
    return oData;
  }

  mount(tRoot, [
    h('div.page-head', {}, [h('div.eyebrow', { text: 'Program' }), h('h1', { text: 'Build a program' })]),
    h('div.card', {}, [
      h('label.field', {}, [h('span.lbl', { text: 'Program name' }), oName]),
      h('div.inline-fields', { style: 'align-items:flex-end' }, [
        h('label.field', { style: 'flex:0 0 auto' }, [h('span.lbl', { text: 'Weeks (2–12)' }), oWeeks]),
        h('label', { style: 'display:flex;gap:8px;align-items:center;padding-bottom:10px' },
          [oDeload, h('span.faint', { text: 'Auto-deload last week' })]),
      ]),
      h('label.field', {}, [
        h('span.lbl', { text: 'Default scheme for new exercises' }), oScheme]),
      oSchedCtrl.el,
    ]),
    h('h2', { text: 'Training days' }),
    oDaysRoot,
    h('button.btn.btn-ghost.btn-block', { type: 'button', text: '+ Add training day', style: 'margin-top:6px',
      onclick: () => { oDraft.days.push({ name: 'Day ' + (oDraft.days.length + 1), exercises: [] }); renderDays(); } }),
    h('button.btn.btn-accent.btn-block', { type: 'button', text: 'Create program', onclick: save, style: 'margin-top:18px' }),
    h('a.btn.btn-ghost.btn-block', { href: '#/program', text: 'Cancel', style: 'margin-top:8px' }),
  ]);

  renderDays();
  oName.focus();
}
