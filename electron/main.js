const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const net = require('net')
const { spawn } = require('child_process')
const fs = require('fs')
const { Client } = require('ssh2')
const Store = require('electron-store')

// 设置应用程序名称
app.setName('Port Forwarder')

// 配置应用缓存路径
app.setPath('userData', path.join(app.getPath('appData'), 'port-forwarder'))

// 初始化 store
const store = new Store({
  name: 'port-forwarding-rules',
  defaults: {
    forwardings: []
  }
});

let mainWindow
const forwardingServers = new Map()
const reverseSshProcesses = new Map()
const sshClients = new Map()

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: true,
      preload: path.join(__dirname, 'preload.js'),
      // 添加缓存配置
      partition: 'persist:main'
    },
    show: false,
    backgroundColor: '#fff',
  })

  // 配置 session
  const ses = mainWindow.webContents.session
  ses.clearCache()
    .then(() => {
      console.log('清除缓存成功');
    })
    .catch(err => {
      console.error('清除缓存失败:', err);
    });

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

// 在应用准备好时进行清理
app.whenReady().then(() => {
  // 清理旧的缓存
  try {
    const ses = require('electron').session;
    ses.defaultSession.clearCache()
      .then(() => {
        console.log('清除默认会话缓存成功');
      })
      .catch(err => {
        console.error('清除默认会话缓存失败:', err);
      });
  } catch (error) {
    console.error('清理缓存出错:', error);
  }

  createWindow();
  
  const forwardings = store.get('forwardings');
  forwardings.forEach(rule => {
    if (rule.status === 'running') {
      const type = rule.type || 'forward'
      if (type === 'reverse-ssh') {
        startReverseSSH({
          sshHost: rule.sshHost,
          sshPort: rule.sshPort,
          sshUser: rule.sshUser,
          sshPassword: rule.sshPassword,
          authType: rule.authType,
          keyPath: rule.keyPath,
          remoteBindHost: rule.remoteBindHost,
          remotePort: rule.remotePort,
          localPort: rule.localPort,
          id: rule.id
        })
      } else {
        startForwarding({
          remoteHost: rule.remoteHost,
          remotePort: rule.remotePort,
          localPort: rule.localPort
        });
      }
    }
  });
});

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

const safeReply = (event, channel, data) => {
  try {
    if (!event.sender.isDestroyed()) {
      event.reply(channel, data);
    }
  } catch (error) {
    console.error('回复消息失败:', error);
  }
};

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
      type: 'forward',
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
        safeReply(event, 'forwarding-status', {
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
      safeReply(event, 'forwarding-status', {
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
        safeReply(event, 'forwarding-status', {
          id,
          status: 'running'
        });
        safeReply(event, 'forwarding-rules-updated', updatedForwardings);
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
      safeReply(event, 'forwarding-status', {
        id,
        status: 'error',
        error: err.message
      });
      safeReply(event, 'forwarding-rules-updated', updatedForwardings);
    }
  }
};

// 基于 ssh2 库的反向端口转发，支持密码认证
const startReverseSSH = (params, event = null) => {
  const {
    sshHost,
    sshPort = 22,
    sshUser,
    sshPassword,
    authType = 'password',
    keyPath,
    remoteBindHost = '127.0.0.1',
    remotePort,
    localPort,
    id: customId
  } = params

  const id = customId || `${sshHost}:${remotePort}<-${localPort}`

  // 持久化规则
  const forwardings = store.get('forwardings');
  const existingRule = forwardings.find(f => f.id === id);
  if (!existingRule) {
    const newRule = {
      id,
      type: 'reverse-ssh',
      sshHost,
      sshPort,
      sshUser,
      sshPassword,
      authType,
      keyPath: keyPath || null,
      remoteBindHost,
      remotePort,
      localPort,
      status: 'stopped',
      createdAt: new Date().toISOString()
    }
    store.set('forwardings', [...forwardings, newRule])
  }

  if (sshClients.has(id)) {
    console.log(`反向 SSH 已在运行: ${id}`)
    return
  }

  const updateStatus = (status, error) => {
    const current = store.get('forwardings')
    const updated = current.map(f => f.id === id ? { ...f, status, error: error || null } : f)
    store.set('forwardings', updated)
    if (event) {
      safeReply(event, 'forwarding-status', { id, status, error })
      safeReply(event, 'forwarding-rules-updated', updated)
    }
  }

  const conn = new Client()
  sshClients.set(id, conn)

  console.log(`启动反向 SSH: ${sshUser}@${sshHost}:${sshPort} -> ${remoteBindHost}:${remotePort}<-127.0.0.1:${localPort}`)

  conn.on('ready', () => {
    console.log(`SSH 连接已建立: ${id}`)
    
    // 建立反向端口转发
    conn.forwardIn(remoteBindHost, remotePort, (err) => {
      if (err) {
        console.error(`反向转发失败: ${err.message}`)
        updateStatus('error', `端口转发失败: ${err.message}`)
        conn.end()
        return
      }
      
      console.log(`反向转发已建立: ${remoteBindHost}:${remotePort} -> 127.0.0.1:${localPort}`)
      updateStatus('running')
    })
  })

  conn.on('tcp connection', (info, accept, reject) => {
    console.log(`收到反向连接请求: ${info.srcIP}:${info.srcPort}`)
    
    const stream = accept()
    const localConn = net.createConnection({
      host: '127.0.0.1',
      port: localPort
    })

    stream.on('close', () => {
      localConn.end()
    })

    localConn.on('close', () => {
      stream.end()
    })

    stream.on('error', (err) => {
      console.error(`反向流错误: ${err.message}`)
      localConn.end()
    })

    localConn.on('error', (err) => {
      console.error(`本地连接错误: ${err.message}`)
      stream.end()
    })

    // 双向数据转发
    stream.pipe(localConn)
    localConn.pipe(stream)
  })

  conn.on('error', (err) => {
    console.error(`SSH 连接错误: ${err.message}`)
    updateStatus('error', `连接失败: ${err.message}`)
    sshClients.delete(id)
  })

  conn.on('end', () => {
    console.log(`SSH 连接已断开: ${id}`)
    updateStatus('stopped')
    sshClients.delete(id)
  })

  // 连接配置
  const connConfig = {
    host: sshHost,
    port: sshPort,
    username: sshUser,
    keepaliveInterval: 60000,
    keepaliveCountMax: 3,
  }

  if (authType === 'password' && sshPassword) {
    connConfig.password = sshPassword
  } else if (authType === 'key' && keyPath && fs.existsSync(keyPath)) {
    connConfig.privateKey = fs.readFileSync(keyPath)
  } else {
    updateStatus('error', '缺少认证信息：请提供密码或密钥文件')
    return
  }

  // 建立连接
  conn.connect(connConfig)
}

// 修改 start-forwarding 事件处理
ipcMain.on('start-forwarding', (event, params) => {
  try {
    startForwarding(params, event);
  } catch (error) {
    console.error('启动转发失败:', error);
    event.reply('forwarding-status', {
      id: `${params.remoteHost}:${params.remotePort}->${params.localPort}`,
      status: 'error',
      error: error.message
    });
  }
});

// 启动反向 SSH
ipcMain.on('start-reverse-ssh', (event, params) => {
  try {
    startReverseSSH(params, event)
  } catch (error) {
    console.error('启动反向 SSH 失败:', error)
    event.reply('forwarding-status', {
      id: params.id || `${params.sshHost}:${params.remotePort}<-${params.localPort}`,
      status: 'error',
      error: error.message
    })
  }
})

// 停止转发
ipcMain.on('stop-forwarding', (event, id) => {
  try {
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
          error: `停止失败: ${err.message}`
        });
      }
    }
  } catch (error) {
    console.error('停止转发失败:', error);
    event.reply('forwarding-status', {
      id,
      status: 'error',
      error: error.message
    });
  }
});

// 停止反向 SSH
ipcMain.on('stop-reverse-ssh', (event, id) => {
  try {
    const client = sshClients.get(id)
    if (client) {
      try {
        client.end()
      } catch (e) {
        console.error('关闭 SSH 连接失败:', e)
      }
      sshClients.delete(id)

      const forwardings = store.get('forwardings');
      const updated = forwardings.map(f => 
        f.id === id ? { ...f, status: 'stopped', error: null } : f
      );
      store.set('forwardings', updated);
      event.reply('forwarding-status', { id, status: 'stopped' })
      event.reply('forwarding-rules-updated', updated)
    }
  } catch (error) {
    console.error('停止反向 SSH 失败:', error)
    event.reply('forwarding-status', { id, status: 'error', error: error.message })
  }
})

// 获取所有规则
ipcMain.handle('get-forwarding-rules', () => {
  try {
    return store.get('forwardings') || [];
  } catch (error) {
    console.error('获取规则失败:', error);
    return [];
  }
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
  const client = sshClients.get(id)
  if (client) {
    try { client.end() } catch (e) {}
    sshClients.delete(id)
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
  const client = sshClients.get(oldId)
  if (client) {
    try { client.end() } catch (e) {}
    sshClients.delete(oldId)
  }
  
  event.reply('forwarding-rules-updated', updatedForwardings);
});

// 添加错误处理
app.on('render-process-gone', (event, webContents, details) => {
  console.error('渲染进程崩溃:', details);
});

app.on('child-process-gone', (event, details) => {
  console.error('子进程崩溃:', details);
});

// 在退出时进行清理
app.on('before-quit', () => {
  try {
    // 关闭所有转发服务
    for (const [id, server] of forwardingServers.entries()) {
      try {
        server.close();
        forwardingServers.delete(id);
      } catch (error) {
        console.error(`关闭服务器失败 ${id}:`, error);
      }
    }
    for (const [id, client] of sshClients.entries()) {
      try {
        client.end()
        sshClients.delete(id)
      } catch (error) {
        console.error(`关闭 SSH 连接失败 ${id}:`, error)
      }
    }
  } catch (error) {
    console.error('退出清理失败:', error);
  }
});