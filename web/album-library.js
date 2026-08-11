(() => {
  "use strict";

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

  async function fetchLibrary() {
    if (mockLibrary) return mockLibrary;
    if (!isAndroidLibrary) return null;
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
      <span class="album-edge-spine" aria-hidden="true"></span>
      <span class="album-edge-arrow" aria-hidden="true">${side === "left" ? "‹" : "›"}</span>
      <span class="album-edge-cover" aria-hidden="true"></span>
      <span class="album-edge-copy">
        <span class="album-edge-kicker">${side === "left" ? "PREVIOUS ALBUM" : "NEXT ALBUM"}</span>
        <strong class="album-edge-title">—</strong>
        <span class="album-edge-meta">—</span>
      </span>`;

    let pointerId = null;
    let startX = 0;
    let moved = false;

    button.addEventListener("pointerdown", (event) => {
      if (state.switching) return;
      pointerId = event.pointerId;
      startX = event.clientX;
      moved = false;
      button.setPointerCapture?.(pointerId);
      button.classList.add("is-dragging");
    });

    button.addEventListener("pointermove", (event) => {
      if (pointerId !== event.pointerId) return;
      const delta = side === "left" ? event.clientX - startX : startX - event.clientX;
      if (Math.abs(delta) > 6) moved = true;
      button.classList.toggle("is-expanded", delta > 12);
      button.style.setProperty("--edge-drag", `${Math.max(0, Math.min(72, delta))}px`);
    });

    const finishPointer = (event) => {
      if (pointerId !== event.pointerId) return;
      const delta = side === "left" ? event.clientX - startX : startX - event.clientX;
      pointerId = null;
      button.classList.remove("is-dragging");
      button.style.removeProperty("--edge-drag");
      if (delta > 54) {
        event.preventDefault();
        activateRail(button);
      } else {
        window.setTimeout(() => button.classList.remove("is-expanded"), 140);
      }
    };

    button.addEventListener("pointerup", finishPointer);
    button.addEventListener("pointercancel", finishPointer);
    button.addEventListener("click", (event) => {
      if (moved) {
        moved = false;
        event.preventDefault();
        return;
      }
      activateRail(button);
    });

    button.addEventListener("focus", () => button.classList.add("is-expanded"));
    button.addEventListener("blur", () => button.classList.remove("is-expanded"));
    $("#app")?.appendChild(button);
    return button;
  }

  function populateRail(button, album) {
    if (!button) return;
    button.hidden = !album;
    button.dataset.albumId = album?.id || "";
    button.querySelector(".album-edge-title").textContent = album?.title || "—";
    button.querySelector(".album-edge-meta").textContent = album ? `${album.trackCount || 0} TRACKS` : "—";
    const cover = button.querySelector(".album-edge-cover");
    if (cover) {
      cover.style.backgroundImage = album?.cover ? `url("${String(album.cover).replace(/"/g, "\\\"")}")` : "none";
      cover.classList.toggle("has-cover", Boolean(album?.cover));
    }
    button.setAttribute("aria-label", album ? `${button.dataset.side === "left" ? "上一张" : "下一张"}专辑：${album.title}` : "切换专辑");
  }

  function renderRails(library) {
    if (!state.rails.prev) state.rails.prev = buildRail("left");
    if (!state.rails.next) state.rails.next = buildRail("right");
    const prev = neighbor(library, -1);
    const next = neighbor(library, 1);
    populateRail(state.rails.prev, prev);
    populateRail(state.rails.next, next);
    document.body.classList.toggle("has-album-rails", Boolean(prev || next));
  }

  function activateRail(button) {
    const id = button?.dataset.albumId;
    if (!id) return;
    switchAlbum(id, button.dataset.side === "left" ? "prev" : "next");
  }

  async function switchAlbum(id, direction = "next") {
    if (!id || state.switching || id === state.library?.currentId) return;
    state.switching = true;
    document.body.dataset.albumSwitchDirection = direction;
    document.body.classList.add("is-album-exiting");
    sessionStorage.setItem("melodio-album-entry", direction);
    await sleep(230);

    if (mockLibrary) {
      const index = mockLibrary.albums.findIndex((album) => album.id === id);
      if (index >= 0) mockLibrary.currentId = id;
      document.body.classList.remove("is-album-exiting");
      document.body.classList.add("is-album-entering");
      state.switching = false;
      state.library = mockLibrary;
      renderRails(state.library);
      setTimeout(() => document.body.classList.remove("is-album-entering"), 460);
      return;
    }

    try {
      const response = await fetch(`/library/__switch__?id=${encodeURIComponent(id)}&t=${Date.now()}`, {
        method: "POST",
        cache: "no-store"
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const url = new URL(location.href);
      url.searchParams.set("imported", "1");
      url.searchParams.set("performance", url.searchParams.get("performance") || "auto");
      url.searchParams.set("album", id);
      location.replace(url.toString());
    } catch (_) {
      state.switching = false;
      document.body.classList.remove("is-album-exiting");
      sessionStorage.removeItem("melodio-album-entry");
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

    const hint = document.querySelector(".album-hint");
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
      const response = await fetch(`/library/__delete__?id=${encodeURIComponent(id)}&t=${Date.now()}`, {
        method: "POST",
        cache: "no-store"
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const nextLibrary = await response.json();
      if (id === state.library.currentId && nextLibrary.currentId) {
        sessionStorage.setItem("melodio-album-entry", "next");
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
          row.classList.remove("is-motion-enter");
          void row.offsetWidth;
          row.classList.add("is-motion-enter");
          setTimeout(() => row.classList.remove("is-motion-enter"), 440);
        }
      });
      observer.observe(list, { subtree: true, attributes: true, attributeFilter: ["class"] });
    }

    const welcome = $("#welcome");
    if (welcome) {
      const sync = () => document.body.classList.toggle("library-overview-open", !welcome.classList.contains("is-hidden"));
      new MutationObserver(sync).observe(welcome, { attributes: true, attributeFilter: ["class"] });
      sync();
    }
  }

  function applyEntryMotion() {
    const direction = sessionStorage.getItem("melodio-album-entry");
    if (!direction) return;
    sessionStorage.removeItem("melodio-album-entry");
    document.body.dataset.albumSwitchDirection = direction;
    document.body.classList.add("is-album-entering");
    requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.add("is-album-entering-ready")));
    setTimeout(() => document.body.classList.remove("is-album-entering", "is-album-entering-ready"), 520);
  }

  async function init() {
    installOverviewInterceptors();
    installMotionPolish();
    applyEntryMotion();
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
