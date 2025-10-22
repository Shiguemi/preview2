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
        this.thumbnailCache = new Map(); // Cache para thumbnails
        this.maxCacheSize = 100; // Máximo de thumbnails em cache
        this.loadQueue = []; // Fila de carregamento
        this.maxConcurrentLoads = 6; // Carregamento paralelo
        this.currentLoads = 0;
        this.preloadDistance = 200; // Distância para pré-carregamento
        
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
                        this.queueThumbnailLoad(item, imagePath, 'visible');
                        this.observer.unobserve(item);
                    }
                }
            });
        }, {
            rootMargin: `${this.preloadDistance}px`,
            threshold: 0.1
        });
    }

    render(images) {
        console.log(`🖼️ Rendering gallery with ${images.length} images`);
        
        // Clear existing content
        this.container.innerHTML = '';
        this.loadQueue = [];
        this.currentLoads = 0;
        
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
        
        // Pré-carregar primeiros thumbnails imediatamente
        this.preloadInitialThumbnails(images);
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

    // Sistema de fila para carregamento paralelo
    queueThumbnailLoad(item, imagePath, priority = 'normal') {
        if (this.loadingThumbnails.has(imagePath)) {
            return;
        }
        
        // Verificar cache primeiro
        const cacheKey = `${imagePath}_${this.thumbnailSize}`;
        if (this.thumbnailCache.has(cacheKey)) {
            this.displayCachedThumbnail(item, cacheKey);
            return;
        }
        
        const loadItem = { item, imagePath, priority };
        
        if (priority === 'visible') {
            this.loadQueue.unshift(loadItem); // Prioridade alta
        } else {
            this.loadQueue.push(loadItem); // Prioridade normal
        }
        
        this.processLoadQueue();
    }
    
    async processLoadQueue() {
        if (this.currentLoads >= this.maxConcurrentLoads || this.loadQueue.length === 0) {
            return;
        }
        
        const { item, imagePath } = this.loadQueue.shift();
        this.currentLoads++;
        
        try {
            await this.loadThumbnail(item, imagePath);
        } finally {
            this.currentLoads--;
            // Processar próximo item da fila
            setTimeout(() => this.processLoadQueue(), 10);
        }
    }
    
    displayCachedThumbnail(item, cacheKey) {
        const cachedData = this.thumbnailCache.get(cacheKey);
        const img = item.querySelector('img');
        const spinner = item.querySelector('.spinner');
        
        img.onload = () => {
            if (spinner) spinner.remove();
            img.style.display = 'block';
            item.classList.remove('loading');
        };
        
        img.src = cachedData;
    }
    
    async loadThumbnail(item, imagePath) {
        if (this.loadingThumbnails.has(imagePath)) {
            return;
        }
        
        this.loadingThumbnails.add(imagePath);
        
        try {
            const result = await window.electronAPI.getThumbnail(imagePath, this.thumbnailSize);
            
            if (result.success && result.data_url) {
                // Cache do thumbnail com limite de memória
                const cacheKey = `${imagePath}_${this.thumbnailSize}`;
                this.addToCache(cacheKey, result.data_url);
                
                const img = item.querySelector('img');
                const spinner = item.querySelector('.spinner');
                
                img.onload = () => {
                    if (spinner) spinner.remove();
                    img.style.display = 'block';
                    item.classList.remove('loading');
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
    
    preloadInitialThumbnails(images) {
        // Pré-carregar os primeiros 12 thumbnails usando batch processing
        const initialCount = Math.min(12, images.length);
        const batchItems = [];
        
        for (let i = 0; i < initialCount; i++) {
            const item = this.container.children[i];
            if (item) {
                const imagePath = item.dataset.imagePath;
                if (imagePath) {
                    batchItems.push({ item, imagePath });
                }
            }
        }
        
        if (batchItems.length > 0) {
            this.loadBatchThumbnails(batchItems);
        }
    }
    
    async loadBatchThumbnails(batchItems) {
        const imagePaths = batchItems.map(item => item.imagePath);
        
        // Marcar como carregando
        batchItems.forEach(({ imagePath }) => {
            this.loadingThumbnails.add(imagePath);
        });
        
        try {
            console.log(`🔄 Loading batch of ${imagePaths.length} thumbnails`);
            
            const result = await window.electronAPI.getBatchThumbnails(imagePaths, this.thumbnailSize);
            
            if (result.success && result.thumbnails) {
                batchItems.forEach(({ item, imagePath }) => {
                    const thumbnailResult = result.thumbnails[imagePath];
                    
                    if (thumbnailResult && thumbnailResult.success && thumbnailResult.data_url) {
                        // Cache do thumbnail com limite de memória
                        const cacheKey = `${imagePath}_${this.thumbnailSize}`;
                        this.addToCache(cacheKey, thumbnailResult.data_url);
                        
                        const img = item.querySelector('img');
                        const spinner = item.querySelector('.spinner');
                        
                        img.onload = () => {
                            if (spinner) spinner.remove();
                            img.style.display = 'block';
                            item.classList.remove('loading');
                        };
                        
                        img.onerror = () => {
                            this.handleThumbnailError(item, 'Failed to display thumbnail');
                        };
                        
                        img.src = thumbnailResult.data_url;
                    } else {
                        this.handleThumbnailError(item, thumbnailResult?.error || 'Failed to generate thumbnail');
                    }
                });
                
                console.log(`✅ Batch loaded: ${result.total_processed}/${imagePaths.length} thumbnails`);
            } else {
                // Fallback para carregamento individual
                batchItems.forEach(({ item, imagePath }) => {
                    this.queueThumbnailLoad(item, imagePath, 'preload');
                });
            }
            
        } catch (error) {
            console.error('❌ Batch thumbnail error:', error);
            // Fallback para carregamento individual
            batchItems.forEach(({ item, imagePath }) => {
                this.queueThumbnailLoad(item, imagePath, 'preload');
            });
        } finally {
            // Remover da lista de carregamento
            batchItems.forEach(({ imagePath }) => {
                this.loadingThumbnails.delete(imagePath);
            });
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
        
        // Update thumbnail container heights
        const thumbnailContainers = this.container.querySelectorAll('.gallery-item-thumbnail');
        thumbnailContainers.forEach(container => {
            container.style.height = `${this.thumbnailSize}px`;
        });
        
        // Recarregar thumbnails com novo tamanho (verificar cache primeiro)
        const items = this.container.querySelectorAll('.gallery-item');
        items.forEach(item => {
            const imagePath = item.dataset.imagePath;
            if (imagePath) {
                const cacheKey = `${imagePath}_${this.thumbnailSize}`;
                if (this.thumbnailCache.has(cacheKey)) {
                    // Usar cache se disponível
                    this.displayCachedThumbnail(item, cacheKey);
                } else {
                    // Recarregar com novo tamanho
                    const img = item.querySelector('img');
                    if (img && img.src) {
                        item.classList.add('loading');
                        img.style.display = 'none';
                        this.queueThumbnailLoad(item, imagePath, 'visible');
                    }
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
        this.loadQueue = [];
        this.currentLoads = 0;
        // Manter cache para reutilização
    }
    
    addToCache(key, value) {
        // Implementar LRU cache simples
        if (this.thumbnailCache.size >= this.maxCacheSize) {
            // Remover o primeiro item (mais antigo)
            const firstKey = this.thumbnailCache.keys().next().value;
            this.thumbnailCache.delete(firstKey);
        }
        this.thumbnailCache.set(key, value);
    }
    
    clearCache() {
        this.thumbnailCache.clear();
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