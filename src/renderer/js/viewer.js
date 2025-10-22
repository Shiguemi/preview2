/**
 * Image Viewer Component
 * Handles the full-screen image modal and navigation
 */

class ImageViewer {
    constructor(app) {
        this.app = app;
        this.currentIndex = -1;
        this.images = [];
        this.isOpen = false;
        this.scale = 1;
        this.translateX = 0;
        this.translateY = 0;
        this.isDragging = false;
        this.isFullscreen = false;
        this.controlsTimeout = null;
        this.dragAnimationFrame = null;
        this.lastDragTime = 0;

        // Preloading system
        this.preloadCache = new Map(); // Cache de imagens pré-carregadas
        this.preloadQueue = new Set(); // Fila de pré-carregamento
        this.preloadDistance = 2; // Quantas imagens carregar para cada lado
        this.maxPreloadSize = 10; // Máximo de imagens no cache
        this.isPreloading = false;
        this.lastNavigationDirection = 0; // -1 = anterior, 1 = próxima, 0 = neutro

        this.init();
    }

    init() {
        this.initializeElements();
        this.setupEventListeners();
    }

    initializeElements() {
        this.elements = {
            modal: document.getElementById('image-viewer'),
            backdrop: this.modal?.querySelector('.modal-backdrop'),
            image: document.getElementById('modal-image'),
            imageName: document.getElementById('modal-image-name'),
            imageDetails: document.getElementById('modal-image-details'),
            imageLoading: document.getElementById('image-loading'),
            closeBtn: document.getElementById('close-modal'),
            prevBtn: document.getElementById('prev-image'),
            nextBtn: document.getElementById('next-image'),
            zoomFitBtn: document.getElementById('zoom-fit'),
            zoom100Btn: document.getElementById('zoom-100'),
            loadFullResBtn: document.getElementById('load-full-res'),
            fullscreenBtn: document.getElementById('fullscreen-toggle'),
            zoomIndicator: document.getElementById('zoom-indicator'),
            preloadIndicator: document.getElementById('preload-indicator')
        };
    }

    setupEventListeners() {
        // Modal controls
        this.elements.closeBtn?.addEventListener('click', () => this.close());
        this.elements.backdrop?.addEventListener('click', () => this.close());
        this.elements.prevBtn?.addEventListener('click', () => this.previous());
        this.elements.nextBtn?.addEventListener('click', () => this.next());

        // Zoom controls
        this.elements.zoomFitBtn?.addEventListener('click', () => this.fitToScreen());
        this.elements.zoom100Btn?.addEventListener('click', () => this.zoom100());
        this.elements.loadFullResBtn?.addEventListener('click', () => this.loadFullResolution());
        this.elements.fullscreenBtn?.addEventListener('click', () => this.toggleFullscreen());

        // Keyboard navigation
        document.addEventListener('keydown', (e) => this.handleKeyboard(e));

        // Mouse/touch interactions
        this.setupImageInteractions();
    }

    setupImageInteractions() {
        const image = this.elements.image;
        if (!image) return;

        // Mouse wheel zoom
        image.addEventListener('wheel', (e) => {
            if (!this.isOpen) return;

            e.preventDefault();
            const delta = e.deltaY > 0 ? 0.9 : 1.1;
            this.zoomAt(e.clientX, e.clientY, delta);
        });

        // Mouse drag
        let startX, startY, startTranslateX, startTranslateY;

        image.addEventListener('mousedown', (e) => {
            if (!this.isOpen) return;

            // Verificar se a imagem é maior que o container (precisa de drag)
            const container = image.parentElement;
            const containerRect = container.getBoundingClientRect();
            const scaledWidth = image.naturalWidth * this.scale;
            const scaledHeight = image.naturalHeight * this.scale;

            const needsDrag = scaledWidth > containerRect.width || scaledHeight > containerRect.height;

            if (!needsDrag) return;

            this.isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            startTranslateX = this.translateX;
            startTranslateY = this.translateY;

            // Desabilitar transições durante o drag para melhor performance
            image.style.transition = 'none';
            image.style.cursor = 'grabbing';

            // Desabilitar pointer events no zoom indicator durante drag
            if (this.elements.zoomIndicator) {
                this.elements.zoomIndicator.style.pointerEvents = 'none';
            }

            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!this.isDragging) return;

            // Throttling inteligente - máximo 60fps
            const now = performance.now();
            if (now - this.lastDragTime < 16) return; // ~60fps
            this.lastDragTime = now;

            // Cancelar frame anterior se ainda não foi executado
            if (this.dragAnimationFrame) {
                cancelAnimationFrame(this.dragAnimationFrame);
            }

            // Usar requestAnimationFrame para suavizar o movimento
            this.dragAnimationFrame = requestAnimationFrame(() => {
                this.translateX = startTranslateX + (e.clientX - startX);
                this.translateY = startTranslateY + (e.clientY - startY);
                this.updateImageTransformFast();
                this.dragAnimationFrame = null;
            });
        });

        document.addEventListener('mouseup', () => {
            if (this.isDragging) {
                this.isDragging = false;

                // Cancelar qualquer animationFrame pendente
                if (this.dragAnimationFrame) {
                    cancelAnimationFrame(this.dragAnimationFrame);
                    this.dragAnimationFrame = null;
                }

                // Reabilitar transições
                image.style.transition = '';

                // Reabilitar pointer events no zoom indicator
                if (this.elements.zoomIndicator) {
                    this.elements.zoomIndicator.style.pointerEvents = '';
                }

                // Atualizar cursor e zoom indicator
                this.updateCursor();
                this.updateZoomIndicator();
            }
        });

        // Double-click to toggle between fit-to-screen and 2x zoom
        image.addEventListener('dblclick', (e) => {
            if (!this.isOpen) return;

            // Se está em fit-to-screen (escala calculada), fazer zoom 2x
            // Se está em zoom, voltar para fit-to-screen
            const container = image.parentElement;
            const containerRect = container.getBoundingClientRect();
            const fitScale = Math.min(
                containerRect.width / image.naturalWidth,
                containerRect.height / image.naturalHeight
            );

            if (Math.abs(this.scale - fitScale) < 0.01) {
                // Está em fit-to-screen, fazer zoom 2x
                this.zoomAt(e.clientX, e.clientY, 2);
            } else {
                // Está em zoom, voltar para fit-to-screen
                this.fitToScreen();
            }
        });
    }

    async open(index) {
        this.images = this.app.getCurrentImages();

        if (index < 0 || index >= this.images.length) {
            console.error('❌ Invalid image index:', index);
            return;
        }

        this.currentIndex = index;
        this.isOpen = true;

        console.log(`🖼️ Opening image viewer: ${this.images[index].name}`);

        // Show modal
        this.elements.modal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';

        // Update UI
        this.updateImageInfo();
        this.showImageLoading(true);

        // Load full image
        await this.loadCurrentImage();
    }

    close() {
        if (!this.isOpen) return;

        console.log('❌ Closing image viewer');

        // Sair do fullscreen se estiver ativo
        if (this.isFullscreen) {
            this.exitFullscreen();
        }

        this.isOpen = false;
        this.elements.modal.classList.add('hidden');
        document.body.style.overflow = '';

        // Reset image state
        this.resetImageTransform();
        this.elements.image.src = '';

        // Limpar cache de preload para liberar memória
        this.clearPreloadCache();
    }

    async previous() {
        if (!this.isOpen || this.images.length === 0) return;

        this.lastNavigationDirection = -1; // Navegando para trás
        this.currentIndex = (this.currentIndex - 1 + this.images.length) % this.images.length;
        console.log(`⬅️ Previous image: ${this.images[this.currentIndex].name}`);

        this.updateImageInfo();
        this.showImageLoading(true);
        this.resetImageTransform();

        await this.loadCurrentImage();
    }

    async next() {
        if (!this.isOpen || this.images.length === 0) return;

        this.lastNavigationDirection = 1; // Navegando para frente
        this.currentIndex = (this.currentIndex + 1) % this.images.length;
        console.log(`➡️ Next image: ${this.images[this.currentIndex].name}`);

        this.updateImageInfo();
        this.showImageLoading(true);
        this.resetImageTransform();

        await this.loadCurrentImage();
    }

    async loadCurrentImage() {
        if (!this.isOpen || this.currentIndex < 0) return;

        const image = this.images[this.currentIndex];
        const cacheKey = `${image.path}_${this.getCurrentMaxSize()}`;

        try {
            // Verificar cache primeiro
            if (this.preloadCache.has(cacheKey)) {
                console.log(`⚡ Loading from cache: ${image.name}`);
                const cachedData = this.preloadCache.get(cacheKey);

                this.elements.image.onload = () => {
                    this.showImageLoading(false);
                    this.fitToScreen();

                    console.log(`✅ Cached image displayed: ${image.name}`);
                    this.checkIfResized(cachedData.maxSize, cachedData.width, cachedData.height);
                    setTimeout(() => this.updateCursor(), 100);

                    // Iniciar preloading das imagens adjacentes
                    this.startPreloading();
                };

                this.elements.image.src = cachedData.data_url;
                await this.updateImageDetails();
                return;
            }

            console.log(`🔄 Loading full image: ${image.path}`);

            const maxSize = this.getCurrentMaxSize();
            console.log(`📐 Max size: ${maxSize === 0 ? 'unlimited' : maxSize}`);

            const result = await window.electronAPI.getFullImage(image.path, maxSize);

            if (result.success && result.data_url) {
                // Adicionar ao cache
                this.addToPreloadCache(cacheKey, {
                    data_url: result.data_url,
                    width: result.width || 0,
                    height: result.height || 0,
                    maxSize: maxSize,
                    timestamp: Date.now()
                });

                this.elements.image.onload = () => {
                    this.showImageLoading(false);
                    this.fitToScreen();

                    const actualWidth = this.elements.image.naturalWidth;
                    const actualHeight = this.elements.image.naturalHeight;

                    console.log(`✅ Image loaded: ${image.name} (${actualWidth}x${actualHeight})`);

                    this.checkIfResized(maxSize, actualWidth, actualHeight);
                    setTimeout(() => this.updateCursor(), 100);

                    // Iniciar preloading das imagens adjacentes
                    this.startPreloading();
                };

                this.elements.image.onerror = () => {
                    this.showImageLoading(false);
                    console.error(`❌ Failed to display image: ${image.name}`);
                };

                this.elements.image.src = result.data_url;
                await this.updateImageDetails();

            } else {
                throw new Error(result.error || 'Failed to load image');
            }

        } catch (error) {
            console.error(`❌ Error loading image: ${error.message}`);
            this.showImageLoading(false);
        }
    }

    getCurrentMaxSize() {
        // Estratégia inteligente de carregamento baseada na tela
        const screenWidth = window.screen.width;
        const screenHeight = window.screen.height;
        const maxScreenDimension = Math.max(screenWidth, screenHeight);

        if (maxScreenDimension >= 2160) {
            return 0; // Sem limite para telas 4K+
        } else if (maxScreenDimension >= 1440) {
            return maxScreenDimension * 2; // 2x para telas QHD+
        } else {
            return Math.max(2048, maxScreenDimension * 1.5); // Mínimo 2048px
        }
    }

    async updateImageDetails() {
        if (!this.isOpen || this.currentIndex < 0) return;

        const image = this.images[this.currentIndex];

        try {
            const info = await window.electronAPI.getImageInfo(image.path);

            if (info.success) {
                const details = [
                    `${info.width} × ${info.height}`,
                    `${info.channels} channels`,
                    this.formatFileSize(info.size_bytes),
                    info.format
                ].join(' • ');

                this.elements.imageDetails.textContent = details;
            }
        } catch (error) {
            console.error('❌ Error getting image info:', error);
        }
    }

    updateImageInfo() {
        if (this.currentIndex < 0 || this.currentIndex >= this.images.length) return;

        const image = this.images[this.currentIndex];
        this.elements.imageName.textContent = image.name;
        this.elements.imageDetails.textContent = 'Loading...';
    }

    showImageLoading(show) {
        this.elements.imageLoading.classList.toggle('hidden', !show);
    }

    fitToScreen() {
        // Calcular escala para a imagem caber completamente na tela
        const image = this.elements.image;
        const container = image.parentElement;

        if (image.naturalWidth && image.naturalHeight) {
            const containerRect = container.getBoundingClientRect();

            // Calcular escalas para largura e altura
            const scaleX = containerRect.width / image.naturalWidth;
            const scaleY = containerRect.height / image.naturalHeight;

            // Usar a menor escala para garantir que a imagem caiba completamente
            this.scale = Math.min(scaleX, scaleY);
            this.translateX = 0;
            this.translateY = 0;
            this.updateImageTransform();
            this.updateCursor();

            console.log(`📐 Fit to screen: Scale ${this.scale.toFixed(3)} (${Math.round(this.scale * 100)}%)`);
        }
    }

    zoom100() {
        // Show image at true 100% scale (1:1 pixel ratio)
        const image = this.elements.image;

        if (image.naturalWidth && image.naturalHeight) {
            // Para zoom 1:1, a escala é sempre 1.0
            // Isso significa 1 pixel da imagem = 1 pixel da tela
            this.scale = 1.0;
            this.translateX = 0;
            this.translateY = 0;
            this.updateImageTransform();
            this.updateCursor();

            const container = image.parentElement;
            const containerRect = container.getBoundingClientRect();
            console.log(`🔍 Zoom 100%: Image ${image.naturalWidth}x${image.naturalHeight}, Container ${Math.round(containerRect.width)}x${Math.round(containerRect.height)}`);
        }
    }

    zoomAt(clientX, clientY, factor) {
        const image = this.elements.image;
        const rect = image.getBoundingClientRect();

        // Calculate mouse position relative to image
        const mouseX = clientX - rect.left;
        const mouseY = clientY - rect.top;

        // Calculate new scale
        const newScale = Math.max(0.1, Math.min(5, this.scale * factor));

        if (newScale !== this.scale) {
            // Adjust translation to zoom at mouse position
            const scaleDiff = newScale - this.scale;
            this.translateX -= (mouseX - rect.width / 2) * scaleDiff / this.scale;
            this.translateY -= (mouseY - rect.height / 2) * scaleDiff / this.scale;

            this.scale = newScale;
            this.updateImageTransform();
            this.updateCursor();
        }
    }

    updateImageTransform() {
        // Usar translate3d para forçar aceleração de hardware
        const transform = `translate3d(${this.translateX}px, ${this.translateY}px, 0) scale(${this.scale})`;
        this.elements.image.style.transform = transform;
        this.updateZoomIndicator();
    }

    updateImageTransformFast() {
        // Versão otimizada para drag - sem atualizar zoom indicator
        const transform = `translate3d(${this.translateX}px, ${this.translateY}px, 0) scale(${this.scale})`;
        this.elements.image.style.transform = transform;
    }

    updateZoomIndicator() {
        if (this.elements.zoomIndicator) {
            const percentage = Math.round(this.scale * 100);
            this.elements.zoomIndicator.textContent = `${percentage}%`;
        }
    }

    updateCursor() {
        const image = this.elements.image;
        const container = image.parentElement;

        if (image.naturalWidth && image.naturalHeight && container) {
            const containerRect = container.getBoundingClientRect();
            const scaledWidth = image.naturalWidth * this.scale;
            const scaledHeight = image.naturalHeight * this.scale;

            const needsDrag = scaledWidth > containerRect.width || scaledHeight > containerRect.height;

            if (this.isFullscreen) {
                // No fullscreen, usar classes CSS para controle do cursor
                image.classList.toggle('draggable', needsDrag);
            } else {
                // No modal normal, usar style direto
                image.style.cursor = needsDrag ? 'grab' : 'default';
                image.classList.remove('draggable');
            }
        }
    }

    resetImageTransform() {
        // Reset para fit-to-screen em vez de scale = 1
        this.fitToScreen();
    }

    handleKeyboard(event) {
        if (!this.isOpen) return;

        switch (event.key) {
            case 'Escape':
                event.preventDefault();
                if (this.isFullscreen) {
                    this.exitFullscreen();
                } else {
                    this.close();
                }
                break;
            case 'ArrowLeft':
                event.preventDefault();
                this.previous();
                break;
            case 'ArrowRight':
                event.preventDefault();
                this.next();
                break;
            case '0':
                event.preventDefault();
                this.fitToScreen();
                break;
            case '1':
                event.preventDefault();
                this.zoom100();
                break;
            case 'f':
            case 'F':
                event.preventDefault();
                this.loadFullResolution();
                break;
            case 'F11':
                event.preventDefault();
                this.toggleFullscreen();
                break;
        }
    }

    checkIfResized(maxSize, actualWidth, actualHeight) {
        if (maxSize > 0 && (actualWidth >= maxSize || actualHeight >= maxSize)) {
            // Imagem foi redimensionada, mostrar indicador
            const fullResBtn = this.elements.loadFullResBtn;
            if (fullResBtn) {
                fullResBtn.style.backgroundColor = '#ff6b35';
                fullResBtn.style.borderColor = '#ff6b35';
                fullResBtn.title = 'Image was resized - Click to load full resolution (F)';
            }
        } else {
            // Imagem em resolução completa
            const fullResBtn = this.elements.loadFullResBtn;
            if (fullResBtn) {
                fullResBtn.style.backgroundColor = '';
                fullResBtn.style.borderColor = '';
                fullResBtn.title = 'Load full resolution (F)';
            }
        }
    }

    async loadFullResolution() {
        if (!this.isOpen || this.currentIndex < 0) return;

        const image = this.images[this.currentIndex];

        try {
            console.log(`🔍 Loading FULL resolution: ${image.path}`);
            this.showImageLoading(true);

            // Forçar carregamento sem limite de tamanho
            const result = await window.electronAPI.getFullImage(image.path, 0);

            if (result.success && result.data_url) {
                this.elements.image.onload = () => {
                    this.showImageLoading(false);
                    this.fitToScreen();
                    console.log(`✅ FULL resolution loaded: ${image.name} (${this.elements.image.naturalWidth}x${this.elements.image.naturalHeight})`);

                    // Garantir que o cursor seja atualizado após o carregamento
                    setTimeout(() => this.updateCursor(), 100);
                };

                this.elements.image.onerror = () => {
                    this.showImageLoading(false);
                    console.error(`❌ Failed to display full resolution: ${image.name}`);
                };

                this.elements.image.src = result.data_url;

                // Update image details
                await this.updateImageDetails();

            } else {
                throw new Error(result.error || 'Failed to load full resolution');
            }

        } catch (error) {
            console.error(`❌ Error loading full resolution: ${error.message}`);
            this.showImageLoading(false);
        }
    }

    toggleFullscreen() {
        if (this.isFullscreen) {
            this.exitFullscreen();
        } else {
            this.enterFullscreen();
        }
    }

    enterFullscreen() {
        if (!this.isOpen) return;

        console.log('🖥️ Entering fullscreen mode');

        this.isFullscreen = true;
        this.elements.modal.classList.add('fullscreen');

        // Atualizar botão
        if (this.elements.fullscreenBtn) {
            this.elements.fullscreenBtn.title = 'Exit fullscreen (F11 or Esc)';
            this.elements.fullscreenBtn.querySelector('.icon').textContent = '⛶';
            this.elements.fullscreenBtn.style.backgroundColor = '#0066cc';
            this.elements.fullscreenBtn.style.borderColor = '#0066cc';
        }

        // Recalcular fit-to-screen para tela cheia
        setTimeout(() => {
            this.fitToScreen();
            this.setupFullscreenControls();
            this.showFullscreenHint();
        }, 100);
    }

    exitFullscreen() {
        if (!this.isFullscreen) return;

        console.log('🖥️ Exiting fullscreen mode');

        this.isFullscreen = false;
        this.elements.modal.classList.remove('fullscreen');

        // Atualizar botão
        if (this.elements.fullscreenBtn) {
            this.elements.fullscreenBtn.title = 'Toggle fullscreen (F11)';
            this.elements.fullscreenBtn.querySelector('.icon').textContent = '⛶';
            this.elements.fullscreenBtn.style.backgroundColor = '';
            this.elements.fullscreenBtn.style.borderColor = '';
        }

        // Limpar timeout dos controles
        if (this.controlsTimeout) {
            clearTimeout(this.controlsTimeout);
            this.controlsTimeout = null;
        }

        // Recalcular fit-to-screen para modal normal
        setTimeout(() => {
            this.fitToScreen();
        }, 100);
    }

    setupFullscreenControls() {
        if (!this.isFullscreen) return;

        const controls = this.elements.modal.querySelector('.image-controls');
        if (!controls) return;

        // Mostrar controles inicialmente
        controls.classList.add('show');

        // Auto-hide após 3 segundos
        this.controlsTimeout = setTimeout(() => {
            controls.classList.remove('show');
        }, 3000);

        // Mostrar controles ao mover o mouse
        const showControls = () => {
            controls.classList.add('show');

            if (this.controlsTimeout) {
                clearTimeout(this.controlsTimeout);
            }

            this.controlsTimeout = setTimeout(() => {
                controls.classList.remove('show');
            }, 3000);
        };

        // Event listeners para mostrar controles
        this.elements.modal.addEventListener('mousemove', showControls);
        this.elements.modal.addEventListener('click', showControls);

        // Listener para redimensionamento da janela
        window.addEventListener('resize', () => {
            if (this.isFullscreen) {
                setTimeout(() => this.fitToScreen(), 100);
            }
        });

        // Adicionar suporte a touch para melhor responsividade
        this.setupTouchEvents();
    }

    showFullscreenHint() {
        // Criar elemento de dica temporário
        const hint = document.createElement('div');
        hint.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 16px 24px;
            border-radius: 8px;
            font-size: 14px;
            z-index: 1000;
            pointer-events: none;
            opacity: 0;
            transition: opacity 0.3s ease;
        `;
        hint.textContent = 'Press ESC or F11 to exit fullscreen';

        document.body.appendChild(hint);

        // Mostrar e esconder a dica
        setTimeout(() => hint.style.opacity = '1', 100);
        setTimeout(() => {
            hint.style.opacity = '0';
            setTimeout(() => document.body.removeChild(hint), 300);
        }, 2000);
    }

    addToPreloadCache(key, data) {
        // Implementar LRU cache para preload
        if (this.preloadCache.size >= this.maxPreloadSize) {
            // Remover o item mais antigo
            let oldestKey = null;
            let oldestTime = Date.now();

            for (const [cacheKey, cacheData] of this.preloadCache) {
                if (cacheData.timestamp < oldestTime) {
                    oldestTime = cacheData.timestamp;
                    oldestKey = cacheKey;
                }
            }

            if (oldestKey) {
                this.preloadCache.delete(oldestKey);
                console.log(`🗑️ Removed old preload cache: ${oldestKey}`);
            }
        }

        this.preloadCache.set(key, data);
    }

    startPreloading() {
        if (this.isPreloading || this.images.length <= 1) return;

        this.isPreloading = true;

        // Mostrar indicador de preloading
        if (this.elements.preloadIndicator) {
            this.elements.preloadIndicator.classList.remove('hidden');
        }

        // Calcular índices para preload (priorizar direção de navegação)
        const indicesToPreload = [];

        if (this.lastNavigationDirection === 1) {
            // Navegando para frente - priorizar próximas imagens
            for (let i = 1; i <= this.preloadDistance * 2; i++) {
                const nextIndex = (this.currentIndex + i) % this.images.length;
                indicesToPreload.push(nextIndex);
            }
            // Algumas anteriores também
            for (let i = 1; i <= this.preloadDistance; i++) {
                const prevIndex = (this.currentIndex - i + this.images.length) % this.images.length;
                indicesToPreload.push(prevIndex);
            }
        } else if (this.lastNavigationDirection === -1) {
            // Navegando para trás - priorizar imagens anteriores
            for (let i = 1; i <= this.preloadDistance * 2; i++) {
                const prevIndex = (this.currentIndex - i + this.images.length) % this.images.length;
                indicesToPreload.push(prevIndex);
            }
            // Algumas próximas também
            for (let i = 1; i <= this.preloadDistance; i++) {
                const nextIndex = (this.currentIndex + i) % this.images.length;
                indicesToPreload.push(nextIndex);
            }
        } else {
            // Navegação neutra - carregar igualmente para ambos os lados
            for (let i = 1; i <= this.preloadDistance; i++) {
                const nextIndex = (this.currentIndex + i) % this.images.length;
                indicesToPreload.push(nextIndex);

                const prevIndex = (this.currentIndex - i + this.images.length) % this.images.length;
                indicesToPreload.push(prevIndex);
            }
        }

        console.log(`🔄 Starting preload for indices: ${indicesToPreload.join(', ')}`);

        // Preload em background
        setTimeout(() => this.preloadImages(indicesToPreload), 100);
    }

    async preloadImages(indices) {
        const maxSize = this.getCurrentMaxSize();
        const preloadPromises = [];

        for (const index of indices) {
            if (index === this.currentIndex) continue; // Skip current image

            const image = this.images[index];
            const cacheKey = `${image.path}_${maxSize}`;

            // Skip if already cached or in queue
            if (this.preloadCache.has(cacheKey) || this.preloadQueue.has(cacheKey)) {
                continue;
            }

            this.preloadQueue.add(cacheKey);

            const preloadPromise = this.preloadSingleImage(image.path, maxSize, cacheKey, index);
            preloadPromises.push(preloadPromise);
        }

        if (preloadPromises.length > 0) {
            try {
                await Promise.all(preloadPromises);
                console.log(`✅ Preloaded ${preloadPromises.length} images`);
            } catch (error) {
                console.error(`❌ Preload error: ${error.message}`);
            }
        }

        this.isPreloading = false;

        // Esconder indicador de preloading
        if (this.elements.preloadIndicator) {
            this.elements.preloadIndicator.classList.add('hidden');
        }
    }

    async preloadSingleImage(imagePath, maxSize, cacheKey, index) {
        try {
            const result = await window.electronAPI.getFullImage(imagePath, maxSize);

            if (result.success && result.data_url) {
                this.addToPreloadCache(cacheKey, {
                    data_url: result.data_url,
                    width: result.width || 0,
                    height: result.height || 0,
                    maxSize: maxSize,
                    timestamp: Date.now()
                });

                console.log(`📦 Preloaded: ${this.images[index].name}`);
            }
        } catch (error) {
            console.error(`❌ Failed to preload ${imagePath}: ${error.message}`);
        } finally {
            this.preloadQueue.delete(cacheKey);
        }
    }

    clearPreloadCache() {
        this.preloadCache.clear();
        this.preloadQueue.clear();
        console.log(`🗑️ Preload cache cleared`);
    }

    setupTouchEvents() {
        const image = this.elements.image;
        if (!image) return;

        let startTouchX, startTouchY, startTranslateX, startTranslateY;
        let isTouchDragging = false;

        // Touch start
        image.addEventListener('touchstart', (e) => {
            if (!this.isOpen || e.touches.length !== 1) return;

            const touch = e.touches[0];
            const container = image.parentElement;
            const containerRect = container.getBoundingClientRect();
            const scaledWidth = image.naturalWidth * this.scale;
            const scaledHeight = image.naturalHeight * this.scale;

            const needsDrag = scaledWidth > containerRect.width || scaledHeight > containerRect.height;
            if (!needsDrag) return;

            isTouchDragging = true;
            startTouchX = touch.clientX;
            startTouchY = touch.clientY;
            startTranslateX = this.translateX;
            startTranslateY = this.translateY;

            // Desabilitar transições durante o drag
            image.style.transition = 'none';
            e.preventDefault();
        }, { passive: false });

        // Touch move
        image.addEventListener('touchmove', (e) => {
            if (!isTouchDragging || e.touches.length !== 1) return;

            const touch = e.touches[0];

            // Throttling inteligente - máximo 60fps
            const now = performance.now();
            if (now - this.lastDragTime < 16) return; // ~60fps
            this.lastDragTime = now;

            // Cancelar frame anterior se ainda não foi executado
            if (this.dragAnimationFrame) {
                cancelAnimationFrame(this.dragAnimationFrame);
            }

            // Usar requestAnimationFrame para suavizar o movimento
            this.dragAnimationFrame = requestAnimationFrame(() => {
                this.translateX = startTranslateX + (touch.clientX - startTouchX);
                this.translateY = startTranslateY + (touch.clientY - startTouchY);
                this.updateImageTransformFast();
                this.dragAnimationFrame = null;
            });

            e.preventDefault();
        }, { passive: false });

        // Touch end
        image.addEventListener('touchend', (e) => {
            if (isTouchDragging) {
                isTouchDragging = false;

                // Cancelar qualquer animationFrame pendente
                if (this.dragAnimationFrame) {
                    cancelAnimationFrame(this.dragAnimationFrame);
                    this.dragAnimationFrame = null;
                }

                // Reabilitar transições
                image.style.transition = '';

                // Atualizar zoom indicator
                this.updateZoomIndicator();
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
}

// Export for use in other modules
window.ImageViewer = ImageViewer;