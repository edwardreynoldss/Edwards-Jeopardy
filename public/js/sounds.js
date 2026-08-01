// Small synthesized sound-effect helper (Web Audio API) so the game works
// fully offline on a LAN with no external audio assets required.
(function (global) {
  let ctx = null;

  function getCtx() {
    if (!ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return null;
      ctx = new AudioCtx();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone(freq, startOffset, duration, { type = 'sine', gain = 0.2, glideTo = null } = {}) {
    const audioCtx = getCtx();
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime + startOffset);
    if (glideTo) {
      osc.frequency.linearRampToValueAtTime(glideTo, audioCtx.currentTime + startOffset + duration);
    }
    g.gain.setValueAtTime(gain, audioCtx.currentTime + startOffset);
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + startOffset + duration);
    osc.connect(g).connect(audioCtx.destination);
    osc.start(audioCtx.currentTime + startOffset);
    osc.stop(audioCtx.currentTime + startOffset + duration + 0.05);
  }

  const Sounds = {
    unlock() {
      getCtx();
    },
    buzz() {
      tone(180, 0, 0.35, { type: 'sawtooth', gain: 0.28, glideTo: 90 });
    },
    correct() {
      tone(523.25, 0, 0.14, { type: 'triangle', gain: 0.22 });
      tone(659.25, 0.12, 0.14, { type: 'triangle', gain: 0.22 });
      tone(783.99, 0.24, 0.28, { type: 'triangle', gain: 0.24 });
    },
    wrong() {
      tone(220, 0, 0.22, { type: 'square', gain: 0.22, glideTo: 140 });
      tone(160, 0.18, 0.28, { type: 'square', gain: 0.22, glideTo: 90 });
    },
    dailyDouble() {
      tone(440, 0, 0.15, { type: 'sine', gain: 0.2 });
      tone(554.37, 0.13, 0.15, { type: 'sine', gain: 0.2 });
      tone(659.25, 0.26, 0.15, { type: 'sine', gain: 0.2 });
      tone(880, 0.39, 0.4, { type: 'sine', gain: 0.26 });
    },
    tick() {
      tone(880, 0, 0.05, { type: 'square', gain: 0.08 });
    },
    reveal() {
      tone(392, 0, 0.5, { type: 'sine', gain: 0.15, glideTo: 523.25 });
    },
    fanfare() {
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((n, i) => tone(n, i * 0.14, 0.3, { type: 'triangle', gain: 0.22 }));
    },
  };

  global.JeopardySounds = Sounds;
})(window);
