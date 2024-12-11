const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electron', {
  ipcRenderer: {
    send: (channel, data) => {
      ipcRenderer.send(channel, data)
    },
    on: (channel, func) => {
      const subscription = (event, ...args) => func(...args)
      ipcRenderer.on(channel, subscription)
      return () => {
        ipcRenderer.removeListener(channel, subscription)
      }
    },
    removeAllListeners: (channel) => {
      ipcRenderer.removeAllListeners(channel)
    },
    invoke: (channel, ...args) => {
      return ipcRenderer.invoke(channel, ...args)
    }
  }
}) 