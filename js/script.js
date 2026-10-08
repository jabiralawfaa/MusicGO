(function () {
  "use strict";

  var PLAYLISTS = window.MUSICGO_PLAYLISTS || [];
  var ICONS = window.MUSICGO_ICONS;
  var FALLBACK_IMG = "images/img1.jpg";
  var RING_C = 2 * Math.PI * 49;
  var STORE_PREFIX = "musicgo-";

  /* ------------------------------------------------------------- storage */

  var storage = {
    get: function (key, fallback) {
      try {
        var v = window.localStorage.getItem(STORE_PREFIX + key);
        return v === null ? fallback : v;
      } catch (e) {
        return fallback;
      }
    },
    set: function (key, value) {
      try {
        window.localStorage.setItem(STORE_PREFIX + key, value);
      } catch (e) {
        /* file:// or private mode — prefs just do not persist */
      }
    },
  };

  /* ---------------------------------------------------------------- state */

  var state = {
    playlist: null,
    index: 0,
    shuffle: false,
    repeat: 0, // 0 = off, 1 = all, 2 = one
    volume: 0.8,
    muted: false,
    lastVolume: 0.8,
    dragging: false,
    bgOff: storage.get("bg", "on") === "off",
  };

  /* ------------------------------------------------------------------ dom */

  var audio = document.getElementById("audio");
  var body = document.body;
  var playBtn = document.getElementById("play-btn");
  var prevBtn = document.getElementById("prev-btn");
  var nextBtn = document.getElementById("next-btn");
  var shuffleBtn = document.getElementById("shuffle-btn");
  var repeatBtn = document.getElementById("repeat-btn");
  var muteBtn = document.getElementById("mute-btn");
  var volumeEl = document.getElementById("volume");
  var volumeValue = document.getElementById("volume-value");
  var seek = document.getElementById("seek");
  var seekFill = document.getElementById("seek-fill");
  var seekThumb = document.getElementById("seek-thumb");
  var currentTimeEl = document.getElementById("current-time");
  var totalTimeEl = document.getElementById("total-time");
  var trackTitle = document.getElementById("track-title");
  var trackArtist = document.getElementById("track-artist");
  var trackNumber = document.getElementById("track-number");
  var trackOf = document.getElementById("track-of");
  var albumStage = document.getElementById("album-stage");
  var albumArt = document.getElementById("album-art");
  var progressCircle = document.getElementById("progress-circle");
  var queueList = document.getElementById("queue-list");
  var queueEmpty = document.getElementById("queue-empty");
  var trackCount = document.getElementById("track-count");
  var tabsEl = document.getElementById("playlist-tabs");
  var npBadge = document.getElementById("np-badge");
  var toastEl = document.getElementById("toast");
  var themeToggle = document.getElementById("theme-toggle");
  var bgToggle = document.getElementById("bg-toggle");
  var bgStage = document.getElementById("bg-stage");
  var bgVideo = document.getElementById("bg-video");
  var bgSource = document.getElementById("bg-source");
  var canvas = document.getElementById("visualizer");
  var uploadModalEl = document.getElementById("upload-modal");
  var helpModalEl = document.getElementById("help-modal");

  function modalsOpen() {
    return (uploadModalEl && !uploadModalEl.hidden) || (helpModalEl && !helpModalEl.hidden);
  }

  /* ---------------------------------------------------------------- toast */

  var toastTimer = null;

  function toast(message) {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.classList.remove("show");
    }, 2400);
  }

  /* ------------------------------------------------------------- helpers */

  function formatTime(seconds) {
    if (!isFinite(seconds) || seconds < 0) return "0:00";
    var m = Math.floor(seconds / 60);
    var s = Math.floor(seconds % 60);
    return m + ":" + (s < 10 ? "0" + s : s);
  }

  function pad2(n) {
    return n < 10 ? "0" + n : String(n);
  }

  function tracks() {
    return state.playlist ? state.playlist.tracks : [];
  }

  function currentTrack() {
    var list = tracks();
    return list[state.index] || null;
  }

  function setIcon(el, name) {
    if (ICONS) ICONS.set(el, name);
  }

  function trackSrc(track) {
    if (!track) return "";
    if (track.src) return track.src;
    return "music/" + track.audio + ".mp3";
  }

  function trackThumb(track) {
    if (!track) return FALLBACK_IMG;
    if (track.thumb) return track.thumb;
    if (track.img) return "images/" + track.img + ".jpg";
    return FALLBACK_IMG;
  }

  function findPlaylistByLabel(label) {
    var wanted = label.toLowerCase();
    for (var i = 0; i < PLAYLISTS.length; i++) {
      if (PLAYLISTS[i].label.toLowerCase() === wanted) return PLAYLISTS[i];
    }
    return null;
  }

  /* ------------------------------------------------------------ bg video */

  function setBgVideo(src) {
    if (!bgSource || !src) return;
    if (bgSource.getAttribute("src") === src) return;
    bgSource.setAttribute("src", src);
    bgVideo.load();
    if (!state.bgOff) {
      var p = bgVideo.play();
      if (p && p.catch) p.catch(function () {});
    }
  }

  function trackBgVideo(track) {
    if (track && track.audio && track.audio.indexOf("special_") === 0) {
      return "videos/" + track.audio + ".mp4";
    }
    return state.playlist ? state.playlist.bgVideo : "videos/wallpaper1.mp4";
  }

  function applyBgPreference() {
    if (!bgStage) return;
    if (state.bgOff) {
      bgStage.classList.add("is-off");
      bgVideo.pause();
      setIcon(bgToggle, "video-off");
      bgToggle.setAttribute("aria-pressed", "false");
    } else {
      bgStage.classList.remove("is-off");
      setIcon(bgToggle, "video");
      bgToggle.setAttribute("aria-pressed", "true");
      var p = bgVideo.play();
      if (p && p.catch) p.catch(function () {});
    }
  }

  /* ---------------------------------------------------------------- queue */

  function renderTabs() {
    tabsEl.innerHTML = "";
    PLAYLISTS.forEach(function (pl) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tab";
      btn.textContent = pl.label;
      btn.setAttribute("data-playlist", pl.id);
      if (state.playlist && pl.id === state.playlist.id) {
        btn.setAttribute("aria-current", "true");
      }
      btn.addEventListener("click", function () {
        if (state.playlist && pl.id === state.playlist.id) return;
        loadPlaylist(pl.id, { autoplay: !audio.paused, announce: true });
      });
      tabsEl.appendChild(btn);
    });
  }

  function markActiveTab() {
    var tabs = tabsEl.querySelectorAll(".tab");
    for (var i = 0; i < tabs.length; i++) {
      var isCurrent =
        state.playlist && tabs[i].getAttribute("data-playlist") === state.playlist.id;
      if (isCurrent) tabs[i].setAttribute("aria-current", "true");
      else tabs[i].removeAttribute("aria-current");
    }
  }

  function renderQueue() {
    var list = tracks();
    queueList.innerHTML = "";
    trackCount.textContent = String(list.length);
    queueEmpty.hidden = list.length > 0;

    list.forEach(function (track, i) {
      var li = document.createElement("li");
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "queue-item" + (i === state.index ? " is-active" : "");
      btn.setAttribute("data-index", String(i));

      var idx = document.createElement("span");
      idx.className = "q-index";
      idx.textContent = pad2(i + 1);

      var thumb = document.createElement("img");
      thumb.className = "q-thumb";
      thumb.src = trackThumb(track);
      thumb.alt = "";
      thumb.loading = "lazy";
      thumb.addEventListener("error", function () {
        if (thumb.src.indexOf(FALLBACK_IMG) !== -1) return;
        thumb.src = FALLBACK_IMG;
      });

      var text = document.createElement("span");
      text.className = "q-body";
      var title = document.createElement("span");
      title.className = "q-title";
      title.textContent = track.name;
      var artist = document.createElement("span");
      artist.className = "q-artist";
      artist.textContent = track.artist;
      text.appendChild(title);
      text.appendChild(artist);

      var tail = document.createElement("span");
      tail.className = "q-tail";
      var playGlyph = document.createElement("span");
      playGlyph.className = "q-play";
      playGlyph.setAttribute("data-icon", "play");
      var eq = document.createElement("span");
      eq.className = "eq-bars q-indicator";
      eq.innerHTML = "<span></span><span></span><span></span>";
      tail.appendChild(playGlyph);
      tail.appendChild(eq);

      btn.appendChild(idx);
      btn.appendChild(thumb);
      btn.appendChild(text);
      btn.appendChild(tail);

      btn.addEventListener("click", function () {
        if (i === state.index) togglePlay();
        else loadTrack(i, { autoplay: true });
      });

      li.appendChild(btn);
      queueList.appendChild(li);
    });

    if (ICONS) ICONS.render(queueList);
    markQueueActive();
  }

  function markQueueActive() {
    var items = queueList.querySelectorAll(".queue-item");
    for (var i = 0; i < items.length; i++) {
      var active = Number(items[i].getAttribute("data-index")) === state.index;
      items[i].classList.toggle("is-active", active);
      if (active) items[i].setAttribute("aria-current", "true");
      else items[i].removeAttribute("aria-current");
    }
  }

  /* ------------------------------------------------------------ playlists */

  function findPlaylist(id) {
    for (var i = 0; i < PLAYLISTS.length; i++) {
      if (PLAYLISTS[i].id === id) return PLAYLISTS[i];
    }
    return null;
  }

  function loadPlaylist(id, opts) {
    opts = opts || {};
    var pl = findPlaylist(id);
    if (!pl) {
      toast("Unknown playlist: " + id);
      return;
    }
    state.playlist = pl;
    state.index = 0;

    if (window.history && window.history.replaceState) {
      window.history.replaceState(null, "", "#" + pl.id);
    }

    markActiveTab();
    renderQueue();
    loadTrack(0, { autoplay: !!opts.autoplay, silent: true });

    if (opts.announce) toast(pl.label + " · " + pl.tracks.length + " tracks");
  }

  /* ---------------------------------------------------------------- tracks */

  function loadTrack(indexValue, opts) {
    opts = opts || {};
    var list = tracks();
    if (!list.length) {
      trackTitle.textContent = "No track";
      trackArtist.textContent = "—";
      trackNumber.textContent = "Track —";
      trackOf.textContent = "of 0";
      return;
    }

    state.index = ((indexValue % list.length) + list.length) % list.length;
    var track = list[state.index];

    trackTitle.textContent = track.name;
    trackArtist.textContent = track.artist;
    trackNumber.textContent = "Track " + pad2(state.index + 1);
    trackOf.textContent = "of " + list.length;

    var nextSrc = trackThumb(track);
    if (albumArt.getAttribute("src") !== nextSrc) {
      albumStage.classList.add("is-swapping");
      albumArt.onload = function () {
        albumStage.classList.remove("is-swapping");
      };
      albumArt.onerror = function () {
        albumArt.onerror = null;
        albumArt.src = FALLBACK_IMG;
      };
      albumArt.src = nextSrc;
      if (albumArt.complete) albumStage.classList.remove("is-swapping");
    }

    audio.src = trackSrc(track);
    audio.load();

    setBgVideo(trackBgVideo(track));

    resetProgress();
    markQueueActive();

    if (opts.autoplay) playSong({ announce: false });
  }

  function resetProgress() {
    seekFill.style.width = "0%";
    seekThumb.style.left = "0%";
    progressCircle.style.strokeDashoffset = String(RING_C);
    currentTimeEl.textContent = "0:00";
    totalTimeEl.textContent = "0:00";
    seek.setAttribute("aria-valuenow", "0");
  }

  /* -------------------------------------------------------------- graph */

  var audioCtx = null;
  var analyser = null;
  var freqData = null;
  var graphState = "none"; // none | ready | unsupported | failed

  function flagPreview() {
    var chip = document.getElementById("viz-chip");
    if (chip) chip.hidden = false;
    var dot = document.querySelector(".viz-label .dot");
    if (dot) dot.classList.add("is-preview");
  }

  function ensureGraph() {
    if (graphState !== "none") return;
    // Web Audio routing of a file:// media element mutes playback in Chrome,
    // so the real analyser only runs when served over http(s).
    if (location.protocol !== "http:" && location.protocol !== "https:") {
      graphState = "unsupported";
      flagPreview();
      return;
    }
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) {
        graphState = "unsupported";
        flagPreview();
        return;
      }
      audioCtx = new AC();
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.82;
      freqData = new Uint8Array(analyser.frequencyBinCount);
      var source = audioCtx.createMediaElementSource(audio);
      source.connect(analyser);
      analyser.connect(audioCtx.destination);
      graphState = "ready";
    } catch (e) {
      analyser = null;
      audioCtx = null;
      graphState = "failed";
      flagPreview();
    }
  }

  function resumeGraph() {
    if (audioCtx && audioCtx.state === "suspended") {
      var p = audioCtx.resume();
      if (p && p.catch) p.catch(function () {});
    }
  }

  /* -------------------------------------------------------------- playback */

  function playSong() {
    ensureGraph();
    resumeGraph();
    if (graphState !== "ready" && !state.previewToastShown) {
      state.previewToastShown = true;
      toast("Preview spectrum — live analysis needs a server");
    }
    var p = audio.play();
    if (p && p.catch) {
      p.catch(function () {
        toast("Playback was blocked — press play again");
      });
    }
  }

  function pauseSong() {
    audio.pause();
  }

  function togglePlay() {
    if (audio.paused) playSong();
    else pauseSong();
  }

  function pickNextIndex(direction) {
    var list = tracks();
    if (!list.length) return 0;
    if (state.shuffle && list.length > 1) {
      var next = state.index;
      while (next === state.index) {
        next = Math.floor(Math.random() * list.length);
      }
      return next;
    }
    return (((state.index + direction) % list.length) + list.length) % list.length;
  }

  function nextTrack(fromUser) {
    var list = tracks();
    if (!list.length) return;
    var target = pickNextIndex(1);
    if (!fromUser && !state.shuffle && target === 0 && state.repeat === 0) {
      // reached the end of the queue with repeat off
      pauseSong();
      toast("End of queue");
      return;
    }
    loadTrack(target, { autoplay: true });
  }

  function prevTrack() {
    if (!tracks().length) return;
    if (audio.currentTime > 3) {
      audio.currentTime = 0;
      return;
    }
    loadTrack(pickNextIndex(-1), { autoplay: true });
  }

  function onEnded() {
    if (state.repeat === 2) {
      audio.currentTime = 0;
      playSong();
      return;
    }
    var list = tracks();
    var atLast = state.index >= list.length - 1;
    if (atLast && state.repeat === 0 && !state.shuffle) {
      pauseSong();
      toast("End of queue");
      return;
    }
    nextTrack(false);
  }

  /* --------------------------------------------------------------- volume */

  function applyVolume(value, showFeedback) {
    var v = Math.max(0, Math.min(1, value));
    state.volume = v;
    state.muted = v === 0;
    audio.volume = v;
    var pct = Math.round(v * 100);
    volumeEl.value = String(pct);
    volumeEl.style.setProperty("--val", pct + "%");
    volumeValue.textContent = String(pct);
    updateVolumeIcon(v);
    if (showFeedback) toast(v === 0 ? "Muted" : "Volume " + pct + "%");
  }

  function updateVolumeIcon(v) {
    if (v === 0) setIcon(muteBtn, "volume-x");
    else if (v < 0.5) setIcon(muteBtn, "volume-1");
    else setIcon(muteBtn, "volume-2");
  }

  function toggleMute() {
    if (state.volume > 0) {
      state.lastVolume = state.volume;
      applyVolume(0, false);
      toast("Muted");
    } else {
      applyVolume(state.lastVolume || 0.8, false);
      toast("Volume " + Math.round(state.volume * 100) + "%");
    }
  }

  /* ------------------------------------------------------------------ seek */

  function seekRatioFromEvent(clientX) {
    var rect = seek.getBoundingClientRect();
    if (!rect.width) return 0;
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  }

  function seekTo(ratio) {
    if (isFinite(audio.duration) && audio.duration > 0) {
      audio.currentTime = ratio * audio.duration;
      updateProgressUI(ratio);
    }
  }

  function bindSeek() {
    seek.addEventListener("pointerdown", function (e) {
      if (!isFinite(audio.duration)) return;
      state.dragging = true;
      seek.classList.add("is-dragging");
      seek.setPointerCapture(e.pointerId);
      seekTo(seekRatioFromEvent(e.clientX));
    });

    seek.addEventListener("pointermove", function (e) {
      if (!state.dragging) return;
      seekTo(seekRatioFromEvent(e.clientX));
    });

    function endDrag(e) {
      if (!state.dragging) return;
      state.dragging = false;
      seek.classList.remove("is-dragging");
      if (e && e.pointerId !== undefined && seek.hasPointerCapture(e.pointerId)) {
        seek.releasePointerCapture(e.pointerId);
      }
    }

    seek.addEventListener("pointerup", endDrag);
    seek.addEventListener("pointercancel", endDrag);

    seek.addEventListener("keydown", function (e) {
      if (!isFinite(audio.duration)) return;
      var step = e.shiftKey ? 15 : 5;
      if (e.key === "ArrowRight" || e.key === "ArrowUp") {
        e.preventDefault();
        audio.currentTime = Math.min(audio.duration, audio.currentTime + step);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
        e.preventDefault();
        audio.currentTime = Math.max(0, audio.currentTime - step);
      } else if (e.key === "Home") {
        e.preventDefault();
        audio.currentTime = 0;
      } else if (e.key === "End") {
        e.preventDefault();
        audio.currentTime = audio.duration;
      }
    });
  }

  /* ---------------------------------------------------------------- theme */

  function readAccent() {
    var raw = getComputedStyle(document.documentElement)
      .getPropertyValue("--accent")
      .trim();
    var hex = raw || "#36ADA3";
    if (hex.charAt(0) !== "#") return { r: 54, g: 173, b: 163 };
    return {
      r: parseInt(hex.slice(1, 3), 16),
      g: parseInt(hex.slice(3, 5), 16),
      b: parseInt(hex.slice(5, 7), 16),
    };
  }

  var accentRgb = readAccent();

  function applyTheme(theme) {
    var light = theme === "light";
    document.documentElement.setAttribute("data-theme", light ? "light" : "dark");
    setIcon(themeToggle, light ? "sun" : "moon");
    storage.set("theme", light ? "light" : "dark");
    window.setTimeout(function () {
      accentRgb = readAccent();
    }, 30);
  }

  /* ----------------------------------------------------------- visualizer */

  var vizCtx = canvas.getContext("2d");
  var vizW = 0;
  var vizH = 0;
  var levels = [];
  var barCount = 0;
  var accentGradient = null;

  function resizeCanvas() {
    var box = canvas.parentElement;
    if (!box) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = box.clientWidth;
    var h = box.clientHeight;
    if (!w || !h) return;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    vizCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    vizW = w;
    vizH = h;

    var count = Math.max(24, Math.min(76, Math.round(w / 11)));
    if (count !== barCount) {
      barCount = count;
      levels = new Array(count);
      for (var i = 0; i < count; i++) levels[i] = 0;
    }
    accentGradient = null;
  }

  function buildGradient() {
    var g = vizCtx.createLinearGradient(0, 0, 0, vizH);
    var a = accentRgb;
    g.addColorStop(0, "rgba(" + a.r + "," + a.g + "," + a.b + ",0.98)");
    g.addColorStop(0.5, "rgba(" + a.r + "," + a.g + "," + a.b + ",0.6)");
    g.addColorStop(1, "rgba(" + a.r + "," + a.g + "," + a.b + ",0.98)");
    accentGradient = g;
  }

  function readSpectrum(time) {
    var n = barCount;
    var targets = null;
    var playing = !audio.paused && !audio.ended;

    if (graphState === "ready" && analyser && playing) {
      analyser.getByteFrequencyData(freqData);
      var sum = 0;
      for (var k = 0; k < freqData.length; k++) sum += freqData[k];
      if (sum > 0) {
        targets = new Array(n);
        var bins = freqData.length;
        for (var i = 0; i < n; i++) {
          var t = i / n;
          var f = Math.pow(t, 1.7);
          var bin = Math.floor(f * (bins - 1));
          var v = freqData[bin];
          if (bin + 1 < bins) v = Math.max(v, freqData[bin + 1]);
          targets[i] = v / 255;
        }
      }
    }

    if (!targets) {
      // Synthetic spectrum: file:// mode, blocked Web Audio, or idle.
      var energy = playing ? 1 : 0.26;
      targets = new Array(n);
      for (var j = 0; j < n; j++) targets[j] = syntheticAt(j, n, time, energy);
    }
    return targets;
  }

  function syntheticAt(i, n, time, energy) {
    var t = i / n;
    var slope = Math.pow(1 - t, 0.9);
    var a = 0.5 + 0.5 * Math.sin(time * 2.2 + i * 0.55);
    var b = 0.5 + 0.5 * Math.sin(time * 3.6 - i * 0.31 + 1.3);
    var c = 0.5 + 0.5 * Math.sin(time * 1.1 + i * 0.17 + 0.4);
    return slope * (0.4 * a + 0.35 * b + 0.25 * c) * energy;
  }

  function roundRectPath(ctx, x, y, w, h, r) {
    var radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  function drawVisualizer(time) {
    if (!vizW || !vizH) return;
    var targets = readSpectrum(time);
    var n = barCount;
    var maxH = vizH - 14;
    var gap = 3;
    var barW = Math.max(2, (vizW - gap * (n - 1)) / n);
    var centerY = vizH / 2;

    vizCtx.clearRect(0, 0, vizW, vizH);

    vizCtx.strokeStyle = "rgba(255,255,255,0.07)";
    vizCtx.lineWidth = 1;
    vizCtx.beginPath();
    vizCtx.moveTo(0, centerY + 0.5);
    vizCtx.lineTo(vizW, centerY + 0.5);
    vizCtx.stroke();

    if (!accentGradient) buildGradient();

    for (var i = 0; i < n; i++) {
      var target = Math.max(0, Math.min(1, targets[i]));
      var cur = levels[i] || 0;
      cur += (target - cur) * (target > cur ? 0.36 : 0.14);
      levels[i] = cur;

      var h = Math.max(3, cur * maxH);
      var x = i * (barW + gap);
      var y = centerY - h / 2;

      vizCtx.fillStyle = "rgba(" + accentRgb.r + "," + accentRgb.g + "," + accentRgb.b + ",0.16)";
      roundRectPath(vizCtx, x - 3, y - 3, barW + 6, h + 6, (barW + 6) / 2);
      vizCtx.fill();

      vizCtx.fillStyle = accentGradient;
      roundRectPath(vizCtx, x, y, barW, h, barW / 2);
      vizCtx.fill();
    }
  }

  /* --------------------------------------------------------- progress loop */

  var lastCurrentText = "";
  var lastTotalText = "";

  function updateProgressUI(ratio) {
    var pct = Math.max(0, Math.min(1, ratio)) * 100;
    seekFill.style.width = pct + "%";
    seekThumb.style.left = pct + "%";
    progressCircle.style.strokeDashoffset = String(RING_C * (1 - ratio));
    seek.setAttribute("aria-valuenow", String(Math.round(pct)));
  }

  function frame(now) {
    window.requestAnimationFrame(frame);

    var time = now / 1000;
    var duration = audio.duration;
    var current = audio.currentTime;

    if (!state.dragging) {
      var ratio = isFinite(duration) && duration > 0 ? current / duration : 0;
      updateProgressUI(ratio);

      var currentText = formatTime(current);
      if (currentText !== lastCurrentText) {
        currentTimeEl.textContent = currentText;
        lastCurrentText = currentText;
      }
      if (isFinite(duration) && duration > 0) {
        var totalText = formatTime(duration);
        if (totalText !== lastTotalText) {
          totalTimeEl.textContent = totalText;
          lastTotalText = totalText;
        }
      }
    }

    drawVisualizer(time);
  }

  /* --------------------------------------------------------- keyboard ops */

  function toggleShuffle() {
    state.shuffle = !state.shuffle;
    shuffleBtn.setAttribute("aria-pressed", String(state.shuffle));
    toast("Shuffle " + (state.shuffle ? "on" : "off"));
  }

  function cycleRepeat() {
    state.repeat = (state.repeat + 1) % 3;
    var labels = ["Off", "All", "One"];
    repeatBtn.setAttribute("aria-pressed", String(state.repeat > 0));
    repeatBtn.setAttribute("aria-label", "Repeat " + labels[state.repeat]);
    setIcon(repeatBtn, state.repeat === 2 ? "repeat-1" : "repeat");
    toast("Repeat · " + labels[state.repeat]);
  }

  function seekBy(seconds) {
    if (!isFinite(audio.duration) || audio.duration <= 0) return;
    audio.currentTime = Math.max(0, Math.min(audio.duration, audio.currentTime + seconds));
  }

  function bumpVolume(delta) {
    var v = Math.round((state.volume + delta) * 100) / 100;
    v = Math.max(0, Math.min(1, v));
    if (v > 0) state.lastVolume = v;
    applyVolume(v, true);
    storage.set("volume", String(Math.round(v * 100)));
  }

  /* --------------------------------------------------------------- events */

  function bindEvents() {
    playBtn.addEventListener("click", togglePlay);
    nextBtn.addEventListener("click", function () {
      nextTrack(true);
    });
    prevBtn.addEventListener("click", prevTrack);

    shuffleBtn.addEventListener("click", toggleShuffle);

    repeatBtn.addEventListener("click", cycleRepeat);

    volumeEl.addEventListener("input", function () {
      var value = Number(volumeEl.value) / 100;
      state.lastVolume = value > 0 ? value : state.lastVolume;
      applyVolume(value, false);
      storage.set("volume", String(Math.round(value * 100)));
    });

    muteBtn.addEventListener("click", toggleMute);

    themeToggle.addEventListener("click", function () {
      var isLight = document.documentElement.getAttribute("data-theme") === "light";
      applyTheme(isLight ? "dark" : "light");
      toast(isLight ? "Dark theme" : "Light theme");
    });

    bgToggle.addEventListener("click", function () {
      state.bgOff = !state.bgOff;
      storage.set("bg", state.bgOff ? "off" : "on");
      applyBgPreference();
      toast(state.bgOff ? "Background video off" : "Background video on");
    });

    audio.addEventListener("play", function () {
      body.classList.add("is-playing");
      albumStage.classList.add("playing");
      setIcon(playBtn, "pause");
      playBtn.setAttribute("aria-label", "Pause");
      npBadge.classList.remove("is-hidden");
      resumeGraph();
    });

    audio.addEventListener("pause", function () {
      body.classList.remove("is-playing");
      albumStage.classList.remove("playing");
      setIcon(playBtn, "play");
      playBtn.setAttribute("aria-label", "Play");
      npBadge.classList.add("is-hidden");
    });

    audio.addEventListener("ended", onEnded);

    audio.addEventListener("error", function () {
      if (!audio.currentSrc) return;
      var track = currentTrack();
      toast("Could not load " + (track ? track.name : "track"));
    });

    document.addEventListener("keydown", function (e) {
      if (modalsOpen()) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      var t = e.target;
      if (t) {
        var tag = t.tagName;
        if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
        if (t.isContentEditable) return;
        var onSlider = t.closest && t.closest("[role='slider']");
        var onButton = t.closest && t.closest("button");
        var isSpace = e.code === "Space" || e.key === " ";
        // let focused controls handle their own activation / arrow keys
        if (isSpace && (onButton || onSlider)) return;
        if (onSlider && e.key.indexOf("Arrow") === 0) return;
      }
      if (e.code === "Space" || e.key === " ") {
        e.preventDefault();
        togglePlay();
      } else if (e.key === "ArrowRight") {
        if (e.shiftKey) seekBy(5);
        else nextTrack(true);
      } else if (e.key === "ArrowLeft") {
        if (e.shiftKey) seekBy(-5);
        else prevTrack();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        bumpVolume(0.05);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        bumpVolume(-0.05);
      } else if (e.key === "m" || e.key === "M") {
        toggleMute();
      } else if (e.key === "s" || e.key === "S") {
        toggleShuffle();
      } else if (e.key === "r" || e.key === "R") {
        cycleRepeat();
      }
    });

    window.addEventListener("hashchange", function () {
      var id = location.hash.replace("#", "");
      if (!state.playlist || id !== state.playlist.id) {
        loadPlaylist(id, { autoplay: !audio.paused, announce: true });
      }
    });

    if (window.ResizeObserver) {
      var ro = new ResizeObserver(resizeCanvas);
      ro.observe(canvas.parentElement);
    }
    window.addEventListener("resize", resizeCanvas);
  }

  /* ---------------------------------------------------------------- upload */

  function bindUpload() {
    var uploadBtn = document.getElementById("upload-btn");
    var modal = document.getElementById("upload-modal");
    var form = document.getElementById("upload-form");
    if (!uploadBtn || !modal || !form) return;

    var audioInput = document.getElementById("up-audio");
    var thumbInput = document.getElementById("up-thumb");
    var titleInput = document.getElementById("up-title");
    var artistInput = document.getElementById("up-artist");
    var playlistSelect = document.getElementById("up-playlist");
    var newWrap = document.getElementById("up-new-wrap");
    var newName = document.getElementById("up-new-name");
    var errorEl = document.getElementById("up-error");
    var submitBtn = document.getElementById("upload-submit");
    var closeBtn = document.getElementById("upload-close");
    var cancelBtn = document.getElementById("upload-cancel");
    var uploads = window.MUSICGO_UPLOADS;

    if (!uploads || !uploads.isLocal()) return;
    uploadBtn.hidden = false;

    function showError(message) {
      errorEl.textContent = message;
      errorEl.hidden = false;
    }

    function clearError() {
      errorEl.textContent = "";
      errorEl.hidden = true;
    }

    function fillPlaylists() {
      playlistSelect.innerHTML = "";
      PLAYLISTS.forEach(function (pl) {
        var opt = document.createElement("option");
        opt.value = pl.id;
        opt.textContent = pl.label;
        playlistSelect.appendChild(opt);
      });
      var opt = document.createElement("option");
      opt.value = "__new__";
      opt.textContent = "New playlist…";
      playlistSelect.appendChild(opt);
      newWrap.hidden = true;
      newName.value = "";
    }

    function openModal() {
      form.reset();
      audioInput.value = "";
      thumbInput.value = "";
      fillPlaylists();
      clearError();
      modal.hidden = false;
      window.requestAnimationFrame(function () {
        modal.classList.add("is-open");
      });
      window.setTimeout(function () {
        audioInput.focus();
      }, 60);
    }

    function closeModal() {
      modal.classList.remove("is-open");
      window.setTimeout(function () {
        modal.hidden = true;
        clearError();
      }, 220);
    }

    uploadBtn.addEventListener("click", openModal);
    closeBtn.addEventListener("click", closeModal);
    cancelBtn.addEventListener("click", closeModal);

    modal.addEventListener("click", function (e) {
      if (e.target === modal) closeModal();
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !modal.hidden) closeModal();
    });

    playlistSelect.addEventListener("change", function () {
      var isNew = playlistSelect.value === "__new__";
      newWrap.hidden = !isNew;
      if (isNew) newName.focus();
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      clearError();

      var file = audioInput.files && audioInput.files[0];
      if (!file) {
        showError("Choose a song file.");
        return;
      }
      if (file.type && file.type.indexOf("audio/") !== 0) {
        showError("That file is not an audio track.");
        return;
      }
      if (file.size > 200 * 1024 * 1024) {
        showError("Song file is larger than 200 MB.");
        return;
      }

      var title = titleInput.value.trim();
      var artist = artistInput.value.trim();
      if (!title) {
        showError("Add a title.");
        return;
      }
      if (!artist) {
        showError("Add an artist name.");
        return;
      }

      var thumbFile = thumbInput.files && thumbInput.files[0];
      if (thumbFile && thumbFile.type && thumbFile.type.indexOf("image/") !== 0) {
        showError("Thumbnail must be an image.");
        return;
      }

      var isNew = playlistSelect.value === "__new__";
      var targetId = playlistSelect.value;
      var targetLabel = "";
      if (isNew) {
        var requested = newName.value.trim();
        if (!requested) {
          showError("Name the new playlist.");
          return;
        }
        var existing = findPlaylistByLabel(requested);
        if (existing) {
          isNew = false;
          targetId = existing.id;
          targetLabel = existing.label;
        } else {
          targetLabel = requested;
          targetId = "u-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
        }
      } else {
        var pl0 = findPlaylist(targetId);
        targetLabel = pl0 ? pl0.label : "";
      }

      submitBtn.disabled = true;
      uploads
        .save({
          title: title,
          artist: artist,
          playlistId: targetId,
          playlistLabel: targetLabel,
          isNewPlaylist: isNew,
          audioBlob: file,
          thumbBlob: thumbFile || null,
        })
        .then(function (record) {
          submitBtn.disabled = false;
          var track = {
            name: record.title,
            artist: record.artist,
            audio: "",
            custom: true,
            src: window.URL.createObjectURL(record.audioBlob),
            thumb: record.thumbBlob ? window.URL.createObjectURL(record.thumbBlob) : null,
            uploadId: record.id,
          };

          var target = findPlaylist(targetId);
          if (!target) {
            target = {
              id: targetId,
              label: targetLabel,
              bgVideo: "videos/wallpaper1.mp4",
              tracks: [],
            };
            PLAYLISTS.push(target);
            renderTabs();
          }
          target.tracks.push(track);

          var isCurrent = state.playlist && state.playlist.id === targetId;
          if (isNew) {
            if (audio.paused) loadPlaylist(targetId, { autoplay: false });
            else renderTabs();
          } else if (isCurrent) {
            renderQueue();
          }

          closeModal();
          toast((isNew ? "Created " : "Added to ") + targetLabel);
        })
        .catch(function (err) {
          submitBtn.disabled = false;
          showError("Upload failed: " + (err && err.message ? err.message : "storage error"));
        });
    });
  }

  /* ------------------------------------------------------------ help guide */

  function bindHelp() {
    var helpBtn = document.getElementById("help-btn");
    var closeBtn = document.getElementById("help-close");
    var okBtn = document.getElementById("help-ok");
    if (!helpBtn || !helpModalEl) return;

    function openHelp() {
      helpModalEl.hidden = false;
      helpBtn.setAttribute("aria-expanded", "true");
      window.requestAnimationFrame(function () {
        helpModalEl.classList.add("is-open");
      });
      window.setTimeout(function () {
        if (!helpModalEl.hidden) closeBtn.focus();
      }, 60);
    }

    function closeHelp() {
      helpModalEl.classList.remove("is-open");
      helpBtn.setAttribute("aria-expanded", "false");
      window.setTimeout(function () {
        helpModalEl.hidden = true;
      }, 220);
    }

    helpBtn.addEventListener("click", function () {
      if (helpModalEl.hidden) openHelp();
      else closeHelp();
    });
    closeBtn.addEventListener("click", closeHelp);
    okBtn.addEventListener("click", closeHelp);
    helpModalEl.addEventListener("click", function (e) {
      if (e.target === helpModalEl) closeHelp();
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !helpModalEl.hidden) {
        closeHelp();
        return;
      }
      if (e.key === "?") {
        if (uploadModalEl && !uploadModalEl.hidden) return;
        if (helpModalEl.hidden) openHelp();
        else closeHelp();
      }
    });
  }

  /* ----------------------------------------------------------------- init */

  function init() {
    if (ICONS) ICONS.render(document);

    applyTheme(storage.get("theme", "dark"));

    var storedVolume = Number(storage.get("volume", "80"));
    if (!isFinite(storedVolume)) storedVolume = 80;
    state.lastVolume = storedVolume / 100 || 0.8;
    applyVolume(storedVolume / 100, false);

    bindSeek();
    bindEvents();
    bindUpload();
    bindHelp();
    applyBgPreference();

    /* file:// can never analyse audio (Chrome blocks every route) — say so
       up front, before the idle preview bars start moving */
    if (location.protocol !== "http:" && location.protocol !== "https:" && graphState === "none") {
      graphState = "unsupported";
      flagPreview();
    }

    var uploads = window.MUSICGO_UPLOADS;
    var ready = Promise.resolve(0);
    if (uploads && uploads.isLocal()) {
      ready = uploads.hydrate(PLAYLISTS).catch(function () {
        return 0;
      });
    }

    ready.then(function () {
      renderTabs();

      if (!PLAYLISTS.length) {
        queueEmpty.hidden = false;
        toast("No playlists loaded");
        return;
      }

      var initialId = location.hash.replace("#", "");
      if (!findPlaylist(initialId)) initialId = PLAYLISTS[0].id;
      loadPlaylist(initialId, { autoplay: false });

      resizeCanvas();
      window.requestAnimationFrame(frame);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  /* small debug/verification hook */
  window.MUSICGO = {
    state: state,
    audio: audio,
    local: window.MUSICGO_UPLOADS ? window.MUSICGO_UPLOADS.isLocal() : false,
    get graph() {
      return graphState;
    },
  };
})();
