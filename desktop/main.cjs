"use strict";

const path = require("node:path");
const { pathToFileURL } = require("node:url");

const APP_URL = "https://nav.xianran.de/";
const APP_ORIGIN = new URL(APP_URL).origin;
const OFFLINE_FILE = path.join(__dirname, "offline.html");
const OFFLINE_URL = pathToFileURL(OFFLINE_FILE).href;

function parseUrl(value) {
  try {
    return new URL(String(value || ""));
  } catch (_) {
    return null;
  }
}

function isTrustedAppUrl(value) {
  const url = parseUrl(value);
  return Boolean(url && url.protocol === "https:" && url.origin === APP_ORIGIN);
}

function isSafeExternalUrl(value) {
  const url = parseUrl(value);
  return Boolean(url && (url.protocol === "https:" || url.protocol === "http:") && !isTrustedAppUrl(url.href));
}

function startElectron() {
  const { app, BrowserWindow, Menu, nativeTheme, session, shell } = require("electron");

  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  let mainWindow = null;

  function openExternal(url) {
    if (!isSafeExternalUrl(url)) return;
    shell.openExternal(url).catch(() => {});
  }

  function createWindow() {
    let showingOfflinePage = false;
    mainWindow = new BrowserWindow({
      width: 1440,
      height: 900,
      minWidth: 960,
      minHeight: 640,
      show: false,
      title: "闲然导航",
      backgroundColor: "#06142d",
      autoHideMenuBar: process.platform !== "darwin",
      icon: path.join(__dirname, "../assets/icons/astral-app-icon.png"),
      webPreferences: {
        nodeIntegration: false,
        nodeIntegrationInWorker: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        webviewTag: false,
        devTools: !app.isPackaged,
      },
    });

    mainWindow.once("ready-to-show", () => mainWindow?.show());

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (isTrustedAppUrl(url)) {
        showingOfflinePage = false;
        mainWindow?.loadURL(url);
      } else openExternal(url);
      return { action: "deny" };
    });

    mainWindow.webContents.on("will-navigate", (event, url) => {
      if (isTrustedAppUrl(url)) {
        showingOfflinePage = false;
        return;
      }
      if (url === OFFLINE_URL) return;
      event.preventDefault();
      openExternal(url);
    });

    mainWindow.webContents.on("will-attach-webview", (event) => event.preventDefault());

    mainWindow.webContents.on("did-fail-load", (_event, errorCode, _description, url, isMainFrame) => {
      if (!isMainFrame || errorCode === -3 || showingOfflinePage || !isTrustedAppUrl(url)) return;
      showingOfflinePage = true;
      mainWindow?.loadFile(OFFLINE_FILE).catch(() => {});
    });

    mainWindow.webContents.on("did-finish-load", () => {
      const currentUrl = mainWindow?.webContents.getURL() || "";
      if (isTrustedAppUrl(currentUrl)) showingOfflinePage = false;
    });

    mainWindow.on("closed", () => {
      mainWindow = null;
    });

    mainWindow.loadURL(APP_URL).catch(() => {});
  }

  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.on("web-contents-created", (_event, contents) => {
    contents.on("will-attach-webview", (event) => event.preventDefault());
  });

  app.whenReady().then(() => {
    app.setAppUserModelId("de.xianran.nav");
    nativeTheme.themeSource = "system";

    session.defaultSession.setPermissionCheckHandler(() => false);
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));

    if (process.platform !== "darwin") Menu.setApplicationMenu(null);
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}

if (require.main === module) startElectron();

module.exports = {
  APP_ORIGIN,
  APP_URL,
  isSafeExternalUrl,
  isTrustedAppUrl,
};
