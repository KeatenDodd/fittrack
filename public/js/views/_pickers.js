'use strict';
import { api } from '../api.js';
import { h, mount, openSheet, toast, guard } from '../ui.js';

let oExerciseCache = null;

export async function loadExercises(isForce) {
  if (!oExerciseCache || isForce) {
    const oData = await api.exercises();
    oExerciseCache = oData.exercises;
  }
  return oExerciseCache;
}

// Opens a searchable list of exercises. Calls tOnPick(exercise) on selection.
export function pickExercise(tOnPick) {
  openSheet('Add exercise', async (tBody, tClose) => {
    mount(tBody, h('p.muted', { text: 'Loading…' }));
    let oExercises = [];
    try { oExercises = await loadExercises(); }
    catch (tErr) { mount(tBody, h('p.muted', { text: 'Could not load exercises.' })); return; }

    const oSearch = h('input', { type: 'search', placeholder: 'Search exercises…' });
    const oList = h('div', { style: 'max-height:52vh;overflow-y:auto' });
    const oNewBtn = h('button.btn.btn-ghost.btn-block', { type: 'button', text: '+ New custom exercise', style: 'margin-top:12px' });

    function paint(sFilter) {
      const sLower = (sFilter || '').toLowerCase();
      const oMatches = oExercises.filter((oE) => oE.name.toLowerCase().includes(sLower)).slice(0, 60);
      mount(oList, oMatches.length ? oMatches.map((oE) =>
        h('div.result', { onclick: () => { tClose(); tOnPick(oE); } }, [
          h('div', {}, [h('div.nm', { text: oE.name }),
            oE.muscle_group ? h('div.br', { text: oE.muscle_group + (oE.equipment ? ' · ' + oE.equipment : '') }) : null]),
          oE.is_custom ? h('div.src', { text: 'custom' }) : null,
        ])
      ) : h('p.muted', { style: 'padding:14px 4px', text: 'No matches. Create a custom exercise below.' }));
    }

    oSearch.addEventListener('input', () => paint(oSearch.value));
    oNewBtn.addEventListener('click', () => openNewExercise((oCreated) => { tClose(); tOnPick(oCreated); }));

    mount(tBody, [oSearch, oList, oNewBtn]);
    paint('');
    oSearch.focus();
  });
}

export function openNewExercise(tOnCreated) {
  openSheet('New exercise', (tBody, tClose) => {
    const oName = h('input', { type: 'text', placeholder: 'e.g. Cable Crossover' });
    const oMuscle = h('input', { type: 'text', placeholder: 'e.g. chest' });
    const oEquip = h('input', { type: 'text', placeholder: 'e.g. cable' });
    const oCategory = h('select', {}, ['strength', 'cardio', 'mobility', 'other'].map((s) => h('option', { value: s, text: s })));

    async function save() {
      if (!oName.value.trim()) { toast('Name is required'); return; }
      const oData = await guard(api.createExercise({
        name: oName.value.trim(), muscleGroup: oMuscle.value.trim() || null,
        equipment: oEquip.value.trim() || null, category: oCategory.value,
      }));
      oExerciseCache = null; // invalidate
      toast('Exercise added');
      tClose();
      tOnCreated(oData.exercise);
    }

    mount(tBody, [
      h('label.field', {}, [h('span.lbl', { text: 'Name' }), oName]),
      h('div.inline-fields', {}, [
        h('label.field', { style: 'flex:1' }, [h('span.lbl', { text: 'Muscle group' }), oMuscle]),
        h('label.field', { style: 'flex:1' }, [h('span.lbl', { text: 'Equipment' }), oEquip]),
      ]),
      h('label.field', {}, [h('span.lbl', { text: 'Category' }), oCategory]),
      h('button.btn.btn-block', { type: 'button', text: 'Add exercise', onclick: save }),
    ]);
    oName.focus();
  });
}
