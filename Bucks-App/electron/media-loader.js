/**
 * Media Loader - Core Image & Video Loading Engine
 *
 * Handles:
 * - CORS proxy fallback chain
 * - Intelligent retry logic with exponential backoff
 * - Multi-strategy caching (IndexedDB + localStorage)
 * - Quality degradation for videos
 * - Performance monitoring and analytics
 * - Bandwidth-aware loading
 * - Progressive image loading
 */

(function() {
  'use strict';

  class MediaLoader {
    constructor(config) {
      this.config = config || window.MediaLoaderConfig;
      this.loadingMap = new Map(); // Track in-flight requests
      this.cacheDB = null;
      this.analytics = [];
      this.stats = {
        totalLoads: 0,
        successfulLoads: 0,
        failedLoads: 0,
        corsFailures: 0,
        timeoutFailures: 0,
        cacheHits: 0,
        averageLoadTime: 0,
      };

      this.init();
    }

    async init() {
      // Initialize IndexedDB cache if enabled
      if (this.config.images.cache.enabled) {
        await this.initCache();
      }

      // Start background sync for analytics
      if (this.config.errorHandling.analytics.enabled) {
        this.startAnalyticsSyncLoop();
      }

      if (this.config.debug.enabled) {
        console.log('[MediaLoader] Initialized with config:', this.config);
      }
    }

    // ─── Cache Management ──────────────────────────────────────
    async initCache() {
      return new Promise((resolve) => {
        const request = indexedDB.open('MediaLoaderCache', 1);

        request.onerror = () => {
          console.warn('[MediaLoader] Failed to open IndexedDB');
          resolve(false);
        };

        request.onsuccess = (e) => {
          this.cacheDB = e.target.result;
          resolve(true);
        };

        request.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains('images')) {
            db.createObjectStore('images', { keyPath: 'url' });
          }
          if (!db.objectStoreNames.contains('videos')) {
            db.createObjectStore('videos', { keyPath: 'url' });
          }
        };
      });
    }

    async getCached(url, type = 'images') {
      if (!this.cacheDB || !this.config[type].cache.enabled) return null;

      return new Promise((resolve) => {
        const tx = this.cacheDB.transaction([type], 'readonly');
        const store = tx.objectStore(type);
        const request = store.get(url);

        request.onsuccess = () => {
          const cached = request.result;
          if (cached && Date.now() - cached.timestamp < this.config[type].cache.ttl) {
            this.stats.cacheHits++;
            resolve(cached.data);
          } else {
            resolve(null);
          }
        };

        request.onerror = () => resolve(null);
      });
    }

    async setCached(url, data, type = 'images') {
      if (!this.cacheDB || !this.config[type].cache.enabled) return;

      return new Promise((resolve) => {
        const tx = this.cacheDB.transaction([type], 'readwrite');
        const store = tx.objectStore(type);
        const request = store.put({
          url,
          data,
          timestamp: Date.now(),
        });

        request.onerror = () => {
          console.warn(`[MediaLoader] Failed to cache ${url}`);
          resolve(false);
        };

        request.onsuccess = () => resolve(true);
      });
    }

    // ─── Image Loading ────────────────────────────────────────
    async loadImage(url, options = {}) {
      this.stats.totalLoads++;

      // Simulate errors for testing
      if (this.config.debug.simulateErrors.enabled) {
        if (Math.random() < this.config.debug.simulateErrors.rate) {
          const errorType = this.config.debug.simulateErrors.errorType;
          throw new Error(`Simulated ${errorType} error`);
        }
      }

      // Check cache first
      const cached = await this.getCached(url, 'images');
      if (cached) {
        if (this.config.debug.enabled) {
          console.log('[MediaLoader] Cache hit for:', url);
        }
        return cached;
      }

      // Validate URL
      if (!this.validateImageUrl(url)) {
        const error = new Error('Invalid image URL');
        this.recordError('validation', url, error);
        throw error;
      }

      // Try loading with retry logic
      const startTime = Date.now();
      let lastError;

      for (let attempt = 0; attempt <= this.config.images.maxRetries; attempt++) {
        try {
          const result = await this.attemptImageLoad(url, attempt);
          const loadTime = Date.now() - startTime;

          // Update stats
          this.stats.successfulLoads++;
          this.stats.averageLoadTime =
            (this.stats.averageLoadTime + loadTime) / 2;

          // Cache successful load
          await this.setCached(url, result, 'images');

          if (this.config.debug.enabled) {
            console.log(`[MediaLoader] Image loaded in ${loadTime}ms:`, url);
          }

          return result;
        } catch (err) {
          lastError = err;

          if (this.config.debug.enabled) {
            console.warn(
              `[MediaLoader] Attempt ${attempt + 1} failed for ${url}:`,
              err.message
            );
          }

          // Determine backoff strategy
          if (attempt < this.config.images.maxRetries) {
            const delay = this.calculateBackoff(attempt, err.type);
            await this.sleep(delay);
          }
        }
      }

      // All attempts failed
      this.stats.failedLoads++;
      this.recordError('image_load', url, lastError);

      throw new Error(
        `Failed to load image after ${this.config.images.maxRetries + 1} attempts: ${lastError.message}`
      );
    }

    async attemptImageLoad(url, attempt) {
      const timeout = this.config.images.timeout;

      // Try direct load first
      if (attempt === 0) {
        return this.fetchImageData(url, timeout);
      }

      // Try with CORS proxies
      const proxies = this.config.corsProxies;
      const proxyIndex = attempt - 1;

      if (proxyIndex < proxies.length) {
        const proxy = proxies[proxyIndex];
        if (proxy.url) {
          const proxyUrl = proxy.url + encodeURIComponent(url);
          return this.fetchImageData(proxyUrl, proxy.timeout);
        }
      }

      throw new Error('No more proxy options');
    }

    async fetchImageData(url, timeout) {
      return Promise.race([
        fetch(url, {
          method: 'GET',
          mode: 'cors',
          credentials: 'omit',
          headers: {
            'Accept': 'image/*',
          },
        }).then(async (res) => {
          if (!res.ok) {
            const error = new Error(`HTTP ${res.status}`);
            error.type = res.status === 404 ? 'notfound' : 'http';
            throw error;
          }
          return res.blob();
        }),
        this.createTimeout(timeout),
      ]).catch((err) => {
        // Categorize error
        if (err.message.includes('CORS') || err.message.includes('NetworkError')) {
          err.type = 'cors';
          this.stats.corsFailures++;
        } else if (err.message.includes('timeout')) {
          err.type = 'timeout';
          this.stats.timeoutFailures++;
        }
        throw err;
      });
    }

    validateImageUrl(url) {
      if (!this.config.validation.urlValidation.enabled) return true;

      try {
        const u = new URL(url);

        // Only allow http/https
        if (!['http:', 'https:'].includes(u.protocol)) {
          return false;
        }

        // Reject suspicious domains
        if (this.config.validation.urlValidation.rejectSuspiciousDomains) {
          const suspiciousDomains = [
            'localhost', '127.0.0.1', '192.168',
            'internal', 'private', 'test',
          ];
          if (suspiciousDomains.some(d => u.hostname.includes(d))) {
            return false;
          }
        }

        return true;
      } catch {
        return false;
      }
    }

    // ─── Video Loading ────────────────────────────────────────
    async loadVideoThumbnail(videoId, source = 'youtube') {
      this.stats.totalLoads++;

      if (source === 'youtube') {
        return this.loadYouTubeThumbnail(videoId);
      }

      throw new Error(`Unknown video source: ${source}`);
    }

    async loadYouTubeThumbnail(videoId) {
      // Check cache first
      const cacheKey = `yt_${videoId}`;
      const cached = await this.getCached(cacheKey, 'videos');
      if (cached) {
        this.stats.cacheHits++;
        return cached;
      }

      const qualities = this.config.videos.youtube.qualities;
      let lastError;

      for (let qualityIdx = 0; qualityIdx < qualities.length; qualityIdx++) {
        const quality = qualities[qualityIdx];
        const thumbUrl = `https://i.ytimg.com/vi/${videoId}/${quality}.jpg`;

        for (let attempt = 0; attempt <= this.config.videos.youtube.maxQualityAttempts; attempt++) {
          try {
            const startTime = Date.now();
            const result = await this.fetchImageData(
              thumbUrl,
              this.config.videos.youtube.qualityTimeout
            );

            // Cache and return
            await this.setCached(cacheKey, result, 'videos');
            this.stats.successfulLoads++;
            this.stats.averageLoadTime =
              (this.stats.averageLoadTime + (Date.now() - startTime)) / 2;

            if (this.config.debug.enabled) {
              console.log(
                `[MediaLoader] YouTube thumbnail loaded (${quality}):`,
                videoId
              );
            }

            return result;
          } catch (err) {
            lastError = err;
            if (attempt < this.config.videos.youtube.maxQualityAttempts) {
              await this.sleep(500);
            }
          }
        }
      }

      this.stats.failedLoads++;
      this.recordError('video_thumbnail', videoId, lastError);
      throw new Error(`Failed to load YouTube thumbnail for ${videoId}`);
    }

    // ─── Utility Methods ───────────────────────────────────────
    calculateBackoff(attempt, errorType) {
      const baseDelay = 1000; // 1 second
      const maxDelay = this.config.errorHandling.strategies.timeout.maxDelay;

      if (errorType === 'timeout') {
        // Longer backoff for timeouts
        return Math.min(
          baseDelay * Math.pow(2, attempt) + Math.random() * 1000,
          maxDelay
        );
      }

      if (errorType === 'cors') {
        // Slightly longer backoff for CORS errors
        return Math.min(
          baseDelay * (attempt + 1) + Math.random() * 500,
          maxDelay / 2
        );
      }

      // Standard exponential backoff
      return Math.min(
        baseDelay * Math.pow(1.5, attempt) + Math.random() * 500,
        maxDelay
      );
    }

    createTimeout(ms) {
      return new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`timeout: ${ms}ms exceeded`)), ms)
      );
    }

    sleep(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }

    // ─── Analytics & Monitoring ───────────────────────────────
    recordError(type, url, error) {
      const event = {
        type,
        url,
        error: error?.message || String(error),
        timestamp: new Date().toISOString(),
        userAgent: navigator.userAgent,
      };

      this.analytics.push(event);

      if (this.config.debug.enabled) {
        console.warn('[MediaLoader] Error recorded:', event);
      }
    }

    startAnalyticsSyncLoop() {
      // Send analytics every 5 minutes or when buffer gets large
      setInterval(() => {
        if (this.analytics.length > 10 || Date.now() % 300000 === 0) {
          this.syncAnalytics();
        }
      }, 60000); // Check every minute
    }

    async syncAnalytics() {
      if (!this.config.errorHandling.analytics.enabled) return;
      if (!this.config.errorHandling.analytics.endpoint) return;
      if (this.analytics.length === 0) return;

      const endpoint = this.config.errorHandling.analytics.endpoint;
      const payload = {
        events: this.analytics,
        stats: this.stats,
        timestamp: new Date().toISOString(),
      };

      try {
        await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        // Clear sent analytics
        this.analytics = [];
      } catch (err) {
        console.warn('[MediaLoader] Failed to sync analytics:', err);
      }
    }

    getStats() {
      return {
        ...this.stats,
        successRate: this.stats.totalLoads > 0
          ? (this.stats.successfulLoads / this.stats.totalLoads * 100).toFixed(2) + '%'
          : '0%',
        cacheHitRate: this.stats.totalLoads > 0
          ? (this.stats.cacheHits / this.stats.totalLoads * 100).toFixed(2) + '%'
          : '0%',
      };
    }

    logStats() {
      const stats = this.getStats();
      console.group('📊 MediaLoader Stats');
      console.log('Total loads:', stats.totalLoads);
      console.log('Successful:', stats.successfulLoads);
      console.log('Failed:', stats.failedLoads);
      console.log('Success rate:', stats.successRate);
      console.log('Cache hit rate:', stats.cacheHitRate);
      console.log('CORS failures:', stats.corsFailures);
      console.log('Timeout failures:', stats.timeoutFailures);
      console.log('Average load time:', stats.averageLoadTime.toFixed(0) + 'ms');
      console.groupEnd();
    }
  }

  // ─── Global Instance ──────────────────────────────────────
  // Create singleton instance
  window.mediaLoader = new MediaLoader(window.MediaLoaderConfig);

  // Export for testing
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = MediaLoader;
  }
})();
