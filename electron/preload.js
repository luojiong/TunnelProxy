const { contextBridge, ipcRenderer } = require('electron')

process.on('uncaughtException', (error) => {
  console.error('未捕获的异常:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('未处理的 Promise 拒绝:', error);
});

contextBridge.exposeInMainWorld('electron', {
  ipcRenderer: {
    send: (channel, data) => {
      try {
        ipcRenderer.send(channel, data)
      } catch (error) {
        console.error('IPC send error:', error);
      }
    },
    on: (channel, func) => {
      try {
        const subscription = (event, ...args) => func(...args)
        ipcRenderer.on(channel, subscription)
        return () => {
          try {
            ipcRenderer.removeListener(channel, subscription)
          } catch (error) {
            console.error('IPC removeListener error:', error);
          }
        }
      } catch (error) {
        console.error('IPC on error:', error);
        return () => {};
      }
    },
    removeAllListeners: (channel) => {
      try {
        ipcRenderer.removeAllListeners(channel)
      } catch (error) {
        console.error('IPC removeAllListeners error:', error);
      }
    },
    invoke: async (channel, ...args) => {
      try {
        return await ipcRenderer.invoke(channel, ...args)
      } catch (error) {
        console.error('IPC invoke error:', error);
        return null;
      }
    }
  }
}) 