(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  const els = {
    body: document.body,
    app: $("#app"),
    canvas: $("#ambientCanvas"),
    albumTitle: $("#albumTitle"),
    artistName: $("#artistName"),
    skinName: $("#skinName"),
    coverA: $("#coverA"),
    coverB: $("#coverB"),
    vinylLabel: $("#vinylLabel"),
    trackIndex: $("#trackIndex"),
    trackTotal: $("#trackTotal"),
    trackTitle: $("#trackTitle"),
    trackSubtitle: $("#trackSubtitle"),
    trackKicker: $("#trackKicker"),
    nextTrackTitle: $("#nextTrackTitle"),
    archiveCode: $("#archiveCode"),
    imageModeText: $("#imageModeText"),
    spectrumRuler: $("#spectrumRuler"),
    currentTime: $("#currentTime"),
    durationTime: $("#durationTime"),
    progressFill: $("#progressFill"),
    progressTrack: $(".progress-track"),
    footerNote: $("#footerNote"),
    playBtn: $("#playBtn"),
    prevBtn: $("#prevBtn"),
    nextBtn: $("#nextBtn"),
    cleanBtn: $("#cleanBtn"),
    loadFolderBtn: $("#loadFolderBtn"),
    motionBtn: $("#motionBtn"),
    mappingBtn: $("#mappingBtn"),
    mappingPanel: $("#mappingPanel"),
    mappingList: $("#mappingList"),
    mappingCloseBtn: $("#mappingCloseBtn"),
    autoMapBtn: $("#autoMapBtn"),
    resetStartsBtn: $("#resetStartsBtn"),
    exportMapBtn: $("#exportMapBtn"),
    welcome: $("#welcome"),
    welcomeFolderBtn: $("#welcomeFolderBtn"),
    welcomeDeleteBtn: $("#welcomeDeleteBtn"),
    welcomeCloseBtn: $("#welcomeCloseBtn"),
    albumPicker: $("#albumPicker"),
    albumOverviewBtn: $("#albumOverviewBtn"),
    controlDock: $(".control-dock"),
    dockToggleLeft: $("#dockToggleLeft"),
    dockToggleRight: $("#dockToggleRight"),
    folderInput: $("#folderInput"),
    dropOverlay: $("#dropOverlay"),
    toast: $("#toast"),
    bgA: $(".background-image-a"),
    bgB: $(".background-image-b"),
    audio: [$("#audioA"), $("#audioB")],
    previewAudio: $("#previewAudio"),
    artShell: $("#artShell"),
    panelAlbumTitle: $("#panelAlbumTitle"),
    touchNowIndex: $("#touchNowIndex"),
    touchNowTitle: $("#touchNowTitle"),
    trackList: $("#trackList")
  };

  const SKINS = [
    { id: "stamp", name: "邮票档案" },
    { id: "film", name: "夜航胶片" },
    { id: "glass", name: "玻璃潮汐" }
  ];

  const AUDIO_EXT = new Set(["mp3", "wav", "m4a", "aac", "ogg", "flac", "opus"]);
  const IMAGE_EXT = new Set(["jpg", "jpeg", "png", "webp", "gif", "avif", "svg"]);

  const PERFORMANCE = (() => {
    const params = new URLSearchParams(location.search);
    const mode = (params.get("performance") || "auto").toLowerCase();
    const ua = navigator.userAgent || "";
    const android = /Android/i.test(ua);
    const webView = android && (/\bwv\b/i.test(ua) || /; wv\)/i.test(ua) || location.hostname === "appassets.androidplatform.net");
    const enabled = mode === "1" || mode === "on" || mode === "mobile" || (mode === "auto" && android);
    return {
      enabled,
      android,
      webView,
      mode,
      spectrumBands: enabled ? 32 : 48,
      targetFps: enabled ? 30 : 60,
      minimumFps: enabled ? 24 : 60,
      cssInterval: enabled ? 34 : 16,
      progressInterval: enabled ? 100 : 50,
      dprCap: enabled ? 1 : 1.5,
      renderScale: 1,
      minRenderScale: enabled ? .72 : 1,
      maxRenderScale: 1,
      adaptive: enabled,
      averageRenderCost: 0,
      averageFrameGap: 0,
      cssCache: new Map(),
      barCache: [],
      qualityChanges: 0
    };
  })();

  document.documentElement.dataset.performance = PERFORMANCE.enabled ? "mobile" : "full";
  document.documentElement.dataset.runtime = PERFORMANCE.webView ? "android-webview" : (PERFORMANCE.android ? "android-browser" : "desktop");

  const state = {
    tracks: [],
    currentIndex: -1,
    activeDeck: 0,
    playing: false,
    transitioning: false,
    transitionToken: 0,
    skinIndex: 0,
    clean: false,
    dockVisible: false,
    objectUrls: [],
    audioContext: null,
    sources: [],
    gains: [],
    analyser: null,
    frequencyData: null,
    timeData: null,
    levels: { energy: 0.12, low: 0.1, mid: 0.08, high: 0.06, impact: 0, flux: 0 },
    spectrum: new Float32Array(PERFORMANCE.spectrumBands),
    previousSpectrum: new Float32Array(PERFORMANCE.spectrumBands),
    spectrumBars: [],
    fakePhase: 0,
    motionMode: 1,
    imageCount: 0,
    availableImages: [],
    decodedImages: new Map(),
    deckTrackIndices: [-1, -1],
    mappingOpen: false,
    previewTrackIndex: -1,
    previewTimer: 0,
    albumMeta: {},
    toastTimer: 0
  };

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function pad(value, size = 2) {
    return String(value).padStart(size, "0");
  }

  function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return "00:00";
    const total = Math.floor(seconds);
    return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
  }

  function formatTimePrecise(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return "00:00.0";
    const minutes = Math.floor(seconds / 60);
    const rest = (seconds - minutes * 60).toFixed(1).padStart(4, "0");
    return `${pad(minutes)}:${rest}`;
  }

  function parseTimeCode(value) {
    const text = String(value || "").trim();
    if (!text) return 0;
    if (!text.includes(":")) {
      const seconds = Number(text);
      return Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
    }
    const parts = text.split(":").map((part) => Number(part.trim()));
    if (parts.some((part) => !Number.isFinite(part))) return 0;
    let total = 0;
    for (const part of parts) total = total * 60 + part;
    return Math.max(0, total);
  }

  function naturalCompare(a, b) {
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
  }

  function extension(name) {
    const match = name.toLowerCase().match(/\.([a-z0-9]+)$/);
    return match ? match[1] : "";
  }

  function stem(name) {
    return name.replace(/\.[^.]+$/, "");
  }

  function pairingKey(name) {
    const base = stem(name).trim().toLowerCase();
    const leading = base.match(/^\s*(\d{1,4})/);
    if (leading) return `n:${String(Number(leading[1])).padStart(4, "0")}`;
    return `s:${base.replace(/[\s_-]+/g, " ")}`;
  }

  function titleFromFilename(name) {
    const base = stem(name).trim();
    const numbered = base.match(/^\s*\d{1,4}(?:\s+|[._\-、—–]+\s*)(.+?)\s*$/);
    const title = (numbered?.[1] || base)
      .replace(/[_]+/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
    return title || base;
  }

  function showToast(message, duration = 2400) {
    clearTimeout(state.toastTimer);
    els.toast.textContent = message;
    els.toast.classList.add("is-visible");
    state.toastTimer = setTimeout(() => els.toast.classList.remove("is-visible"), duration);
  }

  function setWelcomeVisible(visible) {
    els.welcome.classList.toggle("is-hidden", !visible);
  }

  function revokeObjectUrls() {
    for (const url of state.objectUrls) URL.revokeObjectURL(url);
    state.objectUrls = [];
    state.decodedImages.clear();
    state.deckTrackIndices = [-1, -1];
  }

  async function initAudio() {
    if (!state.audioContext) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) throw new Error("当前浏览器不支持 Web Audio API");

      const context = new AudioContextClass();
      const analyser = context.createAnalyser();
      analyser.fftSize = PERFORMANCE.enabled ? 1024 : 2048;
      analyser.smoothingTimeConstant = PERFORMANCE.enabled ? 0.78 : 0.72;
      analyser.minDecibels = -86;
      analyser.maxDecibels = -10;

      const sources = [];
      const gains = [];
      els.audio.forEach((audio) => {
        const source = context.createMediaElementSource(audio);
        const gain = context.createGain();
        gain.gain.value = 0;
        source.connect(gain);
        gain.connect(analyser);
        sources.push(source);
        gains.push(gain);
      });
      analyser.connect(context.destination);

      state.audioContext = context;
      state.analyser = analyser;
      state.sources = sources;
      state.gains = gains;
      state.frequencyData = new Uint8Array(analyser.frequencyBinCount);
      state.timeData = new Uint8Array(analyser.fftSize);
    }

    if (state.audioContext.state === "suspended") {
      await state.audioContext.resume();
    }
  }

  function audioReady(audio, timeout = 1800) {
    if (audio.readyState >= 1) return Promise.resolve();
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        audio.removeEventListener("loadedmetadata", finish);
        audio.removeEventListener("canplay", finish);
        resolve();
      };
      audio.addEventListener("loadedmetadata", finish, { once: true });
      audio.addEventListener("canplay", finish, { once: true });
      setTimeout(finish, timeout);
    });
  }

  function setAudioPosition(audio, track) {
    const startAt = clamp(Number(track.startAt) || 0, 0, Number.isFinite(audio.duration) ? Math.max(0, audio.duration - 0.05) : 1e9);
    try {
      audio.currentTime = startAt;
    } catch (_) {
      // Metadata may still be loading; the loadedmetadata listener below retries.
    }
  }

  function stopStartPreview(resetSource = false) {
    clearTimeout(state.previewTimer);
    state.previewTimer = 0;
    els.previewAudio.pause();
    if (resetSource) {
      els.previewAudio.removeAttribute("src");
      els.previewAudio.load();
      delete els.previewAudio.dataset.trackIndex;
    }
    state.previewTrackIndex = -1;
    $$(".start-preview-button").forEach((button) => {
      button.classList.remove("is-playing");
      button.textContent = "试听";
    });
  }

  function pausePerformanceForEditing() {
    if (!state.playing) return;
    const audio = els.audio[state.activeDeck];
    audio.pause();
    if (state.gains.length && state.audioContext) {
      const now = state.audioContext.currentTime;
      state.gains[state.activeDeck].gain.cancelScheduledValues(now);
      state.gains[state.activeDeck].gain.setValueAtTime(0, now);
    }
    state.playing = false;
    updatePlayButton();
  }

  function ensureTrackDuration(track, trackIndex) {
    if (Number.isFinite(track.duration) && track.duration > 0) return Promise.resolve(track.duration);
    if (track.durationPromise) return track.durationPromise;

    const deck = state.deckTrackIndices.indexOf(trackIndex);
    if (deck >= 0 && Number.isFinite(els.audio[deck].duration) && els.audio[deck].duration > 0) {
      track.duration = els.audio[deck].duration;
      return Promise.resolve(track.duration);
    }

    track.durationPromise = new Promise((resolve) => {
      const probe = new Audio();
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        const duration = Number.isFinite(probe.duration) && probe.duration > 0 ? probe.duration : 0;
        if (duration) track.duration = duration;
        probe.removeAttribute("src");
        probe.load();
        track.durationPromise = null;
        resolve(duration);
      };
      probe.preload = "metadata";
      probe.addEventListener("loadedmetadata", finish, { once: true });
      probe.addEventListener("durationchange", () => {
        if (Number.isFinite(probe.duration) && probe.duration > 0) finish();
      });
      probe.addEventListener("error", finish, { once: true });
      probe.src = track.audio || "";
      probe.load();
      setTimeout(finish, 5000);
    });
    return track.durationPromise;
  }

  function applyTrackStart(trackIndex, value) {
    const track = state.tracks[trackIndex];
    if (!track) return 0;
    const maximum = Number.isFinite(track.duration) && track.duration > 0 ? Math.max(0, track.duration - 0.05) : 1e9;
    const startAt = Math.round(clamp(Number(value) || 0, 0, maximum) * 10) / 10;
    track.startAt = startAt;

    state.deckTrackIndices.forEach((deckTrackIndex, deck) => {
      if (deckTrackIndex !== trackIndex) return;
      if (deck === state.activeDeck && state.playing) return;
      setAudioPosition(els.audio[deck], track);
    });

    if (state.previewTrackIndex === trackIndex && !els.previewAudio.paused) {
      try { els.previewAudio.currentTime = startAt; } catch (_) {}
      clearTimeout(state.previewTimer);
      state.previewTimer = setTimeout(() => stopStartPreview(), 8000);
    }
    return startAt;
  }

  async function previewTrackStart(trackIndex) {
    const track = state.tracks[trackIndex];
    if (!track) return;

    if (state.previewTrackIndex === trackIndex && !els.previewAudio.paused) {
      stopStartPreview();
      return;
    }

    pausePerformanceForEditing();
    stopStartPreview();
    const duration = await ensureTrackDuration(track, trackIndex);
    const preview = els.previewAudio;
    if (preview.dataset.trackIndex !== String(trackIndex) || !preview.src) {
      preview.src = track.audio || "";
      preview.dataset.trackIndex = String(trackIndex);
      preview.load();
    }
    await audioReady(preview, 2400);
    const startAt = clamp(Number(track.startAt) || 0, 0, duration > 0 ? Math.max(0, duration - 0.05) : 1e9);
    try { preview.currentTime = startAt; } catch (_) {}
    await preview.play();
    state.previewTrackIndex = trackIndex;
    $$(".start-preview-button").forEach((button) => {
      const active = Number(button.dataset.trackIndex) === trackIndex;
      button.classList.toggle("is-playing", active);
      button.textContent = active ? "停止" : "试听";
    });
    const previewLength = duration > startAt ? Math.min(8000, Math.max(700, (duration - startAt) * 1000)) : 8000;
    state.previewTimer = setTimeout(() => stopStartPreview(), previewLength);
  }

  function setBackgroundImage(url, target = "a") {
    const el = target === "a" ? els.bgA : els.bgB;
    el.style.backgroundImage = url ? `url("${String(url).replace(/"/g, "\\\"")}")` : "none";
  }

  function preloadImage(url) {
    if (!url) return Promise.resolve(null);
    if (state.decodedImages.has(url)) return state.decodedImages.get(url);

    // Keep the decoded HTMLImageElement alive. Resolving on `load` alone can still
    // leave the first paint doing a costly decode, especially for large PNG files.
    const promise = new Promise((resolve) => {
      const image = new Image();
      image.decoding = "sync";
      image.src = url;

      const finish = () => resolve(image);
      if (typeof image.decode === "function") {
        image.decode().then(finish).catch(() => {
          if (image.complete) finish();
          else {
            image.addEventListener("load", finish, { once: true });
            image.addEventListener("error", finish, { once: true });
          }
        });
      } else {
        image.addEventListener("load", finish, { once: true });
        image.addEventListener("error", finish, { once: true });
      }
    });
    state.decodedImages.set(url, promise);
    return promise;
  }

  async function preloadImages(urls) {
    const unique = [...new Set(urls.filter(Boolean))];
    await Promise.all(unique.map(preloadImage));
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
  }

  async function renderImageVariant(bitmap, maxSide, quality) {
    const longest = Math.max(bitmap.width, bitmap.height);
    const scale = Math.min(1, maxSide / Math.max(1, longest));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: true });
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, width, height);
    return canvasToBlob(canvas, "image/webp", quality);
  }

  async function prepareImageAsset(file, index) {
    const originalUrl = URL.createObjectURL(file);
    state.objectUrls.push(originalUrl);
    const base = {
      name: file.name,
      relativePath: file.webkitRelativePath || file.name,
      url: originalUrl,
      backgroundUrl: originalUrl
    };

    // SVG remains sharp as-is; animated GIFs should not be flattened.
    const ext = extension(file.name);
    if (ext === "svg" || ext === "gif" || typeof createImageBitmap !== "function") return base;

    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      const [coverBlob, backgroundBlob] = await Promise.all([
        renderImageVariant(bitmap, 1800, 0.94),
        renderImageVariant(bitmap, 640, 0.82)
      ]);
      if (typeof bitmap.close === "function") bitmap.close();

      if (coverBlob) {
        base.url = URL.createObjectURL(coverBlob);
        state.objectUrls.push(base.url);
      }
      if (backgroundBlob) {
        base.backgroundUrl = URL.createObjectURL(backgroundBlob);
        state.objectUrls.push(base.backgroundUrl);
      } else {
        base.backgroundUrl = base.url;
      }
      return base;
    } catch (_) {
      return base;
    }
  }

  function setImageWithoutMotion(image, url, track = null, index = 0) {
    if (!image) return;
    const previousTransition = image.style.transition;
    image.style.transition = "none";
    image.src = url || "";
    applyArtVariant(image, track, index);
    // Commit the new source and crop before restoring stylesheet transitions.
    // This prevents the promoted B frame from replaying an object-position move on A.
    void image.offsetWidth;
    image.style.transition = previousTransition;
  }

  function setVinylLabel(url, track = null, index = 0) {
    setImageWithoutMotion(els.vinylLabel, url, track, index);
  }

  const ART_VARIANTS = [
    { position: "50% 50%" },
    { position: "42% 50%" },
    { position: "58% 50%" },
    { position: "50% 42%" },
    { position: "50% 58%" }
  ];

  function applyArtVariant(image, track, index) {
    const variantIndex = Number.isFinite(track?.variationIndex) ? track.variationIndex : index;
    const variant = ART_VARIANTS[variantIndex % ART_VARIANTS.length];
    image.style.objectPosition = track?.objectPosition || variant.position;
  }

  function artCaption(track) {
    if (!track) return "VINYL EDITION";
    if (track.generatedArt) return `GENERATED ART · VINYL ${pad((track.variationIndex || 0) + 1)}`;
    const artNo = pad((track.artIndex || 0) + 1);
    return `ART ${artNo} · VINYL EDITION`;
  }

  function createProceduralArt(index, title = "UNTITLED") {
    const palettes = [
      ["#161b27", "#8c5063", "#dfb77b"],
      ["#081f24", "#387b78", "#b7dfd4"],
      ["#241629", "#6f4b81", "#e7b9c9"],
      ["#1d1b15", "#8e7144", "#e4d0a6"]
    ];
    const [a, b, c] = palettes[index % palettes.length];
    const safe = String(title).replace(/[&<>"]/g, (ch) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[ch]));
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 1200"><defs><radialGradient id="g" cx="28%" cy="22%" r="90%"><stop stop-color="${c}"/><stop offset=".34" stop-color="${b}"/><stop offset="1" stop-color="${a}"/></radialGradient><filter id="n"><feTurbulence baseFrequency=".75" numOctaves="4"/><feColorMatrix values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 .14 0"/></filter></defs><rect width="1200" height="1200" fill="url(#g)"/><circle cx="260" cy="930" r="360" fill="none" stroke="${c}" stroke-opacity=".32" stroke-width="2"/><circle cx="260" cy="930" r="250" fill="none" stroke="${c}" stroke-opacity=".2" stroke-width="2"/><path d="M-80 740 Q280 520 600 730 T1280 650" fill="none" stroke="${c}" stroke-opacity=".35" stroke-width="4"/><rect width="1200" height="1200" filter="url(#n)" opacity=".55"/><text x="76" y="1010" fill="white" fill-opacity=".82" font-size="56" font-family="Arial, sans-serif" letter-spacing="6">${safe.slice(0, 24)}</text><text x="80" y="1074" fill="white" fill-opacity=".48" font-size="20" font-family="Arial, sans-serif" letter-spacing="8">PROCEDURAL LISTENING ART ${pad(index + 1, 3)}</text></svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }

  function renderTrackList() {
    if (!els.trackList) return;
    els.trackList.innerHTML = state.tracks.map((track, index) => `
      <button class="touch-track-row" type="button" role="option"
              data-track-index="${index}" aria-selected="${index === state.currentIndex}">
        <span class="number">${pad(index + 1)}</span>
        <span class="title">${String(track.title || `Track ${pad(index + 1)}`).replace(/[&<>"']/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]))}</span>
        <span class="state-mark" aria-hidden="true"></span>
      </button>`).join("");
  }

  function updateTrackListState(index) {
    if (!els.trackList) return;
    els.trackList.querySelectorAll(".touch-track-row").forEach((row, rowIndex) => {
      const active = rowIndex === index;
      row.classList.toggle("is-active", active);
      row.setAttribute("aria-selected", String(active));
    });
    const track = state.tracks[index];
    if (els.touchNowIndex) els.touchNowIndex.textContent = pad(index + 1);
    if (els.touchNowTitle) els.touchNowTitle.textContent = track?.title || "—";
  }

  async function selectTrackFromTouch(index) {
    if (!state.tracks.length || state.transitioning) return;
    const normalized = (index + state.tracks.length) % state.tracks.length;
    if (normalized === state.currentIndex) {
      if (!state.playing) await togglePlay();
      return;
    }
    const direction = state.currentIndex < 0 || normalized >= state.currentIndex ? 1 : -1;
    const wasPlaying = state.playing;
    state.playing = true;
    try {
      await loadTrack(normalized, { animate: state.currentIndex >= 0, autoplay: true, direction });
    } catch (error) {
      state.playing = wasPlaying;
      updatePlayButton();
      showToast(`切歌失败：${error.message || error}`);
    }
  }

  function updateTrackCopy(index) {
    const track = state.tracks[index];
    if (!track) return;
    const next = state.tracks[(index + 1) % state.tracks.length];
    els.trackIndex.textContent = pad(index + 1);
    els.trackTotal.textContent = `/ ${pad(state.tracks.length)}`;
    els.trackTitle.textContent = track.title || `Track ${pad(index + 1)}`;
    const subtitle = String(track.subtitle || "").trim();
    els.trackSubtitle.textContent = subtitle;
    els.trackSubtitle.hidden = !subtitle;
    els.trackKicker.textContent = track.kicker || "LISTENING FRAGMENT";
    els.nextTrackTitle.textContent = state.tracks.length > 1 ? (next?.title || `Track ${pad((index + 1) % state.tracks.length + 1)}`) : "END OF SIDE A";
    els.archiveCode.textContent = `ARCHIVE ${pad(index + 1, 3)}`;
    els.imageModeText.textContent = artCaption(track);
    els.body.style.setProperty("--track-hue", `${(index * 47 + (track.artIndex || 0) * 31) % 360}deg`);
    els.footerNote.textContent = state.playing ? "FFT LIVE · PRESS → TO CHANGE TRACK" : "SPACE TO PLAY · H TO HIDE UI";
    document.title = `${els.trackTitle.textContent} · ${els.albumTitle.textContent}`;
    updateTrackListState(index);
  }

  function updateAlbumMeta(meta = {}) {
    els.albumTitle.textContent = meta.albumTitle || meta.title || "UNNAMED ALBUM";
    els.artistName.textContent = meta.artist || "YOUR NAME";
    if (els.panelAlbumTitle) els.panelAlbumTitle.textContent = meta.albumTitle || meta.title || "UNNAMED ALBUM";
  }

  function setImageImmediately(url, track = null, index = 0) {
    setImageWithoutMotion(els.coverA, url, track, index);
    els.coverB.removeAttribute("src");
    setVinylLabel(url, track, index);
    setBackgroundImage(track?.backgroundImage || url, "a");
    els.bgA.classList.add("is-active");
    els.bgB.classList.remove("is-active");
    setBackgroundImage("", "b");
  }

  async function prepareAudioDeck(deck, trackIndex) {
    const normalized = (trackIndex + state.tracks.length) % state.tracks.length;
    const track = state.tracks[normalized];
    const audio = els.audio[deck];

    if (state.deckTrackIndices[deck] !== normalized || !audio.src) {
      audio.pause();
      audio.src = track.audio || "";
      state.deckTrackIndices[deck] = normalized;
      audio.load();
      audio.addEventListener("loadedmetadata", () => setAudioPosition(audio, track), { once: true });
    }

    await audioReady(audio, 1200);
    setAudioPosition(audio, track);
  }

  function primeAdjacentAudio(fromIndex, direction = 1) {
    if (state.tracks.length < 2) return;
    const inactiveDeck = 1 - state.activeDeck;
    const target = (fromIndex + direction + state.tracks.length) % state.tracks.length;
    // Wait until the outgoing deck has been released after the crossfade.
    setTimeout(() => prepareAudioDeck(inactiveDeck, target).catch(() => {}), 0);
  }

  async function loadTrack(index, options = {}) {
    const { animate = true, autoplay = state.playing, direction = 1 } = options;
    stopStartPreview();
    if (!state.tracks.length) return;
    if (state.transitioning && animate) return;

    const normalized = (index + state.tracks.length) % state.tracks.length;
    const track = state.tracks[normalized];
    const token = ++state.transitionToken;
    const firstLoad = state.currentIndex < 0;
    const newDeck = firstLoad ? state.activeDeck : 1 - state.activeDeck;
    const oldDeck = state.activeDeck;
    const newAudio = els.audio[newDeck];
    const oldAudio = els.audio[oldDeck];

    state.transitioning = animate && !firstLoad;
    requestVisualFrame(true);
    els.body.dataset.direction = direction >= 0 ? "next" : "prev";

    // Both resources are ready before the visible switch. The next audio deck is normally
    // already primed while the current song is playing, so this resolves immediately.
    await Promise.all([
      prepareAudioDeck(newDeck, normalized),
      preloadImage(track.image),
      preloadImage(track.backgroundImage || track.image)
    ]);
    if (token !== state.transitionToken) return;

    if (firstLoad || !animate) {
      state.currentIndex = normalized;
      state.activeDeck = newDeck;
      setImageImmediately(track.image, track, normalized);
      updateTrackCopy(normalized);
      if (autoplay) await startDeck(newDeck, oldDeck, true);
      updatePlayButton();
      primeAdjacentAudio(normalized, 1);
      return;
    }

    const previousTrack = state.tracks[state.currentIndex];
    const sharedArt = Boolean(previousTrack && previousTrack.image === track.image);
    setImageWithoutMotion(els.coverB, track.image, track, normalized);
    setVinylLabel(track.image, track, normalized);
    setBackgroundImage(track.backgroundImage || track.image, "b");
    els.bgB.classList.add("is-active");
    els.body.classList.toggle("is-shared-art-transition", sharedArt);

    // Force one frame with the incoming image already decoded before starting animation.
    void els.coverB.offsetWidth;
    els.body.classList.add("is-transitioning");
    state.currentIndex = normalized;
    updateTrackCopy(normalized);

    const incomingFrame = els.coverB.closest(".art-frame-b");
    let visualFinished = false;
    let visualFallback = 0;

    const finishVisualTransition = () => {
      if (visualFinished || token !== state.transitionToken) return;
      visualFinished = true;
      clearTimeout(visualFallback);
      incomingFrame?.removeEventListener("animationend", onIncomingAnimationEnd);

      // Promote the already-visible B artwork to A without replaying image-level motion.
      setImageWithoutMotion(els.coverA, track.image, track, normalized);
      els.coverB.removeAttribute("src");
      setBackgroundImage(track.backgroundImage || track.image, "a");
      els.bgA.classList.add("is-active");
      els.bgB.classList.remove("is-active");
      setBackgroundImage("", "b");
      els.body.classList.remove("is-transitioning", "is-shared-art-transition");
      state.activeDeck = newDeck;
      state.transitioning = false;
      if (autoplay) {
        oldAudio.pause();
        try { oldAudio.currentTime = 0; } catch (_) {}
      }
      updatePlayButton();
      primeAdjacentAudio(normalized, direction >= 0 ? 1 : -1);
    };

    function onIncomingAnimationEnd(event) {
      if (event.target === incomingFrame) finishVisualTransition();
    }

    incomingFrame?.addEventListener("animationend", onIncomingAnimationEnd);
    visualFallback = window.setTimeout(finishVisualTransition, 520);

    if (autoplay) {
      try {
        await initAudio();
        const now = state.audioContext.currentTime;
        state.gains[newDeck].gain.cancelScheduledValues(now);
        state.gains[oldDeck].gain.cancelScheduledValues(now);
        state.gains[newDeck].gain.setValueAtTime(0, now);
        state.gains[oldDeck].gain.setValueAtTime(state.gains[oldDeck].gain.value, now);
        await newAudio.play();
        state.gains[newDeck].gain.linearRampToValueAtTime(1, now + 0.24);
        state.gains[oldDeck].gain.linearRampToValueAtTime(0, now + 0.22);
      } catch (error) {
        state.playing = false;
        showToast(`无法播放：${error.message || error}`);
      }
    }

  }

  async function startDeck(deck, oldDeck = 1 - deck, immediate = false) {
    await initAudio();
    const audio = els.audio[deck];
    const now = state.audioContext.currentTime;
    state.gains[deck].gain.cancelScheduledValues(now);
    state.gains[oldDeck].gain.cancelScheduledValues(now);
    state.gains[deck].gain.setValueAtTime(immediate ? 1 : 0, now);
    if (oldDeck !== deck) state.gains[oldDeck].gain.setValueAtTime(0, now);
    await audio.play();
    if (!immediate) state.gains[deck].gain.linearRampToValueAtTime(1, now + 0.35);
    state.playing = true;
    updatePlayButton();
  }

  async function togglePlay() {
    stopStartPreview();
    if (!state.tracks.length) {
      showToast("请先选择素材文件夹或导入专辑");
      return;
    }
    try {
      await initAudio();
      const audio = els.audio[state.activeDeck];
      const gain = state.gains[state.activeDeck];
      const now = state.audioContext.currentTime;
      if (state.playing && !audio.paused) {
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(gain.gain.value, now);
        gain.gain.linearRampToValueAtTime(0, now + 0.18);
        setTimeout(() => audio.pause(), 190);
        state.playing = false;
      } else {
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(0, now);
        await audio.play();
        gain.gain.linearRampToValueAtTime(1, now + 0.25);
        state.playing = true;
      }
      updatePlayButton();
    } catch (error) {
      showToast(`播放失败：${error.message || error}`);
    }
  }

  function updatePlayButton() {
    els.playBtn.textContent = state.playing ? "PAUSE" : "PLAY";
    els.body.classList.toggle("is-playing", state.playing);
    els.footerNote.textContent = state.playing ? "VINYL SPINNING · PRESS → TO CHANGE TRACK" : "SPACE TO PLAY · H TO HIDE UI";
    requestVisualFrame(true);
  }

  function nextTrack(direction = 1) {
    if (!state.tracks.length) return;
    loadTrack(state.currentIndex + direction, { animate: true, autoplay: state.playing, direction });
  }

  function replayTrack() {
    if (state.currentIndex < 0) return;
    const track = state.tracks[state.currentIndex];
    const audio = els.audio[state.activeDeck];
    setAudioPosition(audio, track);
    showToast("已回到当前试听起点");
  }

  function setSkin(id, announce = true) {
    const index = SKINS.findIndex((skin) => skin.id === id);
    if (index < 0) return;
    state.skinIndex = index;
    els.body.dataset.skin = id;
    els.skinName.textContent = SKINS[index].name;
    $$('[data-set-skin]').forEach((button) => button.classList.toggle("active", button.dataset.setSkin === id));
    requestVisualFrame(true);
    if (announce) showToast(`视觉皮肤：${SKINS[index].name}`);
  }

  function cycleSkin(direction) {
    const index = (state.skinIndex + direction + SKINS.length) % SKINS.length;
    setSkin(SKINS[index].id);
  }

  function cycleMotionMode() {
    const names = ["柔和", "丰富", "强烈"];
    state.motionMode = (state.motionMode + 1) % names.length;
    document.documentElement.style.setProperty("--motion", [0.62, 1, 1.38][state.motionMode]);
    els.motionBtn.textContent = `动效：${names[state.motionMode]} M`;
    requestVisualFrame(true);
    showToast(`音频响应动效：${names[state.motionMode]}`);
  }

  function toggleClean() {
    state.clean = !state.clean;
    els.body.dataset.clean = String(state.clean);
    showToast(state.clean ? "已进入干净录制模式 · 按 H 恢复控制" : "已显示控制面板");
  }

  function recomputeArtGroups() {
    const groups = new Map();
    for (const track of state.tracks) {
      const key = track.image || `generated:${track.artIndex || 0}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(track);
    }
    [...groups.values()].forEach((group, groupIndex) => {
      group.forEach((track, index) => {
        const assetIndex = state.availableImages.findIndex((asset) => asset.url === track.image);
        track.artIndex = assetIndex >= 0 ? assetIndex : (Number.isFinite(track.artIndex) ? track.artIndex : groupIndex);
        track.variationIndex = index;
        track.variationTotal = group.length;
      });
    });
    state.imageCount = new Set(state.tracks.map((track) => track.image)).size;
  }

  function setMappingOpen(open) {
    if (open && !state.tracks.length) {
      showToast("请先载入歌曲和图片");
      return;
    }
    state.mappingOpen = Boolean(open);
    els.mappingPanel.classList.toggle("is-open", state.mappingOpen);
    els.mappingPanel.setAttribute("aria-hidden", String(!state.mappingOpen));
    if (state.mappingOpen) {
      pausePerformanceForEditing();
      renderMapping();
    } else {
      stopStartPreview();
    }
  }

  function renderMapping() {
    els.autoMapBtn.disabled = !state.availableImages.length;
    els.mappingList.replaceChildren();
    state.tracks.forEach((track, trackIndex) => {
      const row = document.createElement("div");
      row.className = "mapping-row";

      const number = document.createElement("span");
      number.className = "mapping-number";
      number.textContent = pad(trackIndex + 1);

      const thumb = document.createElement("img");
      thumb.className = "mapping-thumb";
      thumb.src = track.image || "";
      thumb.alt = "";

      const copy = document.createElement("div");
      copy.className = "mapping-copy";
      const title = document.createElement("strong");
      title.textContent = track.title;
      const filename = document.createElement("span");
      filename.textContent = track.sourceName || `Track ${pad(trackIndex + 1)}`;
      copy.append(title, filename);

      const select = document.createElement("select");
      select.setAttribute("aria-label", `${track.title} 使用的图片`);
      if (state.availableImages.length) {
        state.availableImages.forEach((asset, assetIndex) => {
          const option = document.createElement("option");
          option.value = String(assetIndex);
          option.textContent = `${pad(assetIndex + 1)} · ${asset.name}`;
          if (asset.url === track.image) option.selected = true;
          select.append(option);
        });
      } else {
        const option = document.createElement("option");
        option.textContent = "程序化视觉（当前没有图片素材）";
        select.append(option);
        select.disabled = true;
      }
      select.addEventListener("change", async () => {
        const asset = state.availableImages[Number(select.value)];
        if (!asset) return;
        await preloadImage(asset.url);
        track.image = asset.url;
        track.backgroundImage = asset.backgroundUrl || asset.url;
        track.imageName = asset.name;
        track.generatedArt = false;
        recomputeArtGroups();
        thumb.src = asset.url;
        if (trackIndex === state.currentIndex) {
          setImageImmediately(track.image, track, trackIndex);
          updateTrackCopy(trackIndex);
        }
        showToast(`${track.title} → ${asset.name}`);
      });

      const startEditor = document.createElement("div");
      startEditor.className = "start-editor";

      const startLabel = document.createElement("span");
      startLabel.className = "start-label";
      startLabel.textContent = "试听起点";

      const previewButton = document.createElement("button");
      previewButton.type = "button";
      previewButton.className = "start-preview-button";
      previewButton.dataset.trackIndex = String(trackIndex);
      previewButton.textContent = state.previewTrackIndex === trackIndex && !els.previewAudio.paused ? "停止" : "试听";
      previewButton.classList.toggle("is-playing", state.previewTrackIndex === trackIndex && !els.previewAudio.paused);
      previewButton.addEventListener("click", () => previewTrackStart(trackIndex).catch((error) => showToast(`试听失败：${error.message || error}`)));

      const timeline = document.createElement("div");
      timeline.className = "start-timeline";
      const range = document.createElement("input");
      range.className = "start-range";
      range.type = "range";
      range.min = "0";
      range.max = "1";
      range.step = "0.1";
      range.value = String(Number(track.startAt) || 0);
      range.disabled = true;
      range.setAttribute("aria-label", `${track.title} 的试听起点`);
      const scale = document.createElement("div");
      scale.className = "start-scale";
      const zero = document.createElement("span");
      zero.textContent = "00:00";
      const durationText = document.createElement("span");
      durationText.textContent = "读取时长…";
      scale.append(zero, durationText);
      timeline.append(range, scale);

      const timeInput = document.createElement("input");
      timeInput.className = "start-time-input";
      timeInput.type = "text";
      timeInput.inputMode = "decimal";
      timeInput.value = formatTimePrecise(Number(track.startAt) || 0);
      timeInput.setAttribute("aria-label", `${track.title} 的试听起点时间`);
      timeInput.title = "可输入 01:23.5 或直接输入秒数";

      const nudge = document.createElement("div");
      nudge.className = "start-nudge";
      const minus = document.createElement("button");
      minus.type = "button";
      minus.textContent = "−5s";
      const plus = document.createElement("button");
      plus.type = "button";
      plus.textContent = "+5s";
      nudge.append(minus, plus);

      const updateStartUI = (value) => {
        const applied = applyTrackStart(trackIndex, value);
        range.value = String(applied);
        timeInput.value = formatTimePrecise(applied);
        const max = Number(range.max) || 0;
        range.style.setProperty("--start-pct", `${max > 0 ? clamp(applied / max * 100, 0, 100) : 0}%`);
      };

      range.addEventListener("input", () => updateStartUI(Number(range.value)));
      timeInput.addEventListener("change", () => updateStartUI(parseTimeCode(timeInput.value)));
      timeInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          updateStartUI(parseTimeCode(timeInput.value));
          timeInput.blur();
        }
      });
      minus.addEventListener("click", () => updateStartUI((Number(track.startAt) || 0) - 5));
      plus.addEventListener("click", () => updateStartUI((Number(track.startAt) || 0) + 5));

      startEditor.append(startLabel, previewButton, timeline, timeInput, nudge);
      row.append(number, thumb, copy, select, startEditor);
      els.mappingList.append(row);

      ensureTrackDuration(track, trackIndex).then((duration) => {
        if (!row.isConnected) return;
        const maximum = duration > 0 ? Math.max(0, duration - 0.05) : 0;
        range.max = String(maximum || 1);
        range.disabled = !(duration > 0);
        durationText.textContent = duration > 0 ? formatTime(duration) : "时长不可用";
        updateStartUI(Number(track.startAt) || 0);
      });
    });
  }

  function resetAllStartPoints() {
    state.tracks.forEach((track, index) => applyTrackStart(index, 0));
    renderMapping();
    showToast("所有歌曲的试听起点已回到 00:00");
  }

  async function autoMapImages() {
    if (!state.availableImages.length || !state.tracks.length) return;
    state.tracks.forEach((track, index) => {
      const assetIndex = Math.min(
        state.availableImages.length - 1,
        Math.floor(index * state.availableImages.length / state.tracks.length)
      );
      const asset = state.availableImages[assetIndex];
      track.image = asset.url;
      track.backgroundImage = asset.backgroundUrl || asset.url;
      track.imageName = asset.name;
      track.generatedArt = false;
    });
    recomputeArtGroups();
    await preloadImages(state.tracks.map((track) => track.image));
    if (state.currentIndex >= 0) {
      const track = state.tracks[state.currentIndex];
      setImageImmediately(track.image, track, state.currentIndex);
      updateTrackCopy(state.currentIndex);
    }
    renderMapping();
    showToast("已按连续章节重新分配图片");
  }

  function exportMapping() {
    if (!state.tracks.length) return;
    const data = {
      albumTitle: state.albumMeta.albumTitle || state.albumMeta.title || els.albumTitle.textContent,
      artist: state.albumMeta.artist || els.artistName.textContent,
      imagePolicy: "manual",
      tracks: state.tracks.map((track) => ({
        audio: track.sourceName || "",
        image: track.imageName || "",
        startAt: Number(track.startAt) || 0,
        objectPosition: track.objectPosition || undefined
      }))
    };
    const clean = JSON.stringify(data, (key, value) => value === undefined ? undefined : value, 2);
    const url = URL.createObjectURL(new Blob([clean], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "album.json";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast("已导出 album.json，放回素材文件夹即可保留图片映射与试听起点");
  }

  async function setTracks(tracks, meta = {}) {
    if (!tracks.length) throw new Error("没有找到可播放的歌曲文件");

    stopStartPreview(true);
    for (const audio of els.audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    if (state.gains.length) {
      const now = state.audioContext.currentTime;
      state.gains.forEach((gain) => gain.gain.setValueAtTime(0, now));
    }

    tracks.forEach((track) => {
      if (!track.backgroundImage) track.backgroundImage = track.image;
    });
    state.tracks = tracks;
    renderTrackList();
    state.albumMeta = { ...meta };
    state.availableImages = Array.isArray(meta.images) && meta.images.length
      ? meta.images
      : [...new Map(tracks.filter((track) => track.image).map((track, index) => [track.image, {
          name: track.imageName || `Artwork ${pad(index + 1)}`,
          url: track.image,
          backgroundUrl: track.backgroundImage || track.image
        }])).values()];

    recomputeArtGroups();
    state.currentIndex = -1;
    state.activeDeck = 0;
    state.deckTrackIndices = [-1, -1];
    state.playing = false;
    state.transitioning = false;
    setMappingOpen(false);
    updateAlbumMeta(meta);
    updatePlayButton();
    setWelcomeVisible(false);

    showToast(`正在预解码 ${state.availableImages.length || state.imageCount} 张图片…`, 1800);
    await preloadImages([
      ...state.availableImages.flatMap((asset) => [asset.url, asset.backgroundUrl]),
      ...tracks.flatMap((track) => [track.image, track.backgroundImage])
    ]);
    await loadTrack(0, { animate: false, autoplay: true });
    showToast(`已载入 ${tracks.length} 首歌曲 · ${state.imageCount} 张视觉素材 · 图片与下一首音频已预热`, 3600);
  }

  async function parseFolderFiles(fileList) {
    const files = [...fileList];
    const audioFiles = files.filter((file) => AUDIO_EXT.has(extension(file.name))).sort((a, b) => naturalCompare(a.name, b.name));
    const imageFiles = files.filter((file) => IMAGE_EXT.has(extension(file.name))).sort((a, b) => naturalCompare(a.name, b.name));
    if (!audioFiles.length) throw new Error("文件夹中没有识别到 MP3、WAV、M4A、OGG 等音频文件");

    let manifest = null;
    const manifestFile = files.find((file) => file.name.toLowerCase() === "album.json");
    if (manifestFile) {
      try { manifest = JSON.parse(await manifestFile.text()); }
      catch (_) { showToast("album.json 解析失败，已改用自动分配"); }
    }

    revokeObjectUrls();
    const manifestTracks = Array.isArray(manifest?.tracks) ? manifest.tracks : [];
    const audioUrlCache = new Map();
    const imageByName = new Map();
    for (const image of imageFiles) {
      imageByName.set(image.name.toLowerCase(), image);
      imageByName.set((image.webkitRelativePath || image.name).toLowerCase(), image);
    }

    const urlFor = (file, cache) => {
      if (!file) return null;
      if (!cache.has(file)) {
        const url = URL.createObjectURL(file);
        cache.set(file, url);
        state.objectUrls.push(url);
      }
      return cache.get(file);
    };

    if (imageFiles.length) showToast(`正在为录屏优化 ${imageFiles.length} 张图片…`, 2400);
    const imageAssets = await Promise.all(imageFiles.map((file, index) => prepareImageAsset(file, index)));
    const imageAssetByFile = new Map(imageFiles.map((file, index) => [file, imageAssets[index]]));

    const imagePolicy = manifest?.imagePolicy || (imageFiles.length < audioFiles.length ? "chapters" : "match");
    const findManifestDetails = (audioFile, index) => {
      const key = pairingKey(audioFile.name);
      const byName = manifestTracks.find((item) => {
        const candidate = item.audio || item.file || item.filename || "";
        return candidate && (candidate === audioFile.name || pairingKey(candidate) === key);
      });
      return byName || manifestTracks[index] || {};
    };

    const resolveExplicitImage = (details) => {
      const candidate = String(details.image || details.art || details.cover || "").toLowerCase();
      if (!candidate) return null;
      if (imageByName.has(candidate)) return imageByName.get(candidate);
      return imageFiles.find((file) => (file.webkitRelativePath || file.name).toLowerCase().endsWith(candidate)) || null;
    };

    const tracks = audioFiles.map((audioFile, index) => {
      const details = findManifestDetails(audioFile, index);
      const explicitImage = resolveExplicitImage(details);
      let imageFile = explicitImage;
      let artIndex = 0;

      if (!imageFile && imageFiles.length) {
        if (imagePolicy === "cycle") {
          artIndex = index % imageFiles.length;
        } else if (imagePolicy === "chapters" || imageFiles.length < audioFiles.length) {
          artIndex = Math.min(imageFiles.length - 1, Math.floor(index * imageFiles.length / audioFiles.length));
        } else {
          const key = pairingKey(audioFile.name);
          const exact = imageFiles.find((image) => pairingKey(image.name) === key);
          artIndex = exact ? imageFiles.indexOf(exact) : Math.min(index, imageFiles.length - 1);
        }
        imageFile = imageFiles[artIndex];
      } else if (imageFile) {
        artIndex = imageFiles.indexOf(imageFile);
      }

      const title = titleFromFilename(audioFile.name) || details.title || stem(audioFile.name);
      const generatedArt = !imageFile;
      const imageAsset = imageFile ? imageAssetByFile.get(imageFile) : null;
      const image = imageAsset ? imageAsset.url : createProceduralArt(index, title);
      return {
        title,
        subtitle: details.subtitle || details.lyric || "",
        kicker: details.kicker || "LOCAL PERFORMANCE FILE",
        audio: urlFor(audioFile, audioUrlCache),
        image,
        backgroundImage: imageAsset?.backgroundUrl || image,
        imageName: imageFile?.name || "",
        startAt: Number(details.startAt) || 0,
        objectPosition: details.objectPosition || "",
        variationIndex: Number.isFinite(Number(details.variation)) ? Number(details.variation) : undefined,
        artIndex: generatedArt ? index : Math.max(0, artIndex),
        generatedArt,
        sourceName: audioFile.name
      };
    });

    const firstPath = audioFiles[0].webkitRelativePath || "";
    const rootName = firstPath.split("/")[0] || "UNNAMED ALBUM";
    await setTracks(tracks, {
      albumTitle: manifest?.albumTitle || manifest?.title || rootName,
      artist: manifest?.artist || "LOCAL SESSION",
      images: imageAssets
    });

    if (imageFiles.length && imageFiles.length < audioFiles.length) {
      showToast(`${audioFiles.length} 首歌 / ${imageFiles.length} 张图：已按连续章节分配，可按 G 逐首调整`, 4600);
    } else if (!imageFiles.length) {
      showToast("未找到图片：已为每首歌生成程序化视觉底图", 4200);
    }
  }

  function loadStaticConfig(config) {
    config = config || window.ALBUM_CONFIG || {};
    if (!Array.isArray(config.tracks) || !config.tracks.length) return;
    const tracks = config.tracks.map((item, index) => ({
      title: item.audio ? titleFromFilename(item.audio.split("/").pop()) : (item.title || `Track ${pad(index + 1)}`),
      subtitle: item.subtitle || item.lyric || "",
      kicker: item.kicker || "CONFIGURED PERFORMANCE",
      audio: item.audio,
      image: item.image || createProceduralArt(index, item.title || `Track ${pad(index + 1)}`),
      backgroundImage: item.backgroundImage || item.image || "",
      imageName: item.image ? item.image.split("/").pop() : "",
      sourceName: item.audio ? item.audio.split("/").pop() : `Track ${pad(index + 1)}`,
      artIndex: Number.isFinite(Number(item.artIndex)) ? Number(item.artIndex) : undefined,
      generatedArt: !item.image,
      objectPosition: item.objectPosition || "",
      variationIndex: Number.isFinite(Number(item.variation)) ? Number(item.variation) : undefined,
      startAt: Number(item.startAt) || 0
    }));
    setTracks(tracks, config).catch((error) => showToast(error.message));
  }

  /** 当前在专辑弹窗中选中的卡片：{kind: 'builtin'|'imported', el, title} */
  let selectedAlbum = null;

  function showAlbumPicker(albums) {
    const picker = els.albumPicker;
    if (!picker || !Array.isArray(albums) || albums.length < 2) return;
    picker.innerHTML = albums.map((album, index) => {
      const title = album.albumTitle || album.title || `Album ${index + 1}`;
      const artist = album.artist || "";
      const count = Array.isArray(album.tracks) ? album.tracks.length : 0;
      return `<button type="button" class="album-option" data-album-index="${index}">
        <span class="album-option-title">${title}</span>
        <span class="album-option-meta">${artist} · ${count} 首</span>
      </button>`;
    }).join("");
    picker.querySelectorAll(".album-option").forEach((btn) => {
      btn.addEventListener("click", () => {
        const album = albums[Number(btn.dataset.albumIndex)];
        if (!album) return;
        const wasSelected = btn.classList.contains("is-selected");
        selectAlbumCard(btn, "builtin", album.albumTitle || album.title || "");
        // 再次点击已选中的卡片 → 载入该专辑
        if (wasSelected) loadStaticConfig(album);
      });
    });
  }

  /** 单选:清掉其它卡片选中态,记录当前选中 */
  function selectAlbumCard(el, kind, title) {
    const picker = els.albumPicker;
    if (picker) {
      picker.querySelectorAll(".album-option.is-selected").forEach((c) => c.classList.remove("is-selected"));
    }
    el.classList.add("is-selected");
    selectedAlbum = { kind, el, title };
  }

  function getAlbumLibrary() {
    return (Array.isArray(window.MELODIO_ALBUMS) && window.MELODIO_ALBUMS.length)
      ? window.MELODIO_ALBUMS
      : (Array.isArray(window.ALBUM_CONFIG?.tracks) && window.ALBUM_CONFIG.tracks.length ? [window.ALBUM_CONFIG] : []);
  }

  function openAlbumOverview() {
    selectedAlbum = null;
    showAlbumPicker(getAlbumLibrary());
    // 若有已导入的专辑，追加一张“导入专辑”卡片
    const picker = els.albumPicker;
    if (picker && !picker.querySelector(".album-option.is-imported")) {
      fetch("/import/album.json")
        .then((resp) => (resp.ok ? resp.json() : null))
        .then((manifest) => {
          if (!manifest) return;
          const title = manifest.albumTitle || manifest.title || "导入的专辑";
          const count = Array.isArray(manifest.tracks) ? manifest.tracks.length : 0;
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "album-option is-imported";
          btn.innerHTML = `<span class="album-option-title">${title}</span><span class="album-option-meta">导入专辑 · ${count} 首 · 再次点击载入</span>`;
          btn.addEventListener("click", () => {
            const wasSelected = btn.classList.contains("is-selected");
            selectAlbumCard(btn, "imported", title);
            // 再次点击已选中的卡片 → 载入该导入专辑
            if (wasSelected) loadImportedAlbum();
          });
          picker.appendChild(btn);
        })
        .catch(() => {});
    }
    setWelcomeVisible(true);
  }

  /** 删除所选专辑：未选/内置/导入三种情况分别处理，导入需二次点击确认 */
  function handleDeleteSelected() {
    const sel = selectedAlbum;
    if (!sel) {
      showToast("请先选择要删除的专辑", 2600);
      return;
    }
    if (sel.kind === "builtin") {
      showToast(`「${sel.title}」是内置专辑，无法删除`, 3200);
      return;
    }
    const btn = els.welcomeDeleteBtn;
    if (!btn.dataset.confirming) {
      btn.dataset.confirming = "1";
      btn.textContent = "确认删除?";
      setTimeout(() => {
        if (btn.dataset.confirming) {
          btn.dataset.confirming = "";
          btn.textContent = "删除所选专辑";
        }
      }, 5000);
      return;
    }
    btn.dataset.confirming = "";
    btn.disabled = true;
    fetch("/import/__delete__", { method: "POST" })
      .then((resp) => {
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        showToast("已删除导入专辑");
        setTimeout(() => {
          location.href = "https://appassets.androidplatform.net/assets/www/index.html";
        }, 700);
      })
      .catch((error) => {
        showToast(`删除失败：${error.message}`, 4200);
        btn.disabled = false;
        btn.textContent = "删除所选专辑";
      });
  }

  function toggleDock(force) {
    state.dockVisible = (typeof force === "boolean") ? force : !state.dockVisible;
    els.controlDock.classList.toggle("is-visible", state.dockVisible);
  }

  async function loadImportedAlbum() {
    try {
      const resp = await fetch("/import/album.json");
      if (!resp.ok) throw new Error("找不到 album.json");
      const manifest = await resp.json();
      const manifestTracks = Array.isArray(manifest.tracks) ? manifest.tracks : [];
      if (!manifestTracks.length) throw new Error("album.json 中没有曲目信息");

      const tracks = manifestTracks.map((item, index) => {
        const audioPath = String(item.audio || item.file || item.filename || "");
        const imagePath = String(item.image || item.art || item.cover || "");
        const title = item.title || (audioPath ? titleFromFilename(audioPath.split("/").pop()) : `Track ${pad(index + 1)}`);
        return {
          title,
          subtitle: item.subtitle || item.lyric || "",
          kicker: item.kicker || "IMPORTED ALBUM",
          audio: audioPath ? "/import/" + audioPath.replace(/^\//, "") : "",
          image: imagePath ? "/import/" + imagePath.replace(/^\//, "") : createProceduralArt(index, title),
          backgroundImage: imagePath ? "/import/" + imagePath.replace(/^\//, "") : "",
          imageName: imagePath ? imagePath.split("/").pop() : "",
          sourceName: audioPath ? audioPath.split("/").pop() : `Track ${pad(index + 1)}`,
          artIndex: Number.isFinite(Number(item.artIndex)) ? Number(item.artIndex) : undefined,
          generatedArt: !imagePath,
          objectPosition: item.objectPosition || "",
          variationIndex: Number.isFinite(Number(item.variation)) ? Number(item.variation) : undefined,
          startAt: Number(item.startAt) || 0
        };
      });

      await setTracks(tracks, {
        albumTitle: manifest.albumTitle || manifest.title || "IMPORTED ALBUM",
        artist: manifest.artist || "IMPORTED"
      });
    } catch (error) {
      showToast(`导入专辑加载失败：${error.message}`, 4200);
    }
  }

  function updateProgress() {
    if (state.currentIndex < 0) return;
    const audio = els.audio[state.activeDeck];
    const track = state.tracks[state.currentIndex];
    const current = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
    const startAt = clamp(Number(track?.startAt) || 0, 0, duration || 1e9);
    const elapsed = Math.max(0, current - startAt);
    const fragmentDuration = Math.max(0, duration - startAt);
    els.currentTime.textContent = formatTime(elapsed);
    els.durationTime.textContent = formatTime(fragmentDuration);
    els.progressFill.style.width = fragmentDuration > 0 ? `${clamp(elapsed / fragmentDuration * 100, 0, 100)}%` : "0%";

    // 拖动进度条期间不触发自动切歌
    if (!seekActive && duration > 0 && current >= duration - 0.08 && state.playing && !state.transitioning) {
      nextTrack(1);
    }
  }

  // —— 进度条:点击跳转 / 按住拖动 ——
  let seekActive = false;
  let seekResumePlayback = false;
  let lastSeekAt = 0;

  /** 把事件位置换算为音频时间并跳转(考虑试听起点 startAt 偏移) */
  function seekFromEvent(event) {
    const rect = els.progressTrack.getBoundingClientRect();
    const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const audio = els.audio[state.activeDeck];
    const track = state.tracks[state.currentIndex];
    const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
    const startAt = clamp(Number(track?.startAt) || 0, 0, duration || 1e9);
    const fragmentDuration = Math.max(0, duration - startAt);
    const target = startAt + ratio * fragmentDuration;
    audio.currentTime = target;
    els.currentTime.textContent = formatTime(Math.max(0, target - startAt));
    els.progressFill.style.width = `${ratio * 100}%`;
  }

  function bindProgressSeek() {
    const trackEl = els.progressTrack;
    if (!trackEl) return;
    trackEl.addEventListener("pointerdown", (event) => {
      if (state.currentIndex < 0) return;
      seekActive = true;
      seekResumePlayback = state.playing;
      // 拖动时先暂停,松手后从目标位置恢复,手感更稳
      if (seekResumePlayback) els.audio[state.activeDeck].pause();
      trackEl.setPointerCapture?.(event.pointerId);
      seekFromEvent(event);
    });
    trackEl.addEventListener("pointermove", (event) => {
      if (!seekActive) return;
      const now = performance.now();
      if (now - lastSeekAt < 100) return; // 拖动中节流,避免过度 seek
      lastSeekAt = now;
      seekFromEvent(event);
    });
    const finishSeek = (event) => {
      if (!seekActive) return;
      seekActive = false;
      if (event) seekFromEvent(event);
      if (seekResumePlayback) els.audio[state.activeDeck].play().catch(() => {});
    };
    trackEl.addEventListener("pointerup", (event) => finishSeek(event));
    trackEl.addEventListener("pointercancel", () => finishSeek(null));
  }

  function bandEnergy(data, start, end) {
    const safeStart = clamp(Math.floor(start), 0, data.length - 1);
    const safeEnd = clamp(Math.ceil(end), safeStart + 1, data.length);
    let sumSq = 0;
    let peak = 0;
    for (let i = safeStart; i < safeEnd; i++) {
      const value = data[i] / 255;
      sumSq += value * value;
      peak = Math.max(peak, value);
    }
    const rms = Math.sqrt(sumSq / (safeEnd - safeStart));
    return clamp(rms * .72 + peak * .28, 0, 1);
  }

  function rebuildLogSpectrum() {
    if (!state.frequencyData || !state.audioContext) return;
    const minHz = 42;
    const maxHz = Math.min(16500, state.audioContext.sampleRate / 2);
    const nyquist = state.audioContext.sampleRate / 2;
    let flux = 0;
    for (let i = 0; i < state.spectrum.length; i++) {
      const t0 = i / state.spectrum.length;
      const t1 = (i + 1) / state.spectrum.length;
      const f0 = minHz * Math.pow(maxHz / minHz, t0);
      const f1 = minHz * Math.pow(maxHz / minHz, t1);
      const b0 = f0 / nyquist * state.frequencyData.length;
      const b1 = f1 / nyquist * state.frequencyData.length;
      const raw = bandEnergy(state.frequencyData, b0, b1);
      const shaped = Math.pow(clamp((raw - .025) * 1.38, 0, 1), .72);
      const previous = state.spectrum[i];
      const next = previous + (shaped - previous) * (shaped > previous ? .42 : .16);
      flux += Math.max(0, next - state.previousSpectrum[i]);
      state.previousSpectrum[i] = next;
      state.spectrum[i] = next;
    }
    state.levels.flux += (clamp(flux / state.spectrum.length * 5.4, 0, 1) - state.levels.flux) * .34;
  }

  function setVisualVariable(name, value, force = false) {
    const step = PERFORMANCE.enabled ? .02 : .005;
    const quantized = Math.round(value / step) * step;
    const text = quantized.toFixed(PERFORMANCE.enabled ? 2 : 3);
    if (!force && PERFORMANCE.cssCache.get(name) === text) return;
    PERFORMANCE.cssCache.set(name, text);
    document.documentElement.style.setProperty(name, text);
  }

  function updateSpectrumBars(force = false) {
    if (!state.spectrumBars.length) return;
    const motion = [0.62, 1, 1.38][state.motionMode];
    state.spectrumBars.forEach((bar, index) => {
      const value = state.spectrum[index] || 0;
      const emphasized = clamp((.08 + value * 1.12 + state.levels.impact * .18) * motion, .035, 1.5);
      const opacity = clamp(.16 + value * .74 + state.levels.flux * .18, .12, .96);
      const scaleText = emphasized.toFixed(PERFORMANCE.enabled ? 2 : 3);
      const opacityText = opacity.toFixed(PERFORMANCE.enabled ? 2 : 3);
      const cached = PERFORMANCE.barCache[index];
      if (!force && cached?.scale === scaleText && cached?.opacity === opacityText) return;
      PERFORMANCE.barCache[index] = { scale: scaleText, opacity: opacityText };
      bar.style.transform = `scaleY(${scaleText})`;
      bar.style.opacity = opacityText;
    });
  }

  function writeVisualLevels(force = false) {
    const levels = state.levels;
    const motion = [0.62, 1, 1.38][state.motionMode];
    setVisualVariable("--energy", clamp(levels.energy * motion, 0, 1.4), force);
    setVisualVariable("--low", clamp(levels.low * motion, 0, 1.4), force);
    setVisualVariable("--mid", clamp(levels.mid * motion, 0, 1.4), force);
    setVisualVariable("--high", clamp(levels.high * motion, 0, 1.4), force);
    setVisualVariable("--impact", clamp(levels.impact * motion, 0, 1.5), force);
    setVisualVariable("--flux", clamp(levels.flux * motion, 0, 1.5), force);
    updateSpectrumBars(force);
  }

  function updateAudioLevels({ writeStyles = true, forceStyles = false } = {}) {
    const levels = state.levels;
    if (state.analyser && state.audioContext?.state === "running" && state.playing) {
      state.analyser.getByteFrequencyData(state.frequencyData);
      state.analyser.getByteTimeDomainData(state.timeData);
      rebuildLogSpectrum();
      const nyquist = state.audioContext.sampleRate / 2;
      const bin = state.frequencyData.length / nyquist;
      const low = Math.pow(bandEnergy(state.frequencyData, 35 * bin, 190 * bin), .78);
      const mid = Math.pow(bandEnergy(state.frequencyData, 190 * bin, 2600 * bin), .82);
      const high = Math.pow(bandEnergy(state.frequencyData, 2600 * bin, 14000 * bin), .86);
      let sumSq = 0;
      for (const value of state.timeData) {
        const centered = (value - 128) / 128;
        sumSq += centered * centered;
      }
      const rms = Math.sqrt(sumSq / state.timeData.length);
      const energyTarget = clamp(Math.pow(rms * 3.45, .72), 0, 1);
      const lowDelta = low - levels.low;
      const impactTarget = clamp(Math.max(0, lowDelta * 4.8) + levels.flux * .8, 0, 1);
      levels.energy += (energyTarget - levels.energy) * .22;
      levels.low += (low - levels.low) * .24;
      levels.mid += (mid - levels.mid) * .2;
      levels.high += (high - levels.high) * .18;
      levels.impact = Math.max(levels.impact * .86, impactTarget);
    } else if (PERFORMANCE.enabled) {
      // Android/WebView idle mode is intentionally static. The former fake waveform kept
      // the full compositor and canvas pipeline busy even while audio was paused.
      if (forceStyles) {
        levels.energy = .045;
        levels.low = .038;
        levels.mid = .032;
        levels.high = .024;
        levels.impact = 0;
        levels.flux = 0;
        state.spectrum.fill(.025);
      } else {
        levels.energy += (.045 - levels.energy) * .38;
        levels.low += (.038 - levels.low) * .38;
        levels.mid += (.032 - levels.mid) * .38;
        levels.high += (.024 - levels.high) * .38;
        levels.impact *= .55;
        levels.flux *= .55;
        for (let i = 0; i < state.spectrum.length; i++) {
          state.spectrum[i] += (.025 - state.spectrum[i]) * .42;
        }
      }
    } else {
      state.fakePhase += .012;
      const idle = .055 + Math.sin(state.fakePhase) * .012;
      levels.energy += (idle - levels.energy) * .05;
      levels.low += (.048 - levels.low) * .05;
      levels.mid += (.04 - levels.mid) * .05;
      levels.high += (.03 - levels.high) * .05;
      levels.impact *= .9;
      levels.flux *= .9;
      for (let i = 0; i < state.spectrum.length; i++) {
        const target = .04 + Math.max(0, Math.sin(state.fakePhase * 1.7 + i * .37)) * .045;
        state.spectrum[i] += (target - state.spectrum[i]) * .04;
      }
    }
    if (writeStyles) writeVisualLevels(forceStyles);
  }

  const canvas = {
    ctx: els.canvas.getContext("2d", { alpha: true, desynchronized: PERFORMANCE.enabled }),
    width: 0,
    height: 0,
    dpr: 1,
    particles: Array.from({ length: PERFORMANCE.enabled ? 20 : 42 }, (_, index) => ({
      x: (index * 97 % 101) / 101,
      y: (index * 53 % 89) / 89,
      s: .35 + (index % 7) * .11,
      p: index * .63
    }))
  };

  function resizeCanvas() {
    const nextWidth = Math.max(1, window.innerWidth);
    const nextHeight = Math.max(1, window.innerHeight);
    const baseDpr = Math.min(window.devicePixelRatio || 1, PERFORMANCE.dprCap);
    const nextDpr = Math.max(.5, baseDpr * PERFORMANCE.renderScale);
    const pixelWidth = Math.max(1, Math.floor(nextWidth * nextDpr));
    const pixelHeight = Math.max(1, Math.floor(nextHeight * nextDpr));
    if (canvas.width === nextWidth && canvas.height === nextHeight &&
        Math.abs(canvas.dpr - nextDpr) < .001 &&
        els.canvas.width === pixelWidth && els.canvas.height === pixelHeight) {
      requestVisualFrame(true);
      return;
    }
    canvas.dpr = nextDpr;
    canvas.width = nextWidth;
    canvas.height = nextHeight;
    els.canvas.width = pixelWidth;
    els.canvas.height = pixelHeight;
    els.canvas.style.width = `${canvas.width}px`;
    els.canvas.style.height = `${canvas.height}px`;
    canvas.ctx.setTransform(canvas.dpr, 0, 0, canvas.dpr, 0, 0);
    requestVisualFrame(true);
  }

  function drawWaveform(ctx, w, h, y, amplitude, color, lineWidth = 1) {
    const data = state.timeData;
    ctx.beginPath();
    const points = PERFORMANCE.enabled ? 96 : 160;
    for (let i = 0; i < points; i++) {
      const x = i / (points - 1) * w;
      const sample = data && state.playing ? (data[Math.floor(i / points * data.length)] - 128) / 128 : (PERFORMANCE.enabled ? 0 : Math.sin(state.fakePhase * 3 + i * .28) * .18);
      const py = y + sample * amplitude;
      i === 0 ? ctx.moveTo(x, py) : ctx.lineTo(x, py);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }

  function drawAmbient(time) {
    const ctx = canvas.ctx;
    const w = canvas.width;
    const h = canvas.height;
    const { energy, low, mid, high, impact, flux } = state.levels;
    ctx.clearRect(0, 0, w, h);
    const skin = els.body.dataset.skin;

    if (skin === "stamp") {
      ctx.lineWidth = 1;
      const rowCount = PERFORMANCE.enabled ? 5 : 7;
      const lineStep = PERFORMANCE.enabled ? 24 : 14;
      for (let row = 0; row < rowCount; row++) {
        ctx.beginPath();
        for (let x = -20; x <= w + 20; x += lineStep) {
          const y = h * (.16 + row * .105) + Math.sin(x * .011 + time * .00048 + row) * (8 + low * 58);
          x < 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.strokeStyle = `rgba(91, 58, 40, ${.025 + mid * .09})`;
        ctx.stroke();
      }
      drawWaveform(ctx, w, h, h * .73, 26 + energy * 55, `rgba(91,58,40,${.08 + energy * .17})`, 1.2);
      for (let i = 0; i < 8; i++) {
        const radius = 34 + i * 16 + impact * 38;
        ctx.beginPath();
        ctx.arc(w * .79, h * .2, radius, -.75, 2.25);
        ctx.strokeStyle = `rgba(168,64,48,${.025 + flux * .07})`;
        ctx.stroke();
      }
    } else if (skin === "film") {
      const gradient = ctx.createRadialGradient(w * .22, h * .26, 0, w * .22, h * .26, w * .54);
      gradient.addColorStop(0, `rgba(236, 155, 87, ${.04 + energy * .18 + impact * .08})`);
      gradient.addColorStop(.45, `rgba(100, 72, 53, ${.01 + low * .05})`);
      gradient.addColorStop(1, "rgba(236,155,87,0)");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = `rgba(255,255,255,${.022 + high * .09})`;
      ctx.lineWidth = .75;
      const scratchCount = PERFORMANCE.enabled ? 10 : 18;
      for (let i = 0; i < scratchCount; i++) {
        const x = ((i * 137 + time * .022 * (i % 4 + 1)) % (w + 140)) - 70;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + Math.sin(i) * 6, h);
        ctx.stroke();
      }
      drawWaveform(ctx, w * .94, h, h * .76, 34 + mid * 68, `rgba(244,239,231,${.09 + energy * .2})`, 1.3);
      if (impact > .18) {
        ctx.fillStyle = `rgba(255,190,113,${impact * .08})`;
        ctx.fillRect(0, 0, w, h);
      }
    } else {
      const cx = w * .27;
      const cy = h * .7;
      const ringCount = PERFORMANCE.enabled ? 5 : 8;
      for (let ring = 0; ring < ringCount; ring++) {
        ctx.beginPath();
        const radius = 54 + ring * 45 + low * 110 + Math.sin(time * .00055 + ring) * 5;
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(169, 237, 226, ${.022 + (ringCount - ring) * .005 + mid * .08})`;
        ctx.lineWidth = 1 + impact * .7;
        ctx.stroke();
      }
      drawWaveform(ctx, w, h, h * .52, 38 + energy * 82, `rgba(190,245,238,${.075 + energy * .18})`, 1.2);
      for (const particle of canvas.particles) {
        const x = particle.x * w + Math.sin(time * .00025 + particle.p) * (18 + mid * 34);
        const y = particle.y * h + Math.cos(time * .00019 + particle.p) * (15 + low * 28);
        const size = particle.s * (1 + high * 3.4 + impact * 1.8);
        ctx.fillStyle = `rgba(211,255,248,${.045 + high * .16})`;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  const renderClock = {
    rafId: 0,
    needsFrame: true,
    lastVisual: 0,
    lastProgress: 0,
    lastDrawAt: 0,
    sampleCount: 0,
    stableWindows: 0
  };

  function requestVisualFrame(force = false) {
    if (force) renderClock.needsFrame = true;
    if (document.hidden || renderClock.rafId) return;
    renderClock.rafId = requestAnimationFrame(animationLoop);
  }

  function adaptRenderQuality(renderCost, frameGap) {
    if (!PERFORMANCE.adaptive) return;
    PERFORMANCE.averageRenderCost = PERFORMANCE.averageRenderCost
      ? PERFORMANCE.averageRenderCost * .9 + renderCost * .1
      : renderCost;
    PERFORMANCE.averageFrameGap = PERFORMANCE.averageFrameGap
      ? PERFORMANCE.averageFrameGap * .9 + frameGap * .1
      : frameGap;
    renderClock.sampleCount += 1;
    if (renderClock.sampleCount < 45) return;
    renderClock.sampleCount = 0;

    const tooSlow = PERFORMANCE.averageRenderCost > 24 || PERFORMANCE.averageFrameGap > 52;
    const comfortablyFast = PERFORMANCE.averageRenderCost < 10 && PERFORMANCE.averageFrameGap < 39;

    if (tooSlow) {
      renderClock.stableWindows = 0;
      if (PERFORMANCE.renderScale > PERFORMANCE.minRenderScale + .02) {
        PERFORMANCE.renderScale = Math.max(
          PERFORMANCE.minRenderScale,
          Math.round((PERFORMANCE.renderScale - .14) * 100) / 100
        );
        PERFORMANCE.qualityChanges += 1;
        resizeCanvas();
      } else if (PERFORMANCE.targetFps > PERFORMANCE.minimumFps) {
        PERFORMANCE.targetFps = PERFORMANCE.minimumFps;
        PERFORMANCE.qualityChanges += 1;
      }
      return;
    }

    if (comfortablyFast && PERFORMANCE.renderScale < PERFORMANCE.maxRenderScale) {
      renderClock.stableWindows += 1;
      if (renderClock.stableWindows >= 8) {
        PERFORMANCE.renderScale = Math.min(
          PERFORMANCE.maxRenderScale,
          Math.round((PERFORMANCE.renderScale + .08) * 100) / 100
        );
        renderClock.stableWindows = 0;
        resizeCanvas();
      }
    } else {
      renderClock.stableWindows = 0;
    }
  }

  function animationLoop(time) {
    renderClock.rafId = 0;
    if (document.hidden) return;

    const continuous = !PERFORMANCE.enabled || state.playing || state.transitioning;
    if (!continuous && !renderClock.needsFrame) return;

    const visualInterval = 1000 / PERFORMANCE.targetFps;
    const visualDue = renderClock.needsFrame || !renderClock.lastVisual || time - renderClock.lastVisual >= visualInterval;
    if (visualDue) {
      const startedAt = performance.now();
      const forceStyles = renderClock.needsFrame;
      updateAudioLevels({ writeStyles: true, forceStyles });
      drawAmbient(time);
      const finishedAt = performance.now();
      const frameGap = renderClock.lastDrawAt ? finishedAt - renderClock.lastDrawAt : visualInterval;
      renderClock.lastDrawAt = finishedAt;
      renderClock.lastVisual = time;
      renderClock.needsFrame = false;
      adaptRenderQuality(finishedAt - startedAt, frameGap);
    }

    if (!renderClock.lastProgress || time - renderClock.lastProgress >= PERFORMANCE.progressInterval) {
      updateProgress();
      renderClock.lastProgress = time;
    }

    if (!PERFORMANCE.enabled || state.playing || state.transitioning || renderClock.needsFrame) {
      requestVisualFrame();
    }
  }

  function bindEvents() {
    const openFolder = async () => {
      try { await initAudio(); } catch (_) {}
      els.folderInput.value = "";
      els.folderInput.click();
    };

    els.loadFolderBtn.addEventListener("click", openFolder);
    els.welcomeFolderBtn.addEventListener("click", openFolder);
    els.welcomeDeleteBtn?.addEventListener("click", handleDeleteSelected);
    els.folderInput.addEventListener("change", async () => {
      if (!els.folderInput.files.length) return;
      try { await parseFolderFiles(els.folderInput.files); }
      catch (error) { showToast(error.message || String(error), 4200); }
    });

    els.welcomeCloseBtn?.addEventListener("click", () => setWelcomeVisible(false));
    els.albumOverviewBtn?.addEventListener("click", openAlbumOverview);
    els.dockToggleLeft?.addEventListener("click", () => toggleDock());
    els.dockToggleRight?.addEventListener("click", () => toggleDock());

    els.trackList?.addEventListener("click", (event) => {
      const row = event.target.closest("[data-track-index]");
      if (!row) return;
      selectTrackFromTouch(Number(row.dataset.trackIndex));
    });

    let gestureStartX = 0;
    let gestureStartY = 0;
    let gestureMoved = false;
    els.artShell?.addEventListener("pointerdown", (event) => {
      gestureStartX = event.clientX;
      gestureStartY = event.clientY;
      gestureMoved = false;
      els.artShell.setPointerCapture?.(event.pointerId);
    });
    els.artShell?.addEventListener("pointermove", (event) => {
      if (Math.abs(event.clientX - gestureStartX) > 10 || Math.abs(event.clientY - gestureStartY) > 10) gestureMoved = true;
    });
    els.artShell?.addEventListener("pointerup", (event) => {
      const dx = event.clientX - gestureStartX;
      const dy = event.clientY - gestureStartY;
      if (Math.abs(dx) > 72 && Math.abs(dx) > Math.abs(dy) * 1.15) {
        nextTrack(dx < 0 ? 1 : -1);
        return;
      }
      if (!gestureMoved) togglePlay();
    });

    window.Melodio = {
      next: () => nextTrack(1),
      previous: () => nextTrack(-1),
      togglePlay,
      selectTrack: selectTrackFromTouch,
      setSkin,
      getPerformanceInfo: () => ({
        enabled: PERFORMANCE.enabled,
        android: PERFORMANCE.android,
        webView: PERFORMANCE.webView,
        targetFps: PERFORMANCE.targetFps,
        renderScale: PERFORMANCE.renderScale,
        effectiveDpr: canvas.dpr,
        canvasPixels: els.canvas.width * els.canvas.height,
        averageRenderCost: Number(PERFORMANCE.averageRenderCost.toFixed(2)),
        averageFrameGap: Number(PERFORMANCE.averageFrameGap.toFixed(2)),
        qualityChanges: PERFORMANCE.qualityChanges
      })
    };

    els.playBtn.addEventListener("click", togglePlay);
    els.prevBtn.addEventListener("click", () => nextTrack(-1));
    els.nextBtn.addEventListener("click", () => nextTrack(1));
    els.motionBtn.addEventListener("click", cycleMotionMode);
    els.mappingBtn.addEventListener("click", () => setMappingOpen(!state.mappingOpen));
    els.mappingCloseBtn.addEventListener("click", () => setMappingOpen(false));
    els.autoMapBtn.addEventListener("click", () => autoMapImages().catch((error) => showToast(error.message || String(error))));
    els.resetStartsBtn.addEventListener("click", resetAllStartPoints);
    els.exportMapBtn.addEventListener("click", exportMapping);
    els.mappingPanel.addEventListener("click", (event) => {
      if (event.target === els.mappingPanel) setMappingOpen(false);
    });
    els.cleanBtn.addEventListener("click", toggleClean);
    $$('[data-set-skin]').forEach((button) => button.addEventListener("click", () => setSkin(button.dataset.setSkin)));

    document.addEventListener("keydown", (event) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.target instanceof HTMLSelectElement || event.target instanceof HTMLInputElement) return;
      const key = event.key.toLowerCase();
      if (state.mappingOpen && !["g", "escape"].includes(key)) return;
      if ([" ", "arrowleft", "arrowright", "arrowup", "arrowdown"].includes(key)) event.preventDefault();
      if (key === " ") togglePlay();
      else if (key === "arrowright" || key === "d") nextTrack(1);
      else if (key === "arrowleft" || key === "a") nextTrack(-1);
      else if (key === "r") replayTrack();
      else if (key === "g") setMappingOpen(!state.mappingOpen);
      else if (key === "escape" && state.mappingOpen) setMappingOpen(false);
      else if (key === "h") toggleClean();
      else if (key === "m") cycleMotionMode();
      else if (key === "arrowdown" || key === "]") {
        if (!event.repeat) cycleSkin(1);
      }
      else if (key === "arrowup" || key === "[") {
        if (!event.repeat) cycleSkin(-1);
      }
    });

    let dragDepth = 0;
    window.addEventListener("dragenter", (event) => {
      event.preventDefault();
      dragDepth += 1;
      els.dropOverlay.classList.add("is-visible");
    });
    window.addEventListener("dragover", (event) => event.preventDefault());
    window.addEventListener("dragleave", (event) => {
      event.preventDefault();
      dragDepth = Math.max(0, dragDepth - 1);
      if (!dragDepth) els.dropOverlay.classList.remove("is-visible");
    });
    window.addEventListener("drop", async (event) => {
      event.preventDefault();
      dragDepth = 0;
      els.dropOverlay.classList.remove("is-visible");
      if (!event.dataTransfer.files.length) return;
      try {
        await initAudio();
        await parseFolderFiles(event.dataTransfer.files);
      } catch (error) {
        showToast(error.message || String(error), 4200);
      }
    });

    document.addEventListener("visibilitychange", () => {
      if (document.hidden && state.playing) {
        togglePlay();
        showToast("页面离开前台，已自动暂停，避免录制错位", 3200);
      } else if (!document.hidden) {
        requestVisualFrame(true);
      }
    });

    els.audio.forEach((audio) => audio.addEventListener("error", () => {
      if (audio.error) showToast(`音频加载失败（代码 ${audio.error.code}）`);
    }));
    els.previewAudio.addEventListener("ended", () => stopStartPreview());
    els.previewAudio.addEventListener("error", () => {
      if (els.previewAudio.error) showToast(`试听加载失败（代码 ${els.previewAudio.error.code}）`);
      stopStartPreview();
    });

    window.addEventListener("resize", resizeCanvas);
    window.addEventListener("beforeunload", revokeObjectUrls);
  }

  function bootstrap() {
    els.spectrumRuler.innerHTML = Array.from({ length: state.spectrum.length }, () => "<i></i>").join("");
    state.spectrumBars = [...els.spectrumRuler.children];
    bindEvents();
    bindProgressSeek();
    resizeCanvas();
    setSkin("stamp", false);
    requestVisualFrame(true);
    const params = new URLSearchParams(location.search);
    const albums = getAlbumLibrary();
    if (params.get("blank") === "1") {
      loadStaticConfig(albums[0]);
    } else if (params.get("imported") === "1") {
      loadImportedAlbum();
    } else if (albums.length === 1) {
      loadStaticConfig(albums[0]);
    } else if (albums.length > 1) {
      openAlbumOverview();
    } else {
      showToast("未配置内置专辑，请使用「＋ 导入新专辑」", 4200);
      openAlbumOverview();
    }
  }

  bootstrap();
})();
