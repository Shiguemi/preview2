/**
 * Main Application Controller
 * Handles initialization, backend communication, and global state
 */

class ImageViewerApp {
    constructor() {
        this.currentFolder = null;
        this.images = [];
        this.filteredImages = [];
        this.isRecursive = false;
        this.backendReady = false;
        
        this.init();
    }

    async init() {
        console.log('🚀 Initializing Image Viewer Pro...');
        
        // Initialize components
        this.initializeElements();
        this.setupEventListeners();
        this.setupBackendListeners();
        
        // Initialize other modules
        if (window.Gallery) {
            this.gallery = new window.Gallery(this);
        }
        
        if (window.ImageViewer) {
            this.viewer = new window.ImageViewer(this);
        }
        
        if (window.Filters) {
            this.filters = new window.Filters(this);
        }
        
        console.log('✅ Application initialized');
    }

    initializeElements() {
        // Header elements
        this.elements = {
            selectFolderBtn: document.getElementById('select-folder-btn'),
            recursiveToggle: document.getElementById('recursive-toggle'),
            currentFolder: document.getElementById('current-folder'),
            imageCount: document.getElementById('image-count'),
            
            // Gallery elements
            gallery: document.getElementById('gallery'),
            loadingState: document.getElementById('loading-state'),
            emptyState: document.getElementById('empty-state'),
            emptySelectBtn: document.getElementById('empty-select-btn'),
            
            // Status elements
            backendStatus: document.getElementById('backend-status'),
            statusDot: document.querySelector('.status-dot'),
            selectionInfo: document.getElementById('selection-info')
        };
    }

    setupEventListeners() {
        // Folder selection
        this.elements.selectFolderBtn.addEventListener('click', () => this.selectFolder());
        this.elements.emptySelectBtn.addEventListener('click', () => this.selectFolder());
        
        // Recursive toggle
        this.elements.recursiveToggle.addEventListener('click', () => this.toggleRecursive());
        
        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => this.handleKeyboard(e));
        
        // Window events
        window.addEventListener('beforeunload', () => this.cleanup());
    }

    setupBackendListeners() {
        // Backend ready event
        window.electronAPI.onBackendReady(() => {
            console.log('✅ Backend is ready!');
            this.backendReady = true;
            this.updateBackendStatus('ready', 'Backend: Ready');
        });
    }

    async selectFolder() {
        try {
            console.log('📁 Opening folder selection dialog...');
            
            const folderPath = await window.electronAPI.selectFolder();
            if (!folderPath) {
                console.log('❌ No folder selected');
                return;
            }
            
            console.log(`📂 Selected folder: ${folderPath}`);
            await this.loadFolder(folderPath);
            
        } catch (error) {
            console.error('❌ Error selecting folder:', error);
            this.showError('Failed to select folder: ' + error.message);
        }
    }

    async loadFolder(folderPath) {
        try {
            this.currentFolder = folderPath;
            this.updateFolderInfo();
            this.showLoading(true);
            
            console.log(`🔍 Scanning folder: ${folderPath} (recursive: ${this.isRecursive})`);
            
            const result = await window.electronAPI.scanFolder(folderPath, this.isRecursive);
            
            if (!result.success) {
                throw new Error(result.error || 'Failed to scan folder');
            }
            
            console.log(`✅ Found ${result.total_count} images`);
            
            this.images = result.images;
            this.applyFilters();
            this.showLoading(false);
            
            if (this.gallery) {
                this.gallery.render(this.filteredImages);
            }
            
        } catch (error) {
            console.error('❌ Error loading folder:', error);
            this.showError('Failed to load folder: ' + error.message);
            this.showLoading(false);
        }
    }

    toggleRecursive() {
        this.isRecursive = !this.isRecursive;
        this.elements.recursiveToggle.classList.toggle('active', this.isRecursive);
        
        console.log(`🔄 Recursive mode: ${this.isRecursive ? 'ON' : 'OFF'}`);
        
        // Reload current folder if one is selected
        if (this.currentFolder) {
            this.loadFolder(this.currentFolder);
        }
    }

    applyFilters() {
        if (this.filters) {
            this.filteredImages = this.filters.apply(this.images);
        } else {
            this.filteredImages = [...this.images];
        }
        
        this.updateImageCount();
    }

    updateFolderInfo() {
        if (this.currentFolder) {
            const folderName = this.currentFolder.split(/[\\/]/).pop();
            this.elements.currentFolder.textContent = folderName;
            this.elements.currentFolder.title = this.currentFolder;
        } else {
            this.elements.currentFolder.textContent = 'No folder selected';
            this.elements.currentFolder.title = '';
        }
    }

    updateImageCount() {
        const count = this.filteredImages.length;
        const total = this.images.length;
        
        if (count === total) {
            this.elements.imageCount.textContent = `${count} images`;
        } else {
            this.elements.imageCount.textContent = `${count} of ${total} images`;
        }
    }

    showLoading(show) {
        this.elements.loadingState.classList.toggle('hidden', !show);
        this.elements.gallery.classList.toggle('hidden', show);
        this.elements.emptyState.classList.toggle('hidden', show || this.images.length > 0);
    }

    showError(message) {
        console.error('💥 Error:', message);
        
        // You could implement a toast notification system here
        // For now, we'll just log to console and update status
        this.elements.selectionInfo.textContent = `Error: ${message}`;
        
        setTimeout(() => {
            this.elements.selectionInfo.textContent = 'Ready';
        }, 5000);
    }

    updateBackendStatus(status, message) {
        this.elements.backendStatus.textContent = message;
        this.elements.statusDot.className = `status-dot ${status}`;
    }

    handleKeyboard(event) {
        // Global keyboard shortcuts
        if (event.ctrlKey || event.metaKey) {
            switch (event.key) {
                case 'o':
                case 'O':
                    event.preventDefault();
                    this.selectFolder();
                    break;
                case 'r':
                case 'R':
                    event.preventDefault();
                    this.toggleRecursive();
                    break;
            }
        }
    }

    cleanup() {
        console.log('🧹 Cleaning up application...');
        
        // Remove event listeners
        window.electronAPI.removeAllListeners('backend-ready');
        
        // Clear any intervals or timeouts
        // (none currently, but good practice)
    }

    // Public API for other modules
    getCurrentImages() {
        return this.filteredImages;
    }

    getCurrentFolder() {
        return this.currentFolder;
    }

    isBackendReady() {
        return this.backendReady;
    }

    refreshGallery() {
        if (this.gallery) {
            this.gallery.render(this.filteredImages);
        }
    }
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.app = new ImageViewerApp();
});

// Export for other modules
window.ImageViewerApp = ImageViewerApp;