const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } = require('electron')
const path = require('path')
const net = require('net')
const { spawn } = require('child_process')
const fs = require('fs')
const { Client } = require('ssh2')
const Store = require('electron-store')

// 提前设置单实例锁，避免二次实例瞬退导致“自动退出”的错觉
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  try { app.quit() } catch (_) {}
  try { process.exit(0) } catch (_) {}
} else {
  app.on('second-instance', () => {
    try {
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore()
        mainWindow.show()
        mainWindow.focus()
      }
    } catch (e) {
      console.error('激活已有实例失败:', e)
    }
  })
}

// 主进程增加基础错误日志，避免因未捕获异常直接退出
process.on('uncaughtException', (error) => {
  try {
    console.error('主进程未捕获的异常:', error)
  } catch (_) {}
})
process.on('unhandledRejection', (reason) => {
  try {
    console.error('主进程未处理的 Promise 拒绝:', reason)
  } catch (_) {}
})

// 设置应用程序名称
app.setName('Tunnel Proxy')

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
let tray = null
const forwardingServers = new Map()
const reverseSshProcesses = new Map()
const sshClients = new Map()

// 获取资源路径的统一函数
const getResourcePath = (...pathSegments) => {
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged
  
  if (isDev) {
    // 开发环境：从 src/assets 或 resources 目录获取
    const devPath1 = path.join(__dirname, '../src/assets', ...pathSegments)
    const devPath2 = path.join(__dirname, '../resources', ...pathSegments)
    
    // 检查文件是否存在，优先使用 src/assets
    if (fs.existsSync(devPath1)) {
      return devPath1
    } else if (fs.existsSync(devPath2)) {
      return devPath2
    } else {
      // 兜底路径
      return devPath1
    }
  } else {
    // 生产环境：从 process.resourcesPath 获取
    return path.join(process.resourcesPath, ...pathSegments)
  }
}

// 创建系统托盘
const createTray = () => {
  // 获取托盘图标路径
  const getTrayIconPath = () => {
    if (process.platform === 'win32') {
      return getResourcePath('icons', '32x32.png')
    } else if (process.platform === 'darwin') {
      return getResourcePath('icons', '16x16.png')
    } else {
      return getResourcePath('icons', '32x32.png')
    }
  }

  const iconPath = getTrayIconPath()
  console.log('托盘图标路径:', iconPath)
  console.log('图标文件是否存在:', fs.existsSync(iconPath))
  
  // 创建托盘图标
  tray = new Tray(iconPath)
  
  // 设置托盘提示文本
  tray.setToolTip('Tunnel Proxy - 端口转发工具')
  
  // 创建托盘右键菜单
  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示主窗口',
      click: () => {
        if (mainWindow) {
          if (mainWindow.isMinimized()) {
            mainWindow.restore()
          }
          mainWindow.show()
          mainWindow.focus()
        }
      }
    },
    {
      label: '隐藏到托盘',
      click: () => {
        if (mainWindow) {
          mainWindow.hide()
        }
      }
    },
    { type: 'separator' },
    {
      label: '转发规则管理',
      click: () => {
        if (mainWindow) {
          mainWindow.show()
          mainWindow.focus()
        }
      }
    },
    { type: 'separator' },
    {
      label: '关于',
      click: () => {
        if (mainWindow) {
          mainWindow.webContents.executeJavaScript(`
            alert('Tunnel Proxy v${require('../package.json').version}\\n\\n一个简单易用的端口转发工具\\n支持本地转发和SSH反向转发');
          `)
          mainWindow.show()
          mainWindow.focus()
        }
      }
    },
    {
      label: '退出程序',
      click: () => {
        app.isQuiting = true
        app.quit()
      }
    }
  ])
  
  // 设置托盘菜单
  tray.setContextMenu(contextMenu)
  
  // 双击托盘图标显示主窗口
  tray.on('double-click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide()
      } else {
        mainWindow.show()
        mainWindow.focus()
      }
    }
  })
  
  // 单击托盘图标（Windows 下）
  tray.on('click', () => {
    if (process.platform === 'win32') {
      if (mainWindow) {
        if (mainWindow.isVisible()) {
          mainWindow.hide()
        } else {
          mainWindow.show()
          mainWindow.focus()
        }
      }
    }
  })
}

const createWindow = () => {
  // 获取图标路径
  const getIconPath = () => {
    if (process.platform === 'win32') {
      return getResourcePath('icons', 'icon.ico')
    } else if (process.platform === 'darwin') {
      return getResourcePath('icons', 'icon.icns')
    } else {
      return getResourcePath('icons', '512x512.png')
    }
  }

  const iconPath = getIconPath()
  console.log('主窗口图标路径:', iconPath)
  console.log('主窗口图标文件是否存在:', fs.existsSync(iconPath))

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: iconPath,
    autoHideMenuBar:true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: true,
      preload: path.join(__dirname, 'preload.js'),
      // 添加缓存配置
      partition: 'persist:main'
    },
    show: false,
    backgroundColor: '#fff',
    // 添加窗口标题
    title: 'Tunnel Proxy',
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

  // 拦截窗口关闭事件
  mainWindow.on('close', (event) => {
    if (!app.isQuiting) {
      event.preventDefault()
      mainWindow.hide()
      
      // 首次隐藏时显示提示（可选）
      if (!mainWindow.hasShownTrayNotification) {
        tray.displayBalloon({
          iconType: 'info',
          title: 'Tunnel Proxy',
          content: '应用程序已最小化到系统托盘，点击托盘图标可以重新打开'
        })
        mainWindow.hasShownTrayNotification = true
      }
      return false
    }
  })

  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged
  const devUrl = process.env.VITE_DEV_SERVER_URL || (isDev ? 'http://localhost:5173' : null)

  console.log('VITE_DEV_SERVER_URL:', process.env.VITE_DEV_SERVER_URL)
  console.log('NODE_ENV:', process.env.NODE_ENV)

  if (devUrl) {
    mainWindow.loadURL(devUrl)
    if (isDev) {
      mainWindow.webContents.openDevTools({ mode: 'detach' })
    }
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  // 页面加载成功后兜底显示
  mainWindow.webContents.on('did-finish-load', () => {
    try {
      if (!mainWindow.isVisible()) {
        mainWindow.show()
      }
    } catch (e) {
      console.error('did-finish-load 显示窗口失败:', e)
    }
  })

  // 页面加载失败时自动重试一次（开发模式）
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error('页面加载失败:', { errorCode, errorDescription, validatedURL })
    if (devUrl) {
      setTimeout(() => {
        try {
          console.log('重试加载开发服务器:', devUrl)
          mainWindow.loadURL(devUrl)
        } catch (e) {
          console.error('重试加载失败:', e)
        }
      }, 500)
    }
  })

  // 超时兜底强制显示，避免 ready-to-show 未触发导致窗口不出现
  setTimeout(() => {
    try {
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
        console.warn('超时兜底：强制显示窗口')
        mainWindow.show()
      }
    } catch (e) {
      console.error('超时兜底显示失败:', e)
    }
  }, 3000)

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

  // 创建系统托盘
  createTray();
  
  // 创建主窗口
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

// 单实例逻辑已提前处理（见文件顶部）

app.on('window-all-closed', () => {
  // 在 Windows 和 Linux 下，当所有窗口关闭时不退出应用
  // 因为我们希望应用继续在托盘中运行
  if (process.platform === 'darwin') {
    // macOS 下的标准行为：关闭窗口但保持应用运行
    return
  }
  // Windows 和 Linux 下也不退出，让应用在托盘中继续运行
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
app.on('before-quit', (event) => {
  app.isQuiting = true
  
  try {
    // 销毁托盘图标
    if (tray) {
      tray.destroy()
      tray = null
    }
    
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