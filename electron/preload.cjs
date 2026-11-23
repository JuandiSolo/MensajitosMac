const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  onNewMessage: (callback) => {
    ipcRenderer.on('new-message', (_event, message) => callback(message));
  },
  onHideNotification: (callback) => {
    ipcRenderer.on('hide-notification', (_event) => callback());
  },
  notifyClicked: () => ipcRenderer.send('notification-clicked'),
  notifyClosed: () => ipcRenderer.send('notification-closed'),
  setIgnoreMouse: (ignore) => ipcRenderer.send('set-ignore-mouse', ignore),
  resizeOverlay: (height) => ipcRenderer.send('resize-overlay', height)
});
