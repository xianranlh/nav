/* 闲然导航 · PWA 安装入口
 * Chromium 有原生安装事件时直接唤起；iOS/Safari 等平台展示对应的手动安装方法。
 */
(function () {
  "use strict";

  const button = document.getElementById("btn-install-app");
  const dialog = document.getElementById("dialog-install-app");
  const steps = document.getElementById("install-app-steps");
  if (!button || !dialog || !steps) return;

  let installPrompt = null;

  function isStandalone() {
    return window.matchMedia?.("(display-mode: standalone)").matches ||
      window.navigator.standalone === true;
  }

  function canOfferInstall() {
    return location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1";
  }

  function manualGuide() {
    const ua = navigator.userAgent || "";
    const isIos = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const isAndroid = /Android/i.test(ua);
    const isSafari = /Safari/i.test(ua) && !/Chrome|CriOS|Edg|OPR|Firefox|FxiOS/i.test(ua);

    if (isIos) {
      return "<p><strong>在 iPhone / iPad 上：</strong></p><ol><li>请使用 Safari 打开本页。</li><li>点底部的“分享”按钮。</li><li>选择“添加到主屏幕”，再点“添加”。</li></ol>";
    }
    if (isAndroid) {
      return "<p><strong>在 Android 上：</strong></p><ol><li>打开浏览器菜单。</li><li>选择“安装应用”或“添加到主屏幕”。</li><li>确认安装。</li></ol>";
    }
    if (isSafari) {
      return "<p><strong>在 macOS Safari 上：</strong></p><ol><li>打开菜单栏“文件”。</li><li>选择“添加到程序坞”。</li><li>确认名称并添加。</li></ol>";
    }
    return "<p><strong>在电脑浏览器上：</strong></p><ol><li>点击地址栏右侧的安装图标。</li><li>若没有图标，请打开浏览器菜单，选择“安装闲然导航”。</li><li>确认安装。</li></ol>";
  }

  function refreshButton() {
    button.hidden = isStandalone() || !canOfferInstall();
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    refreshButton();
  });

  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    button.hidden = true;
    window.toast?.("闲然导航已安装，可从桌面或主屏幕打开");
  });

  window.matchMedia?.("(display-mode: standalone)").addEventListener?.("change", refreshButton);

  button.addEventListener("click", async () => {
    if (installPrompt) {
      const prompt = installPrompt;
      installPrompt = null;
      await prompt.prompt();
      const choice = await prompt.userChoice.catch(() => null);
      if (choice?.outcome === "accepted") button.hidden = true;
      return;
    }
    steps.innerHTML = manualGuide();
    if (window.Dlg?.open) window.Dlg.open(dialog);
    else dialog.showModal();
  });

  refreshButton();
})();
