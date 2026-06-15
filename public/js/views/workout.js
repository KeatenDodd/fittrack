'use strict';
import { api } from '../api.js';
import { oStore } from '../store.js';
import { h, mount, num, clock, toast, confirmAction, guard } from '../ui.js';
import { pickExercise } from './_pickers.js';

let oTick = null;          // 1s interval (elapsed + rest)
let oRest = null;          // { iLeft, iTotal } or null
const DEFAULT_REST = 120;

function stopTick() { if (oTick) { clearInterval(oTick); oTick = null; } }

// Build a short toast from the program progression result returned by /finish.
function progressionToast(oProg) {
  if (!oProg) return 'Workout saved';
  if (oProg.wasDeload) return 'Deload done — next block at Week 1';
  const aUp = (oProg.summary || []).filter((s) => s.action === 'up');
  let sMsg = aUp.length
    ? 'Progressed: ' + aUp.map((s) => s.exercise + ' →' + s.weight).join(', ')
    : 'Workout saved — chase those reps next time';
  if (oProg.newBlock) sMsg += ' · new block';
  return sMsg;
}

export async function render(tRoot, tArgs, tCtx) {
  stopTick();
  oRest = null;

  const sActive = oStore.activeSessionId;
  if (!sActive) return renderStart(tRoot, tCtx);

  let oSession;
  try {
    oSession = (await api.session(sActive)).session;
  } catch (tErr) {
    oStore.activeSessionId = null;
    return renderStart(tRoot, tCtx);
  }
  if (oSession.ended_at) { oStore.activeSessionId = null; return renderStart(tRoot, tCtx); }

  renderActive(tRoot, tCtx, oSession);
}

// ---- start screen ------------------------------------------------------------
async function renderStart(tRoot, tCtx) {
  mount(tRoot, h('div.empty', { text: 'Loading…' }));
  const [oTemplatesRes, oProgramRes] = await Promise.all([
    api.templates(),
    api.activeProgram().catch(() => ({ program: null })),
  ]);
  const oTemplates = oTemplatesRes.templates;
  const oProgram = oProgramRes.program;

  async function startEmpty() {
    const oData = await guard(api.startSession({ name: 'Quick workout' }));
    oStore.activeSessionId = oData.session.id;
    tCtx.navigate('/workout');
  }
  async function startFrom(tId) {
    const oData = await guard(api.startSession({ templateId: tId }));
    oStore.activeSessionId = oData.session.id;
    tCtx.navigate('/workout');
  }
  async function startProgram() {
    const oData = await guard(api.startNextProgramDay(oProgram.id));
    oStore.activeSessionId = oData.sessionId;
    tCtx.navigate('/workout');
  }

  const oProgramCard = oProgram && oProgram.next_day
    ? h('div.card', { style: 'margin-bottom:20px' }, [
        h('div.meal-head', {}, [
          h('span.name', { text: oProgram.name }),
          h('a', { href: '#/program', text: 'Manage' }),
        ]),
        h('div.muted', { style: 'margin:2px 0 10px',
          text: 'Next: ' + oProgram.next_day.name + ' · Week ' + oProgram.current_week + ' of '
            + oProgram.weeks + (oProgram.is_deload_week ? ' (deload)' : '') }),
        h('button.btn.btn-accent.btn-block', { type: 'button',
          text: 'Start ' + oProgram.next_day.name, onclick: startProgram }),
      ])
    : null;

  mount(tRoot, [
    h('div.page-head', {}, [h('div.eyebrow', { text: 'Workout' }), h('h1', { text: 'Start training' })]),
    oProgramCard,
    h('button.btn.btn-accent.btn-block', { type: 'button', text: 'Start empty workout', onclick: startEmpty, style: 'margin-bottom:20px' }),
    h('div.meal-head', {}, [h('span.name', { text: 'From a template' }),
      h('a', { href: '#/templates', text: 'Manage' })]),
    h('div.card.tight', {}, oTemplates.length
      ? oTemplates.map((oT) => h('div.row.list-link', { onclick: () => startFrom(oT.id) }, [
          h('div', {}, [h('div.label', { text: oT.name }),
            h('div.sub', { text: oT.exercise_count + ' exercises' })]),
          h('span.faint', { text: 'Start →' }),
        ]))
      : [h('div.empty', {}, [h('p', { text: 'No templates yet.' }),
          h('a.btn.btn-ghost', { href: '#/templates', text: 'Create one' })])]),
  ]);
}

// ---- active session ----------------------------------------------------------
function renderActive(tRoot, tCtx, oSession) {
  const oElapsed = h('span.num');
  const oRestRoot = h('div');

  function paintElapsed() {
    const iSec = Math.floor((Date.now() - new Date(oSession.started_at).getTime()) / 1000);
    oElapsed.textContent = clock(iSec);
  }
  function paintRest() {
    if (!oRest) { mount(oRestRoot, null); return; }
    mount(oRestRoot, h('div.rest-timer', {}, [
      h('span.faint', { text: 'Rest' }),
      h('span.t', { text: clock(oRest.iLeft) }),
      h('button', { type: 'button', text: '+30', onclick: () => { oRest.iLeft += 30; paintRest(); } }),
      h('button', { type: 'button', text: 'Skip', onclick: () => { oRest = null; paintRest(); } }),
    ]));
  }
  function startRest(iSeconds) { oRest = { iLeft: iSeconds || DEFAULT_REST }; paintRest(); }

  stopTick();
  oTick = setInterval(() => {
    paintElapsed();
    if (oRest) {
      oRest.iLeft -= 1;
      if (oRest.iLeft <= 0) { oRest = null; toast('Rest done'); }
      paintRest();
    }
  }, 1000);
  paintElapsed();

  async function reload() {
    oSession = (await api.session(oSession.id)).session;
    paintExercises();
  }

  async function finish() {
    const oRes = await guard(api.finishSession(oSession.id));
    oStore.activeSessionId = null;
    stopTick();
    toast(progressionToast(oRes && oRes.progression));
    tCtx.navigate('/history/' + oSession.id);
  }

  function addExercise() {
    pickExercise(async (oExercise) => {
      await guard(api.addSessionExercise(oSession.id, oExercise.id));
      reload();
    });
  }

  const oExerciseRoot = h('div');

  function paintExercises() {
    if (!oSession.exercises.length) {
      mount(oExerciseRoot, h('div.empty', {}, [h('p', { text: 'No exercises yet.' }),
        h('button.btn.btn-ghost', { type: 'button', text: 'Add exercise', onclick: addExercise })]));
      return;
    }
    mount(oExerciseRoot, oSession.exercises.map((oEx) => exerciseCard(oEx, { reload, startRest })));
  }

  mount(tRoot, [
    h('div.page-head', { style: 'display:flex;justify-content:space-between;align-items:flex-start' }, [
      h('div', {}, [h('div.eyebrow', {}, ['Elapsed ', oElapsed]),
        h('h1', { text: oSession.name || 'Workout' })]),
      h('button.btn.btn-accent.btn-sm', { type: 'button', text: 'Finish', onclick: finish }),
    ]),
    oExerciseRoot,
    h('button.btn.btn-ghost.btn-block', { type: 'button', text: '+ Add exercise', onclick: addExercise, style: 'margin-top:6px' }),
    h('button.btn.btn-block', { type: 'button', text: 'Discard workout', style: 'margin-top:10px;background:none;color:var(--danger);box-shadow:inset 0 0 0 1px var(--line-strong)',
      onclick: () => confirmAction('Discard this workout and all its sets?', async () => {
        await guard(api.deleteSession(oSession.id));
        oStore.activeSessionId = null; stopTick(); toast('Discarded'); tCtx.navigate('/dashboard');
      }) }),
    oRestRoot,
  ]);

  paintExercises();
}

function exerciseCard(oEx, tCtx) {
  const oWeight = h('input.num', { type: 'number', inputmode: 'decimal', placeholder: 'lb', step: 'any' });
  const oReps = h('input.num', { type: 'number', inputmode: 'numeric', placeholder: 'reps' });

  // prefill from last logged set; otherwise from the program target (if any)
  const oLast = oEx.sets[oEx.sets.length - 1];
  const bHasTarget = oEx.target_sets != null;
  if (oLast) {
    if (oLast.weight != null) oWeight.value = oLast.weight;
    if (oLast.reps != null) oReps.value = oLast.reps;
  } else if (bHasTarget) {
    if (oEx.target_weight != null) oWeight.value = oEx.target_weight;
    if (oEx.target_rep_high != null) oReps.placeholder = oEx.target_rep_low + '–' + oEx.target_rep_high;
  }

  let oTargetLine = null;
  if (bHasTarget) {
    const sReps = oEx.target_rep_low === oEx.target_rep_high
      ? String(oEx.target_rep_low) : oEx.target_rep_low + '–' + oEx.target_rep_high;
    const sW = oEx.target_weight != null ? ' @ ' + num(oEx.target_weight, oEx.target_weight % 1 ? 1 : 0) + ' lb' : '';
    oTargetLine = h('div.faint', { style: 'margin-bottom:8px',
      text: 'Target  ' + oEx.target_sets + ' × ' + sReps + sW });
  }

  async function addSet() {
    const oBody = {
      weight: oWeight.value === '' ? null : Number(oWeight.value),
      reps: oReps.value === '' ? null : Number(oReps.value),
      restSeconds: oLast && oLast.rest_seconds ? oLast.rest_seconds : null,
    };
    await guard(api.addSet(oEx.id, oBody));
    tCtx.startRest(oBody.restSeconds);
    await tCtx.reload();
  }

  const oRows = oEx.sets.map((oSet) => h('tr', {}, [
    h('td.n' + (oSet.is_warmup ? '.warm' : ''), { text: oSet.is_warmup ? 'W' : String(oSet.set_number) }),
    h('td.num', { text: oSet.weight != null ? num(oSet.weight, oSet.weight % 1 ? 1 : 0) : '–' }),
    h('td.num', { text: oSet.reps != null ? String(oSet.reps) : '–' }),
    h('td', { style: 'text-align:right' }, [
      h('button.icon-btn', { type: 'button', text: '\u00d7', title: 'Delete set',
        onclick: async () => { await guard(api.deleteSet(oSet.id)); tCtx.reload(); } }),
    ]),
  ]));

  [oWeight, oReps].forEach((tInput) =>
    tInput.addEventListener('keydown', (tEvent) => { if (tEvent.key === 'Enter') addSet(); }));

  // Per-exercise note for this workout — surfaces later in Progress.
  const oNote = h('input.note-input', { type: 'text', value: oEx.notes || '',
    placeholder: 'Note (e.g. shoulder felt tight, low energy)…' });
  let sSavedNote = oEx.notes || '';
  async function saveNote() {
    const sVal = oNote.value.trim();
    if (sVal === sSavedNote) return;
    sSavedNote = sVal;
    oEx.notes = sVal;
    try { await api.setSessionExerciseNote(oEx.id, sVal); toast('Note saved'); }
    catch (tErr) { toast(tErr.message || 'Could not save note'); }
  }
  oNote.addEventListener('blur', saveNote);
  oNote.addEventListener('keydown', (tEvent) => { if (tEvent.key === 'Enter') oNote.blur(); });

  return h('div.card', {}, [
    h('div', { style: 'display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px' }, [
      h('div', {}, [h('strong', { text: oEx.exercise_name }),
        oEx.muscle_group ? h('span.faint', { text: '  ' + oEx.muscle_group }) : null]),
      h('button.icon-btn', { type: 'button', text: '\u22ef', title: 'Remove exercise',
        onclick: () => confirmAction('Remove ' + oEx.exercise_name + ' from this workout?', async () => {
          await guard(api.removeSessionExercise(oEx.id)); tCtx.reload();
        }) }),
    ]),
    oTargetLine,
    oEx.sets.length ? h('table.set-table', {}, [
      h('thead', {}, h('tr', {}, [h('th.n', { text: '#' }), h('th', { text: 'Weight' }), h('th', { text: 'Reps' }), h('th', {})])),
      h('tbody', {}, oRows),
    ]) : null,
    h('div.inline-fields', { style: 'margin-top:10px' }, [
      h('div', { style: 'flex:1' }, [oWeight]),
      h('div', { style: 'flex:1' }, [oReps]),
      h('button.btn.btn-sm', { type: 'button', text: 'Add set', onclick: addSet, style: 'flex:0 0 auto' }),
    ]),
    h('div', { style: 'margin-top:8px' }, [oNote]),
  ]);
}
