const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Folder operations
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  scanFolder: (folderPath, recursive) => ipcRenderer.invoke('scan-folder', folderPath, recursive),
  
  // Image operations
  getThumbnail: (imagePath, size) => ipcRenderer.invoke('get-thumbnail', imagePath, size),
  getThumbnailBinary: (imagePath, size) => ipcRenderer.invoke('get-thumbnail-binary', imagePath, size),
  getBatchThumbnails: (imagePaths, size) => ipcRenderer.invoke('get-batch-thumbnails', imagePaths, size),
  getImageInfo: (imagePath) => ipcRenderer.invoke('get-image-info', imagePath),
  getFullImage: (imagePath, maxSize) => ipcRenderer.invoke('get-full-image', imagePath, maxSize),
  
  // Event listeners
  onBackendReady: (callback) => ipcRenderer.on('backend-ready', callback),
  onScanProgress: (callback) => ipcRenderer.on('scan-progress', (event, data) => callback(data)),
  
  // Utility
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel)
});