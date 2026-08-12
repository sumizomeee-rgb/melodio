(() => {
  "use strict";

  // APK WebView 由 Kotlin/Native Bridge 管理本地文件和生命周期；PWA 能力只用于普通浏览器。
  if (location.hostname === "appassets.androidplatform.net") return;

  const manifest = document.createElement("link");
  manifest.rel = "manifest";
  manifest.href = "./manifest.webmanifest";
  document.head.appendChild(manifest);

  const theme = document.createElement("meta");
  theme.name = "theme-color";
  theme.content = "#0b0b0c";
  document.head.appendChild(theme);

  const appleCapable = document.createElement("meta");
  appleCapable.name = "apple-mobile-web-app-capable";
  appleCapable.content = "yes";
  document.head.appendChild(appleCapable);

  if (!window.isSecureContext) return;

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch((error) => {
        console.warn("Melodio PWA service worker registration failed", error);
      });
    }, { once: true });
  }

  if (!("showDirectoryPicker" in window) || !("indexedDB" in window)) return;

  const DB_NAME = "melodio-pwa";
  const DB_VERSION = 1;
  const STORE_NAME = "handles";
  const LAST_ALBUM_KEY = "last-album";

  function openDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function readHandle() {
    const db = await openDb();
    try {
      return await new Promise((resolve, reject) => {
        const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(LAST_ALBUM_KEY);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  }

  async function saveHandle(handle) {
    const db = await openDb();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).put(handle, LAST_ALBUM_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }

  async function collectFiles(directoryHandle) {
    const rootName = directoryHandle.name || "UNNAMED ALBUM";
    const files = [];

    async function walk(dir, prefix) {
      for await (const entry of dir.values()) {
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.kind === "directory") {
          await walk(entry, relative);
          continue;
        }
        if (entry.kind !== "file") continue;
        const file = await entry.getFile();
        try {
          Object.defineProperty(file, "webkitRelativePath", {
            value: `${rootName}/${relative}`,
            configurable: true
          });
        } catch (_) {}
        files.push(file);
      }
    }

    await walk(directoryHandle, "");
    return files;
  }

  async function feedFolderInput(directoryHandle) {
    const input = document.getElementById("folderInput");
    if (!input) throw new Error("找不到 Melodio 文件夹输入控件");
    const files = await collectFiles(directoryHandle);
    if (!files.length) throw new Error("所选文件夹为空");

    let assigned = false;
    try {
      Object.defineProperty(input, "files", { value: files, configurable: true });
      assigned = true;
    } catch (_) {}

    if (!assigned && typeof DataTransfer === "function") {
      const transfer = new DataTransfer();
      files.forEach((file) => transfer.items.add(file));
      input.files = transfer.files;
      assigned = true;
    }
    if (!assigned) throw new Error("当前浏览器无法把目录文件交给 Melodio");

    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  async function chooseFolder() {
    const handle = await window.showDirectoryPicker({
      id: "melodio-album",
      mode: "read",
      startIn: "music"
    });
    try { await saveHandle(handle); } catch (_) {}
    await feedFolderInput(handle);
    return handle;
  }

  function installPickerInterception() {
    const targets = [document.getElementById("loadFolderBtn"), document.getElementById("welcomeFolderBtn")].filter(Boolean);
    for (const target of targets) {
      target.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        try {
          await chooseFolder();
        } catch (error) {
          if (error?.name === "AbortError") return;
          console.error("Melodio PWA folder picker failed", error);
          alert(`文件夹读取失败：${error?.message || error}`);
        }
      }, true);
    }
  }

  async function installRestoreButton() {
    let handle = null;
    try { handle = await readHandle(); } catch (_) {}
    if (!handle) return;

    const actions = document.querySelector(".welcome-actions");
    if (!actions || document.getElementById("pwaRestoreAlbumBtn")) return;

    const button = document.createElement("button");
    button.id = "pwaRestoreAlbumBtn";
    button.type = "button";
    button.className = "primary";
    button.textContent = `继续上次专辑 · ${handle.name || "已授权目录"}`;
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      button.disabled = true;
      try {
        let permission = await handle.queryPermission({ mode: "read" });
        if (permission !== "granted") permission = await handle.requestPermission({ mode: "read" });
        if (permission !== "granted") throw new Error("未获得目录读取权限");
        await feedFolderInput(handle);
        button.remove();
      } catch (error) {
        console.error("Melodio PWA restore failed", error);
        button.disabled = false;
        alert(`恢复专辑失败：${error?.message || error}`);
      }
    }, true);
    actions.prepend(button);
  }

  window.addEventListener("DOMContentLoaded", () => {
    installPickerInterception();
    installRestoreButton().catch(() => {});
  }, { once: true });
})();
