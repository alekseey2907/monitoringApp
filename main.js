const { app, BrowserWindow } = require('electron');
const path = require('path');
const { startServer } = require('./server/server.js');

let mainWindow;
let serverInstance;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, 'assets', 'icon.png')
  });

  mainWindow.loadFile('frontend/index.html');

  // Открыть DevTools в режиме разработки
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  // Запуск сервера для приёма данных от ESP32
  serverInstance = startServer();
  
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', async () => {
  if (process.platform !== 'darwin') {
    if (serverInstance) {
      await serverInstance.close();
    }
    app.quit();
  }
});

app.on('before-quit', async (event) => {
  if (serverInstance) {
    event.preventDefault();
    await serverInstance.close();
    serverInstance = null;
    app.quit();
  }
});
