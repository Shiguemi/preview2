const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

// Application state
let mainWindow = null;
let backendProcess = null;
let backendReady = false;
const BACKEND_PORT = 8000;
const BACKEND_URL = `http://localhost:${BACKEND_PORT}`;

// Development mode check
const isDev = process.argv.includes('--dev');

/**
 * Create the main application window
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: true, // Keep security enabled
    },
    titleBarStyle: 'default',
    show: false, // Don't show until ready
  });

  // Remove menu bar
  Menu.setApplicationMenu(null);

  // Load the main page
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    
    if (isDev) {
      mainWindow.webContents.openDevTools();
    }
  });

  // Handle window closed
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/**
 * Get Python executable path (with virtual environment support)
 */
function getPythonExecutable() {
  const projectRoot = path.join(__dirname, '../..');
  const venvPath = path.join(projectRoot, '.venv');
  
  // Check if virtual environment exists
  if (fs.existsSync(venvPath)) {
    const venvPython = process.platform === 'win32' 
      ? path.join(venvPath, 'Scripts', 'python.exe')
      : path.join(venvPath, 'bin', 'python');
    
    if (fs.existsSync(venvPython)) {
      console.log('✅ Using virtual environment Python');
      return venvPython;
    }
  }
  
  // Fallback to system Python
  const systemPython = process.platform === 'win32' ? 'python' : 'python3';
  console.log('⚠️ Using system Python - consider setting up virtual environment');
  return systemPython;
}

/**
 * Start the Python backend server
 */
async function startBackend() {
  return new Promise((resolve, reject) => {
    console.log('Starting Python backend...');
    
    const backendPath = path.join(__dirname, '../backend/server.py');
    const pythonCmd = getPythonExecutable();
    
    backendProcess = spawn(pythonCmd, [backendPath, BACKEND_PORT.toString()], {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: path.join(__dirname, '../backend')
    });

    // Also try HTTP health check as fallback
    const healthCheckInterval = setInterval(async () => {
      try {
        const response = await fetch(`${BACKEND_URL}/health`);
        if (response.ok && !backendStarted) {
          backendStarted = true;
          clearTimeout(startupTimeout);
          clearInterval(healthCheckInterval);
          backendReady = true;
          console.log('✅ Backend ready via health check!');
          resolve();
        }
      } catch (error) {
        // Health check failed, continue waiting
      }
    }, 1000);

    let startupTimeout = setTimeout(() => {
      clearInterval(healthCheckInterval);
      reject(new Error('Backend startup timeout'));
    }, 15000); // Reduced timeout

    let backendStarted = false;
    
    const checkBackendReady = (source, output) => {
      if (backendStarted) return;
      
      if (output.includes('Server started') || 
          output.includes('Uvicorn running on') || 
          output.includes('Application startup complete')) {
        backendStarted = true;
        clearTimeout(startupTimeout);
        backendReady = true;
        console.log('✅ Backend ready!');
        resolve();
      }
    };

    backendProcess.stdout.on('data', (data) => {
      const output = data.toString();
      console.log('[Backend]', output.trim());
      checkBackendReady('stdout', output);
    });

    backendProcess.stderr.on('data', (data) => {
      const output = data.toString();
      console.log('[Backend Error]', output.trim());
      checkBackendReady('stderr', output);
    });

    backendProcess.on('error', (error) => {
      clearTimeout(startupTimeout);
      console.error('Failed to start backend:', error);
      reject(error);
    });

    backendProcess.on('exit', (code) => {
      console.log(`Backend exited with code ${code}`);
      backendReady = false;
    });
  });
}

/**
 * Stop the Python backend server
 */
function stopBackend() {
  if (backendProcess) {
    console.log('Stopping Python backend...');
    backendProcess.kill();
    backendProcess = null;
    backendReady = false;
  }
}

/**
 * Make HTTP request to backend
 */
async function backendRequest(endpoint, options = {}) {
  if (!backendReady) {
    throw new Error('Backend not ready');
  }

  const url = `${BACKEND_URL}${endpoint}`;
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    },
    ...options
  });

  if (!response.ok) {
    throw new Error(`Backend request failed: ${response.status}`);
  }

  return response.json();
}

// App event handlers
app.whenReady().then(async () => {
  try {
    // Start backend first
    await startBackend();
    
    // Then create window
    createWindow();
    
    // Notify renderer that backend is ready
    if (mainWindow) {
      mainWindow.webContents.send('backend-ready');
    }
  } catch (error) {
    console.error('Failed to start application:', error);
    
    // Show error dialog
    if (mainWindow) {
      dialog.showErrorBox('Startup Error', 
        'Failed to start the image processing backend. Please ensure Python is installed.');
    }
    
    app.quit();
  }
});

app.on('window-all-closed', () => {
  stopBackend();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', () => {
  stopBackend();
});

// IPC Handlers
ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select Image Folder'
  });

  if (result.canceled) {
    return null;
  }

  return result.filePaths[0];
});

ipcMain.handle('scan-folder', async (event, folderPath, recursive = false) => {
  try {
    const response = await backendRequest('/scan-folder', {
      method: 'POST',
      body: JSON.stringify({
        folder_path: folderPath,
        recursive: recursive
      })
    });
    
    return response;
  } catch (error) {
    console.error('Folder scan failed:', error);
    throw error;
  }
});

ipcMain.handle('get-thumbnail-binary', async (event, imagePath, size = 200) => {
  try {
    const url = `${BACKEND_URL}/thumbnail-binary`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        image_path: imagePath,
        size: size
      })
    });

    if (!response.ok) {
      throw new Error(`Backend request failed: ${response.status}`);
    }

    // Get image dimensions from headers
    const width = parseInt(response.headers.get('X-Image-Width') || '0');
    const height = parseInt(response.headers.get('X-Image-Height') || '0');
    
    // Get binary data
    const arrayBuffer = await response.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    
    return {
      success: true,
      binary_data: uint8Array,
      width: width,
      height: height
    };
  } catch (error) {
    console.error('Binary thumbnail generation failed:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

ipcMain.handle('get-thumbnail', async (event, imagePath, size = 200) => {
  try {
    const response = await backendRequest('/thumbnail', {
      method: 'POST',
      body: JSON.stringify({
        image_path: imagePath,
        size: size
      })
    });
    
    return response;
  } catch (error) {
    console.error('Thumbnail generation failed:', error);
    throw error;
  }
});

ipcMain.handle('get-image-info', async (event, imagePath) => {
  try {
    const response = await backendRequest('/image-info', {
      method: 'POST',
      body: JSON.stringify({
        image_path: imagePath
      })
    });
    
    return response;
  } catch (error) {
    console.error('Image info failed:', error);
    throw error;
  }
});

ipcMain.handle('get-batch-thumbnails', async (event, imagePaths, size = 200) => {
  try {
    const response = await backendRequest('/batch-thumbnails', {
      method: 'POST',
      body: JSON.stringify({
        image_paths: imagePaths,
        size: size
      })
    });
    
    return response;
  } catch (error) {
    console.error('Batch thumbnail generation failed:', error);
    throw error;
  }
});

ipcMain.handle('get-full-image', async (event, imagePath, maxSize = 2048) => {
  try {
    const response = await backendRequest('/full-image', {
      method: 'POST',
      body: JSON.stringify({
        image_path: imagePath,
        max_size: maxSize
      })
    });
    
    return response;
  } catch (error) {
    console.error('Full image loading failed:', error);
    throw error;
  }
});

// Export for testing
module.exports = {
  createWindow,
  startBackend,
  stopBackend,
  backendRequest
};