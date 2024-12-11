const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const net = require('net');

let mainWindow;
const forwardingServers = new Map();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

ipcMain.on('start-forwarding', (event, { remoteHost, remotePort, localPort }) => {
  const server = net.createServer((socket) => {
    const client = net.createConnection({
      host: remoteHost,
      port: parseInt(remotePort)
    }, () => {
      socket.pipe(client);
      client.pipe(socket);
    });

    client.on('error', (err) => {
      console.error('远程连接错误:', err);
      socket.end();
    });
  });

  server.listen(parseInt(localPort), '127.0.0.1', () => {
    console.log(`转发服务启动: ${localPort} -> ${remoteHost}:${remotePort}`);
    event.reply('forwarding-status', {
      id: `${remoteHost}:${remotePort}->${localPort}`,
      status: 'running'
    });
  });

  forwardingServers.set(`${remoteHost}:${remotePort}->${localPort}`, server);
});

ipcMain.on('stop-forwarding', (event, id) => {
  const server = forwardingServers.get(id);
  if (server) {
    server.close(() => {
      console.log(`停止转发: ${id}`);
      event.reply('forwarding-status', {
        id: id,
        status: 'stopped'
      });
    });
    forwardingServers.delete(id);
  }
}); 