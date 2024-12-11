const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const net = require('net')
const Store = require('electron-store')

// 初始化 store
const store = new Store({
  name: 'port-forwarding-rules',
  defaults: {
    forwardings: []
  }
});

let mainWindow
const forwardingServers = new Map()

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: true,
      preload: path.join(__dirname, 'preload.js')
    },
    show: false,
    backgroundColor: '#fff',
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
    if (process.env.NODE_ENV === 'development') {
      mainWindow.webContents.openDevTools()
    }
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.webContents.setWindowOpenHandler(() => {
    return { action: 'deny' }
  })
}

// 确保只创建一个窗口
app.whenReady().then(() => {
  createWindow()
})

// 防止重复启动应用
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

// 创建一个辅助函数来启动转发
const startForwarding = (params, event = null) => {
  const { remoteHost, remotePort, localPort } = params;
  const id = `${remoteHost}:${remotePort}->${localPort}`;
  
  // 检查是否已经存在这个转发规则
  const forwardings = store.get('forwardings');
  const existingRule = forwardings.find(f => f.id === id);
  
  if (!existingRule) {
    const newForwarding = {
      id,
      remoteHost,
      remotePort,
      localPort,
      status: 'stopped',
      createdAt: new Date().toISOString()
    };
    store.set('forwardings', [...forwardings, newForwarding]);
  }

  if (forwardingServers.has(id)) {
    console.log(`转发规则已经在运行: ${id}`);
    return;
  }

  const server = net.createServer((socket) => {
    if (!server.clients) {
      server.clients = new Set();
    }
    server.clients.add(socket);

    console.log(`新的连接请求: ${localPort} -> ${remoteHost}:${remotePort}`);
    
    const client = net.createConnection({
      host: remoteHost,
      port: parseInt(remotePort),
      timeout: 5000
    }, () => {
      console.log('成功连接到远程服务器');
      socket.pipe(client);
      client.pipe(socket);
    });

    const cleanup = () => {
      if (server.clients) {
        server.clients.delete(socket);
      }
      try {
        socket.destroy();
        client.destroy();
      } catch (err) {
        console.error('清理连接时出错:', err);
      }
    };

    client.on('error', (err) => {
      console.error('远程连接错误:', err);
      cleanup();
      if (event) {
        event.reply('forwarding-status', {
          id: id,
          status: 'error',
          error: `连接错误: ${err.message} (${err.code})`
        });
      }
    });

    client.on('timeout', () => {
      console.error('连接超时');
      cleanup();
    });

    socket.on('error', (err) => {
      console.error('本地连接错误:', err);
      cleanup();
    });

    socket.on('end', cleanup);
    client.on('end', cleanup);
    socket.on('close', cleanup);
    client.on('close', cleanup);
  });

  server.on('error', (err) => {
    console.error('服务器错误:', err);
    if (event) {
      event.reply('forwarding-status', {
        id,
        status: 'error',
        error: err.message
      });
    }
    
    const currentForwardings = store.get('forwardings');
    const updatedForwardings = currentForwardings.map(f => 
      f.id === id ? { ...f, status: 'error', error: err.message } : f
    );
    store.set('forwardings', updatedForwardings);
  });

  try {
    server.listen(parseInt(localPort), '0.0.0.0', () => {
      console.log(`转发服务启动: ${localPort} -> ${remoteHost}:${remotePort}`);
      
      const currentForwardings = store.get('forwardings');
      const updatedForwardings = currentForwardings.map(f => 
        f.id === id ? { ...f, status: 'running', error: null } : f
      );
      store.set('forwardings', updatedForwardings);
      
      if (event) {
        event.reply('forwarding-status', {
          id,
          status: 'running'
        });
        event.reply('forwarding-rules-updated', updatedForwardings);
      }
    });

    forwardingServers.set(id, server);
  } catch (err) {
    console.error('启动服务器失败:', err);
    
    const currentForwardings = store.get('forwardings');
    const updatedForwardings = currentForwardings.map(f => 
      f.id === id ? { ...f, status: 'error', error: err.message } : f
    );
    store.set('forwardings', updatedForwardings);
    
    if (event) {
      event.reply('forwarding-status', {
        id,
        status: 'error',
        error: err.message
      });
      event.reply('forwarding-rules-updated', updatedForwardings);
    }
  }
};

// 修改 start-forwarding 事件处理
ipcMain.on('start-forwarding', (event, params) => {
  startForwarding(params, event);
});

// 停止转发
ipcMain.on('stop-forwarding', (event, id) => {
  const server = forwardingServers.get(id);
  if (server) {
    try {
      // 关闭所有现有连接
      server.clients?.forEach(client => {
        try {
          client.destroy();
        } catch (err) {
          console.error('关闭客户端连接失败:', err);
        }
      });

      // 强制关闭服务器
      server.close();
      server.unref();

      const forwardings = store.get('forwardings');
      const updatedForwardings = forwardings.map(f => 
        f.id === id ? { ...f, status: 'stopped', error: null } : f
      );
      store.set('forwardings', updatedForwardings);

      console.log(`停止转发: ${id}`);
      event.reply('forwarding-status', {
        id: id,
        status: 'stopped'
      });
      event.reply('forwarding-rules-updated', updatedForwardings);

      // 从 Map 中移除服务器引用
      forwardingServers.delete(id);
    } catch (err) {
      console.error('停止服务器时出错:', err);
      event.reply('forwarding-status', {
        id: id,
        status: 'error',
        error: `停���失败: ${err.message}`
      });
    }
  }
});

// 获取所有规则
ipcMain.handle('get-forwarding-rules', () => {
  return store.get('forwardings');
});

// 删除规则
ipcMain.on('delete-forwarding', (event, id) => {
  const forwardings = store.get('forwardings');
  const updatedForwardings = forwardings.filter(f => f.id !== id);
  store.set('forwardings', updatedForwardings);
  
  const server = forwardingServers.get(id);
  if (server) {
    server.close();
    forwardingServers.delete(id);
  }
  
  event.reply('forwarding-rules-updated', updatedForwardings);
});

// 编辑规则
ipcMain.on('edit-forwarding', (event, { oldId, newRule }) => {
  const forwardings = store.get('forwardings');
  const updatedForwardings = forwardings.map(f => 
    f.id === oldId ? { ...newRule } : f
  );
  
  store.set('forwardings', updatedForwardings);
  
  const server = forwardingServers.get(oldId);
  if (server) {
    server.close();
    forwardingServers.delete(oldId);
  }
  
  event.reply('forwarding-rules-updated', updatedForwardings);
});

// 修改应用启动时的自动启动逻辑
app.whenReady().then(() => {
  createWindow();
  
  const forwardings = store.get('forwardings');
  forwardings.forEach(rule => {
    if (rule.status === 'running') {
      startForwarding({
        remoteHost: rule.remoteHost,
        remotePort: rule.remotePort,
        localPort: rule.localPort
      });
    }
  });
});