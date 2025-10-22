/**
 * Gallery Component
 * Handles the thumbnail grid display and interactions
 */

class Gallery {
    constructor(app) {
        this.app = app;
        this.container = document.getElementById('gallery');
        this.thumbnailSize = 200;
        this.loadingThumbnails = new Set();
        
        this.init();
    }

    init() {
        this.setupThumbnailSizeControl();
        this.setupIntersectionObserver();
    }

    setupThumbnailSizeControl() {
        const sizeSlider = document.getElementById('thumbnail-size');
        const sizeValue = document.getElementById('size-value');
        
        sizeSlider.addEventListener('input', (e) => {
            this.thumbnailSize = parseInt(e.target.value);
            sizeValue.textContent = `${this.thumbnailSize}px`;
            this.updateThumbnailSize();
        });
    }

    setupIntersectionObserver() {
        this.observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const item = entry.target;
                    const imagePath = item.dataset.imagePath;
                    
                    if (imagePath && !this.loadingThumbnails.has(imagePath)) {
                        this.loadThumbnail(item, imagePath);
                        this.observer.unobserve(item);
                    }
                }
            });
        }, {
            rootMargin: '100px',
            threshold: 0.1
        });
    }

    render(images) {
        console.log(`🖼️ Rendering gallery with ${images.length} images`);
        
        // Clear existing content
        this.container.innerHTML = '';
        
        if (images.length === 0) {
            return;
        }

        // Create gallery items
        images.forEach((image, index) => {
            const item = this.createGalleryItem(image, index);
            this.container.appendChild(item);
            
            // Start observing for lazy loading
            this.observer.observe(item);
        });

        // Update grid layout
        this.updateThumbnailSize();
        
        // Show gallery
        this.container.classList.remove('hidden');
    }

    createGalleryItem(image, index) {
        const item = document.createElement('div');
        item.className = 'gallery-item loading';
        item.dataset.imagePath = image.path;
        item.dataset.imageIndex = index;
        
        // Create thumbnail container
        const thumbnailContainer = document.createElement('div');
        thumbnailContainer.className = 'gallery-item-thumbnail';
        
        // Create loading spinner
        const spinner = document.createElement('div');
        spinner.className = 'spinner';
        thumbnailContainer.appendChild(spinner);
        
        // Create image element (hidden initially)
        const img = document.createElement('img');
        img.style.display = 'none';
        img.alt = image.name;
        thumbnailContainer.appendChild(img);
        
        item.appendChild(thumbnailContainer);
        
        // Create info section
        const info = document.createElement('div');
        info.className = 'gallery-item-info';
        
        const name = document.createElement('div');
        name.className = 'gallery-item-name';
        name.textContent = image.name;
        name.title = image.name;
        
        const details = document.createElement('div');
        details.className = 'gallery-item-details';
        
        const size = this.formatFileSize(image.size);
        const type = image.extension.toUpperCase().substring(1);
        
        details.innerHTML = `<span>${type}</span><span>${size}</span>`;
        
        info.appendChild(name);
        info.appendChild(details);
        item.appendChild(info);
        
        // Add click handler
        item.addEventListener('click', () => {
            if (this.app.viewer) {
                this.app.viewer.open(index);
            }
        });
        
        return item;
    }

    async loadThumbnail(item, imagePath) {
        if (this.loadingThumbnails.has(imagePath)) {
            return;
        }
        
        this.loadingThumbnails.add(imagePath);
        
        try {
            console.log(`🔄 Loading thumbnail: ${imagePath}`);
            
            const result = await window.electronAPI.getThumbnail(imagePath, this.thumbnailSize);
            
            if (result.success && result.data_url) {
                const img = item.querySelector('img');
                const spinner = item.querySelector('.spinner');
                
                img.onload = () => {
                    spinner.remove();
                    img.style.display = 'block';
                    item.classList.remove('loading');
                    console.log(`✅ Thumbnail loaded: ${imagePath}`);
                };
                
                img.onerror = () => {
                    this.handleThumbnailError(item, 'Failed to display thumbnail');
                };
                
                img.src = result.data_url;
            } else {
                this.handleThumbnailError(item, result.error || 'Failed to generate thumbnail');
            }
            
        } catch (error) {
            console.error(`❌ Thumbnail error for ${imagePath}:`, error);
            this.handleThumbnailError(item, error.message);
        } finally {
            this.loadingThumbnails.delete(imagePath);
        }
    }

    handleThumbnailError(item, errorMessage) {
        const spinner = item.querySelector('.spinner');
        if (spinner) {
            spinner.remove();
        }
        
        item.classList.remove('loading');
        item.classList.add('error');
        
        console.error(`💥 Thumbnail error: ${errorMessage}`);
    }

    updateThumbnailSize() {
        this.container.style.gridTemplateColumns = 
            `repeat(auto-fill, minmax(${this.thumbnailSize}px, 1fr))`;
        
        // Update existing thumbnails if needed
        const items = this.container.querySelectorAll('.gallery-item img');
        items.forEach(img => {
            if (img.src && !img.src.startsWith('data:')) {
                // Reload thumbnail with new size
                const item = img.closest('.gallery-item');
                const imagePath = item.dataset.imagePath;
                if (imagePath) {
                    this.loadThumbnail(item, imagePath);
                }
            }
        });
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 B';
        
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    // Public methods
    refresh() {
        const images = this.app.getCurrentImages();
        this.render(images);
    }

    clear() {
        this.container.innerHTML = '';
        this.loadingThumbnails.clear();
    }

    destroy() {
        if (this.observer) {
            this.observer.disconnect();
        }
        this.clear();
    }
}

// Export for use in other modules
window.Gallery = Gallery;