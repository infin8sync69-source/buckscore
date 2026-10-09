/**
 * Unified Media Renderer
 *
 * Bridges legacy image/video rendering with modern A2UIResults system.
 * Ensures all media flows through the same pipeline for consistency.
 *
 * Responsibilities:
 * - Normalize media data shapes
 * - Route through MediaLoader for smart loading
 * - Use A2UIResults for rendering
 * - Handle fallbacks and errors
 * - Track performance
 */

(function() {
  'use strict';

  class UnifiedMediaRenderer {
    constructor() {
      this.mediaLoader = window.mediaLoader;
      this.config = window.MediaLoaderConfig;
      this.renderCache = new Map();
    }

    /**
     * Render any media component through unified pipeline
     * Accepts: image_gallery, video, research
     */
    async renderMediaComponent(component, data, options = {}) {
      if (!window.A2UIResults) {
        console.error('[UnifiedMediaRenderer] A2UIResults not available');
        return null;
      }

      // Normalize data to standard shape
      const items = window.A2UIResults.normalize(component, data);

      if (!items || items.length === 0) {
        if (this.config.debug.enabled) {
          console.log('[UnifiedMediaRenderer] No items to render:', component);
        }
        return null;
      }

      // Enrich items with media loader info
      const enrichedItems = await this.enrichMediaItems(items, component);

      // Filter out items that failed validation
      const validItems = enrichedItems.filter(item => !item._error);

      if (validItems.length === 0) {
        console.warn('[UnifiedMediaRenderer] All items failed validation');
        return null;
      }

      // Auto-select best layout if not specified
      const layout = options.layout ||
        window.A2UIResults.pickLayout(validItems);

      // Render using A2UIResults
      try {
        const html = window.A2UIResults.render(validItems, {
          ...options,
          layout,
          onLayout: options.onLayout,
        });

        // Attach media loader to images
        this.attachMediaLoaders(html, validItems);

        return html;
      } catch (err) {
        console.error('[UnifiedMediaRenderer] Render failed:', err);
        return this.renderFallback(validItems, err);
      }
    }

    /**
     * Enrich items with media loading metadata
     */
    async enrichMediaItems(items, component) {
      return Promise.all(
        items.map(async (item) => {
          try {
            // Validate URL
            if (!this.validateMediaUrl(item)) {
              item._error = 'Invalid URL';
              return item;
            }

            // Pre-validate image exists (quick check)
            if (item.thumbnail || item.kind === 'image') {
              const url = item.thumbnail || item.url;
              if (url && this.shouldPrevalidate(url)) {
                const canLoad = await this.quickValidate(url);
                if (!canLoad) {
                  item._error = 'Cannot load';
                  item._status = 'error';
                }
              }
            }

            // Add loading metadata
            item._loadingStrategy = this.getLoadingStrategy(item);
            item._maxRetries = this.getMaxRetries(item);

            return item;
          } catch (err) {
            item._error = err.message;
            return item;
          }
        })
      );
    }

    /**
     * Determine optimal loading strategy
     */
    getLoadingStrategy(item) {
      if (item.kind === 'video' || item.domain === 'youtube.com') {
        return 'youtube-thumbnail';
      }

      if (item.source === 'youtube') {
        return 'youtube-video';
      }

      // Check if domain supports direct loading
      const directLoadDomains = [
        'unsplash.com', 'pexels.com', 'pixabay.com',
        'open.spotify.com', 'imgur.com', 'cdn.',
      ];

      if (directLoadDomains.some(d => item.url?.includes(d))) {
        return 'direct';
      }

      // Use CORS proxy for others
      return 'cors-proxy';
    }

    /**
     * Get max retries based on strategy and reliability
     */
    getMaxRetries(item) {
      if (item.kind === 'video' || item.domain === 'youtube.com') {
        // YouTube thumbnails are reliable, few retries needed
        return 2;
      }

      if (item.source === 'unsplash' || item.source === 'pexels') {
        // Reliable sources
        return 2;
      }

      // Unknown sources need more retries
      return this.config.images.maxRetries;
    }

    /**
     * Should we pre-validate this URL?
     * (Only for high-traffic/slow sources)
     */
    shouldPrevalidate(url) {
      if (!url) return false;

      // Pre-validate Google Images
      if (url.includes('google') && url.includes('image')) {
        return true;
      }

      // Pre-validate Bing Images
      if (url.includes('bing') && url.includes('image')) {
        return true;
      }

      return false;
    }

    /**
     * Quick validation - just check if we can HEAD the resource
     */
    async quickValidate(url) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2000);

        const response = await fetch(url, {
          method: 'HEAD',
          mode: 'cors',
          signal: controller.signal,
        });

        clearTimeout(timeout);
        return response.ok;
      } catch {
        return false; // Assume it might load later
      }
    }

    /**
     * Validate media URL
     */
    validateMediaUrl(item) {
      if (!item.url && !item.thumbnail) {
        return false;
      }

      try {
        const url = item.url || item.thumbnail;
        new URL(url);
        return true;
      } catch {
        return false;
      }
    }

    /**
     * Attach media loader event listeners to rendered images
     */
    attachMediaLoaders(html, items) {
      if (!html) return;

      // If html is a string, convert to DOM element first
      let container = html;
      if (typeof html === 'string') {
        const div = document.createElement('div');
        div.innerHTML = html;
        container = div.firstElementChild;
      }

      // Find all images
      const images = container.querySelectorAll('img[src]');
      images.forEach((img, idx) => {
        const item = items[idx];
        if (!item || !item._loadingStrategy) return;

        // Add data attributes for media loader
        img.setAttribute('data-loading-strategy', item._loadingStrategy);
        img.setAttribute('data-max-retries', item._maxRetries);
        img.setAttribute('data-media-url', item.url || item.thumbnail);

        // Attach load/error handlers
        img.addEventListener('load', () => {
          img.classList.add('is-loaded');
          this.recordLoad(item, 'success');
        });

        img.addEventListener('error', async () => {
          this.recordLoad(item, 'error');
          // Media loader will be called from a2ui-engine.js
        });

        // Trigger actual loading through MediaLoader
        this.loadImageThroughMediaLoader(img, item);
      });
    }

    /**
     * Load image through MediaLoader with retry
     */
    async loadImageThroughMediaLoader(img, item) {
      const url = item.url || item.thumbnail;
      if (!url) return;

      try {
        // Let mediaLoader handle the loading
        // It will cache successful loads and retry as needed
        const result = await this.mediaLoader.loadImage(url);

        // Create blob URL and update img src
        const blobUrl = URL.createObjectURL(result);
        img.src = blobUrl;

        // Clean up old blob URL if exists
        const oldUrl = img.dataset.blobUrl;
        if (oldUrl) URL.revokeObjectURL(oldUrl);
        img.dataset.blobUrl = blobUrl;

      } catch (err) {
        console.warn(`[UnifiedMediaRenderer] Failed to load ${url}:`, err);
        this.handleMediaLoadError(img, item, err);
      }
    }

    /**
     * Handle media load errors with graceful fallback
     */
    handleMediaLoadError(img, item, error) {
      if (!this.config.errorHandling.degradation.showErrorStates) {
        img.style.display = 'none';
        return;
      }

      // Create error indicator element
      const errorDiv = document.createElement('div');
      errorDiv.className = 'media-load-error';
      errorDiv.style.cssText = `
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-direction: column;
        gap: 8px;
        background: var(--hover-bg);
        border-radius: 10px;
        padding: 12px;
        font-size: 12px;
        color: var(--text-tertiary);
        cursor: pointer;
      `;

      errorDiv.innerHTML = `
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>
        </svg>
        <span>Failed to load</span>
      `;

      // Add retry functionality
      if (this.config.errorHandling.degradation.allowManualRetry) {
        errorDiv.style.cursor = 'pointer';
        errorDiv.title = 'Click to retry';
        errorDiv.addEventListener('click', async () => {
          errorDiv.style.opacity = '0.5';
          await this.loadImageThroughMediaLoader(img, item);
          errorDiv.remove();
        });
      }

      // Replace image with error indicator
      img.style.display = 'none';
      img.parentElement.style.position = 'relative';
      img.parentElement.appendChild(errorDiv);
    }

    /**
     * Render fallback when all else fails
     */
    renderFallback(items, error) {
      const fallbackHtml = document.createElement('div');
      fallbackHtml.className = 'media-render-fallback';
      fallbackHtml.style.cssText = `
        padding: 20px;
        background: var(--hover-bg);
        border-radius: 12px;
        text-align: center;
        color: var(--text-secondary);
      `;

      fallbackHtml.innerHTML = `
        <div style="font-size: 14px; font-weight: 600; margin-bottom: 8px;">
          Unable to render media
        </div>
        <div style="font-size: 12px; color: var(--text-tertiary);">
          ${error?.message || 'Unknown error'}
        </div>
        <button onclick="location.reload()" style="
          margin-top: 12px;
          padding: 6px 12px;
          background: var(--accent);
          color: var(--accent-contrast);
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-size: 12px;
        ">Retry</button>
      `;

      return fallbackHtml;
    }

    /**
     * Record media load metrics
     */
    recordLoad(item, status) {
      const event = {
        type: 'media_load',
        component: item.kind || 'unknown',
        status,
        url: item.url,
        timestamp: new Date().toISOString(),
      };

      if (this.config.debug.enabled) {
        console.log('[UnifiedMediaRenderer] Media load:', event);
      }

      // Could send to analytics here
    }

    /**
     * Get render stats
     */
    getStats() {
      return {
        mediaLoader: this.mediaLoader.getStats(),
        cached: this.renderCache.size,
      };
    }

    /**
     * Log stats
     */
    logStats() {
      console.group('📊 UnifiedMediaRenderer Stats');
      const stats = this.getStats();
      console.log('Cache size:', stats.cached);
      console.log('MediaLoader stats:', stats.mediaLoader);
      console.groupEnd();
    }
  }

  // Create singleton
  window.unifiedMediaRenderer = new UnifiedMediaRenderer();

  // Export
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = UnifiedMediaRenderer;
  }
})();
