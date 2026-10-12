(function () {
  "use strict";

  var PLAYLISTS = window.MUSICGO_PLAYLISTS || [];
  var ICONS = window.MUSICGO_ICONS;
  var FALLBACK_IMG = "images/img1.jpg";

  var BG_PRESETS = [
    { id: "wallpaper1", kind: "video", src: "videos/wallpaper1.mp4", label: "Nebula Drift" },
    { id: "wallpaper2", kind: "video", src: "videos/wallpaper2.mp4", label: "Midnight Wave" },
    { id: "wallpaper3", kind: "video", src: "videos/wallpaper3.mp4", label: "Aurora Field" },
    { id: "yoasobi", kind: "image", src: "images/yoasobi.jpg", label: "Yoasobi" },
    { id: "hololive", kind: "image", src: "images/hololive.jpg", label: "Hololive" },
    { id: "hoshino", kind: "image", src: "images/hoshino.jpg", label: "Hoshino" },
    { id: "mash", kind: "image", src: "images/mash.jpg", label: "Mash" },
    { id: "my-idol", kind: "image", src: "images/my-idol.jpg", label: "My Idol" },
    { id: "img1", kind: "image", src: "images/img1.jpg", label: "Ember" },
  ];

  var BG_UPLOAD_MAX = 10 * 1024 * 1024;

  function findBgPreset(id) {
    for (var i = 0; i < BG_PRESETS.length; i++) {
      if (BG_PRESETS[i].id === id) return BG_PRESETS[i];
    }
    return null;
  }

  /* Stored bg: null | {kind:"preset", id} | {kind:"upload", blob}.
     Memory bg: null | {kind:"preset", id} | {kind:"upload", url}.
     Resolves to {media:"video"|"image", src} or null (legacy path). */
  function bgUrlFor(sel) {
    if (!sel) return null;
    if (sel.kind === "preset") {
      var p = findBgPreset(sel.id);
      if (!p) return null;
      return { media: p.kind, src: p.src };
    }
    if (sel.kind === "upload" && sel.url) return { media: "image", src: sel.url };
    return null;
  }

  function resolveTrackBg(track) {
    if (track && track.bg) return track.bg;
    if (state.playlist && state.playlist.bg) return state.playlist.bg;
    return null;
  }

  function revokeBgUrl(bg) {
    if (bg && bg.kind === "upload" && bg.url && bg.url.indexOf("blob:") === 0) {
      try {
        window.URL.revokeObjectURL(bg.url);
      } catch (e) {}
    }
  }

  function showBgImage(src) {
    if (!bgImage) return;
    if (bgImage.getAttribute("src") !== src) bgImage.src = src;
    bgImage.hidden = false;
    if (bgStage) bgStage.classList.add("has-image");
    if (bgVideo) {
      try {
        bgVideo.pause();
      } catch (e) {}
    }
  }

  function hideBgImage() {
    if (bgImage) bgImage.hidden = true;
    if (bgStage) bgStage.classList.remove("has-image");
  }

  function applyBackground() {
    var track = currentTrack();
    var res = bgUrlFor(resolveTrackBg(track));
    if (!res) {
      hideBgImage();
      setBgVideo(trackBgVideo(track));
      return;
    }
    if (res.media === "video") {
      hideBgImage();
      setBgVideo(res.src);
    } else {
      showBgImage(res.src);
    }
  }
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
    minimized: false,
    lyricsAlign: (function () {
      var a = storage.get("lyrics-align", "center");
      return a === "left" || a === "right" || a === "center" ? a : "center";
    })(),
    lyricsSize: (function () {
      var n = parseInt(storage.get("lyrics-size", "2"), 10);
      return n >= 0 && n <= 4 ? n : 2;
    })(),
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
  var bgImage = document.getElementById("bg-image");
  var canvas = document.getElementById("visualizer");
  var uploadModalEl = document.getElementById("upload-modal");
  var helpModalEl = document.getElementById("help-modal");
  var editModalEl = document.getElementById("edit-modal");
  var lyricsEditorModalEl = document.getElementById("lyrics-editor-modal");
  var playlistModalEl = document.getElementById("playlist-modal");
  var minimizeBtn = document.getElementById("minimize-btn");
  var miniBar = document.getElementById("mini-bar");
  var miniThumb = document.getElementById("mini-thumb");
  var miniTitle = document.getElementById("mini-title");
  var miniArtist = document.getElementById("mini-artist");
  var miniSeek = document.getElementById("mini-seek");
  var miniSeekFill = document.getElementById("mini-seek-fill");
  var miniCurrent = document.getElementById("mini-current");
  var miniTotal = document.getElementById("mini-total");
  var miniPlay = document.getElementById("mini-play");
  var miniPrev = document.getElementById("mini-prev");
  var miniNext = document.getElementById("mini-next");
  var miniShuffle = document.getElementById("mini-shuffle");
  var miniRepeat = document.getElementById("mini-repeat");
  var miniVolBtn = document.getElementById("mini-vol-btn");
  var miniDropup = document.getElementById("mini-dropup");
  var miniVolumeEl = document.getElementById("mini-volume");
  var lyricsAlignBtn = document.getElementById("lyrics-align-btn");
  var lyricsSizeDec = document.getElementById("lyrics-size-dec");
  var lyricsSizeInc = document.getElementById("lyrics-size-inc");
  var lyricsOverlay = document.getElementById("lyrics-overlay");
  var lyricsLines = document.getElementById("lyrics-lines");
  var lastLyricsTrack = null;
  var lyricActiveIndex = -1;
  var lyricSweepKey = "";
  var lyricSweepRM = null;

  function modalsOpen() {
    return (
      (uploadModalEl && !uploadModalEl.hidden) ||
      (helpModalEl && !helpModalEl.hidden) ||
      (editModalEl && !editModalEl.hidden) ||
      (lyricsEditorModalEl && !lyricsEditorModalEl.hidden) ||
      (playlistModalEl && !playlistModalEl.hidden)
    );
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

  /* ------------------------------------------------------ minimize (mini) */

  function syncMiniMeta() {
    if (!miniBar) return;
    var track = currentTrack();
    if (miniThumb) {
      var src = trackThumb(track);
      if (miniThumb.getAttribute("src") !== src) miniThumb.src = src;
    }
    if (miniTitle) miniTitle.textContent = track ? track.name : "No track";
    if (miniArtist) miniArtist.textContent = track ? track.artist : "—";
  }

  function syncMiniTransport() {
    if (!miniBar) return;
    if (miniPlay) {
      var playing = !audio.paused && !audio.ended;
      setIcon(miniPlay, playing ? "pause" : "play");
      miniPlay.setAttribute("aria-label", playing ? "Pause" : "Play");
    }
    if (miniShuffle) {
      miniShuffle.setAttribute("aria-pressed", String(state.shuffle));
      miniShuffle.classList.toggle("is-active", state.shuffle);
    }
    if (miniRepeat) {
      var labels = ["Off", "All", "One"];
      miniRepeat.setAttribute("aria-pressed", String(state.repeat > 0));
      miniRepeat.setAttribute("aria-label", "Repeat " + labels[state.repeat]);
      setIcon(miniRepeat, state.repeat === 2 ? "repeat-1" : "repeat");
    }
    if (miniVolumeEl) {
      var pct = Math.round(state.volume * 100);
      miniVolumeEl.value = String(pct);
      miniVolumeEl.style.setProperty("--val", pct + "%");
    }
    if (miniVolBtn) {
      if (state.volume === 0) setIcon(miniVolBtn, "volume-x");
      else if (state.volume < 0.5) setIcon(miniVolBtn, "volume-1");
      else setIcon(miniVolBtn, "volume-2");
    }
  }

  function closeMiniDropup() {
    if (miniDropup && !miniDropup.hidden) miniDropup.hidden = true;
    if (miniVolBtn) miniVolBtn.setAttribute("aria-expanded", "false");
  }

  /* ----------------------------------------------- minimized karaoke lyrics */

  function renderLyricWords(el, line) {
    el.textContent = "";
    for (var i = 0; i < line.words.length; i++) {
      var w = document.createElement("span");
      w.className = "ly-word";
      w.textContent = line.words[i].text;
      w.setAttribute("data-text", line.words[i].text);
      el.appendChild(w);
      if (i < line.words.length - 1) el.appendChild(document.createTextNode(" "));
    }
  }

  function sweepReduced() {
    if (lyricSweepRM === null) {
      lyricSweepRM = false;
      try {
        var mq = window.matchMedia("(prefers-reduced-motion: reduce)");
        lyricSweepRM = !!mq.matches;
        var upd = function (e) {
          lyricSweepRM = !!e.matches;
        };
        if (mq.addEventListener) mq.addEventListener("change", upd);
        else if (mq.addListener) mq.addListener(upd);
      } catch (err) {
        lyricSweepRM = false;
      }
    }
    return lyricSweepRM;
  }

  function paintLyricSweep(line, lit, bucket) {
    if (!lyricsLines) return;
    var activeEl = lyricsLines.querySelector(".lyric-line.is-active");
    if (!activeEl) return;
    var spans = activeEl.querySelectorAll(".ly-word");
    for (var i = 0; i < line.words.length && i < spans.length; i++) {
      var sp = spans[i];
      if (i < lit - 1) {
        sp.classList.add("is-lit");
        sp.classList.remove("sweep");
        sp.style.removeProperty("--sw");
      } else if (i === lit - 1) {
        sp.classList.add("is-lit");
        sp.classList.add("sweep");
        sp.style.setProperty("--sw", bucket * 5 + "%");
      } else {
        sp.classList.remove("is-lit");
        sp.classList.remove("sweep");
        sp.style.removeProperty("--sw");
      }
    }
  }

  function updateLyricSweep() {
    if (!lyricsOverlay || lyricsOverlay.hidden || !lyricsLines) return;
    var track = currentTrack();
    var lyric = track && track.lyrics ? track.lyrics : null;
    if (!lyric || !lyric.synced || !lyric.lines || !lyric.lines.length) return;
    if (lyricActiveIndex < 0 || !lyric.lines[lyricActiveIndex]) return;
    var line = lyric.lines[lyricActiveIndex];
    if (!line.words || !line.words.length) return;
    var ms = audio.currentTime * 1000;
    var lit = 0;
    while (lit < line.words.length && line.words[lit].t <= ms) lit++;
    var bucket = 20;
    if (lit > 0 && !sweepReduced()) {
      var wt = line.words[lit - 1].t;
      var nt = lit < line.words.length ? line.words[lit].t : wt + 800;
      var frac = nt > wt ? (ms - wt) / (nt - wt) : 1;
      if (frac < 0) frac = 0;
      if (frac > 1) frac = 1;
      bucket = Math.floor(frac * 20);
    }
    var key = lyricActiveIndex + ":" + lit + ":" + bucket;
    if (key === lyricSweepKey) return;
    lyricSweepKey = key;
    paintLyricSweep(line, lit, bucket);
  }

  function renderLyricLines(lyric) {
    if (!lyricsLines) return;
    lyricSweepKey = "";
    lyricsLines.textContent = "";
    var i, el;
    if (!lyric.synced) {
      lyricsLines.classList.add("is-static");
      for (i = 0; i < lyric.lines.length; i++) {
        el = document.createElement("div");
        el.className = "lyric-line";
        el.textContent = lyric.lines[i].text;
        lyricsLines.appendChild(el);
      }
      lyricsLines.scrollTop = 0;
      return;
    }
    lyricsLines.classList.remove("is-static");
    var idx = lyricActiveIndex;
    if (idx < 0) {
      if (!lyric.lines.length) return;
      el = document.createElement("div");
      el.className = "lyric-line is-dim";
      el.textContent = lyric.lines[0].text;
      lyricsLines.appendChild(el);
      return;
    }
    el = document.createElement("div");
    el.className = "lyric-line is-active";
    if (lyric.lines[idx].words && lyric.lines[idx].words.length) {
      el.classList.add("has-words");
      renderLyricWords(el, lyric.lines[idx]);
    } else {
      el.textContent = lyric.lines[idx].text;
    }
    lyricsLines.appendChild(el);
    if (idx + 1 < lyric.lines.length) {
      var next = document.createElement("div");
      next.className = "lyric-line is-dim";
      next.textContent = lyric.lines[idx + 1].text;
      lyricsLines.appendChild(next);
    }
  }

  function updateLyricActive(force) {
    if (!lyricsOverlay || lyricsOverlay.hidden || !lyricsLines) return;
    var track = currentTrack();
    var lyric = track && track.lyrics ? track.lyrics : null;
    if (!lyric || !lyric.synced || !lyric.lines || !lyric.lines.length) return;
    var ms = audio.currentTime * 1000;
    var idx = -1;
    var i;
    if (
      lyricActiveIndex >= 0 &&
      lyric.lines[lyricActiveIndex] &&
      lyric.lines[lyricActiveIndex].t <= ms
    ) {
      idx = lyricActiveIndex;
    } else if (lyricActiveIndex > 0) {
      for (i = lyricActiveIndex - 1; i >= 0; i--) {
        if (lyric.lines[i].t <= ms) {
          idx = i;
          break;
        }
      }
    }
    for (i = idx + 1; i < lyric.lines.length; i++) {
      if (lyric.lines[i].t <= ms) idx = i;
      else break;
    }
    if (idx !== lyricActiveIndex || force) {
      lyricActiveIndex = idx;
      renderLyricLines(lyric);
    }
  }

  function syncLyricsOverlay() {
    if (!lyricsOverlay || !lyricsLines) return;
    var track = currentTrack();
    var lyric = track && track.lyrics ? track.lyrics : null;
    var show = !!(state.minimized && lyric && lyric.lines && lyric.lines.length);
    lyricsOverlay.hidden = !show;
    lyricsOverlay.setAttribute("aria-hidden", show ? "false" : "true");
    if (!show) {
      if (lyricsLines) {
        lyricsLines.textContent = "";
        lyricsLines.classList.remove("is-static");
      }
      lyricSweepKey = "";
      lastLyricsTrack = null;
      lyricActiveIndex = -1;
      return;
    }
    lyricsOverlay.setAttribute("data-align", state.lyricsAlign);
    if (lastLyricsTrack !== track) {
      lastLyricsTrack = track;
      lyricActiveIndex = -1;
      renderLyricLines(lyric);
    }
    if (lyric.synced) updateLyricActive(true);
  }

  function bindLyricsAlign() {
    if (!lyricsAlignBtn) return;
    var icons = { left: "align-left", center: "align-center", right: "align-right" };
    function cap(s) {
      return s.charAt(0).toUpperCase() + s.slice(1);
    }
    setIcon(lyricsAlignBtn, icons[state.lyricsAlign] || "align-center");
    lyricsAlignBtn.addEventListener("click", function () {
      var order = ["left", "center", "right"];
      state.lyricsAlign = order[(order.indexOf(state.lyricsAlign) + 1) % order.length];
      storage.set("lyrics-align", state.lyricsAlign);
      setIcon(lyricsAlignBtn, icons[state.lyricsAlign] || "align-center");
      lyricsAlignBtn.setAttribute("aria-label", cap(state.lyricsAlign));
      if (lyricsOverlay) lyricsOverlay.setAttribute("data-align", state.lyricsAlign);
      toast("Lyrics · " + cap(state.lyricsAlign));
    });
  }

  function bindLyricsSize() {
    if (!lyricsSizeDec || !lyricsSizeInc) return;
    var sizes = [14, 17, 20, 24, 28];
    var names = ["Extra Small", "Small", "Medium", "Large", "Extra Large"];
    function applySize() {
      if (lyricsOverlay) {
        lyricsOverlay.style.setProperty("--lyrics-size", sizes[state.lyricsSize] + "px");
      }
      lyricsSizeDec.setAttribute("aria-disabled", state.lyricsSize <= 0 ? "true" : "false");
      lyricsSizeInc.setAttribute(
        "aria-disabled",
        state.lyricsSize >= sizes.length - 1 ? "true" : "false"
      );
    }
    function stepSize(delta) {
      var next = state.lyricsSize + delta;
      if (next < 0) next = 0;
      if (next > sizes.length - 1) next = sizes.length - 1;
      state.lyricsSize = next;
      storage.set("lyrics-size", String(next));
      applySize();
      toast("Lyrics size: " + names[next]);
    }
    applySize();
    lyricsSizeDec.addEventListener("click", function () {
      stepSize(-1);
    });
    lyricsSizeInc.addEventListener("click", function () {
      stepSize(1);
    });
  }

  function toggleMinimize() {
    state.minimized = !state.minimized;
    body.classList.toggle("is-minimized", state.minimized);
    if (miniBar) miniBar.hidden = !state.minimized;
    if (minimizeBtn) {
      setIcon(minimizeBtn, state.minimized ? "chevron-up" : "chevron-down");
      minimizeBtn.setAttribute("aria-pressed", String(state.minimized));
      minimizeBtn.setAttribute(
        "aria-label",
        state.minimized ? "Expand player" : "Minimize player"
      );
      minimizeBtn.setAttribute(
        "title",
        state.minimized ? "Expand to full player" : "Collapse to mini bar"
      );
    }
    if (state.minimized) {
      closeMiniDropup();
      syncMiniMeta();
      syncMiniTransport();
    }
    syncLyricsOverlay();
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
      if (!bgStage.classList.contains("has-image")) {
        var p = bgVideo.play();
        if (p && p.catch) p.catch(function () {});
      }
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
      if (track.uploadId) {
        var editGlyph = document.createElement("span");
        editGlyph.className = "q-edit";
        editGlyph.setAttribute("role", "button");
        editGlyph.setAttribute("tabindex", "0");
        editGlyph.setAttribute("data-icon", "pencil");
        editGlyph.setAttribute("aria-label", "Edit track info");
        editGlyph.setAttribute("title", "Edit track info");
        (function (t) {
          function openEdit(e) {
            if (e) {
              if (e.stopPropagation) e.stopPropagation();
              if (e.preventDefault) e.preventDefault();
            }
            openEditModal(t);
          }
          editGlyph.addEventListener("click", openEdit);
          editGlyph.addEventListener("keydown", function (e) {
            if (e.key === "Enter" || e.key === " ") openEdit(e);
          });
        })(track);
        tail.appendChild(editGlyph);
        var lyricGlyph = document.createElement("span");
        lyricGlyph.className = "q-lyrics";
        lyricGlyph.setAttribute("role", "button");
        lyricGlyph.setAttribute("tabindex", "0");
        lyricGlyph.setAttribute("data-icon", "text-quote");
        lyricGlyph.setAttribute("aria-label", "Edit lyrics");
        lyricGlyph.setAttribute("title", "Edit lyrics");
        (function (t) {
          function openLyrics(e) {
            if (e) {
              if (e.stopPropagation) e.stopPropagation();
              if (e.preventDefault) e.preventDefault();
            }
            openLyricsEditor(t, false);
          }
          lyricGlyph.addEventListener("click", openLyrics);
          lyricGlyph.addEventListener("keydown", function (e) {
            if (e.key === "Enter" || e.key === " ") openLyrics(e);
          });
        })(track);
        tail.appendChild(lyricGlyph);
      }

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
      syncLyricsOverlay();
      return;
    }

    state.index = ((indexValue % list.length) + list.length) % list.length;
    var track = list[state.index];

    trackTitle.textContent = track.name;
    trackArtist.textContent = track.artist;
    trackNumber.textContent = "Track " + pad2(state.index + 1);
    trackOf.textContent = "of " + list.length;
    syncMiniMeta();
    syncLyricsOverlay();

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

    applyBackground();

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
    if (miniSeekFill) miniSeekFill.style.width = "0%";
    if (miniSeek) miniSeek.setAttribute("aria-valuenow", "0");
    if (miniCurrent) miniCurrent.textContent = "0:00";
    if (miniTotal) miniTotal.textContent = "0:00";
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
    if (miniVolumeEl) {
      miniVolumeEl.value = String(pct);
      miniVolumeEl.style.setProperty("--val", pct + "%");
    }
    if (showFeedback) toast(v === 0 ? "Muted" : "Volume " + pct + "%");
  }

  function updateVolumeIcon(v) {
    if (v === 0) setIcon(muteBtn, "volume-x");
    else if (v < 0.5) setIcon(muteBtn, "volume-1");
    else setIcon(muteBtn, "volume-2");
    if (miniVolBtn) {
      if (v === 0) setIcon(miniVolBtn, "volume-x");
      else if (v < 0.5) setIcon(miniVolBtn, "volume-1");
      else setIcon(miniVolBtn, "volume-2");
    }
  }

  function handleVolumeInput(rawValue) {
    var value = Number(rawValue) / 100;
    state.lastVolume = value > 0 ? value : state.lastVolume;
    applyVolume(value, false);
    storage.set("volume", String(Math.round(value * 100)));
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

  function miniSeekRatioFromEvent(clientX) {
    if (!miniSeek) return 0;
    var rect = miniSeek.getBoundingClientRect();
    if (!rect.width) return 0;
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  }

  function bindMiniSeek() {
    if (!miniSeek) return;
    miniSeek.addEventListener("pointerdown", function (e) {
      if (!isFinite(audio.duration)) return;
      state.dragging = true;
      miniSeek.classList.add("is-dragging");
      try {
        miniSeek.setPointerCapture(e.pointerId);
      } catch (err) {}
      seekTo(miniSeekRatioFromEvent(e.clientX));
    });

    miniSeek.addEventListener("pointermove", function (e) {
      if (!state.dragging) return;
      seekTo(miniSeekRatioFromEvent(e.clientX));
    });

    function endMiniDrag(e) {
      if (!state.dragging) return;
      state.dragging = false;
      miniSeek.classList.remove("is-dragging");
      if (e && e.pointerId !== undefined) {
        try {
          if (miniSeek.hasPointerCapture(e.pointerId)) {
            miniSeek.releasePointerCapture(e.pointerId);
          }
        } catch (err) {}
      }
    }

    miniSeek.addEventListener("pointerup", endMiniDrag);
    miniSeek.addEventListener("pointercancel", endMiniDrag);

    miniSeek.addEventListener("keydown", function (e) {
      if (!isFinite(audio.duration)) return;
      if (e.key === "ArrowRight" || e.key === "ArrowUp") {
        e.preventDefault();
        audio.currentTime = Math.min(audio.duration, audio.currentTime + 5);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
        e.preventDefault();
        audio.currentTime = Math.max(0, audio.currentTime - 5);
      } else if (e.key === "Home") {
        e.preventDefault();
        audio.currentTime = 0;
      } else if (e.key === "End") {
        e.preventDefault();
        audio.currentTime = audio.duration;
      }
    });
  }

  function bindMini() {
    if (minimizeBtn) minimizeBtn.addEventListener("click", toggleMinimize);
    if (miniThumb) {
      miniThumb.addEventListener("error", function () {
        if (miniThumb.src.indexOf(FALLBACK_IMG) !== -1) return;
        miniThumb.src = FALLBACK_IMG;
      });
    }
    if (miniPlay) miniPlay.addEventListener("click", togglePlay);
    if (miniPrev) miniPrev.addEventListener("click", prevTrack);
    if (miniNext) {
      miniNext.addEventListener("click", function () {
        nextTrack(true);
      });
    }
    if (miniShuffle) miniShuffle.addEventListener("click", toggleShuffle);
    if (miniRepeat) miniRepeat.addEventListener("click", cycleRepeat);
    if (miniVolBtn && miniDropup) {
      miniVolBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        var willOpen = miniDropup.hidden;
        miniDropup.hidden = !willOpen;
        miniVolBtn.setAttribute("aria-expanded", String(willOpen));
      });
    }
    if (miniVolumeEl) {
      miniVolumeEl.addEventListener("input", function () {
        handleVolumeInput(miniVolumeEl.value);
      });
    }
    document.addEventListener("click", function (e) {
      if (!miniDropup || miniDropup.hidden) return;
      if (e.target && e.target.closest && e.target.closest(".mini-vol")) return;
      closeMiniDropup();
    });
    document.addEventListener(
      "keydown",
      function (e) {
        if (e.key === "Escape" && miniDropup && !miniDropup.hidden) {
          closeMiniDropup();
        }
      },
      true
    );
    bindMiniSeek();
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
    if (miniSeekFill) miniSeekFill.style.width = pct + "%";
    if (miniSeek) miniSeek.setAttribute("aria-valuenow", String(Math.round(pct)));
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
        if (miniCurrent) miniCurrent.textContent = currentText;
        lastCurrentText = currentText;
      }
      if (isFinite(duration) && duration > 0) {
        var totalText = formatTime(duration);
        if (totalText !== lastTotalText) {
          totalTimeEl.textContent = totalText;
          if (miniTotal) miniTotal.textContent = totalText;
          lastTotalText = totalText;
        }
      }
    }

    if (lyricsOverlay && !lyricsOverlay.hidden) updateLyricActive(false);

    if (lyricsOverlay && !lyricsOverlay.hidden) updateLyricSweep();

    drawVisualizer(time);
  }

  /* --------------------------------------------------------- keyboard ops */

  function toggleShuffle() {
    state.shuffle = !state.shuffle;
    shuffleBtn.setAttribute("aria-pressed", String(state.shuffle));
    if (miniShuffle) {
      miniShuffle.setAttribute("aria-pressed", String(state.shuffle));
      miniShuffle.classList.toggle("is-active", state.shuffle);
    }
    toast("Shuffle " + (state.shuffle ? "on" : "off"));
  }

  function cycleRepeat() {
    state.repeat = (state.repeat + 1) % 3;
    var labels = ["Off", "All", "One"];
    repeatBtn.setAttribute("aria-pressed", String(state.repeat > 0));
    repeatBtn.setAttribute("aria-label", "Repeat " + labels[state.repeat]);
    setIcon(repeatBtn, state.repeat === 2 ? "repeat-1" : "repeat");
    if (miniRepeat) {
      miniRepeat.setAttribute("aria-pressed", String(state.repeat > 0));
      miniRepeat.setAttribute("aria-label", "Repeat " + labels[state.repeat]);
      setIcon(miniRepeat, state.repeat === 2 ? "repeat-1" : "repeat");
    }
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
      handleVolumeInput(volumeEl.value);
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
      if (miniPlay) {
        setIcon(miniPlay, "pause");
        miniPlay.setAttribute("aria-label", "Pause");
      }
      npBadge.classList.remove("is-hidden");
      resumeGraph();
    });

    audio.addEventListener("pause", function () {
      body.classList.remove("is-playing");
      albumStage.classList.remove("playing");
      setIcon(playBtn, "play");
      playBtn.setAttribute("aria-label", "Play");
      if (miniPlay) {
        setIcon(miniPlay, "play");
        miniPlay.setAttribute("aria-label", "Play");
      }
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

  function readLrcFile(file) {
    return new Promise(function (resolve) {
      try {
        var reader = new FileReader();
        reader.onload = function () {
          var parsed = null;
          try {
            var uploads = window.MUSICGO_UPLOADS;
            if (uploads && uploads.parseLrc) parsed = uploads.parseLrc(reader.result);
          } catch (e) {
            parsed = null;
          }
          resolve(parsed);
        };
        reader.onerror = function () {
          resolve(null);
        };
        reader.readAsText(file);
      } catch (e) {
        resolve(null);
      }
    });
  }

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
    var thumbField = document.getElementById("up-thumb-field");
    var coverField = document.getElementById("up-cover-field");
    var noCoverEl = document.getElementById("up-no-cover");
    var srcEmbedded = document.getElementById("up-src-embedded");
    var srcCustom = document.getElementById("up-src-custom");
    var embeddedPreview = document.getElementById("up-embedded-preview");
    var embeddedCover = null;
    var embeddedURL = null;
    var embeddedLyrics = null;
    var lrcInput = document.getElementById("up-lrc");
    var lrcNote = document.getElementById("up-lrc-note");
    var lrcLyrics = null;
    var lastLrcFile = null;

    function resetCoverState() {
      if (embeddedURL) {
        try {
          window.URL.revokeObjectURL(embeddedURL);
        } catch (e) {}
        embeddedURL = null;
      }
      embeddedCover = null;
      embeddedLyrics = null;
      lrcLyrics = null;
      lastLrcFile = null;
      if (lrcNote) lrcNote.hidden = true;
      if (embeddedPreview) embeddedPreview.removeAttribute("src");
      if (srcEmbedded) srcEmbedded.checked = true;
      if (thumbField) thumbField.hidden = false;
      if (coverField) coverField.hidden = true;
      if (noCoverEl) noCoverEl.hidden = true;
    }

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
      if (lrcInput) lrcInput.value = "";
      resetCoverState();
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
      resetCoverState();
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

    audioInput.addEventListener("change", function () {
      if (embeddedURL) {
        try {
          window.URL.revokeObjectURL(embeddedURL);
        } catch (e) {}
        embeddedURL = null;
      }
      embeddedCover = null;
      embeddedLyrics = null;
      if (embeddedPreview) embeddedPreview.removeAttribute("src");
      if (coverField) coverField.hidden = true;
      if (noCoverEl) noCoverEl.hidden = true;
      if (thumbField) thumbField.hidden = false;
      if (srcEmbedded) srcEmbedded.checked = true;
      var file = audioInput.files && audioInput.files[0];
      if (!file) return;
      if (!uploads || (!uploads.extractCover && !uploads.extractMedia)) return;
      var readMedia = uploads.extractMedia
        ? uploads.extractMedia(file)
        : uploads.extractCover(file).then(function (blob) {
            return { cover: blob, lyrics: null };
          });
      readMedia.then(function (media) {
        var cur = audioInput.files && audioInput.files[0];
        if (cur !== file || modal.hidden) return;
        var blob = media && media.cover ? media.cover : null;
        if (blob) {
          embeddedCover = blob;
          try {
            embeddedURL = window.URL.createObjectURL(blob);
          } catch (e) {
            embeddedURL = null;
          }
          if (embeddedPreview && embeddedURL) embeddedPreview.src = embeddedURL;
          if (coverField) coverField.hidden = false;
          if (srcEmbedded) srcEmbedded.checked = true;
          if (thumbField) thumbField.hidden = true;
        } else {
          if (noCoverEl) noCoverEl.hidden = false;
          if (thumbField) thumbField.hidden = false;
        }
        embeddedLyrics = media && media.lyrics ? media.lyrics : null;
      });
    });

    if (srcEmbedded) {
      srcEmbedded.addEventListener("change", function () {
        if (srcEmbedded.checked && thumbField) thumbField.hidden = true;
      });
    }
    if (srcCustom) {
      srcCustom.addEventListener("change", function () {
        if (srcCustom.checked && thumbField) thumbField.hidden = false;
      });
    }

    if (lrcInput) {
      lrcInput.addEventListener("change", function () {
        lrcLyrics = null;
        lastLrcFile = null;
        if (lrcNote) lrcNote.hidden = true;
        var f = lrcInput.files && lrcInput.files[0];
        if (!f) return;
        readLrcFile(f).then(function (parsed) {
          var cur = lrcInput.files && lrcInput.files[0];
          if (cur !== f || modal.hidden) return;
          if (parsed) {
            lrcLyrics = parsed;
            lastLrcFile = f;
            if (lrcNote) lrcNote.hidden = false;
          }
        });
      });
    }

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

      var lrcFile = lrcInput.files && lrcInput.files[0];
      if (lrcFile && lrcFile !== lastLrcFile) {
        submitBtn.disabled = true;
        readLrcFile(lrcFile).then(function (parsed) {
          submitBtn.disabled = false;
          if (modal.hidden) return;
          if (!parsed) {
            showError("No timed lines found in .lrc");
            return;
          }
          lrcLyrics = parsed;
          lastLrcFile = lrcFile;
          if (lrcNote) lrcNote.hidden = false;
          doUploadSave(parsed);
        });
        return;
      }
      if (lrcFile && !lrcLyrics) {
        showError("No timed lines found in .lrc");
        return;
      }
      doUploadSave(lrcLyrics || null);

      function doUploadSave(lrcParsed) {
        submitBtn.disabled = true;
        var useEmbedded = embeddedCover && srcEmbedded && srcEmbedded.checked;
        uploads
          .save({
            title: title,
            artist: artist,
            playlistId: targetId,
            playlistLabel: targetLabel,
            isNewPlaylist: isNew,
            audioBlob: file,
            thumbBlob: useEmbedded ? embeddedCover : thumbFile || null,
            lyrics: lrcParsed || embeddedLyrics || null,
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
              lyrics: record.lyrics || null,
              bg: null,
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
      }
    });
  }

  /* -------------------------------------------------------------- track edit */

  var editTarget = null;

  function lyricsStateLabel(lyric) {
    if (!lyric || !lyric.lines || !lyric.lines.length) return "No lyrics";
    return (lyric.synced ? "Synced" : "Static") + " lyrics (" + lyric.lines.length + " lines)";
  }

  function refreshEditLyricsState() {
    if (!editTarget) return;
    var lyric = editTarget.removeLyrics
      ? null
      : editTarget.pendingLyrics || editTarget.record.lyrics || null;
    if (editTarget.editorLines) {
      lyric = editTarget.editorLines.length
        ? { synced: true, lines: editTarget.editorLines }
        : null;
    }
    var stateEl = document.getElementById("edit-lyrics-state");
    if (stateEl) stateEl.textContent = lyricsStateLabel(lyric);
    var removeBtn = document.getElementById("edit-lyrics-remove");
    if (removeBtn) removeBtn.hidden = !lyric;
  }

  function formatLyricTime(ms) {
    if (!isFinite(ms) || ms < 0) ms = 0;
    ms = Math.round(ms);
    var m = Math.floor(ms / 60000);
    var s = Math.floor((ms % 60000) / 1000);
    var cs = Math.floor((ms % 1000) / 10);
    return pad2(m) + ":" + pad2(s) + "." + pad2(cs);
  }

  function parseLyricTime(str) {
    var m = String(str).trim().match(/^(\d+):(\d{1,2})(?:\.(\d{1,3}))?$/);
    if (!m) return null;
    var sec = parseInt(m[2], 10);
    if (sec > 59) return null;
    var ms = parseInt(m[1], 10) * 60000 + sec * 1000;
    var frac = m[3] || "";
    if (frac.length === 1) ms += parseInt(frac, 10) * 100;
    else if (frac.length === 2) ms += parseInt(frac, 10) * 10;
    else if (frac.length === 3) ms += parseInt(frac, 10);
    return ms;
  }

  function cloneLyricLines(lines) {
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var entry = {
        t: lines[i].t,
        text: lines[i].text,
        raw: formatLyricTime(lines[i].t),
        origText: lines[i].text,
      };
      if (lines[i].words) {
        entry.words = lines[i].words.map(function (w) {
          return { t: w.t, text: w.text };
        });
      }
      out.push(entry);
    }
    return out;
  }

  function buildEditorLyrics(rows) {
    var lines = [];
    var total = 0;
    var i;
    for (i = 0; i < rows.length; i++) {
      var text = String(rows[i].text).trim();
      if (!text) continue;
      var t = rows[i].t;
      if (t === null || t === undefined || !isFinite(t) || t < 0) return false;
      if (lines.length >= 800 || total >= 20000) break;
      var room = 20000 - total;
      if (room <= 0) break;
      if (text.length > room) text = text.slice(0, room);
      if (!text) break;
      var built = { t: t, text: text };
      if (rows[i].words && text === rows[i].origText) {
        built.words = rows[i].words.map(function (w) {
          return { t: w.t, text: w.text };
        });
      }
      lines.push(built);
      total += text.length;
    }
    var seq = [];
    for (i = 0; i < lines.length; i++) seq.push({ line: lines[i], at: i });
    seq.sort(function (a, b) {
      if (a.line.t !== b.line.t) return a.line.t - b.line.t;
      return a.at - b.at;
    });
    lines = [];
    for (i = 0; i < seq.length; i++) lines.push(seq[i].line);
    if (!lines.length) return null;
    return { synced: true, lines: lines };
  }

  function resortLyricEditor() {
    if (!editTarget || !editTarget.editorLines) return;
    var rows = editTarget.editorLines;
    var seq = [];
    var i;
    for (i = 0; i < rows.length; i++) {
      var t = rows[i].t === null || rows[i].t === undefined ? Infinity : rows[i].t;
      seq.push({ entry: rows[i], t: t, at: i });
    }
    seq.sort(function (a, b) {
      if (a.t !== b.t) return a.t - b.t;
      return a.at - b.at;
    });
    var sorted = [];
    for (i = 0; i < seq.length; i++) sorted.push(seq[i].entry);
    editTarget.editorLines = sorted;
    // Reorder the EXISTING row nodes in place: appendChild on an attached
    // node moves it without recreating it, so focus, caret and typed values
    // in other rows survive the resort.
    var list = document.getElementById("lyric-rows");
    if (!list) return;
    for (i = 0; i < sorted.length; i++) {
      for (var k = 0; k < list.children.length; k++) {
        if (list.children[k]._lyricEntry === sorted[i]) {
          list.appendChild(list.children[k]);
          break;
        }
      }
    }
    renumberLyricRows();
  }

  function renumberLyricRows() {
    var list = document.getElementById("lyric-rows");
    if (!list) return;
    for (var i = 0; i < list.children.length; i++) {
      var row = list.children[i];
      var time = row.querySelector(".ly-time");
      var text = row.querySelector(".ly-text");
      var del = row.querySelector(".ly-del");
      if (time) time.setAttribute("aria-label", "Line " + (i + 1) + " time");
      if (text) text.setAttribute("aria-label", "Line " + (i + 1) + " lyric");
      if (del) del.setAttribute("aria-label", "Delete line " + (i + 1));
    }
  }

  function buildLyricRow(entry, n) {
    var invalid =
      (entry.t === null || entry.t === undefined) && !!String(entry.text).trim();
    var row = document.createElement("div");
    row.className = "lyric-row" + (invalid ? " is-invalid" : "");
    row._lyricEntry = entry;
    var time = document.createElement("input");
    time.type = "text";
    time.className = "ly-time";
    time.value =
      entry.raw !== undefined && entry.raw !== null
        ? entry.raw
        : formatLyricTime(entry.t);
    time.setAttribute("aria-label", "Line " + (n + 1) + " time");
    time.setAttribute("maxlength", "12");
    time.setAttribute("placeholder", "00:00.00");
    time.addEventListener("change", function () {
      var ms = parseLyricTime(time.value);
      entry.t = ms;
      entry.raw = time.value;
      if (ms === null) {
        row.classList.add("is-invalid");
        return;
      }
      row.classList.remove("is-invalid");
      resortLyricEditor();
    });
    var text = document.createElement("input");
    text.type = "text";
    text.className = "ly-text";
    text.value = entry.text;
    text.setAttribute("aria-label", "Line " + (n + 1) + " lyric");
    text.addEventListener("input", function () {
      entry.text = text.value;
    });
    var del = document.createElement("button");
    del.type = "button";
    del.className = "icon-btn ly-del";
    del.setAttribute("aria-label", "Delete line " + (n + 1));
    del.setAttribute("title", "Delete line");
    setIcon(del, "x");
    del.addEventListener("click", function () {
      if (!editTarget || !editTarget.editorLines) return;
      var live = editTarget.editorLines;
      var at = live.indexOf(entry);
      if (at !== -1) live.splice(at, 1);
      if (row.parentNode) row.parentNode.removeChild(row);
      renumberLyricRows();
      refreshEditLyricsState();
    });
    row.appendChild(time);
    row.appendChild(text);
    row.appendChild(del);
    return row;
  }

  function renderLyricEditor() {
    var box = document.getElementById("lyrics-editor");
    var list = document.getElementById("lyric-rows");
    var hint = document.getElementById("lyrics-editor-hint");
    if (!box || !list) return;
    if (!editTarget || !editTarget.editorLines) {
      box.hidden = true;
      list.textContent = "";
      if (hint) hint.hidden = true;
      return;
    }
    box.hidden = false;
    list.textContent = "";
    var rows = editTarget.editorLines;
    for (var i = 0; i < rows.length; i++) {
      list.appendChild(buildLyricRow(rows[i], i));
    }
    if (hint) hint.hidden = rows.length > 0;
  }

  /* ----------------------------------------------- background picker (shared) */

  function buildBgPicker(groupEl, groupName, selectedValue, defaultLabel) {
    if (!groupEl) return;
    groupEl.innerHTML = "";
    function addOption(value, label, thumb) {
      var lab = document.createElement("label");
      lab.className = "cover-choice";
      var input = document.createElement("input");
      input.type = "radio";
      input.name = groupName;
      input.value = value;
      if (value === selectedValue) input.checked = true;
      lab.appendChild(input);
      if (thumb) lab.appendChild(thumb);
      var span = document.createElement("span");
      span.textContent = label;
      lab.appendChild(span);
      groupEl.appendChild(lab);
      return input;
    }
    addOption("", defaultLabel, null);
    BG_PRESETS.forEach(function (p) {
      var thumb;
      if (p.kind === "video") {
        thumb = document.createElement("video");
        thumb.className = "bg-thumb";
        thumb.src = p.src;
        thumb.muted = true;
        thumb.playsInline = true;
        thumb.preload = "metadata";
      } else {
        thumb = document.createElement("img");
        thumb.className = "bg-thumb";
        thumb.src = p.src;
        thumb.alt = "";
        thumb.loading = "lazy";
      }
      addOption(p.id, p.label, thumb);
    });
    addOption("__upload", "Upload image…", null);
  }

  function bgGroupValue(groupEl, groupName) {
    if (!groupEl) return "";
    var checked = groupEl.querySelector('input[name="' + groupName + '"]:checked');
    return checked ? checked.value : "";
  }

  function checkBgUploadRadio(groupEl, groupName) {
    if (!groupEl) return;
    var input = groupEl.querySelector('input[name="' + groupName + '"][value="__upload"]');
    if (input) input.checked = true;
  }

  function paintBgPreview(ids, res) {
    var wrap = document.getElementById(ids.wrap);
    var img = document.getElementById(ids.img);
    var vid = document.getElementById(ids.vid);
    if (!wrap) return;
    if (!res) {
      wrap.hidden = true;
      return;
    }
    wrap.hidden = false;
    if (res.media === "video") {
      if (img) img.hidden = true;
      if (vid) {
        vid.hidden = false;
        if (vid.getAttribute("src") !== res.src) vid.src = res.src;
        try {
          var pr = vid.play();
          if (pr && pr.catch) pr.catch(function () {});
        } catch (e) {}
      }
    } else {
      if (vid) {
        try {
          vid.pause();
        } catch (e) {}
        vid.hidden = true;
      }
      if (img) {
        img.hidden = false;
        if (img.getAttribute("src") !== res.src) img.src = res.src;
      }
    }
  }

  function editBgSelection() {
    return bgGroupValue(document.getElementById("edit-bg-choices"), "edit-bg-src");
  }

  function refreshEditBgPreview() {
    if (!editTarget) return;
    var sel = editBgSelection();
    var fileEl = document.getElementById("edit-bg-file");
    if (fileEl) fileEl.hidden = sel !== "__upload";
    var res = null;
    if (sel && sel !== "__upload") {
      res = bgUrlFor({ kind: "preset", id: sel });
    } else if (sel === "__upload") {
      if (editTarget.bgURL) res = { media: "image", src: editTarget.bgURL };
      else if (
        editTarget.record.bg &&
        editTarget.record.bg.kind === "upload" &&
        editTarget.track.bg &&
        editTarget.track.bg.url
      ) {
        res = { media: "image", src: editTarget.track.bg.url };
      }
    } else {
      var pl = editTarget.record.playlistId ? findPlaylist(editTarget.record.playlistId) : null;
      if (pl && pl.bg) res = bgUrlFor(pl.bg);
      if (!res) res = { media: "video", src: trackBgVideo(editTarget.track) };
    }
    paintBgPreview(
      { wrap: "edit-bg-preview-wrap", img: "edit-bg-preview", vid: "edit-bg-preview-video" },
      res
    );
  }

  function openEditModal(track) {
    var uploads = window.MUSICGO_UPLOADS;
    if (!track || !track.uploadId || !uploads || !uploads.isLocal() || !editModalEl) return;
    uploads.get(track.uploadId).then(
      function (record) {
        if (!record) {
          toast("Track not found in library");
          return;
        }
        editTarget = {
          track: track,
          record: record,
          pendingLyrics: null,
          removeLyrics: false,
          thumbURL: null,
          editorLines: null,
          bgFile: null,
          bgURL: null,
        };
        var titleInput = document.getElementById("edit-title");
        var artistInput = document.getElementById("edit-artist");
        if (titleInput) titleInput.value = record.title || "";
        if (artistInput) artistInput.value = record.artist || "";
        var preview = document.getElementById("edit-thumb-preview");
        if (preview) {
          preview.removeAttribute("src");
          var cur = trackThumb(track);
          if (cur) preview.src = cur;
        }
        var keepRadio = document.getElementById("edit-src-keep");
        if (keepRadio) keepRadio.checked = true;
        var thumbFile = document.getElementById("edit-thumb-file");
        if (thumbFile) thumbFile.value = "";
        var lrcInput = document.getElementById("edit-lrc");
        if (lrcInput) lrcInput.value = "";
        var recBg = record.bg;
        var bgSel =
          recBg && recBg.kind === "preset"
            ? recBg.id
            : recBg && recBg.kind === "upload"
              ? "__upload"
              : "";
        buildBgPicker(document.getElementById("edit-bg-choices"), "edit-bg-src", bgSel, "Playlist default");
        var bgFileEl = document.getElementById("edit-bg-file");
        if (bgFileEl) {
          bgFileEl.value = "";
          bgFileEl.hidden = bgSel !== "__upload";
        }
        refreshEditBgPreview();
        var srcLyric = record.lyrics && record.lyrics.synced ? record.lyrics : null;
        editTarget.editorLines = srcLyric ? cloneLyricLines(srcLyric.lines) : null;
        refreshEditLyricsState();
        renderLyricEditor();
        var errorEl = document.getElementById("edit-error");
        if (errorEl) {
          errorEl.textContent = "";
          errorEl.hidden = true;
        }
        editModalEl.hidden = false;
        window.requestAnimationFrame(function () {
          editModalEl.classList.add("is-open");
        });
        window.setTimeout(function () {
          if (titleInput && !editModalEl.hidden) titleInput.focus();
        }, 60);
      },
      function () {
        toast("Could not open editor");
      }
    );
  }

  function bindEdit() {
    var modal = editModalEl;
    var form = document.getElementById("edit-form");
    if (!modal || !form) return;
    var uploads = window.MUSICGO_UPLOADS;
    var thumbFile = document.getElementById("edit-thumb-file");
    var preview = document.getElementById("edit-thumb-preview");
    var srcNew = document.getElementById("edit-src-new");
    var lrcInput = document.getElementById("edit-lrc");
    var removeBtn = document.getElementById("edit-lyrics-remove");
    var addLineBtn = document.getElementById("lyrics-add-line");
    var errorEl = document.getElementById("edit-error");
    var saveBtn = document.getElementById("edit-save");
    var closeBtn = document.getElementById("edit-close");
    var cancelBtn = document.getElementById("edit-cancel");

    function showError(message) {
      if (!errorEl) return;
      errorEl.textContent = message;
      errorEl.hidden = false;
    }

    function clearError() {
      if (!errorEl) return;
      errorEl.textContent = "";
      errorEl.hidden = true;
    }

    function closeEdit() {
      modal.classList.remove("is-open");
      if (editTarget && editTarget.thumbURL) {
        try {
          window.URL.revokeObjectURL(editTarget.thumbURL);
        } catch (e) {}
        editTarget.thumbURL = null;
      }
      if (editTarget && editTarget.bgURL) {
        try {
          window.URL.revokeObjectURL(editTarget.bgURL);
        } catch (e) {}
        editTarget.bgURL = null;
      }
      editTarget = null;
      window.setTimeout(function () {
        modal.hidden = true;
        clearError();
      }, 220);
    }

    if (closeBtn) closeBtn.addEventListener("click", closeEdit);
    if (cancelBtn) cancelBtn.addEventListener("click", closeEdit);

    modal.addEventListener("click", function (e) {
      if (e.target === modal) closeEdit();
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !modal.hidden) closeEdit();
    });

    if (thumbFile) {
      thumbFile.addEventListener("change", function () {
        if (editTarget && editTarget.thumbURL) {
          try {
            window.URL.revokeObjectURL(editTarget.thumbURL);
          } catch (e) {}
          editTarget.thumbURL = null;
        }
        var f = thumbFile.files && thumbFile.files[0];
        if (!f || !editTarget || !preview) return;
        try {
          editTarget.thumbURL = window.URL.createObjectURL(f);
        } catch (e) {
          editTarget.thumbURL = null;
        }
        if (editTarget.thumbURL) preview.src = editTarget.thumbURL;
        if (srcNew) srcNew.checked = true;
      });
    }

    if (lrcInput) {
      lrcInput.addEventListener("change", function () {
        if (!editTarget) return;
        var f = lrcInput.files && lrcInput.files[0];
        editTarget.pendingLyrics = null;
        if (!f) {
          refreshEditLyricsState();
          return;
        }
        readLrcFile(f).then(function (parsed) {
          if (!editTarget || modal.hidden) return;
          var cur = lrcInput.files && lrcInput.files[0];
          if (cur !== f) return;
          if (parsed) {
            editTarget.pendingLyrics = parsed;
            editTarget.removeLyrics = false;
            editTarget.editorLines = cloneLyricLines(parsed.lines);
            clearError();
          } else {
            showError("No timed lines found in .lrc");
          }
          refreshEditLyricsState();
          renderLyricEditor();
        });
      });
    }

    var bgChoices = document.getElementById("edit-bg-choices");
    var bgFile = document.getElementById("edit-bg-file");
    if (bgChoices) {
      bgChoices.addEventListener("change", function () {
        refreshEditBgPreview();
      });
    }
    if (bgFile) {
      bgFile.addEventListener("change", function () {
        if (editTarget && editTarget.bgURL) {
          try {
            window.URL.revokeObjectURL(editTarget.bgURL);
          } catch (e) {}
          editTarget.bgURL = null;
        }
        var f = bgFile.files && bgFile.files[0];
        if (!f || !editTarget) return;
        try {
          editTarget.bgURL = window.URL.createObjectURL(f);
        } catch (e) {
          editTarget.bgURL = null;
        }
        checkBgUploadRadio(bgChoices, "edit-bg-src");
        refreshEditBgPreview();
      });
    }

    if (removeBtn) {
      removeBtn.addEventListener("click", function () {
        if (!editTarget) return;
        editTarget.removeLyrics = true;
        editTarget.pendingLyrics = null;
        editTarget.editorLines = null;
        if (lrcInput) lrcInput.value = "";
        refreshEditLyricsState();
        renderLyricEditor();
      });
    }

    var openLyricsBtn = document.getElementById("edit-lyrics-open");
    if (openLyricsBtn) {
      openLyricsBtn.addEventListener("click", function () {
        if (!editTarget) return;
        openLyricsEditor(editTarget.track, true);
      });
    }

    if (addLineBtn) {
      addLineBtn.addEventListener("click", function () {
        if (!editTarget || !editTarget.editorLines) return;
        var rows = editTarget.editorLines;
        var nt = 0;
        if (rows.length) {
          var last = rows[rows.length - 1].t;
          nt = (isFinite(last) ? last : 0) + 2000;
        }
        rows.push({ t: nt, text: "", raw: formatLyricTime(nt) });
        clearError();
        var list = document.getElementById("lyric-rows");
        if (list) {
          var fresh = buildLyricRow(rows[rows.length - 1], rows.length);
          list.appendChild(fresh);
          renumberLyricRows();
          var box = fresh.querySelector(".ly-text");
          if (box) box.focus();
        }
        refreshEditLyricsState();
      });
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!editTarget || !uploads) return;
      clearError();
      var titleInput = document.getElementById("edit-title");
      var artistInput = document.getElementById("edit-artist");
      var title = titleInput ? titleInput.value.trim() : "";
      var artist = artistInput ? artistInput.value.trim() : "";
      if (!title) {
        showError("Add a title.");
        return;
      }
      if (!artist) {
        showError("Add an artist name.");
        return;
      }
      var newThumb = thumbFile && thumbFile.files ? thumbFile.files[0] : null;
      if (newThumb && newThumb.type && newThumb.type.indexOf("image/") !== 0) {
        showError("Thumbnail must be an image.");
        return;
      }
      var newBgFile = bgFile && bgFile.files ? bgFile.files[0] : null;
      if (newBgFile && newBgFile.type && newBgFile.type.indexOf("image/") !== 0) {
        showError("Background must be an image.");
        return;
      }
      if (newBgFile && newBgFile.size > BG_UPLOAD_MAX) {
        showError("Background image must be smaller than 10 MB.");
        return;
      }
      var srcNewEl = document.getElementById("edit-src-new");
      var useNewThumb = !!(newThumb && (!srcNewEl || srcNewEl.checked));
      var record = editTarget.record;
      var track = editTarget.track;
      record.title = title;
      record.artist = artist;
      if (useNewThumb) record.thumbBlob = newThumb;
      var bgSel = bgGroupValue(document.getElementById("edit-bg-choices"), "edit-bg-src");
      if (bgSel === "") record.bg = null;
      else if (bgSel === "__upload") {
        if (newBgFile) record.bg = { kind: "upload", blob: newBgFile };
        else if (record.bg && record.bg.kind === "upload" && record.bg.blob) {
          /* keep existing upload */
        } else {
          showError("Choose a background image, or pick another option.");
          return;
        }
      } else record.bg = { kind: "preset", id: bgSel };
      if (editTarget.removeLyrics) record.lyrics = null;
      else if (editTarget.editorLines) {
        var built = buildEditorLyrics(editTarget.editorLines);
        if (built === false) {
          renderLyricEditor();
          showError("Time format: mm:ss.xx");
          return;
        }
        record.lyrics = built;
      } else if (editTarget.pendingLyrics) record.lyrics = editTarget.pendingLyrics;
      if (saveBtn) saveBtn.disabled = true;
      uploads.update(record).then(
        function () {
          if (saveBtn) saveBtn.disabled = false;
          track.name = record.title;
          track.artist = record.artist;
          if (useNewThumb) {
            if (track.thumb && track.thumb.indexOf("blob:") === 0) {
              try {
                window.URL.revokeObjectURL(track.thumb);
              } catch (err) {}
            }
            try {
              track.thumb = window.URL.createObjectURL(newThumb);
            } catch (err) {
              track.thumb = null;
            }
          }
          track.lyrics = record.lyrics || null;
          revokeBgUrl(track.bg);
          track.bg = uploads.memoryBg ? uploads.memoryBg(record.bg) : null;
          renderQueue();
          var cur = currentTrack();
          if (cur === track || (cur && track.uploadId && cur.uploadId === track.uploadId)) {
            trackTitle.textContent = track.name;
            trackArtist.textContent = track.artist;
            albumArt.src = trackThumb(track);
            syncMiniMeta();
            syncLyricsOverlay();
            applyBackground();
          }
          closeEdit();
          toast("Track updated");
        },
        function (err) {
          if (saveBtn) saveBtn.disabled = false;
          showError("Update failed: " + (err && err.message ? err.message : "storage error"));
        }
      );
    });
  }

  /* ------------------------------------------------------ lyrics editor modal */

  function updateLyricWordsPreview() {
    var el = document.getElementById("lyrics-words-preview");
    if (!el) return;
    var count = 0;
    var stamps = [];
    if (editTarget && editTarget.editorLines) {
      var rows = editTarget.editorLines;
      for (var i = 0; i < rows.length; i++) {
        var w = rows[i].words;
        if (!w) continue;
        for (var j = 0; j < w.length; j++) {
          if (stamps.length < 3) stamps.push(formatLyricTime(w[j].t));
          count++;
        }
      }
    }
    if (!count) {
      el.hidden = true;
      el.textContent = "";
      return;
    }
    el.hidden = false;
    el.textContent =
      count +
      (count === 1 ? " word" : " words") +
      " · " +
      stamps.join(", ") +
      (count > stamps.length ? ", …" : "");
  }

  function openLyricsEditor(track, fromEdit) {
    var uploads = window.MUSICGO_UPLOADS;
    if (!track || !track.uploadId || !uploads || !uploads.isLocal() || !lyricsEditorModalEl)
      return;
    function proceed(t, record) {
      if (!editTarget || editTarget.track !== t) {
        editTarget = {
          track: t,
          record: record,
          pendingLyrics: null,
          removeLyrics: false,
          thumbURL: null,
          editorLines: null,
        };
      } else {
        editTarget.record = record;
      }
      var src = editTarget.removeLyrics
        ? null
        : editTarget.pendingLyrics || record.lyrics;
      editTarget.editorLines = src && src.synced ? cloneLyricLines(src.lines) : [];
      editTarget.lyricsReturnEdit = !!fromEdit && !!editModalEl && !editModalEl.hidden;
      if (editTarget.lyricsReturnEdit) {
        editModalEl.classList.remove("is-open");
        editModalEl.hidden = true;
      }
      refreshEditLyricsState();
      renderLyricEditor();
      updateLyricWordsPreview();
      var errorEl = document.getElementById("lyrics-editor-error");
      if (errorEl) {
        errorEl.textContent = "";
        errorEl.hidden = true;
      }
      var meta = document.getElementById("lyrics-editor-meta");
      if (meta) meta.textContent = t.name + " · " + t.artist;
      lyricsEditorModalEl.hidden = false;
      window.requestAnimationFrame(function () {
        lyricsEditorModalEl.classList.add("is-open");
      });
      window.setTimeout(function () {
        if (lyricsEditorModalEl.hidden) return;
        var first = document.querySelector("#lyric-rows .ly-time");
        if (first) first.focus();
      }, 60);
    }
    if (editTarget && editTarget.track === track && editTarget.record) {
      proceed(track, editTarget.record);
    } else {
      uploads.get(track.uploadId).then(
        function (record) {
          if (!record) {
            toast("Track not found in library");
            return;
          }
          proceed(track, record);
        },
        function () {
          toast("Could not open lyrics editor");
        }
      );
    }
  }

  function closeLyricsEditor(saved) {
    if (!lyricsEditorModalEl) return;
    lyricsEditorModalEl.classList.remove("is-open");
    if (!saved && editTarget) editTarget.editorLines = null;
    window.setTimeout(function () {
      lyricsEditorModalEl.hidden = true;
    }, 220);
    if (editTarget && editTarget.lyricsReturnEdit && editModalEl) {
      editTarget.lyricsReturnEdit = false;
      editModalEl.hidden = false;
      window.requestAnimationFrame(function () {
        editModalEl.classList.add("is-open");
      });
    }
  }

  function bindLyricsEditor() {
    var modal = lyricsEditorModalEl;
    var form = document.getElementById("lyrics-editor-form");
    if (!modal || !form) return;
    var uploads = window.MUSICGO_UPLOADS;
    var errorEl = document.getElementById("lyrics-editor-error");
    var saveBtn = document.getElementById("lyrics-editor-save");
    var closeBtn = document.getElementById("lyrics-editor-close");
    var cancelBtn = document.getElementById("lyrics-editor-cancel");

    function showError(message) {
      if (!errorEl) return;
      errorEl.textContent = message;
      errorEl.hidden = false;
    }

    function clearError() {
      if (!errorEl) return;
      errorEl.textContent = "";
      errorEl.hidden = true;
    }

    if (closeBtn)
      closeBtn.addEventListener("click", function () {
        closeLyricsEditor(false);
      });
    if (cancelBtn)
      cancelBtn.addEventListener("click", function () {
        closeLyricsEditor(false);
      });

    modal.addEventListener("click", function (e) {
      if (e.target === modal) closeLyricsEditor(false);
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !modal.hidden) closeLyricsEditor(false);
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!editTarget || !uploads) return;
      clearError();
      var built = buildEditorLyrics(editTarget.editorLines || []);
      if (built === false) {
        renderLyricEditor();
        showError("Time format: mm:ss.xx");
        return;
      }
      var record = editTarget.record;
      var track = editTarget.track;
      record.lyrics = built;
      if (saveBtn) saveBtn.disabled = true;
      uploads.update(record).then(
        function () {
          if (saveBtn) saveBtn.disabled = false;
          track.lyrics = record.lyrics || null;
          editTarget.pendingLyrics = record.lyrics;
          editTarget.removeLyrics = !record.lyrics;
          refreshEditLyricsState();
          updateLyricWordsPreview();
          var cur = currentTrack();
          if (cur === track || (cur && track.uploadId && cur.uploadId === track.uploadId)) {
            syncLyricsOverlay();
          }
          closeLyricsEditor(true);
          toast("Lyrics updated");
        },
        function (err) {
          if (saveBtn) saveBtn.disabled = false;
          showError("Update failed: " + (err && err.message ? err.message : "storage error"));
        }
      );
    });
  }

  /* ------------------------------------------------------ mobile nav drawer */

  function bindNav() {
    var toggle = document.getElementById("nav-toggle");
    var scrim = document.getElementById("nav-scrim");
    var timer = null;
    if (!toggle) return;

    function isOpen() {
      return document.body.classList.contains("nav-open");
    }

    function setNav(open) {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (open) {
        document.body.classList.remove("nav-closing");
        document.body.classList.add("nav-open");
        toggle.setAttribute("aria-expanded", "true");
        setIcon(toggle, "x");
        if (scrim) scrim.hidden = false;
      } else {
        if (!isOpen() && !document.body.classList.contains("nav-closing")) return;
        document.body.classList.remove("nav-open");
        document.body.classList.add("nav-closing");
        toggle.setAttribute("aria-expanded", "false");
        setIcon(toggle, "menu");
        timer = setTimeout(function () {
          document.body.classList.remove("nav-closing");
          if (scrim) scrim.hidden = true;
          timer = null;
        }, 260);
      }
    }

    toggle.addEventListener("click", function () {
      setNav(!isOpen());
    });

    if (scrim) {
      scrim.addEventListener("click", function () {
        setNav(false);
      });
    }

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && isOpen()) setNav(false);
    });

    // opening a modal from the drawer closes the drawer first
    ["upload-btn", "help-btn"].forEach(function (id) {
      var btn = document.getElementById(id);
      if (btn) {
        btn.addEventListener("click", function () {
          setNav(false);
        });
      }
    });
  }

  /* ------------------------------------------------------------ help guide */

  /* ---------------------------------------------------------- playlist edit */

  var plTarget = null;

  function refreshPlaylistBgPreview() {
    if (!plTarget) return;
    var sel = bgGroupValue(
      document.getElementById("playlist-bg-choices"),
      "pl-bg-src"
    );
    var fileEl = document.getElementById("playlist-bg-file");
    if (fileEl) fileEl.hidden = sel !== "__upload";
    var res = null;
    if (sel && sel !== "__upload") {
      res = bgUrlFor({ kind: "preset", id: sel });
    } else if (sel === "__upload") {
      if (plTarget.bgURL) res = { media: "image", src: plTarget.bgURL };
      else if (
        plTarget.def &&
        plTarget.def.bg &&
        plTarget.def.bg.kind === "upload" &&
        plTarget.playlist.bg &&
        plTarget.playlist.bg.url
      ) {
        res = { media: "image", src: plTarget.playlist.bg.url };
      }
    } else {
      res = {
        media: "video",
        src: plTarget.playlist.bgVideo || "videos/wallpaper1.mp4",
      };
    }
    paintBgPreview(
      {
        wrap: "playlist-bg-preview-wrap",
        img: "playlist-bg-preview",
        vid: "playlist-bg-preview-video",
      },
      res
    );
  }

  function openPlaylistModal() {
    var uploads = window.MUSICGO_UPLOADS;
    var pl = state.playlist;
    if (!pl || !uploads || !uploads.isLocal() || !playlistModalEl) return;
    uploads.getPlaylist(pl.id).then(
      function (def) {
        plTarget = { playlist: pl, def: def, bgFile: null, bgURL: null };
        var nameInput = document.getElementById("playlist-name");
        if (nameInput) nameInput.value = (def && def.label) || pl.label;
        var sel = pl.bg ? (pl.bg.kind === "preset" ? pl.bg.id : "__upload") : "";
        buildBgPicker(
          document.getElementById("playlist-bg-choices"),
          "pl-bg-src",
          sel,
          "Default video"
        );
        var fileEl = document.getElementById("playlist-bg-file");
        if (fileEl) {
          fileEl.value = "";
          fileEl.hidden = sel !== "__upload";
        }
        refreshPlaylistBgPreview();
        var errorEl = document.getElementById("playlist-error");
        if (errorEl) {
          errorEl.textContent = "";
          errorEl.hidden = true;
        }
        playlistModalEl.hidden = false;
        window.requestAnimationFrame(function () {
          playlistModalEl.classList.add("is-open");
        });
        window.setTimeout(function () {
          if (nameInput && !playlistModalEl.hidden) nameInput.focus();
        }, 60);
      },
      function () {
        toast("Could not open playlist editor");
      }
    );
  }

  function bindPlaylistModal() {
    var modal = playlistModalEl;
    var form = document.getElementById("playlist-form");
    if (!modal || !form) return;
    var uploads = window.MUSICGO_UPLOADS;
    var editBtn = document.getElementById("playlist-edit");
    var bgChoices = document.getElementById("playlist-bg-choices");
    var bgFile = document.getElementById("playlist-bg-file");
    var errorEl = document.getElementById("playlist-error");
    var saveBtn = document.getElementById("playlist-save");
    var closeBtn = document.getElementById("playlist-close");
    var cancelBtn = document.getElementById("playlist-cancel");

    if (editBtn) {
      if (uploads && uploads.isLocal()) editBtn.hidden = false;
      editBtn.addEventListener("click", function () {
        openPlaylistModal();
      });
    }

    function showError(message) {
      if (!errorEl) return;
      errorEl.textContent = message;
      errorEl.hidden = false;
    }

    function clearError() {
      if (!errorEl) return;
      errorEl.textContent = "";
      errorEl.hidden = true;
    }

    function closePlaylist() {
      modal.classList.remove("is-open");
      if (plTarget && plTarget.bgURL) {
        try {
          window.URL.revokeObjectURL(plTarget.bgURL);
        } catch (e) {}
        plTarget.bgURL = null;
      }
      plTarget = null;
      window.setTimeout(function () {
        modal.hidden = true;
        clearError();
      }, 220);
    }

    if (closeBtn) closeBtn.addEventListener("click", closePlaylist);
    if (cancelBtn) cancelBtn.addEventListener("click", closePlaylist);

    modal.addEventListener("click", function (e) {
      if (e.target === modal) closePlaylist();
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !modal.hidden) closePlaylist();
    });

    if (bgChoices) {
      bgChoices.addEventListener("change", function () {
        refreshPlaylistBgPreview();
      });
    }
    if (bgFile) {
      bgFile.addEventListener("change", function () {
        if (plTarget && plTarget.bgURL) {
          try {
            window.URL.revokeObjectURL(plTarget.bgURL);
          } catch (e) {}
          plTarget.bgURL = null;
        }
        var f = bgFile.files && bgFile.files[0];
        if (!f || !plTarget) return;
        try {
          plTarget.bgURL = window.URL.createObjectURL(f);
        } catch (e) {
          plTarget.bgURL = null;
        }
        checkBgUploadRadio(bgChoices, "pl-bg-src");
        refreshPlaylistBgPreview();
      });
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!plTarget || !uploads) return;
      clearError();
      var nameInput = document.getElementById("playlist-name");
      var name = nameInput ? nameInput.value.trim() : "";
      if (!name) {
        showError("Enter a playlist name.");
        return;
      }
      var newBgFile = bgFile && bgFile.files ? bgFile.files[0] : null;
      if (newBgFile && newBgFile.type && newBgFile.type.indexOf("image/") !== 0) {
        showError("Background must be an image.");
        return;
      }
      if (newBgFile && newBgFile.size > BG_UPLOAD_MAX) {
        showError("Background image must be smaller than 10 MB.");
        return;
      }
      var sel = bgGroupValue(
        document.getElementById("playlist-bg-choices"),
        "pl-bg-src"
      );
      var stored = null;
      if (sel === "") stored = null;
      else if (sel === "__upload") {
        if (newBgFile) stored = { kind: "upload", blob: newBgFile };
        else if (
          plTarget.def &&
          plTarget.def.bg &&
          plTarget.def.bg.kind === "upload" &&
          plTarget.def.bg.blob
        ) {
          stored = plTarget.def.bg;
        } else {
          showError("Choose a background image, or pick another option.");
          return;
        }
      } else stored = { kind: "preset", id: sel };
      var pl = plTarget.playlist;
      var def = {
        id: pl.id,
        label: name,
        addedAt: (plTarget.def && plTarget.def.addedAt) || Date.now(),
        bg: stored,
      };
      if (saveBtn) saveBtn.disabled = true;
      uploads.savePlaylist(def).then(
        function (saved) {
          if (saveBtn) saveBtn.disabled = false;
          pl.label = saved.label;
          revokeBgUrl(pl.bg);
          pl.bg = uploads.memoryBg ? uploads.memoryBg(saved.bg) : null;
          renderTabs();
          applyBackground();
          closePlaylist();
          toast("Playlist updated");
        },
        function (err) {
          if (saveBtn) saveBtn.disabled = false;
          showError("Update failed: " + (err && err.message ? err.message : "storage error"));
        }
      );
    });
  }

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
    bindMini();
    bindLyricsAlign();
    bindLyricsSize();
    bindEvents();
    bindUpload();
    bindEdit();
    bindLyricsEditor();
    bindHelp();
    bindNav();
    bindPlaylistModal();
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
