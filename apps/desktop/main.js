// Focus desktop app (Windows, Mac, Linux)
// Opens the live Focus website so the app always has the latest version.
// If there's no internet on the very first launch, it opens the copy of the app bundled inside.
const { app, BrowserWindow, shell, Menu } = require("electron");
const path = require("path");

const LIVE_URL = "https://lamichhaneanish26-s.github.io/focus-app-v2/";
const BUNDLED = path.join(__dirname, "web", "index.html");

function createWindow() {
  const win = new BrowserWindow({
    width: 1240,
    height: 860,
    minWidth: 380,
    minHeight: 600,
    title: "Focus",
    backgroundColor: "#e5f3e7",
    icon: path.join(__dirname, "build", "icon.png"),
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  let usedFallback = false;
  win.webContents.on("did-fail-load", (_event, code, _desc, url, isMainFrame) => {
    // -3 = navigation aborted (normal when the page redirects); ignore it
    if (!isMainFrame || code === -3 || usedFallback || url.startsWith("file:")) return;
    usedFallback = true;
    win.loadFile(BUNDLED);
  });

  // Links to other websites open in the normal browser, not inside the app
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(LIVE_URL) && !url.startsWith("file:")) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  win.loadURL(LIVE_URL).catch(() => { /* handled by did-fail-load */ });
}

// A simple menu: keeps copy/paste and reload, hides developer clutter
const isMac = process.platform === "darwin";
Menu.setApplicationMenu(Menu.buildFromTemplate([
  ...(isMac ? [{ role: "appMenu" }] : []),
  { role: "editMenu" },
  { label: "View", submenu: [{ role: "reload" }, { role: "togglefullscreen" }, { type: "separator" }, { role: "zoomIn" }, { role: "zoomOut" }, { role: "resetZoom" }] },
  { role: "windowMenu" }
]));

app.setAppUserModelId("io.github.lamichhaneanish26s.focus"); // makes Windows notifications show the app name

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (!isMac) app.quit();
});
