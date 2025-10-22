# Image Viewer Pro

Professional image viewer with EXR support, built with Electron and Python backend.

## Features

- 🖼️ Support for multiple image formats (JPG, PNG, GIF, BMP, TIFF, WebP, EXR, HDR)
- 🔍 High-quality thumbnail generation
- 📁 Recursive folder scanning
- ⚡ Fast image processing with OpenCV
- 🎨 Modern, responsive UI
- 🐍 Automatic Python virtual environment detection

## Quick Start

### Option 1: Automatic Setup (Recommended)

```bash
# Clone and setup
cd image-viewer-pro
npm install
npm run setup

# Start the application
npm start
```

### Option 2: Manual Setup

1. **Install Node.js dependencies:**
   ```bash
   npm install
   ```

2. **Create Python virtual environment:**
   ```bash
   python -m venv .venv
   ```

3. **Activate virtual environment:**
   - Windows: `.venv\Scripts\activate`
   - macOS/Linux: `source .venv/bin/activate`

4. **Install Python dependencies:**
   ```bash
   pip install -r src/backend/requirements.txt
   ```

5. **Start the application:**
   ```bash
   npm start
   ```

### Option 3: Using Convenience Scripts

- **Windows Batch:** Double-click `start.bat`
- **PowerShell:** `.\start.ps1`

## How It Works

The application automatically detects and uses your Python virtual environment:

1. **Virtual Environment Detection:** Looks for `.venv` folder in project root
2. **Automatic Fallback:** Uses system Python if virtual environment not found
3. **Backend Startup:** Launches FastAPI server with image processing capabilities
4. **Frontend Connection:** Electron app connects to Python backend via HTTP

## Project Structure

```
image-viewer-pro/
├── src/
│   ├── main/           # Electron main process
│   ├── renderer/       # Frontend (HTML/CSS/JS)
│   └── backend/        # Python FastAPI server
├── scripts/            # Setup and utility scripts
├── .venv/             # Python virtual environment
├── start.bat          # Windows startup script
├── start.ps1          # PowerShell startup script
└── package.json       # Node.js configuration
```

## Development

### Running in Development Mode

```bash
npm run start:dev
```

This opens the application with developer tools enabled.

### Backend Only

To run just the Python backend:

```bash
npm run backend
```

### Building for Distribution

```bash
npm run build
```

## Troubleshooting

### Python Issues

- **"Python not found":** Install Python 3.8+ and ensure it's in your PATH
- **"Missing packages":** Run `npm run setup` or manually install requirements
- **"Backend timeout":** Check if port 8000 is available

### Virtual Environment Issues

- **Not detected:** Ensure `.venv` folder exists in project root
- **Activation fails:** Recreate virtual environment: `python -m venv .venv`

### Performance Tips

- Use virtual environment for better dependency isolation
- Close other applications using port 8000
- For large image collections, enable recursive scanning carefully

## Dependencies

### Node.js
- Electron 28.0.0
- node-fetch 3.3.2

### Python
- FastAPI 0.104.1
- Uvicorn 0.24.0
- Pillow 10.1.0
- OpenCV 4.8.1.78
- NumPy 1.24.4

## License

MIT License - see LICENSE file for details.