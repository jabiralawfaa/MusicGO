/* MusicGO audio effects — 10-band graphic EQ, bass/treble boost and a
   procedural-IR reverb inserted between the media source and the analyser.
   Plain script on purpose (classic script like the rest: ES modules are
   blocked on file://). Owns all Web Audio nodes; script.js owns the panel UI.
   Volume stays on the element (audio.volume); this module never touches it. */
(function (global) {
  "use strict";

  var STORE_KEY = "musicgo-fx";
  var PRESET_KEY = "musicgo-fx-presets";

  var EQ_FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
  var EQ_Q = 1.4;
  var EQ_MIN = -12;
  var EQ_MAX = 12;
  var BASS_FREQ = 100;
  var BASS_Q = 0.9;
  var TREBLE_FREQ = 8000;
  var IR_DEBOUNCE_MS = 200;

  function defaultReverb() {
    return {
      size: 55,
      decay: 1.8,
      damp: 6000,
      filterType: "lowpass",
      filterFreq: 8000,
      preDelay: 20,
      mix: 0,
    };
  }

  function defaultSettings() {
    return {
      enabled: true,
      eqEnabled: true,
      reverbEnabled: true,
      eq: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      bass: 0,
      treble: 0,
      reverb: defaultReverb(),
    };
  }

  function zeros10() {
    return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  }

  var BUILTINS = {
    Flat: {
      eq: zeros10(),
      bass: 0,
      treble: 0,
      reverb: { size: 55, decay: 1.8, damp: 6000, filterType: "lowpass", filterFreq: 8000, preDelay: 20, mix: 0 },
    },
    "Bass Boost": {
      eq: [3, 2, 0, 0, 0, 0, 0, 0, 0, 0],
      bass: 100,
      treble: 0,
      reverb: { size: 55, decay: 1.8, damp: 6000, filterType: "lowpass", filterFreq: 8000, preDelay: 20, mix: 0 },
    },
    "Treble Boost": {
      eq: [0, 0, 0, 0, 0, 0, 0, 0, 2, 3],
      bass: 0,
      treble: 100,
      reverb: { size: 55, decay: 1.8, damp: 6000, filterType: "lowpass", filterFreq: 8000, preDelay: 20, mix: 0 },
    },
    Vocal: {
      eq: [0, 0, 1, 2, 3, 3, 2, 1, 0, 0],
      bass: 10,
      treble: 15,
      reverb: { size: 45, decay: 1.4, damp: 5000, filterType: "highpass", filterFreq: 400, preDelay: 15, mix: 15 },
    },
    Rock: {
      eq: [4, 3, 1, -1, -2, -2, -1, 1, 3, 4],
      bass: 60,
      treble: 60,
      reverb: { size: 50, decay: 1.6, damp: 7000, filterType: "lowpass", filterFreq: 9000, preDelay: 15, mix: 10 },
    },
    Room: {
      eq: zeros10(),
      bass: 0,
      treble: 0,
      reverb: { size: 55, decay: 1.8, damp: 6000, filterType: "lowpass", filterFreq: 8000, preDelay: 20, mix: 30 },
    },
  };

  function clampNum(v, lo, hi, fb) {
    v = Number(v);
    if (!isFinite(v)) return fb;
    if (v < lo) return lo;
    if (v > hi) return hi;
    return v;
  }

  function sanitizeSettings(raw) {
    var d = defaultSettings();
    if (!raw || typeof raw !== "object") return d;
    var s = defaultSettings();
    s.enabled = raw.enabled !== false;
    s.eqEnabled = raw.eqEnabled !== false;
    s.reverbEnabled = raw.reverbEnabled !== false;
    if (raw.eq && raw.eq.length === 10) {
      for (var i = 0; i < 10; i++) s.eq[i] = clampNum(raw.eq[i], EQ_MIN, EQ_MAX, 0);
    }
    s.bass = clampNum(raw.bass, 0, 100, 0);
    s.treble = clampNum(raw.treble, 0, 100, 0);
    var r = raw.reverb || {};
    var dr = d.reverb;
    s.reverb = {
      size: clampNum(r.size, 0, 100, dr.size),
      decay: clampNum(r.decay, 0.3, 6, dr.decay),
      damp: clampNum(r.damp, 500, 16000, dr.damp),
      filterType: r.filterType === "highpass" ? "highpass" : "lowpass",
      filterFreq: clampNum(r.filterFreq, 200, 16000, dr.filterFreq),
      preDelay: clampNum(r.preDelay, 0, 250, dr.preDelay),
      mix: clampNum(r.mix, 0, 100, dr.mix),
    };
    return s;
  }

  function cloneSettings(s) {
    return {
      enabled: !!s.enabled,
      eqEnabled: !!s.eqEnabled,
      reverbEnabled: !!s.reverbEnabled,
      eq: s.eq.slice(0),
      bass: s.bass,
      treble: s.treble,
      reverb: {
        size: s.reverb.size,
        decay: s.reverb.decay,
        damp: s.reverb.damp,
        filterType: s.reverb.filterType,
        filterFreq: s.reverb.filterFreq,
        preDelay: s.reverb.preDelay,
        mix: s.reverb.mix,
      },
    };
  }

  function loadSettings() {
    try {
      var raw = window.localStorage.getItem(STORE_KEY);
      if (!raw) return defaultSettings();
      return sanitizeSettings(JSON.parse(raw));
    } catch (e) {
      return defaultSettings();
    }
  }

  function persistSettings() {
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(settings));
    } catch (e) {}
  }

  function loadCustom() {
    try {
      var raw = window.localStorage.getItem(PRESET_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(arr)) return [];
      var out = [];
      for (var i = 0; i < arr.length; i++) {
        var e = arr[i];
        if (e && typeof e.id === "string" && typeof e.name === "string" && e.settings) {
          out.push({ id: e.id, name: String(e.name).slice(0, 40), settings: sanitizeSettings(e.settings) });
        }
      }
      return out;
    } catch (e) {
      return [];
    }
  }

  function storeCustom(arr) {
    try {
      window.localStorage.setItem(PRESET_KEY, JSON.stringify(arr));
    } catch (e) {}
  }

  var settings = loadSettings();
  var customs = loadCustom();

  var ctx = null;
  var nodes = null;
  var installed = false;
  var irTimer = null;

  /* Click-free param write. AudioParam.value is ignored once automation
     events exist, so every slider goes through cancel+setTarget. */
  function smooth(param, v) {
    if (!param) return;
    try {
      var now = ctx.currentTime;
      param.cancelAndHoldAtTime(now);
      param.setTargetAtTime(v, now, 0.02);
    } catch (e) {
      try {
        param.value = v;
      } catch (e2) {}
    }
  }

  /* Procedural stereo impulse response. Size shapes the early-reflection
     pattern (small = tight + strong early echoes, large = diffuse bloom)
     and stretches the tail; decay sets the envelope length. */
  function buildIR(sizePct, decaySec, sampleRate) {
    var s = clampNum(sizePct, 0, 100, 55) / 100;
    var decay = clampNum(decaySec, 0.3, 6, 1.8);
    var dur = decay * (0.85 + s * 0.3);
    if (dur < 0.3) dur = 0.3;
    if (dur > 6) dur = 6;
    var len = Math.max(16, Math.floor(sampleRate * dur));
    var buf = ctx.createBuffer(2, len, sampleRate);
    var earlyCount = Math.round(10 - s * 7);
    var earlyAmp = 0.9 - s * 0.55;
    var power = 2.6 - s * 1.4;
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch);
      for (var i = 0; i < len; i++) {
        var x = i / len;
        var n = Math.random() * 2 - 1;
        d[i] = n * Math.pow(1 - x, power) * Math.exp((-3 * (i / sampleRate)) / dur);
      }
      for (var k = 1; k <= earlyCount; k++) {
        var at = Math.floor((k / (earlyCount + 1)) * 0.09 * sampleRate * (0.7 + 0.6 * s)) + ch * 7;
        if (at < len) d[at] += (earlyAmp / k) * (Math.random() < 0.5 ? -1 : 1);
      }
    }
    return buf;
  }

  function regenIR() {
    if (!installed || !nodes) return;
    try {
      nodes.conv.buffer = buildIR(settings.reverb.size, settings.reverb.decay, ctx.sampleRate);
    } catch (e) {}
  }

  function scheduleIR() {
    if (irTimer) {
      clearTimeout(irTimer);
      irTimer = null;
    }
    irTimer = setTimeout(function () {
      irTimer = null;
      regenIR();
    }, IR_DEBOUNCE_MS);
  }

  function applyAll() {
    if (!installed || !nodes) return;
    var on = !!settings.enabled;
    var eqOn = on && !!settings.eqEnabled;
    for (var i = 0; i < 10; i++) {
      smooth(nodes.eq[i].gain, eqOn ? clampNum(settings.eq[i], EQ_MIN, EQ_MAX, 0) : 0);
    }
    smooth(nodes.bass.gain, on ? clampNum(settings.bass, 0, 100, 0) * 0.12 : 0);
    smooth(nodes.treble.gain, on ? clampNum(settings.treble, 0, 100, 0) * 0.12 : 0);
    var r = settings.reverb;
    smooth(nodes.pre.delayTime, clampNum(r.preDelay, 0, 250, 20) / 1000);
    smooth(nodes.damp.frequency, clampNum(r.damp, 500, 16000, 6000));
    try {
      nodes.tone.type = r.filterType === "highpass" ? "highpass" : "lowpass";
    } catch (e) {}
    smooth(nodes.tone.frequency, clampNum(r.filterFreq, 200, 16000, 8000));
    var m = on && settings.reverbEnabled ? clampNum(r.mix, 0, 100, 0) / 100 : 0;
    smooth(nodes.dry.gain, Math.cos((m * Math.PI) / 2));
    smooth(nodes.wet.gain, Math.sin((m * Math.PI) / 2));
  }

  /* Take over routing: source -> EQ -> boosts -> dry/wet split -> analyser.
     The analyser -> destination link owned by script.js is left alone. */
  function install(audioCtx, source, analyser) {
    if (installed) return true;
    if (!audioCtx || !source || !analyser) return false;
    try {
      ctx = audioCtx;
      var eq = [];
      var i;
      var f;
      for (i = 0; i < 10; i++) {
        f = ctx.createBiquadFilter();
        f.type = i === 0 ? "lowshelf" : i === 9 ? "highshelf" : "peaking";
        f.frequency.value = EQ_FREQS[i];
        if (f.type === "peaking") f.Q.value = EQ_Q;
        f.gain.value = 0;
        eq.push(f);
      }
      var bass = ctx.createBiquadFilter();
      bass.type = "peaking";
      bass.frequency.value = BASS_FREQ;
      bass.Q.value = BASS_Q;
      bass.gain.value = 0;
      var treble = ctx.createBiquadFilter();
      treble.type = "highshelf";
      treble.frequency.value = TREBLE_FREQ;
      treble.gain.value = 0;
      var dry = ctx.createGain();
      dry.gain.value = 1;
      var wet = ctx.createGain();
      wet.gain.value = 0;
      var sum = ctx.createGain();
      sum.gain.value = 1;
      // safety limiter against boost clipping
      var limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -6;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.25;
      var pre = ctx.createDelay(1.0);
      pre.delayTime.value = 0.02;
      var damp = ctx.createBiquadFilter();
      damp.type = "lowpass";
      damp.frequency.value = 6000;
      var conv = ctx.createConvolver();
      conv.normalize = true;
      conv.buffer = buildIR(settings.reverb.size, settings.reverb.decay, ctx.sampleRate);
      var tone = ctx.createBiquadFilter();
      tone.type = "lowpass";
      tone.frequency.value = 8000;
      source.disconnect();
      var head = source;
      for (i = 0; i < 10; i++) {
        head.connect(eq[i]);
        head = eq[i];
      }
      head.connect(bass);
      bass.connect(treble);
      treble.connect(dry);
      dry.connect(sum);
      treble.connect(pre);
      pre.connect(damp);
      damp.connect(conv);
      conv.connect(tone);
      tone.connect(wet);
      wet.connect(sum);
      sum.connect(limiter);
      limiter.connect(analyser);
      nodes = {
        eq: eq,
        bass: bass,
        treble: treble,
        dry: dry,
        wet: wet,
        pre: pre,
        damp: damp,
        conv: conv,
        tone: tone,
        limiter: limiter,
      };
      installed = true;
      try {
        ctx.addEventListener("statechange", function () {
          if (ctx && ctx.state === "interrupted") {
            try {
              ctx.resume();
            } catch (e) {}
          }
        });
      } catch (e) {}
      applyAll();
      return true;
    } catch (e) {
      try {
        source.disconnect();
      } catch (e2) {}
      try {
        source.connect(analyser);
      } catch (e3) {}
      ctx = null;
      nodes = null;
      installed = false;
      return false;
    }
  }

  function setEnabled(b) {
    settings.enabled = !!b;
    persistSettings();
    applyAll();
  }

  function setEqEnabled(b) {
    settings.eqEnabled = !!b;
    persistSettings();
    applyAll();
  }

  function setReverbEnabled(b) {
    settings.reverbEnabled = !!b;
    persistSettings();
    applyAll();
  }

  function setEqBand(i, db) {
    i = Math.floor(Number(i));
    if (i < 0 || i > 9 || !isFinite(db)) return;
    settings.eq[i] = clampNum(db, EQ_MIN, EQ_MAX, 0);
    persistSettings();
    applyAll();
  }

  function setBass(pct) {
    settings.bass = clampNum(pct, 0, 100, 0);
    persistSettings();
    applyAll();
  }

  function setTreble(pct) {
    settings.treble = clampNum(pct, 0, 100, 0);
    persistSettings();
    applyAll();
  }

  function setReverb(key, value) {
    var r = settings.reverb;
    if (key === "size") r.size = clampNum(value, 0, 100, 55);
    else if (key === "decay") r.decay = clampNum(value, 0.3, 6, 1.8);
    else if (key === "damp") r.damp = clampNum(value, 500, 16000, 6000);
    else if (key === "filterType") r.filterType = value === "highpass" ? "highpass" : "lowpass";
    else if (key === "filterFreq") r.filterFreq = clampNum(value, 200, 16000, 8000);
    else if (key === "preDelay") r.preDelay = clampNum(value, 0, 250, 20);
    else if (key === "mix") r.mix = clampNum(value, 0, 100, 0);
    else return;
    persistSettings();
    applyAll();
    if (key === "size" || key === "decay") scheduleIR();
  }

  function applyPreset(name) {
    if (!BUILTINS[name]) return false;
    var keepOn = settings.enabled;
    var keepEq = settings.eqEnabled;
    var keepRev = settings.reverbEnabled;
    var p = BUILTINS[name];
    settings.eq = p.eq.slice(0);
    settings.bass = p.bass;
    settings.treble = p.treble;
    settings.reverb = {
      size: p.reverb.size,
      decay: p.reverb.decay,
      damp: p.reverb.damp,
      filterType: p.reverb.filterType,
      filterFreq: p.reverb.filterFreq,
      preDelay: p.reverb.preDelay,
      mix: p.reverb.mix,
    };
    settings.enabled = keepOn;
    settings.eqEnabled = keepEq;
    settings.reverbEnabled = keepRev;
    persistSettings();
    applyAll();
    scheduleIR();
    return true;
  }

  function resetDefaults() {
    var d = defaultSettings();
    var keepOn = settings.enabled;
    var keepEq = settings.eqEnabled;
    var keepRev = settings.reverbEnabled;
    settings = d;
    settings.enabled = keepOn;
    settings.eqEnabled = keepEq;
    settings.reverbEnabled = keepRev;
    persistSettings();
    applyAll();
    scheduleIR();
  }

  function listCustom() {
    var out = [];
    for (var i = 0; i < customs.length; i++) {
      out.push({ id: customs[i].id, name: customs[i].name });
    }
    return out;
  }

  function saveCustom(name) {
    name = String(name == null ? "" : name).trim().slice(0, 40);
    if (!name) return null;
    var entry = {
      id: "c" + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36),
      name: name,
      settings: cloneSettings(settings),
    };
    customs.push(entry);
    storeCustom(customs);
    return { id: entry.id, name: entry.name };
  }

  function findCustom(id) {
    for (var i = 0; i < customs.length; i++) {
      if (customs[i].id === id) return customs[i];
    }
    return null;
  }

  function renameCustom(id, name) {
    var e = findCustom(id);
    if (!e) return false;
    name = String(name == null ? "" : name).trim().slice(0, 40);
    if (!name) return false;
    e.name = name;
    storeCustom(customs);
    return true;
  }

  function deleteCustom(id) {
    for (var i = 0; i < customs.length; i++) {
      if (customs[i].id === id) {
        customs.splice(i, 1);
        storeCustom(customs);
        return true;
      }
    }
    return false;
  }

  function applyCustom(id) {
    var e = findCustom(id);
    if (!e) return false;
    var keepOn = settings.enabled;
    var keepEq = settings.eqEnabled;
    var keepRev = settings.reverbEnabled;
    settings = sanitizeSettings(e.settings);
    settings.enabled = keepOn;
    settings.eqEnabled = keepEq;
    settings.reverbEnabled = keepRev;
    persistSettings();
    applyAll();
    scheduleIR();
    return true;
  }

  function numEq(a, b) {
    return Math.abs(Number(a) - Number(b)) < 1e-6;
  }

  /* True when current settings equal the given builtin/custom preset.
     The on/off flags are independent of presets and ignored. */
  function matchesPreset(kind, key) {
    var t = null;
    if (kind === "builtin") t = BUILTINS[key];
    else if (kind === "custom") {
      var e = findCustom(key);
      t = e ? e.settings : null;
    }
    if (!t) return false;
    var s = settings;
    var r = t.reverb;
    var sr = s.reverb;
    var i;
    for (i = 0; i < 10; i++) if (!numEq(s.eq[i], t.eq[i])) return false;
    if (!numEq(s.bass, t.bass) || !numEq(s.treble, t.treble)) return false;
    if (!numEq(sr.size, r.size) || !numEq(sr.decay, r.decay) || !numEq(sr.damp, r.damp)) return false;
    if (sr.filterType !== r.filterType || !numEq(sr.filterFreq, r.filterFreq)) return false;
    if (!numEq(sr.preDelay, r.preDelay) || !numEq(sr.mix, r.mix)) return false;
    return true;
  }

  /* Resolved (effective) values honouring the bypass flags — what you hear. */
  function debug() {
    var on = !!settings.enabled;
    var eqOn = on && !!settings.eqEnabled;
    var eq = [];
    for (var i = 0; i < 10; i++) eq.push(eqOn ? settings.eq[i] : 0);
    var wetOn = on && !!settings.reverbEnabled;
    var r = settings.reverb;
    return {
      eq: eq,
      bass: on ? settings.bass * 0.12 : 0,
      treble: on ? settings.treble * 0.12 : 0,
      reverb: {
        size: r.size,
        decay: r.decay,
        damp: r.damp,
        filterType: r.filterType,
        filterFreq: r.filterFreq,
        preDelay: r.preDelay,
        mix: wetOn ? r.mix : 0,
      },
      enabled: on,
      eqEnabled: !!settings.eqEnabled,
      reverbEnabled: !!settings.reverbEnabled,
      irLength: nodes && nodes.conv && nodes.conv.buffer ? nodes.conv.buffer.length : 0,
    };
  }

  global.MUSICGO_FX = {
    install: install,
    isInstalled: function () {
      return installed;
    },
    bands: function () {
      return EQ_FREQS.slice(0);
    },
    range: function () {
      return { min: EQ_MIN, max: EQ_MAX };
    },
    getSettings: function () {
      return cloneSettings(settings);
    },
    setEnabled: setEnabled,
    setEqEnabled: setEqEnabled,
    setReverbEnabled: setReverbEnabled,
    setEqBand: setEqBand,
    setBass: setBass,
    setTreble: setTreble,
    setReverb: setReverb,
    builtins: function () {
      return ["Flat", "Bass Boost", "Treble Boost", "Vocal", "Rock", "Room"];
    },
    applyPreset: applyPreset,
    applyCustom: applyCustom,
    matchesPreset: matchesPreset,
    listCustom: listCustom,
    saveCustom: saveCustom,
    renameCustom: renameCustom,
    deleteCustom: deleteCustom,
    resetDefaults: resetDefaults,
    debug: debug,
  };
})(window);
