/**
 * Setup script for Image Viewer Pro
 * Installs Python dependencies and prepares the environment
 */

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function getPythonExecutable() {
    console.log('🐍 Checking Python installation...');
    
    const projectRoot = path.join(__dirname, '..');
    const venvPath = path.join(projectRoot, '.venv');
    
    // Check if virtual environment exists
    if (fs.existsSync(venvPath)) {
        const venvPython = process.platform === 'win32' 
            ? path.join(venvPath, 'Scripts', 'python.exe')
            : path.join(venvPath, 'bin', 'python');
        
        if (fs.existsSync(venvPython)) {
            try {
                const version = execSync(`"${venvPython}" --version`, { encoding: 'utf8' });
                console.log(`✅ Found virtual environment Python: ${version.trim()}`);
                console.log(`📁 Virtual environment: ${venvPath}`);
                return venvPython;
            } catch (error) {
                console.log('⚠️ Virtual environment Python not working, trying system Python...');
            }
        }
    }
    
    // Fallback to system Python
    const pythonCommands = ['python', 'python3', 'py'];
    
    for (const cmd of pythonCommands) {
        try {
            const version = execSync(`${cmd} --version`, { encoding: 'utf8' });
            console.log(`✅ Found system Python: ${version.trim()}`);
            return cmd;
        } catch (error) {
            // Continue to next command
        }
    }
    
    throw new Error('Python not found. Please install Python 3.8 or higher.');
}

function checkPython() {
    return getPythonExecutable();
}

function checkPip(pythonCmd) {
    console.log('📦 Checking pip...');
    
    try {
        const version = execSync(`${pythonCmd} -m pip --version`, { encoding: 'utf8' });
        console.log(`✅ Found pip: ${version.trim()}`);
        return true;
    } catch (error) {
        throw new Error('pip not found. Please ensure pip is installed.');
    }
}

function installPythonDependencies(pythonCmd) {
    return new Promise((resolve, reject) => {
        console.log('📥 Installing Python dependencies...');
        
        const requirementsPath = path.join(__dirname, '../src/backend/requirements.txt');
        
        if (!fs.existsSync(requirementsPath)) {
            reject(new Error('requirements.txt not found'));
            return;
        }
        
        const installProcess = spawn(pythonCmd, ['-m', 'pip', 'install', '-r', requirementsPath], {
            stdio: 'inherit'
        });
        
        installProcess.on('close', (code) => {
            if (code === 0) {
                console.log('✅ Python dependencies installed successfully');
                resolve();
            } else {
                reject(new Error(`pip install failed with code ${code}`));
            }
        });
        
        installProcess.on('error', (error) => {
            reject(new Error(`Failed to run pip: ${error.message}`));
        });
    });
}

function createTestImages() {
    console.log('🖼️ Creating test images...');
    
    const testDir = path.join(__dirname, '../test-images');
    
    if (!fs.existsSync(testDir)) {
        fs.mkdirSync(testDir, { recursive: true });
    }
    
    // Create a simple PNG (1x1 transparent pixel)
    const pngData = Buffer.from([
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D,
        0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
        0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4, 0x89, 0x00, 0x00, 0x00,
        0x0A, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00,
        0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00, 0x00, 0x00, 0x00, 0x49,
        0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82
    ]);
    
    // Create a simple JPEG (1x1 black pixel)
    const jpegData = Buffer.from([
        0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01,
        0x01, 0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00, 0xFF, 0xDB, 0x00, 0x43,
        0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09,
        0x09, 0x08, 0x0A, 0x0C, 0x14, 0x0D, 0x0C, 0x0B, 0x0B, 0x0C, 0x19, 0x12,
        0x13, 0x0F, 0x14, 0x1D, 0x1A, 0x1F, 0x1E, 0x1D, 0x1A, 0x1C, 0x1C, 0x20,
        0x24, 0x2E, 0x27, 0x20, 0x22, 0x2C, 0x23, 0x1C, 0x1C, 0x28, 0x37, 0x29,
        0x2C, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1F, 0x27, 0x39, 0x3D, 0x38, 0x32,
        0x3C, 0x2E, 0x33, 0x34, 0x32, 0xFF, 0xC0, 0x00, 0x11, 0x08, 0x00, 0x01,
        0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
        0xFF, 0xC4, 0x00, 0x14, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x08, 0xFF, 0xC4,
        0x00, 0x14, 0x10, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xFF, 0xDA, 0x00, 0x0C,
        0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3F, 0x00, 0x80, 0xFF, 0xD9
    ]);
    
    // Create test images
    for (let i = 1; i <= 3; i++) {
        fs.writeFileSync(path.join(testDir, `test-${i}.png`), pngData);
        fs.writeFileSync(path.join(testDir, `test-${i}.jpg`), jpegData);
    }
    
    console.log(`✅ Test images created in: ${testDir}`);
    console.log('   - 3 PNG files (67 bytes each)');
    console.log('   - 3 JPEG files (169 bytes each)');
}

async function runSetup() {
    console.log('=== Image Viewer Pro Setup ===\n');
    
    try {
        // Check Python
        const pythonCmd = checkPython();
        
        // Check pip
        checkPip(pythonCmd);
        
        // Install dependencies
        await installPythonDependencies(pythonCmd);
        
        // Create test images
        createTestImages();
        
        console.log('\n🎉 Setup completed successfully!');
        console.log('\n📋 Next steps:');
        console.log('1. Run: npm start');
        console.log('2. Select the test-images folder');
        console.log('3. Enjoy your new image viewer!');
        
    } catch (error) {
        console.error('\n❌ Setup failed:', error.message);
        console.log('\n🔧 Troubleshooting:');
        console.log('- Ensure Python 3.8+ is installed');
        console.log('- Ensure pip is available');
        console.log('- Check internet connection for package downloads');
        process.exit(1);
    }
}

// Run setup if called directly
if (require.main === module) {
    runSetup();
}

module.exports = {
    checkPython,
    checkPip,
    installPythonDependencies,
    createTestImages
};