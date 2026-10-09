/**
 * Media Loader Configuration
 *
 * Critical USP Component: Image & Video Loading Strategy
 *
 * This configuration controls:
 * - CORS proxy fallback chain
 * - Retry logic and timeouts
 * - Quality fallback strategies
 * - Error tracking and analytics
 * - Performance monitoring
 * - Cache strategies
 */

(function() {
  'use strict';

  const MediaLoaderConfig = {
    // ─── CORS Proxy Chain ──────────────────────────────────────
    // Tried in order until one succeeds. Each should handle different scenarios.
    corsProxies: [
      // Primary: Direct load (no proxy)
      { name: 'direct', url: null, timeout: 5000 },

      // Fallback 1: corsproxy.io (free, reliable)
      { name: 'corsproxy', url: 'https://corsproxy.io/', timeout: 8000 },

      // Fallback 2: CORS-anywhere (has rate limits)
      { name: 'cors-anywhere', url: 'https://cors-anywhere.herokuapp.com/', timeout: 8000 },

      // Fallback 3: allorigins (lightweight)
      { name: 'allorigins', url: 'https://api.allorigins.win/raw?url=', timeout: 7000 },
    ],

    // ─── Image Loading Strategy ────────────────────────────────
    images: {
      // Maximum retry attempts per image
      maxRetries: 3,

      // Timeout per attempt (ms)
      timeout: 6000,

      // Fallback URLs to try if primary fails
      fallbacks: {
        enabled: true,
        // Generate placeholder data URI as last resort
        generatePlaceholder: true,
      },

      // Quality degradation strategy
      qualityFallback: {
        enabled: true,
        // Try to load lower quality versions
        qualities: [
          { suffix: '', label: 'original' },
          { suffix: '?w=800&q=80', label: 'optimized' },
          { suffix: '?w=400&q=75', label: 'thumbnail' },
        ],
      },

      // Cache strategy
      cache: {
        enabled: true,
        // Store successful loads to avoid re-fetching
        storage: 'indexeddb', // 'indexeddb' or 'localstorage'
        ttl: 7 * 24 * 60 * 60 * 1000, // 7 days
        maxSize: 50 * 1024 * 1024, // 50 MB total
      },

      // Performance monitoring
      monitoring: {
        enabled: true,
        trackLoadTimes: true,
        trackFailures: true,
        trackCORSErrors: true,
      },
    },

    // ─── Video Loading Strategy ────────────────────────────────
    videos: {
      // YouTube-specific configuration
      youtube: {
        // Thumbnail quality fallback order (best → worst)
        qualities: [
          'maxresdefault',  // 1280×720
          'sddefault',      // 640×480
          'hqdefault',      // 480×360
          'mqdefault',      // 320×180
          'default',        // 120×90
        ],

        // Timeout per quality attempt
        qualityTimeout: 4000,

        // Maximum quality attempts
        maxQualityAttempts: 3,

        // Fallback to play button overlay if thumbnail fails
        showPlayButtonFallback: true,
      },

      // Generic video thumbnail loading
      generic: {
        maxRetries: 2,
        timeout: 6000,
        // Allow loading from common CDNs
        allowedDomains: [
          'youtube.com', 'youtu.be', 'ytimg.com',
          'vimeo.com', 'cdn.vimeo.com',
          'cdn.jwplayer.com',
          'video.google.com',
        ],
      },

      // Cache strategy
      cache: {
        enabled: true,
        storage: 'indexeddb',
        ttl: 30 * 24 * 60 * 60 * 1000, // 30 days (videos rarely change)
        maxSize: 20 * 1024 * 1024, // 20 MB
      },
    },

    // ─── Error Handling & Recovery ─────────────────────────────
    errorHandling: {
      // Log errors for monitoring
      logging: {
        enabled: true,
        level: 'warn', // 'debug', 'info', 'warn', 'error'
      },

      // Send analytics for debugging
      analytics: {
        enabled: true,
        endpoint: null, // Set to your analytics endpoint
        trackDomain: true,
        trackErrorReason: true,
        trackUserAgent: false, // Privacy-first
      },

      // Graceful degradation strategies
      degradation: {
        // Show error state instead of hiding
        showErrorStates: true,

        // Display error messages to users
        userFeedback: true,

        // Allow manual retry
        allowManualRetry: true,

        // Show fallback content
        showFallbackContent: true,
      },

      // Specific error handling
      strategies: {
        // CORS errors
        cors: {
          retryWithProxy: true,
          autoRetry: true,
          maxProxyAttempts: 3,
        },

        // Timeout errors
        timeout: {
          retryWithLongerTimeout: true,
          increaseTimeoutBy: 2000, // Add 2s per retry
        },

        // 404 / Not Found
        notfound: {
          retryWithProxy: false, // No point retrying broken URLs
          showError: true,
        },

        // Network errors
        network: {
          retryWithBackoff: true,
          initialDelay: 1000,
          maxDelay: 10000,
        },
      },
    },

    // ─── Performance Optimization ──────────────────────────────
    performance: {
      // Lazy load images/videos
      lazyLoading: {
        enabled: true,
        threshold: 0.1, // Start loading 10% before viewport
      },

      // Progressive enhancement
      progressive: {
        enabled: true,
        // Show low-quality placeholder first, then high quality
        twoPhaseLoading: true,
      },

      // Resource hints
      resourceHints: {
        preconnect: true,  // Pre-establish connections to CDNs
        prefetch: true,    // Prefetch images below fold
        preload: false,    // Too aggressive for large galleries
      },

      // Bandwidth awareness
      bandwidthAware: {
        enabled: true,
        // Detect connection speed and adjust quality
        checkConnectionSpeed: true,
        // Reduce quality on slower connections
        qualityByConnection: {
          '4g': 'maxresdefault',      // Full quality
          '3g': 'hqdefault',          // Medium quality
          'slow-4g': 'mqdefault',     // Low quality
          '2g': 'mqdefault',          // Lowest quality
        },
      },

      // Concurrent loading limits
      concurrency: {
        maxConcurrent: 4, // Load max 4 images simultaneously
        // Queue remaining requests
        queueRemaining: true,
      },
    },

    // ─── Data Validation ───────────────────────────────────────
    validation: {
      // Validate URLs before loading
      urlValidation: {
        enabled: true,
        // Only allow http/https
        requireSecure: false, // http is ok too for local dev
        // Reject suspicious URLs
        rejectSuspiciousDomains: true,
      },

      // Validate image metadata
      metadata: {
        // Require minimum dimensions
        minWidth: 100,
        minHeight: 100,
        // Maximum dimensions to prevent abuse
        maxWidth: 4000,
        maxHeight: 4000,
        // Allowed MIME types
        allowedTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
      },

      // Validate video metadata
      videoMetadata: {
        // Required fields
        requireTitle: true,
        requireThumbnail: true,
        // Video ID validation
        youtubeIdPattern: /^[A-Za-z0-9_-]{11}$/,
      },
    },

    // ─── Fallback Content ──────────────────────────────────────
    fallbacks: {
      // Placeholder for failed images
      imagePlaceholder: {
        type: 'gradient', // 'gradient', 'icon', 'color'
        showDimensions: false,
        // Colored placeholders by error type
        colors: {
          loading: 'var(--input-bg)',
          error: 'var(--hover-bg)',
          cors: 'var(--hover-bg)',
        },
      },

      // Fallback for failed videos
      videoPlaceholder: {
        showPlayIcon: true,
        showErrorMessage: true,
        message: 'Video preview unavailable',
      },

      // Generic fallback icon/text
      genericFallback: {
        type: 'icon', // 'icon', 'text', 'both'
        icon: '📸', // For images
        text: 'Image',
      },
    },

    // ─── Development & Debugging ───────────────────────────────
    debug: {
      // Enable debug logging
      enabled: false,

      // Log all loading attempts
      logAttempts: false,

      // Log cache operations
      logCache: false,

      // Simulate failures for testing
      simulateErrors: {
        enabled: false,
        rate: 0, // 0-1 (0.5 = 50% of images fail)
        errorType: 'cors', // 'cors', 'timeout', 'notfound', 'network'
      },

      // Performance profiling
      profile: false,
    },

    // ─── Feature Flags ────────────────────────────────────────
    features: {
      // Enable/disable entire features
      imageLoading: true,
      videoLoading: true,
      corsProxy: true,
      caching: true,
      analytics: true,
      bandwidthAware: true,
    },
  };

  // ─── Runtime Configuration (can be overridden) ─────────────
  // Allow configuration updates at runtime
  window.MediaLoaderConfig = {
    ...MediaLoaderConfig,

    // Override methods
    setProxy: function(name, url, timeout) {
      const proxy = this.corsProxies.find(p => p.name === name);
      if (proxy) {
        proxy.url = url;
        proxy.timeout = timeout;
      }
    },

    setAnalyticsEndpoint: function(endpoint) {
      this.errorHandling.analytics.endpoint = endpoint;
    },

    setDebugMode: function(enabled) {
      this.debug.enabled = enabled;
    },

    enableSimulatedErrors: function(rate, type) {
      this.debug.simulateErrors.enabled = true;
      this.debug.simulateErrors.rate = rate;
      this.debug.simulateErrors.errorType = type;
    },

    getActiveProxies: function() {
      return this.corsProxies.filter(p => p.url);
    },

    validate: function() {
      const errors = [];

      // Validate proxy chain
      if (this.corsProxies.length === 0) {
        errors.push('No CORS proxies configured');
      }

      // Validate cache configuration
      if (this.images.cache.maxSize < 1024 * 1024) {
        errors.push('Image cache size too small (< 1MB)');
      }

      if (errors.length > 0) {
        console.warn('MediaLoaderConfig validation errors:', errors);
        return false;
      }

      return true;
    },

    logConfiguration: function() {
      console.group('🎬 MediaLoaderConfig');
      console.log('CORS Proxies:', this.corsProxies.length);
      console.log('Image retries:', this.images.maxRetries);
      console.log('Video qualities:', this.videos.youtube.qualities.length);
      console.log('Features enabled:',
        Object.values(this.features).filter(Boolean).length + '/' +
        Object.keys(this.features).length
      );
      console.log('Analytics:', this.errorHandling.analytics.enabled);
      console.log('Caching:', this.images.cache.enabled && this.videos.cache.enabled);
      console.log('Debug mode:', this.debug.enabled);
      console.groupEnd();
    },
  };

  // Validate configuration on load
  if (typeof window !== 'undefined') {
    window.addEventListener('load', () => {
      if (window.MediaLoaderConfig.debug.enabled) {
        window.MediaLoaderConfig.logConfiguration();
      }
    });
  }

  // Export for Node.js if needed
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = MediaLoaderConfig;
  }

})();
