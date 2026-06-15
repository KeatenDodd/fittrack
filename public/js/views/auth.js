'use strict';
import { api } from '../api.js';
import { oStore } from '../store.js';
import { h, mount, openSheet, toast } from '../ui.js';

export async function render(tRoot, tArgs, tCtx) {
  function enter(oData) {
    oStore.setSession(oData.accessToken, oData.refreshToken, oData.user);
    tCtx.onAuthed();
  }

  async function selectProfile(oProfile) {
    try {
      enter(await api.selectProfile(oProfile.id));
    } catch (tErr) {
      toast(tErr.message || 'Could not open that profile.');
    }
  }

  function openAdd() {
    openSheet('Add a profile', (oBody, oClose) => {
      const oError = h('p.faint', { style: 'min-height:18px;font-size:13px;color:var(--danger);margin:0' });
      const oName = h('input', { type: 'text', placeholder: 'e.g. Melissa', autocomplete: 'off' });
      const oSex = h('select', {}, [['', 'Prefer not to say'], ['male', 'Male'], ['female', 'Female']]
        .map(([v, t]) => h('option', { value: v, text: t })));

      async function create() {
        const sName = oName.value.trim();
        if (!sName) { oError.textContent = 'Enter a name.'; return; }
        try {
          const oData = await api.register({ username: sName, displayName: sName, sex: oSex.value || null });
          oClose();
          enter(oData);
        } catch (tErr) {
          oError.textContent = tErr.message || 'Could not create that profile.';
        }
      }

      mount(oBody, [
        h('label.field', {}, [h('span.lbl', { text: 'Name' }), oName]),
        h('label.field', {}, [h('span.lbl', { text: 'Sex (enables cycle tracking)' }), oSex]),
        oError,
        h('button.btn.btn-block', { type: 'button', text: 'Create profile', onclick: create }),
      ]);
      oName.addEventListener('keydown', (tEvent) => { if (tEvent.key === 'Enter') create(); });
      setTimeout(() => oName.focus(), 50);
    });
  }

  function profileTile(oProfile) {
    const sName = oProfile.displayName || oProfile.username;
    const sInitial = (sName[0] || '?').toUpperCase();
    return h('button.profile', { type: 'button', onclick: () => selectProfile(oProfile) }, [
      h('span.avatar', { text: sInitial }),
      h('span.profile-name', { text: sName }),
    ]);
  }

  let aProfiles = [];
  try {
    const oData = await api.profiles();
    aProfiles = oData.profiles || [];
  } catch (tErr) {
    aProfiles = [];
  }

  const aTiles = aProfiles.map(profileTile);
  aTiles.push(
    h('button.profile.profile-add', { type: 'button', onclick: openAdd }, [
      h('span.avatar', { text: '+' }),
      h('span.profile-name', { text: 'Add profile' }),
    ])
  );

  mount(tRoot, h('div.auth-wrap', {}, [
    h('div.brand-lg', { html: 'Fit<b style="color:var(--accent)">Track</b>' }),
    h('p.tagline', { text: aProfiles.length ? "Who's working out?" : 'Add a profile to get started.' }),
    h('div.profile-grid', {}, aTiles),
  ]));
}
