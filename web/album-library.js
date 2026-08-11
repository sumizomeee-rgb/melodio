(() => {
  "use strict";

  const TRANSITION_KEY = "melodio-album-transition-v3";
  const state = {
    library: null,
    switching: false,
    selectedAlbumId: "",
    rails: { prev: null, next: null }
  };

  const $ = (selector) => document.querySelector(selector);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const isAndroidLibrary = location.hostname === "appassets.androidplatform.net";
  const mockLibrary = window.__MELODIO_LIBRARY_MOCK__ || null;

  function installVisualContinuity() {
    if (document.getElementById("melodio-library-visual-v3")) return;
    const style = document.createElement("style");
    style.id = "melodio-library-visual-v3";
    style.textContent = `
      body.is-album-switch-loading #welcome,
      body.is-album-switch-loading .welcome-panel,
      body.is-album-switch-loading .loading-panel {
        opacity: 0 !important;
        visibility: hidden !important;
        pointer-events: none !important;
      }

      body[data-skin="film"] .touch-album-panel::before {
        background: linear-gradient(90deg,
          rgba(14,13,12,0) 0%,
          rgba(14,13,12,.10) 16%,
          rgba(14,13,12,.30) 46%,
          rgba(14,13,12,.48) 100%) !important;
      }
      body[data-skin="glass"] .touch-album-panel::before {
        background: linear-gradient(90deg,
          rgba(12,20,31,0) 0%,
          rgba(12,20,31,.08) 18%,
          rgba(12,20,31,.25) 50%,
          rgba(12,20,31,.42) 100%) !important;
      }

      html[data-performance="mobile"] body[data-skin="stamp"] #ambientCanvas {
        opacity: .09 !important;
        clip-path: none !important;
        -webkit-mask-image: linear-gradient(90deg,
          #000 0%, #000 40%,
          rgba(0,0,0,.56) 61%,
          rgba(0,0,0,.16) 84%,
          transparent 100%) !important;
        mask-image: linear-gradient(90deg,
          #000 0%, #000 40%,
          rgba(0,0,0,.56) 61%,
          rgba(0,0,0,.16) 84%,
          transparent 100%) !important;
      }
      html[data-performance="mobile"] body[data-skin="stamp"] .spectrum-ruler {
        left: 5% !important;
        width: 58% !important;
        right: auto !important;
        height: clamp(38px, 7.5vh, 72px) !important;
        opacity: calc(.28 + var(--energy) * .42) !important;
        -webkit-mask-image: linear-gradient(90deg,
          transparent 0%, #000 7%, #000 64%,
          rgba(0,0,0,.42) 82%, transparent 100%) !important;
        mask-image: linear-gradient(90deg,
          transparent 0%, #000 7%, #000 64%,
          rgba(0,0,0,.42) 82%, transparent 100%) !important;
      }

      html[data-performance="mobile"] body[data-skin="film"] #ambientCanvas {
        opacity: .15 !important;
        clip-path: none !important;
        -webkit-mask-image: linear-gradient(90deg,
          #000 0%, #000 43%,
          rgba(0,0,0,.58) 64%,
          rgba(0,0,0,.18) 86%,
          transparent 100%) !important;
        mask-image: linear-gradient(90deg,
          #000 0%, #000 43%,
          rgba(0,0,0,.58) 64%,
          rgba(0,0,0,.18) 86%,
          transparent 100%) !important;
      }
      html[data-performance="mobile"] body[data-skin="film"] .spectrum-ruler {
        left: 4.5% !important;
        width: 61% !important;
        right: auto !important;
        height: clamp(62px, 13.5vh, 136px) !important;
        opacity: calc(.38 + var(--energy) * .48) !important;
        -webkit-mask-image: linear-gradient(90deg,
          transparent 0%, #000 5%, #000 62%,
          rgba(0,0,0,.45) 82%, transparent 100%) !important;
        mask-image: linear-gradient(90deg,
          transparent 0%, #000 5%, #000 62%,
          rgba(0,0,0,.45) 82%, transparent 100%) !important;
      }

      html[data-performance="mobile"] body[data-skin="glass"] #ambientCanvas {
        opacity: .34 !important;
        clip-path: none !important;
        -webkit-mask-image: linear-gradient(90deg,
          #000 0%, #000 46%,
          rgba(0,0,0,.48) 68%,
          rgba(0,0,0,.18) 88%,
          transparent 100%) !important;
        mask-image: linear-gradient(90deg,
          #000 0%, #000 46%,
          rgba(0,0,0,.48) 68%,
          rgba(0,0,0,.18) 88%,
          transparent 100%) !important;
      }

      .touch-track-row.is-active .state-mark {
        animation: none !important;
        transform: scale(calc(.88 + var(--energy) * .18)) !important;
        opacity: .96 !important;
        transition: transform 70ms linear, opacity 70ms linear, box-shadow 70ms linear !important;
      }
      body[data-skin="stamp"] .touch-track-row.is-active .state-mark {
        box-shadow: 0 0 0 3px rgba(255,248,233,.08), 0 0 12px rgba(255,248,233,.20);
      }
      body[data-skin="film"] .touch-track-row.is-active .state-mark {
        box-shadow: 0 0 0 3px rgba(22,15,11,.08), 0 0 14px rgba(242,179,107,.28);
      }
      body[data-skin="glass"] .touch-track-row.is-active .state-mark {
        box-shadow: 0 0 0 3px rgba(233,251,255,.08), 0 0 16px rgba(188,231,223,.30);
      }

      body.is-album-exiting #welcome,
      body.is-album-entering #welcome {
        opacity: 0 !important;
        visibility: hidden !important;
        pointer-events: none !important;
      }
    `;
    document.head.appendChild(style);
  }

  async function fetchLibrary() {
    if (mockLibrary) return mockLibrary;
    if (!isAndroidLibrary) return null;
    if (window.MelodioNative?.readLibraryJson) {
      try {
        const text = window.MelodioNative.readLibraryJson();
        return text ? JSON.parse(text) : null;
      } catch (_) {
        return null;
      }
    }
    try {
      const response = await fetch(`/library/__list__?t=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) return null;
      return await response.json();
    } catch (_) {
      return null;
    }
  }

  function currentIndex(library) {
    if (!library?.albums?.length) return -1;
    const index = library.albums.findIndex((album) => album.id === library.currentId);
    return index >= 0 ? index : 0;
  }

  function neighbor(library, offset) {
    const albums = library?.albums || [];
    if (albums.length < 2) return null;
    const index = currentIndex(library);
    return albums[(index + offset + albums.length) % albums.length];
  }

  function buildRail(side) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `album-edge-rail album-edge-${side}`;
    button.dataset.side = side;
    button.innerHTML = `
      <span class="album-edge-cover" aria-hidden="true"></span>
      <span class="album-edge-arrow" aria-hidden="true">${side === "left" ? "‹" : "›"}</span>`;

    let pointerId = null;
    let startX = 0;
    let dragged = false;
    let suppressClick = false;

    const resetPointer = () => {
      pointerId = null;
      button.classList.remove("is-pressed");
      button.style.removeProperty("--rail-pull");
      window.setTimeout(() => { dragged = false; }, 0);
    };

    button.addEventListener("pointerdown", (event) => {
      if (state.switching) return;
      pointerId = event.pointerId;
      startX = event.clientX;
      dragged = false;
      suppressClick = false;
      button.setPointerCapture?.(pointerId);
      button.classList.add("is-pressed");
    });

    button.addEventListener("pointermove", (event) => {
      if (pointerId !== event.pointerId) return;
      const inward = side === "left" ? event.clientX - startX : startX - event.clientX;
      if (Math.abs(inward) > 7) dragged = true;
      const pull = Math.max(0, Math.min(16, inward));
      button.style.setProperty("--rail-pull", `${side === "left" ? pull : -pull}px`);
    });

    button.addEventListener("pointerup", (event) => {
      if (pointerId !== event.pointerId) return;
      const inward = side === "left" ? event.clientX - startX : startX - event.clientX;
      if (inward > 34) {
        suppressClick = true;
        event.preventDefault();
        activateRail(button);
      }
      resetPointer();
    });

    button.addEventListener("pointercancel", resetPointer);
    button.addEventListener("click", (event) => {
      if (suppressClick) {
        suppressClick = false;
        event.preventDefault();
        return;
      }
      if (dragged) return;
      activateRail(button);
    });

    $("#app")?.appendChild(button);
    return button;
  }

  function populateRail(button, album) {
    if (!button) return;
    button.hidden = false;
    button.classList.toggle("is-empty", !album);
    button.dataset.albumId = album?.id || "";
    const cover = button.querySelector(".album-edge-cover");
    if (cover) {
      cover.style.backgroundImage = album?.cover ? `url("${String(album.cover).replace(/"/g, "\\\"")}")` : "none";
      cover.classList.toggle("has-cover", Boolean(album?.cover));
    }
    const direction = button.dataset.side === "left" ? "上一张" : "下一张";
    button.setAttribute("aria-label", album ? `${direction}专辑：${album.title}` : "打开专辑管理");
  }

  function renderRails(library) {
    if (!state.rails.prev) state.rails.prev = buildRail("left");
    if (!state.rails.next) state.rails.next = buildRail("right");
    const prev = neighbor(library, -1);
    const next = neighbor(library, 1);
    populateRail(state.rails.prev, prev);
    populateRail(state.rails.next, next);
    document.body.classList.toggle("has-album-rails", true);
  }

  function activateRail(button) {
    if (state.switching) return;
    const id = button?.dataset.albumId;
    if (!id) {
      openLibraryOverview();
      return;
    }
    switchAlbum(id, button.dataset.side === "left" ? "prev" : "next");
  }

  function rememberTransition(direction, id, autoplay = true) {
    const payload = {
      direction,
      id,
      autoplay,
      skin: document.body.dataset.skin || "stamp",
      at: Date.now()
    };
    try { sessionStorage.setItem(TRANSITION_KEY, JSON.stringify(payload)); } catch (_) {}
    return payload;
  }

  function readTransition() {
    try {
      const raw = sessionStorage.getItem(TRANSITION_KEY);
      if (!raw) return null;
      const value = JSON.parse(raw);
      if (!value || Date.now() - Number(value.at || 0) > 12000) {
        sessionStorage.removeItem(TRANSITION_KEY);
        return null;
      }
      return value;
    } catch (_) {
      return null;
    }
  }

  function clearTransition() {
    try { sessionStorage.removeItem(TRANSITION_KEY); } catch (_) {}
  }

  function ensureCurtain(direction, covered = false) {
    let curtain = $(".album-switch-curtain");
    if (!curtain) {
      curtain = document.createElement("div");
      curtain.className = "album-switch-curtain";
      curtain.setAttribute("aria-hidden", "true");
      $("#app")?.appendChild(curtain);
    }
    document.body.dataset.albumSwitchDirection = direction;
    curtain.classList.toggle("is-covering", covered);
    curtain.classList.remove("is-revealing");
    return curtain;
  }

  function primePendingTransition(pending) {
    if (!pending) return;
    state.switching = true;
    document.body.dataset.albumSwitchDirection = pending.direction || "next";
    document.body.classList.add("is-album-switch-loading");
    ensureCurtain(pending.direction || "next", true);
    const welcome = $("#welcome");
    if (welcome) {
      welcome.style.opacity = "0";
      welcome.style.visibility = "hidden";
      welcome.style.pointerEvents = "none";
    }
  }

  async function switchAlbum(id, direction = "next") {
    if (!id || state.switching || id === state.library?.currentId) return;
    state.switching = true;
    const pending = rememberTransition(direction, id, true);
    const curtain = ensureCurtain(direction, false);
    document.body.classList.add("is-album-exiting");
    requestAnimationFrame(() => requestAnimationFrame(() => curtain.classList.add("is-covering")));
    await sleep(250);

    if (mockLibrary) {
      const index = mockLibrary.albums.findIndex((album) => album.id === id);
      if (index >= 0) mockLibrary.currentId = id;
      state.library = mockLibrary;
      renderRails(state.library);
      document.body.classList.remove("is-album-exiting");
      document.body.classList.add("is-album-entering");
      requestAnimationFrame(() => requestAnimationFrame(() => {
        document.body.classList.add("is-album-entering-ready");
        curtain.classList.add("is-revealing");
      }));
      window.setTimeout(() => {
        document.body.classList.remove("is-album-entering", "is-album-entering-ready");
        curtain.remove();
        state.switching = false;
        clearTransition();
      }, 560);
      return;
    }

    try {
      if (window.MelodioNative?.switchAlbum) {
        if (!window.MelodioNative.switchAlbum(id)) throw new Error("album not found");
      } else {
        const response = await fetch(`/library/__switch__?id=${encodeURIComponent(id)}&t=${Date.now()}`, {
          method: "POST",
          cache: "no-store"
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
      }
      const url = new URL(location.href);
      url.searchParams.set("imported", "1");
      url.searchParams.set("performance", url.searchParams.get("performance") || "auto");
      url.searchParams.set("album", id);
      location.replace(url.toString());
    } catch (_) {
      state.switching = false;
      document.body.classList.remove("is-album-exiting");
      curtain.classList.add("is-revealing");
      window.setTimeout(() => curtain.remove(), 360);
      clearTransition();
      void pending;
    }
  }

  function selectOverviewCard(card, albumId) {
    const picker = $("#albumPicker");
    picker?.querySelectorAll(".album-option.is-selected").forEach((node) => node.classList.remove("is-selected"));
    card.classList.add("is-selected");
    state.selectedAlbumId = albumId;
  }

  function renderOverview(library) {
    const welcome = $("#welcome");
    const picker = $("#albumPicker");
    if (!welcome || !picker) return;
    picker.replaceChildren();
    const albums = library?.albums || [];
    state.selectedAlbumId = library?.currentId || "";

    if (!albums.length) {
      const empty = document.createElement("div");
      empty.className = "album-empty";
      empty.textContent = "还没有专辑 · 点下方「＋ 导入新专辑」选择素材文件夹";
      picker.appendChild(empty);
    } else {
      albums.forEach((album) => {
        const card = document.createElement("button");
        card.type = "button";
        card.className = "album-option is-imported library-album-option";
        card.dataset.albumId = album.id;
        if (album.id === library.currentId) card.classList.add("is-selected", "is-current");
        card.innerHTML = `
          <span class="library-album-thumb" aria-hidden="true"></span>
          <span class="library-album-card-copy">
            <span class="album-option-title"></span>
            <span class="album-option-meta"></span>
          </span>
          <span class="library-current-mark">${album.id === library.currentId ? "PLAYING" : ""}</span>`;
        card.querySelector(".album-option-title").textContent = album.title || "未命名专辑";
        card.querySelector(".album-option-meta").textContent = `${album.trackCount || 0} 首 · 再次点击载入`;
        const thumb = card.querySelector(".library-album-thumb");
        if (thumb && album.cover) thumb.style.backgroundImage = `url("${String(album.cover).replace(/"/g, "\\\"")}")`;
        card.addEventListener("click", () => {
          const wasSelected = state.selectedAlbumId === album.id;
          selectOverviewCard(card, album.id);
          if (wasSelected && album.id !== library.currentId) {
            const from = currentIndex(library);
            const to = albums.findIndex((item) => item.id === album.id);
            switchAlbum(album.id, to < from ? "prev" : "next");
          }
        });
        picker.appendChild(card);
      });
    }

    const hint = $(".album-hint");
    if (hint) hint.textContent = "点一次选择 · 再点一次载入 · 播放页左右边缘可直接切专辑";
    welcome.classList.remove("is-hidden");
  }

  async function openLibraryOverview() {
    const library = await fetchLibrary();
    if (library) {
      state.library = library;
      renderOverview(library);
    } else {
      $("#welcome")?.classList.remove("is-hidden");
    }
  }

  async function deleteSelectedAlbum() {
    const id = state.selectedAlbumId;
    if (!id || !state.library || mockLibrary) return;
    const button = $("#welcomeDeleteBtn");
    if (!button) return;
    if (button.dataset.libraryConfirm !== id) {
      button.dataset.libraryConfirm = id;
      button.textContent = "确认删除?";
      setTimeout(() => {
        if (button.dataset.libraryConfirm === id) {
          button.dataset.libraryConfirm = "";
          button.textContent = "删除所选专辑";
        }
      }, 4200);
      return;
    }
    button.dataset.libraryConfirm = "";
    button.disabled = true;
    try {
      let nextLibrary = null;
      if (window.MelodioNative?.deleteAlbumFromLibrary) {
        const text = window.MelodioNative.deleteAlbumFromLibrary(id);
        if (!text) throw new Error("delete failed");
        nextLibrary = JSON.parse(text);
      } else {
        const response = await fetch(`/library/__delete__?id=${encodeURIComponent(id)}&t=${Date.now()}`, {
          method: "POST",
          cache: "no-store"
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        nextLibrary = await response.json();
      }
      if (id === state.library.currentId && nextLibrary.currentId) {
        rememberTransition("next", nextLibrary.currentId, true);
        const url = new URL(location.href);
        url.searchParams.set("imported", "1");
        location.replace(url.toString());
        return;
      }
      state.library = nextLibrary;
      renderOverview(nextLibrary);
      renderRails(nextLibrary);
    } catch (_) {
      button.textContent = "删除失败 · 重试";
    } finally {
      button.disabled = false;
      if (!button.textContent.includes("失败")) button.textContent = "删除所选专辑";
    }
  }

  function installOverviewInterceptors() {
    if (!isAndroidLibrary && !mockLibrary) return;
    document.addEventListener("click", (event) => {
      const overview = event.target.closest?.("#albumOverviewBtn");
      if (overview) {
        event.preventDefault();
        event.stopImmediatePropagation();
        openLibraryOverview();
        return;
      }
      const deleteButton = event.target.closest?.("#welcomeDeleteBtn");
      if (deleteButton && state.library?.albums?.length) {
        event.preventDefault();
        event.stopImmediatePropagation();
        deleteSelectedAlbum();
      }
    }, true);
  }

  function installMotionPolish() {
    const list = $("#trackList");
    if (list) {
      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          const row = mutation.target;
          if (!(row instanceof HTMLElement) || !row.classList.contains("touch-track-row")) continue;
          if (!row.classList.contains("is-active")) continue;
          const wasActive = String(mutation.oldValue || "").split(/\s+/).includes("is-active");
          if (wasActive) continue;
          row.classList.remove("is-motion-enter");
          void row.offsetWidth;
          row.classList.add("is-motion-enter");
          setTimeout(() => row.classList.remove("is-motion-enter"), 440);
        }
      });
      observer.observe(list, {
        subtree: true,
        attributes: true,
        attributeOldValue: true,
        attributeFilter: ["class"]
      });
    }

    const welcome = $("#welcome");
    if (welcome) {
      const sync = () => document.body.classList.toggle("library-overview-open", !welcome.classList.contains("is-hidden"));
      new MutationObserver(sync).observe(welcome, { attributes: true, attributeFilter: ["class"] });
      sync();
    }
  }

  function startFirstTrackAfterAlbumSwitch(pending) {
    if (!pending?.autoplay || !isAndroidLibrary || !window.Melodio?.togglePlay) return;
    window.setTimeout(() => {
      if (document.body.classList.contains("is-playing")) return;
      try { window.Melodio.togglePlay(); } catch (_) {}
    }, 70);
  }

  function completePendingEntry(pending) {
    const curtain = ensureCurtain(pending.direction || "next", true);
    document.body.classList.remove("is-album-switch-loading");
    const welcome = $("#welcome");
    if (welcome) {
      welcome.style.removeProperty("opacity");
      welcome.style.removeProperty("visibility");
      welcome.style.removeProperty("pointer-events");
    }
    document.body.classList.add("is-album-entering");
    startFirstTrackAfterAlbumSwitch(pending);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      document.body.classList.add("is-album-entering-ready");
      curtain.classList.add("is-revealing");
    }));
    window.setTimeout(() => {
      document.body.classList.remove("is-album-entering", "is-album-entering-ready");
      curtain.remove();
      clearTransition();
      state.switching = false;
    }, 580);
  }

  function applyPendingTransition(pending = readTransition()) {
    if (!pending) return;
    primePendingTransition(pending);
    if (pending.skin && window.Melodio?.setSkin) {
      try { window.Melodio.setSkin(pending.skin); } catch (_) {}
    }

    const panel = $("#loadingPanel");
    let done = false;
    const finish = () => {
      if (done) return;
      if (panel?.classList.contains("is-active")) return;
      done = true;
      observer?.disconnect();
      completePendingEntry(pending);
    };
    const observer = panel ? new MutationObserver(finish) : null;
    observer?.observe(panel, { attributes: true, attributeFilter: ["class"] });
    requestAnimationFrame(finish);
    window.setTimeout(() => {
      if (done) return;
      done = true;
      observer?.disconnect();
      completePendingEntry(pending);
    }, 7000);
  }

  installVisualContinuity();
  const bootPendingTransition = readTransition();
  if (bootPendingTransition) primePendingTransition(bootPendingTransition);

  async function init() {
    installOverviewInterceptors();
    installMotionPolish();
    applyPendingTransition(bootPendingTransition);
    const library = await fetchLibrary();
    if (!library) return;
    state.library = library;
    state.selectedAlbumId = library.currentId || "";
    renderRails(library);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }

  window.MelodioLibrary = {
    refresh: async () => {
      const library = await fetchLibrary();
      if (!library) return null;
      state.library = library;
      renderRails(library);
      return library;
    },
    switchAlbum
  };
})();