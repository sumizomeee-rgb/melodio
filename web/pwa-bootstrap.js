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

  if (!window.isSecureContext || !("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch((error) => {
      console.warn("Melodio PWA service worker registration failed", error);
    });
  }, { once: true });
})();
