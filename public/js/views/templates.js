'use strict';
import { api } from '../api.js';
import { h, mount, toast, confirmAction, guard } from '../ui.js';
import { pickExercise } from './_pickers.js';

export async function render(tRoot, tArgs, tCtx) {
  if (tArgs[0] === 'edit') return renderEditor(tRoot, tCtx, tArgs[1]);
  if (tArgs[0] === 'new') return renderEditor(tRoot, tCtx, null);
  return renderList(tRoot, tCtx);
}

async function renderList(tRoot, tCtx) {
  mount(tRoot, h('div.empty', { text: 'Loading…' }));
  const oTemplates = (await api.templates()).templates;

  mount(tRoot, [
    h('div.page-head', { style: 'display:flex;justify-content:space-between;align-items:flex-start' }, [
      h('div', {}, [h('div.eyebrow', { text: 'Workout' }), h('h1', { text: 'Templates' })]),
      h('button.btn.btn-sm', { type: 'button', text: '+ New', onclick: () => tCtx.navigate('/templates/new') }),
    ]),
    h('div.card.tight', {}, oTemplates.length
      ? oTemplates.map((oT) => h('div.row', {}, [
          h('div.list-link', { style: 'flex:1', onclick: () => tCtx.navigate('/templates/edit/' + oT.id) }, [
            h('div.label', { text: oT.name }),
            h('div.sub', { text: oT.exercise_count + ' exercises' }),
          ]),
          h('button.btn.btn-ghost.btn-sm', { type: 'button', text: 'Start',
            onclick: async () => {
              const oData = await guard(api.startSession({ templateId: oT.id }));
              const { oStore } = await import('../store.js');
              oStore.activeSessionId = oData.session.id;
              tCtx.navigate('/workout');
            } }),
        ]))
      : [h('div.empty', {}, [h('p', { text: 'No templates yet. Build one to start workouts faster.' }),
          h('button.btn.btn-ghost', { type: 'button', text: 'Create a template', onclick: () => tCtx.navigate('/templates/new') })])]),
  ]);
}

async function renderEditor(tRoot, tCtx, tId) {
  mount(tRoot, h('div.empty', { text: 'Loading…' }));

  let oTemplate = { name: '', notes: '', exercises: [] };
  if (tId) oTemplate = (await api.template(tId)).template;

  // working copy of exercises: { exerciseId, exercise_name, targetSets, targetReps, targetRestSeconds }
  let oItems = (oTemplate.exercises || []).map((oE) => ({
    exerciseId: oE.exercise_id, exercise_name: oE.exercise_name,
    targetSets: oE.target_sets, targetReps: oE.target_reps, targetRestSeconds: oE.target_rest_seconds,
  }));

  const oName = h('input', { type: 'text', placeholder: 'e.g. Push Day', value: oTemplate.name || '' });
  const oListRoot = h('div.card.tight');

  function paintItems() {
    mount(oListRoot, oItems.length ? oItems.map((oItem, iIndex) => h('div.row', {}, [
      h('div', { style: 'flex:1' }, [
        h('div.label', { text: oItem.exercise_name }),
        h('div.sub', {}, [
          inlineNum(oItem, 'targetSets', 'sets'), ' × ',
          inlineNum(oItem, 'targetReps', 'reps'), ' · ',
          inlineNum(oItem, 'targetRestSeconds', 's rest'),
        ]),
      ]),
      h('button.icon-btn', { type: 'button', text: '\u00d7', onclick: () => { oItems.splice(iIndex, 1); paintItems(); } }),
    ])) : h('div.empty', {}, [h('p', { text: 'Add exercises to this template.' })]));
  }

  function inlineNum(oItem, sKey, sSuffix) {
    const oInput = h('input.num', { type: 'number', value: oItem[sKey] != null ? oItem[sKey] : '',
      style: 'width:46px;display:inline-block;padding:2px 5px;text-align:center', placeholder: '–' });
    oInput.addEventListener('input', () => { oItem[sKey] = oInput.value === '' ? null : Number(oInput.value); });
    return h('span', {}, [oInput, ' ' + sSuffix]);
  }

  function addExercise() {
    pickExercise((oExercise) => {
      oItems.push({ exerciseId: oExercise.id, exercise_name: oExercise.name,
        targetSets: 3, targetReps: 10, targetRestSeconds: 120 });
      paintItems();
    });
  }

  async function save() {
    if (!oName.value.trim()) { toast('Name your template'); return; }
    const oBody = { name: oName.value.trim(), exercises: oItems };
    if (tId) await guard(api.updateTemplate(tId, oBody));
    else await guard(api.createTemplate(oBody));
    toast('Template saved');
    tCtx.navigate('/templates');
  }

  mount(tRoot, [
    h('div.page-head', {}, [h('div.eyebrow', { text: 'Template' }), h('h1', { text: tId ? 'Edit template' : 'New template' })]),
    h('label.field', {}, [h('span.lbl', { text: 'Name' }), oName]),
    h('div.meal-head', {}, [h('span.name', { text: 'Exercises' })]),
    oListRoot,
    h('button.btn.btn-ghost.btn-block', { type: 'button', text: '+ Add exercise', onclick: addExercise, style: 'margin:8px 0 18px' }),
    h('div.btn-row', {}, [
      h('button.btn', { type: 'button', text: 'Save template', onclick: save }),
      h('button.btn.btn-ghost', { type: 'button', text: 'Cancel', onclick: () => tCtx.navigate('/templates') }),
      tId ? h('button.btn', { type: 'button', text: 'Delete', style: 'background:none;color:var(--danger);box-shadow:inset 0 0 0 1px var(--line-strong)',
        onclick: () => confirmAction('Delete this template?', async () => { await guard(api.deleteTemplate(tId)); toast('Deleted'); tCtx.navigate('/templates'); }) }) : null,
    ]),
  ]);
  paintItems();
}
