'use strict';
import { api } from '../api.js';
import { oStore } from '../store.js';
import { h, mount, num, toast, guard, confirmAction } from '../ui.js';
import { pickExercise } from './_pickers.js';

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

export async function render(tRoot, tArgs, tCtx) {
  if (tArgs[0] === 'new') return renderBuilder(tRoot, tCtx);

  mount(tRoot, h('div.empty', { text: 'Loading…' }));
  const oProgram = (await api.activeProgram()).program;

  if (!oProgram) {
    mount(tRoot, [
      h('div.page-head', {}, [h('div.eyebrow', { text: 'Program' }), h('h1', { text: 'Mesocycle' })]),
      h('div.empty', {}, [
        h('p', { text: 'No active program. A program plans your training over a block of weeks and automatically progresses weight/reps and schedules a deload.' }),
        h('button.btn.btn-accent', { type: 'button', text: 'Build a program',
          onclick: () => tCtx.navigate('/program/new') }),
      ]),
    ]);
    return;
  }

  renderOverview(tRoot, tCtx, oProgram);
}

// ---- active program overview -------------------------------------------------
function renderOverview(tRoot, tCtx, oProgram) {
  const bDeload = !!oProgram.is_deload_week;
  const oNext = oProgram.next_day;

  async function startNext() {
    const oData = await guard(api.startNextProgramDay(oProgram.id));
    oStore.activeSessionId = oData.sessionId;
    toast('Workout ready');
    tCtx.navigate('/workout');
  }

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
        h('button.btn.btn-accent.btn-block', { type: 'button',
          text: 'Start ' + oNext.name, onclick: startNext, style: 'margin-top:12px' }),
      ])
    : h('div.empty', { text: 'This program has no training days.' });

  // full structure (all days)
  const oStructure = h('div.card.tight', {}, (oProgram.days || []).map((oDay, iIdx) =>
    h('div.row', {}, [
      h('div', {}, [
        h('div.label', { text: oDay.name + (iIdx === oProgram.current_day_index ? '  ◀ next' : '') }),
        h('div.sub', { text: (oDay.exercises || []).map((e) => e.exercise_name).join(', ') || 'No exercises' }),
      ]),
    ])
  ));

  mount(tRoot, [
    h('div.page-head', {}, [
      h('div.eyebrow', { text: 'Program' + (bDeload ? ' · deload week' : '') }),
      h('h1', { text: oProgram.name }),
      h('div.muted', { text: 'Week ' + oProgram.current_week + ' of ' + oProgram.weeks
        + (oProgram.deload_enabled ? ' · auto-deload on the last week' : '') }),
    ]),
    oNextCard,
    h('h2', { text: 'Training days' }),
    oStructure,
    h('div.btn-row', { style: 'margin-top:16px' }, [
      h('button.btn.btn-ghost', { type: 'button', text: 'Restart block',
        onclick: () => confirmAction('Restart at Week 1, Day 1? Your progressed weights are kept.', async () => {
          await guard(api.restartProgram(oProgram.id)); toast('Block restarted'); render(tRoot, [], tCtx);
        }) }),
      h('button.btn.btn-ghost', { type: 'button', text: 'New program',
        onclick: () => tCtx.navigate('/program/new') }),
    ]),
    h('button.btn.btn-block', { type: 'button', text: 'Delete program',
      style: 'margin-top:10px;background:none;color:var(--danger);box-shadow:inset 0 0 0 1px var(--line-strong)',
      onclick: () => confirmAction('Delete "' + oProgram.name + '"? This cannot be undone.', async () => {
        await guard(api.deleteProgram(oProgram.id)); toast('Program deleted'); render(tRoot, [], tCtx);
      }) }),
  ]);
}

// ---- builder -----------------------------------------------------------------
function renderBuilder(tRoot, tCtx) {
  const oDraft = {
    name: '',
    weeks: 5,
    deloadEnabled: true,
    days: [{ name: 'Day 1', exercises: [] }],
  };

  const oName = h('input', { type: 'text', placeholder: 'e.g. Hypertrophy block' });
  oName.addEventListener('input', () => { oDraft.name = oName.value; });

  const oWeeks = h('input.num', { type: 'number', inputmode: 'numeric', value: '5', min: '2', max: '12', style: 'width:80px' });
  oWeeks.addEventListener('input', () => { oDraft.weeks = oWeeks.value; });

  const oDeload = h('input', { type: 'checkbox', checked: true });
  oDeload.addEventListener('change', () => { oDraft.deloadEnabled = oDeload.checked; });

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
          oDay.exercises.push({
            exerciseId: oPicked.id, exercise_name: oPicked.name, muscle_group: oPicked.muscle_group,
            sets: 3, repLow: 8, repHigh: 12, weight: '', increment: 5,
          });
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
    return h('div', { style: 'padding:8px 0;border-top:1px solid var(--line)' }, [
      h('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:6px' }, [
        h('strong', { text: oEx.exercise_name }),
        h('button.icon-btn', { type: 'button', text: '×', title: 'Remove',
          onclick: () => { oDay.exercises.splice(iEx, 1); reRender(); } }),
      ]),
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
