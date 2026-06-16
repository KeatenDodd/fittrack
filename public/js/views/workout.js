'use strict';
import { api } from '../api.js';
import { oStore } from '../store.js';
import { h, mount, num, clock, toast, confirmAction, guard, openSheet, restGap } from '../ui.js';
import { pickExercise } from './_pickers.js';
import { unlockAudio, playBell } from '../sound.js';

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

  // The Program hub owns starting workouts; /workout only renders a live session.
  const sActive = oStore.activeSessionId;
  if (!sActive) { tCtx.navigate('/program'); return; }

  let oSession;
  try {
    oSession = (await api.session(sActive)).session;
  } catch (tErr) {
    oStore.activeSessionId = null;
    tCtx.navigate('/program');
    return;
  }
  if (oSession.ended_at) { oStore.activeSessionId = null; tCtx.navigate('/program'); return; }

  renderActive(tRoot, tCtx, oSession);
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
      if (oRest.iLeft <= 0) { oRest = null; toast('Rest done'); playBell(); }
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
    const oGroups = supersetLabels(oSession.exercises);
    mount(oExerciseRoot, oSession.exercises.map((oEx) =>
      exerciseCard(oEx, { reload, startRest, session: oSession, groups: oGroups })));
  }

  mount(tRoot, [
    h('div.page-head', { style: 'display:flex;justify-content:space-between;align-items:flex-start' }, [
      h('div', {}, [h('div.eyebrow', {}, ['Elapsed ', oElapsed]),
        h('h1', { text: oSession.name || 'Workout' })]),
      h('button.btn.btn-ghost.btn-sm', { type: 'button', text: 'Finish', onclick: finish }),
    ]),
    oExerciseRoot,
    h('button.btn.btn-ghost.btn-block', { type: 'button', text: '+ Add exercise', onclick: addExercise, style: 'margin-top:6px' }),
    // Primary Finish lives at the bottom -- that's where you land after scrolling
    // down through the workout vertically.
    h('button.btn.btn-accent.btn-block', { type: 'button', text: 'Finish workout', onclick: finish, style: 'margin-top:18px' }),
    h('button.btn.btn-block', { type: 'button', text: 'Discard workout', style: 'margin-top:10px;background:none;color:var(--danger);box-shadow:inset 0 0 0 1px var(--line-strong)',
      onclick: () => confirmAction('Discard this workout and all its sets?', async () => {
        await guard(api.deleteSession(oSession.id));
        oStore.activeSessionId = null; stopTick(); toast('Discarded'); tCtx.navigate('/dashboard');
      }) }),
    oRestRoot,
  ]);

  paintExercises();
}

// Assign A, B, C... labels to distinct superset groups, in first-seen order.
function supersetLabels(aExercises) {
  const oMap = {}; let i = 0;
  for (const oEx of aExercises) {
    if (oEx.superset_group != null && !(oEx.superset_group in oMap)) {
      oMap[oEx.superset_group] = String.fromCharCode(65 + i); i += 1;
    }
  }
  return oMap;
}

// Set-type cell label + css class.
const SET_TYPE_MARK = { warmup: { t: 'W', c: '.warm' }, myo: { t: 'M', c: '.myo' }, drop: { t: 'D', c: '.drop' } };
const SET_TYPE_CYCLE = ['normal', 'warmup', 'myo', 'drop'];
function setTypeOf(oSet) { return oSet.set_type || (oSet.is_warmup ? 'warmup' : 'normal'); }
function setMarkerCell(oSet, tOnClick) {
  const oM = SET_TYPE_MARK[setTypeOf(oSet)];
  return h('td.n' + (oM ? oM.c : ''), { title: 'Tap to change set type', style: 'cursor:pointer',
    text: oM ? oM.t : String(oSet.set_number), onclick: tOnClick });
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

  // Set-type chip for the add row -- tap to cycle Normal -> Warmup -> Myo -> Drop.
  let sAddType = 'normal';
  const oTypeChip = h('button.type-chip', { type: 'button', title: 'Set type', style: 'flex:0 0 auto' });
  function paintTypeChip() {
    const oM = SET_TYPE_MARK[sAddType];
    oTypeChip.textContent = oM ? oM.t : '·';
    oTypeChip.className = 'type-chip' + (oM ? ' on' : '');
  }
  oTypeChip.addEventListener('click', () => {
    sAddType = SET_TYPE_CYCLE[(SET_TYPE_CYCLE.indexOf(sAddType) + 1) % SET_TYPE_CYCLE.length];
    paintTypeChip();
  });
  paintTypeChip();

  async function addSet() {
    unlockAudio(); // this tap lets the rest-done sound play later (iOS)
    const oBody = {
      weight: oWeight.value === '' ? null : Number(oWeight.value),
      reps: oReps.value === '' ? null : Number(oReps.value),
      setType: sAddType,
      restSeconds: oLast && oLast.rest_seconds ? oLast.rest_seconds : null,
    };
    await guard(api.addSet(oEx.id, oBody));
    if (sAddType !== 'warmup') tCtx.startRest(oBody.restSeconds);
    await tCtx.reload();
  }

  // Tap a set's marker cell to cycle its type (warmup / myo / drop / normal).
  async function cycleType(oSet) {
    const sNext = SET_TYPE_CYCLE[(SET_TYPE_CYCLE.indexOf(setTypeOf(oSet)) + 1) % SET_TYPE_CYCLE.length];
    await guard(api.updateSet(oSet.id, {
      weight: oSet.weight, reps: oSet.reps, restSeconds: oSet.rest_seconds,
      rpe: oSet.rpe, notes: oSet.notes, setType: sNext,
    }));
    tCtx.reload();
  }

  const oRows = oEx.sets.map((oSet, i) => h('tr', {}, [
    setMarkerCell(oSet, () => cycleType(oSet)),
    h('td.num', { text: oSet.weight != null ? num(oSet.weight, oSet.weight % 1 ? 1 : 0) : '–' }),
    h('td.num', { text: oSet.reps != null ? String(oSet.reps) : '–' }),
    h('td.num.rest', { text: (i > 0 && restGap(oEx.sets[i - 1], oSet)) || '–' }),
    h('td', { style: 'text-align:right' }, [
      h('button.icon-btn', { type: 'button', text: '×', title: 'Delete set',
        onclick: async () => { await guard(api.deleteSet(oSet.id)); tCtx.reload(); } }),
    ]),
  ]));

  [oWeight, oReps].forEach((tInput) =>
    tInput.addEventListener('keydown', (tEvent) => { if (tEvent.key === 'Enter') addSet(); }));

  // Per-exercise note for this workout -- surfaces later in Progress.
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

  // Set videos -- film a lift and attach it to this exercise.
  function pickVideo() {
    const oInput = h('input', { type: 'file', accept: 'video/*', style: 'display:none' });
    oInput.addEventListener('change', async () => {
      const oFile = oInput.files && oInput.files[0];
      if (!oFile) return;
      toast('Uploading video…');
      try { await api.addExerciseMedia(oEx.id, oFile); toast('Video added'); tCtx.reload(); }
      catch (tErr) { toast(tErr.message || 'Upload failed'); }
    });
    oInput.click();
  }
  const oMediaRow = h('div.clip-row', {}, [
    ...(oEx.media || []).map((oM) => clipTile(oM, oEx, tCtx)),
    h('button.btn.btn-ghost.btn-sm', { type: 'button', text: '🎥 Add video', onclick: pickVideo }),
  ]);

  const sGroupLabel = (oEx.superset_group != null && tCtx.groups) ? tCtx.groups[oEx.superset_group] : null;

  return h('div.card', {}, [
    h('div', { style: 'display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px' }, [
      h('div', {}, [h('strong', { text: oEx.exercise_name }),
        oEx.muscle_group ? h('span.faint', { text: '  ' + oEx.muscle_group }) : null,
        sGroupLabel ? h('span.ss-badge', { text: 'Superset ' + sGroupLabel }) : null]),
      h('button.icon-btn', { type: 'button', text: '⋯', title: 'Options',
        onclick: () => openExerciseMenu(oEx, tCtx) }),
    ]),
    oTargetLine,
    oEx.sets.length ? h('table.set-table', {}, [
      h('thead', {}, h('tr', {}, [h('th.n', { text: '#' }), h('th', { text: 'Weight' }), h('th', { text: 'Reps' }), h('th', { text: 'Rest' }), h('th', {})])),
      h('tbody', {}, oRows),
    ]) : null,
    h('div.inline-fields', { style: 'margin-top:10px' }, [
      oTypeChip,
      h('div', { style: 'flex:1' }, [oWeight]),
      h('div', { style: 'flex:1' }, [oReps]),
      h('button.btn.btn-sm', { type: 'button', text: 'Add set', onclick: addSet, style: 'flex:0 0 auto' }),
    ]),
    h('div', { style: 'margin-top:8px' }, [oNote]),
    oMediaRow,
  ]);
}

// Exercise options sheet: superset link/unlink + remove.
function openExerciseMenu(oEx, tCtx) {
  const aSiblings = (tCtx.session.exercises || []).filter((e) => e.id !== oEx.id);
  openSheet(oEx.exercise_name, (tBody, tClose) => {
    const aActions = [];
    if (aSiblings.length) {
      aActions.push(h('button.btn.btn-ghost.btn-block', { type: 'button', text: 'Superset with…',
        onclick: () => { tClose(); openSupersetPick(oEx, aSiblings, tCtx); } }));
    }
    if (oEx.superset_group != null) {
      aActions.push(h('button.btn.btn-ghost.btn-block', { type: 'button', text: 'Unlink superset',
        style: 'margin-top:8px', onclick: async () => { tClose(); await guard(api.unlinkSuperset(oEx.id)); tCtx.reload(); } }));
    }
    aActions.push(h('button.btn.btn-block', { type: 'button', text: 'Remove exercise',
      style: 'margin-top:8px;background:none;color:var(--danger);box-shadow:inset 0 0 0 1px var(--line-strong)',
      onclick: () => { tClose(); confirmAction('Remove ' + oEx.exercise_name + ' from this workout?', async () => {
        await guard(api.removeSessionExercise(oEx.id)); tCtx.reload(); }); } }));
    mount(tBody, aActions);
  });
}

function openSupersetPick(oEx, aSiblings, tCtx) {
  openSheet('Superset with', (tBody, tClose) => {
    mount(tBody, h('div.card.tight', {}, aSiblings.map((e) =>
      h('div.row.list-link', { onclick: async () => {
        tClose(); await guard(api.supersetExercise(oEx.id, e.id)); toast('Supersetted'); tCtx.reload();
      } }, [
        h('div', {}, [h('div.label', { text: e.exercise_name }),
          e.muscle_group ? h('div.sub', { text: e.muscle_group }) : null]),
        h('span.faint', { text: 'Link →' }),
      ]))));
  });
}

// A small play tile for an attached clip (tap to view / move / delete).
function clipTile(oM, oEx, tCtx) {
  return h('div.clip', { onclick: () => openClip(oM, oEx, tCtx) }, [h('span.clip-play', { text: '▶' })]);
}

function openClip(oM, oEx, tCtx) {
  openSheet(oEx.exercise_name, (tBody, tClose) => {
    mount(tBody, [
      h('video', { src: oM.url, controls: true, playsinline: true, style: 'width:100%;border-radius:8px' }),
      h('div.btn-row', { style: 'margin-top:12px' }, [
        h('button.btn.btn-ghost', { type: 'button', text: 'Move to another exercise',
          onclick: () => { tClose(); openClipMove(oM, oEx, tCtx); } }),
        h('button.btn', { type: 'button', text: 'Delete', style: 'background:var(--danger)',
          onclick: () => { tClose(); confirmAction('Delete this clip?', async () => {
            await guard(api.deleteExerciseMedia(oM.id)); tCtx.reload(); }); } }),
      ]),
    ]);
  });
}

function openClipMove(oM, oEx, tCtx) {
  const aTargets = (tCtx.session.exercises || []).filter((e) => e.id !== oEx.id);
  openSheet('Move clip to…', (tBody, tClose) => {
    mount(tBody, aTargets.length
      ? h('div.card.tight', {}, aTargets.map((e) =>
          h('div.row.list-link', { onclick: async () => {
            tClose(); await guard(api.moveExerciseMedia(oM.id, e.id)); toast('Clip moved'); tCtx.reload();
          } }, [
            h('div', {}, [h('div.label', { text: e.exercise_name })]),
            h('span.faint', { text: 'Move →' }),
          ])))
      : h('p.muted', { text: 'No other exercises in this workout to move it to.' }));
  });
}
