'use strict';
// A soft, low "ding" for the rest timer — synthesized with the Web Audio API so
// there's no audio file to ship and it works offline. Call unlockAudio() from a
// user gesture (e.g. logging a set) so iOS lets it play later.

let oCtx = null;
function ctx() {
  if (!oCtx) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    oCtx = new Ctor();
  }
  if (oCtx.state === 'suspended') oCtx.resume();
  return oCtx;
}

export function unlockAudio() { try { ctx(); } catch (tErr) { /* no audio */ } }

// A warm two-tone bell (not shrill): a mid note with a quiet octave below,
// gentle attack and a ~1.2s exponential decay.
export function playBell() {
  try {
    const c = ctx();
    if (!c) return;
    const t0 = c.currentTime;
    const oGain = c.createGain();
    oGain.gain.setValueAtTime(0.0001, t0);
    oGain.gain.exponentialRampToValueAtTime(0.35, t0 + 0.02);
    oGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.3);
    oGain.connect(c.destination);

    [523.25, 261.63].forEach((fFreq, i) => {
      const oOsc = c.createOscillator();
      oOsc.type = 'sine';
      oOsc.frequency.value = fFreq;
      const oVoice = c.createGain();
      oVoice.gain.value = i === 0 ? 1 : 0.5; // octave-down is quieter
      oOsc.connect(oVoice); oVoice.connect(oGain);
      oOsc.start(t0);
      oOsc.stop(t0 + 1.4);
    });
  } catch (tErr) { /* ignore */ }
}
