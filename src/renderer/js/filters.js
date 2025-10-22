/**
 * Filters Component
 * Handles image filtering and sorting
 */

class Filters {
    constructor(app) {
        this.app = app;
        this.activeFilters = {
            jpg: true,
            png: true,
            exr: true,
            other: true
        };
        this.sortBy = 'name';
        
        this.init();
    }

    init() {
        this.setupFilterControls();
        this.setupSortControl();
    }

    setupFilterControls() {
        const filterCheckboxes = {
            'show-jpg': 'jpg',
            'show-png': 'png', 
            'show-exr': 'exr',
            'show-other': 'other'
        };

        Object.entries(filterCheckboxes).forEach(([elementId, filterKey]) => {
            const checkbox = document.getElementById(elementId);
            if (checkbox) {
                checkbox.addEventListener('change', (e) => {
                    this.activeFilters[filterKey] = e.target.checked;
                    this.applyFilters();
                    console.log(`🔍 Filter ${filterKey}: ${e.target.checked ? 'ON' : 'OFF'}`);
                });
            }
        });
    }

    setupSortControl() {
        const sortSelect = document.getElementById('sort-by');
        if (sortSelect) {
            sortSelect.addEventListener('change', (e) => {
                this.sortBy = e.target.value;
                this.applyFilters();
                console.log(`📊 Sort by: ${this.sortBy}`);
            });
        }
    }

    apply(images) {
        let filtered = [...images];

        // Apply type filters
        filtered = filtered.filter(image => {
            const ext = image.extension.toLowerCase();
            
            if ((ext === '.jpg' || ext === '.jpeg') && this.activeFilters.jpg) return true;
            if (ext === '.png' && this.activeFilters.png) return true;
            if (ext === '.exr' && this.activeFilters.exr) return true;
            if (!this.isCommonFormat(ext) && this.activeFilters.other) return true;
            
            return false;
        });

        // Apply sorting
        filtered.sort((a, b) => {
            switch (this.sortBy) {
                case 'name':
                    return a.name.localeCompare(b.name);
                case 'size':
                    return b.size - a.size; // Larger first
                case 'type':
                    return a.extension.localeCompare(b.extension);
                default:
                    return 0;
            }
        });

        return filtered;
    }

    applyFilters() {
        this.app.applyFilters();
        
        if (this.app.gallery) {
            this.app.gallery.refresh();
        }
    }

    isCommonFormat(ext) {
        return ['.jpg', '.jpeg', '.png', '.exr'].includes(ext);
    }

    // Public methods
    reset() {
        this.activeFilters = {
            jpg: true,
            png: true,
            exr: true,
            other: true
        };
        this.sortBy = 'name';
        
        // Update UI
        document.getElementById('show-jpg').checked = true;
        document.getElementById('show-png').checked = true;
        document.getElementById('show-exr').checked = true;
        document.getElementById('show-other').checked = true;
        document.getElementById('sort-by').value = 'name';
        
        this.applyFilters();
    }

    getActiveFilters() {
        return { ...this.activeFilters };
    }

    getSortBy() {
        return this.sortBy;
    }
}

// Export for use in other modules
window.Filters = Filters;