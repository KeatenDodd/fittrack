'use strict';
import { api } from '../api.js';
import { oStore } from '../store.js';
import { h, mount, todayISO, toast, guard } from '../ui.js';

export async function render(tRoot, tArgs, tCtx) {
  mount(tRoot, h('div.empty', { text: 'Loading…' }));
  let sKey = (await api.activityKey()).key;
  const oUser = oStore.user || {};
  const oVer = await api.appVersion().catch(() => null);

  // ---- profile (name + sex; sex unlocks female-health/cycle tracking) ----
  const oName = h('input', { type: 'text', value: oUser.displayName || '' });
  const oSex = h('select', {}, [['', 'Prefer not to say'], ['male', 'Male'], ['female', 'Female']]
    .map(([v, t]) => h('option', { value: v, text: t, selected: (oUser.sex || '') === v })));
  async function saveProfile() {
    const oResp = await guard(api.updateProfile({ displayName: oName.value.trim() || null, sex: oSex.value || null }));
    oStore.setSession(oStore.accessToken, oStore.refreshToken, oResp.user);
    toast('Profile saved');
    location.reload(); // re-render header so the Cycle menu shows/hides
  }

  // Native apps (the watch's Health exporter) can't trust the local HTTPS
  // certificate, so offer an HTTP base (server also listens on port+1) that
  // skips certificates entirely.
  const bHttps = location.protocol === 'https:';
  const sHttpBase = bHttps
    ? 'http://' + location.hostname + ':' + (Number(location.port || 443) + 1)
    : location.origin;
  const sUrl = location.origin + '/api/activity';
  const sHaeUrl = location.origin + '/api/activity/health-auto-export';
  const sHaeHttpUrl = sHttpBase + '/api/activity/health-auto-export';
  const sCertUrl = sHttpBase + '/rootCA.crt';
  const sBodyExample = '{ "date": "' + todayISO() + '", "steps": 8400, "caloriesBurned": 540 }';

  const oKeyField = h('code.mono-block', { text: sKey });
  function copy(sText) { navigator.clipboard.writeText(sText).then(() => toast('Copied'), () => toast('Copy failed')); }
  async function rotate() {
    const oResp = await guard(api.rotateActivityKey());
    sKey = oResp.key; oKeyField.textContent = sKey; toast('New key issued');
  }

  mount(tRoot, [
    h('div.page-head', {}, [h('div.eyebrow', { text: 'Settings' }), h('h1', { text: 'Configuration' })]),

    h('h2', { text: 'Profile' }),
    h('div.card', {}, [
      h('div.inline-fields', {}, [
        h('label.field', { style: 'flex:1' }, [h('span.lbl', { text: 'Display name' }), oName]),
        h('label.field', { style: 'flex:1' }, [h('span.lbl', { text: 'Sex' }), oSex]),
      ]),
      h('p.faint', { style: 'font-size:12.5px;margin:2px 0 10px', text:
        'Setting sex to Female adds a Cycle menu for period & cycle tracking, and lets the macro calculator use the right formula.' }),
      h('button.btn.btn-block', { type: 'button', text: 'Save profile', onclick: saveProfile }),
    ]),

    h('h2', { style: 'margin-top:20px', text: 'Connect your watch (steps & calories)' }),
    h('div.card', {}, [
      h('p.muted', { style: 'margin-top:0', text:
        'Your Zepp watch already sends steps & active calories to Apple Health (iPhone) or Health Connect (Android). ' +
        'A once-a-day phone automation reads those and POSTs them here — no typing needed. Steps appear on the Activity screen.' }),
      h('div.kv', {}, [h('span.lbl', { text: 'POST URL' }),
        h('div.copyrow', {}, [h('code.mono-block', { text: sUrl }), copyBtn(() => copy(sUrl))])]),
      h('div.kv', {}, [h('span.lbl', { text: 'Header  X-API-Key' }),
        h('div.copyrow', {}, [oKeyField, copyBtn(() => copy(sKey))])]),
      h('div.kv', {}, [h('span.lbl', { text: 'JSON body (for Android / custom)' }),
        h('div.copyrow', {}, [h('code.mono-block', { text: sBodyExample }), copyBtn(() => copy(sBodyExample))])]),
      h('div.kv', {}, [h('span.lbl', { text: 'iPhone app URL (Health Auto Export)' }),
        h('div.copyrow', {}, [h('code.mono-block', { text: sHaeUrl }), copyBtn(() => copy(sHaeUrl))])]),

      bHttps ? h('div.callout', {}, [
        h('strong', { text: '“Certificate is invalid” error in the app?' }),
        h('p', { style: 'margin:6px 0 8px', text:
          'Native apps won’t trust this server’s local certificate. Pick one fix:' }),
        h('div.kv', {}, [h('span.lbl', { text: 'Easiest — use this HTTP URL (no certificate)' }),
          h('div.copyrow', {}, [h('code.mono-block', { text: sHaeHttpUrl }), copyBtn(() => copy(sHaeHttpUrl))])]),
        h('p.faint', { style: 'margin:6px 0', text:
          'Or trust the certificate once: on the iPhone open the link below, Install the profile, then ' +
          'Settings → General → About → Certificate Trust Settings → turn it ON.' }),
        h('a.btn.btn-ghost.btn-sm', { href: sCertUrl, text: 'Install certificate (open on the phone)' }),
      ]) : null,

      details('iPhone — easiest, no Shortcut (Health Auto Export app)', [
        'Check your Zepp watch is putting Steps & Active Energy into Apple Health (open Health → Browse → Activity).',
        'Install “Health Auto Export – JSON+CSV” from the App Store and allow it to read Health.',
        'In the app: Automations → New Automation → REST API. Set URL to the “iPhone app URL” above (or the HTTP URL if you hit a certificate error), Method POST.',
        'Add a Header named  X-API-Key  with your key above. Pick metrics Steps + Active Energy, aggregation Daily.',
        'Set it to run once a day and Save. It now syncs on its own — no Shortcut, no typing.',
      ]),
      details('Android (Health Connect)', [
        'Make sure Zepp syncs to Health Connect (Zepp app → Profile → Add accounts/apps → Health Connect).',
        'Install an automation app that can read Health Connect and make HTTP requests (e.g. Macrodroid, or HTTP Shortcuts + Tasker).',
        'Create a daily task that reads today’s steps + active calories and POSTs to the “POST URL” above with header X-API-Key and the JSON body shown.',
        'Schedule it once a day (e.g. late evening).',
      ]),

      h('div.btn-row', { style: 'margin-top:6px' }, [
        h('button.btn.btn-ghost.btn-sm', { type: 'button', text: 'Rotate key', onclick: rotate }),
      ]),
      h('p.faint', { style: 'margin-bottom:0', text:
        'Keep this key private — anyone with it can post activity to your profile. Rotating it disables the old one.' }),
    ]),

    h('h2', { style: 'margin-top:20px', text: 'Import data' }),
    h('div.card', {}, [
      h('p.muted', { style: 'margin-top:0', text:
        'Bring in workout history from the Strong app (Profile → Settings → Export Data → CSV).' }),
      h('a.btn.btn-block', { href: '#/import', text: 'Open Strong import', style: 'text-align:center' }),
    ]),

    h('h2', { style: 'margin-top:20px', text: 'About' }),
    h('div.card', {}, [
      h('div.kv', {}, [h('span.lbl', { text: 'FitTrack version' }),
        h('span.num', { text: oVer && oVer.version ? oVer.version : '—' })]),
      updateBlock(oVer),
    ]),
  ]);
}

// Interactive update section for the About card. Lets the user check GitHub and
// apply a staged update in one click (swap + relaunch), rather than relying on
// the background server happening to exit.
function updateBlock(oVerInit) {
  const oWrap = h('div', { style: 'margin-top:10px' });
  let oVer = oVerInit;

  async function doCheck(tEvent) {
    const oBtn = tEvent.currentTarget;
    oBtn.disabled = true; oBtn.textContent = 'Checking…';
    try { oVer = await api.checkUpdate(); }
    catch (tErr) { toast('Check failed'); paint(); return; }
    toast(oVer.staged ? 'Update found' : "You're up to date");
    paint();
  }

  async function doApply(tEvent) {
    tEvent.currentTarget.disabled = true;
    // The server quits ~0.5s after responding, so this request may resolve or
    // error as it closes — either way the update is now applying.
    try { await api.applyUpdate(); } catch (tErr) { /* expected as server exits */ }
    mount(oWrap, h('div.callout', {}, [
      h('strong', { text: 'Updating…' }),
      h('p', { style: 'margin:6px 0 0', text: 'FitTrack is restarting. A new window will open in a few seconds — if it doesn’t, just reopen the app.' }),
    ]));
  }

  function paint() {
    if (!oVer) { mount(oWrap, null); return; }
    if (oVer.staged) {
      mount(oWrap, h('div.callout', {}, [
        h('strong', { text: 'Update ready' + (oVer.latest ? ' (v' + oVer.latest + ')' : '') }),
        h('p', { style: 'margin:6px 0 8px', text: 'Apply it now — FitTrack will restart and reopen.' }),
        h('button.btn.btn-accent.btn-sm', { type: 'button', text: 'Restart & update now', onclick: doApply }),
      ]));
    } else if (oVer.sea && oVer.repoSet) {
      mount(oWrap, [
        h('p.faint', { style: 'margin:8px 0', text: "You're up to date." }),
        h('button.btn.btn-ghost.btn-sm', { type: 'button', text: 'Check for updates', onclick: doCheck }),
      ]);
    } else if (oVer.sea && !oVer.repoSet) {
      mount(oWrap, h('p.faint', { style: 'margin:8px 0 0', text: 'Auto-update is not configured.' }));
    } else {
      mount(oWrap, h('p.faint', { style: 'margin:8px 0 0', text: 'Running the development server.' }));
    }
  }

  paint();
  return oWrap;
}

function details(sTitle, aSteps) {
  return h('details.howto', {}, [
    h('summary', { text: sTitle }),
    h('ol', {}, aSteps.map((s) => h('li', { text: s }))),
  ]);
}
function copyBtn(fn) { return h('button.btn.btn-ghost.btn-sm', { type: 'button', text: 'Copy', onclick: fn }); }
