/**
 * Intent Router - Routes queries to appropriate peers based on intent-matched capabilities
 * Implements fallback chains, load balancing, and capability matching
 */

class IntentRouter {
  constructor(agentSwarm = null) {
    this.agentSwarm = agentSwarm;
    this.routes = new Map();
    this.peerCapabilities = new Map();
    this.routingHistory = [];
    this.fallbackChains = {};
    this.loadBalancer = new LoadBalancer();
    this.initializeRoutes();
  }

  /**
   * Initialize default routing configuration
   * @private
   */
  initializeRoutes() {
    this.routes.set('search', {
      capabilities: ['knowledge-retrieval', 'web-search', 'data-analysis'],
      fallback: ['general-query', 'search-fallback'],
      timeout: 30000,
      retries: 3
    });

    this.routes.set('transaction', {
      capabilities: ['wallet-operation', 'blockchain-tx', 'transaction-validation'],
      fallback: ['transaction-broadcast', 'blockchain-fallback'],
      timeout: 60000,
      retries: 2
    });

    this.routes.set('navigation', {
      capabilities: ['ui-navigation', 'page-routing', 'menu-control'],
      fallback: ['general-navigation', 'ui-fallback'],
      timeout: 5000,
      retries: 1
    });

    this.routes.set('settings', {
      capabilities: ['config-management', 'preference-setting', 'system-config'],
      fallback: ['local-storage', 'config-fallback'],
      timeout: 10000,
      retries: 2
    });

    this.routes.set('help', {
      capabilities: ['documentation', 'support-agent', 'faq-retrieval'],
      fallback: ['general-support', 'help-fallback'],
      timeout: 20000,
      retries: 2
    });

    this.routes.set('command', {
      capabilities: ['command-execution', 'task-runner', 'action-executor'],
      fallback: ['deferred-command', 'command-fallback'],
      timeout: 45000,
      retries: 2
    });

    this.routes.set('general', {
      capabilities: ['general-query', 'conversation', 'text-processing'],
      fallback: ['fallback-general'],
      timeout: 20000,
      retries: 1
    });
  }

  /**
   * Route a query to appropriate peer(s)
   * @param {string} intent - The classified intent
   * @param {string} query - The original query
   * @param {Object} context - Additional context (confidence, user data, etc.)
   * @returns {Promise<Object>} - Routing result with selected peer and capability
   */
  async route(intent, query, context = {}) {
    const startTime = Date.now();

    try {
      // Get route configuration for intent
      const route = this.routes.get(intent) || this.routes.get('general');

      // Get available peers with matching capabilities
      const candidatePeers = await this.findCapableePeers(route.capabilities);

      if (candidatePeers.length === 0) {
        // Try fallback capabilities
        return await this.routeWithFallback(intent, query, route, context);
      }

      // Select best peer using load balancer
      const selectedPeer = this.loadBalancer.selectPeer(candidatePeers);

      const result = {
        intent,
        peerId: selectedPeer.peerId,
        capabilities: selectedPeer.capabilities,
        primaryCapability: selectedPeer.primaryCapability,
        loadScore: selectedPeer.loadScore,
        queryTime: Date.now() - startTime,
        status: 'routed',
        retries: 0,
        fallbackUsed: false,
        timestamp: Date.now()
      };

      this.recordRoute(result);
      return result;
    } catch (error) {
      console.error('Routing error:', error);
      return await this.handleRoutingError(intent, query, context, error);
    }
  }

  /**
   * Route with fallback chain if primary capabilities unavailable
   * @private
   */
  async routeWithFallback(intent, query, route, context) {
    const fallbackRoute = { ...route };
    fallbackRoute.capabilities = route.fallback;

    const fallbackPeers = await this.findCapableePeers(fallbackRoute.capabilities);

    if (fallbackPeers.length === 0) {
      return this.createErrorRoute(intent, 'No capable peers available');
    }

    const selectedPeer = this.loadBalancer.selectPeer(fallbackPeers);

    return {
      intent,
      peerId: selectedPeer.peerId,
      capabilities: selectedPeer.capabilities,
      primaryCapability: selectedPeer.primaryCapability,
      loadScore: selectedPeer.loadScore,
      status: 'routed-fallback',
      fallbackUsed: true,
      timestamp: Date.now()
    };
  }

  /**
   * Find peers with required capabilities
   * @private
   */
  async findCapableePeers(requiredCapabilities) {
    // This would integrate with agent swarm
    // For now, return mock implementation
    const candidatePeers = [];

    if (this.agentSwarm) {
      const peers = this.agentSwarm.getActivePeers?.() || [];

      for (const peer of peers) {
        const peerCaps = this.peerCapabilities.get(peer.id) || [];
        const matchingCaps = requiredCapabilities.filter(cap =>
          peerCaps.includes(cap)
        );

        if (matchingCaps.length > 0) {
          candidatePeers.push({
            peerId: peer.id,
            capabilities: peerCaps,
            primaryCapability: matchingCaps[0],
            load: peer.load || 0,
            responseTime: peer.avgResponseTime || 0,
            reliability: peer.reliability || 0.95
          });
        }
      }
    }

    // If no swarm or no peers, create default peer
    if (candidatePeers.length === 0) {
      candidatePeers.push(this.createDefaultPeer(requiredCapabilities));
    }

    return candidatePeers;
  }

  /**
   * Create default peer for local handling
   * @private
   */
  createDefaultPeer(capabilities) {
    return {
      peerId: 'local-default',
      capabilities,
      primaryCapability: capabilities[0],
      load: 0,
      responseTime: 5,
      reliability: 1.0
    };
  }

  /**
   * Handle routing errors with retry logic
   * @private
   */
  async handleRoutingError(intent, query, context, error) {
    const route = this.routes.get(intent) || this.routes.get('general');
    let retries = context.retries || 0;

    if (retries < route.retries) {
      // Retry with fallback
      retries++;
      await new Promise(resolve => setTimeout(resolve, 100 * retries)); // Exponential backoff
      return await this.routeWithFallback(intent, query, route, { ...context, retries });
    }

    return this.createErrorRoute(intent, error.message);
  }

  /**
   * Create error route result
   * @private
   */
  createErrorRoute(intent, errorMessage) {
    return {
      intent,
      peerId: null,
      capabilities: [],
      status: 'error',
      error: errorMessage,
      fallbackUsed: false,
      timestamp: Date.now()
    };
  }

  /**
   * Register peer capabilities
   * @param {string} peerId - Peer ID
   * @param {string[]} capabilities - Array of capability names
   */
  registerPeerCapabilities(peerId, capabilities) {
    this.peerCapabilities.set(peerId, capabilities);
  }

  /**
   * Get peer capabilities
   * @param {string} peerId - Peer ID
   * @returns {string[]} - Array of capabilities
   */
  getPeerCapabilities(peerId) {
    return this.peerCapabilities.get(peerId) || [];
  }

  /**
   * Add custom route
   * @param {string} intent - Intent name
   * @param {Object} routeConfig - Route configuration
   */
  addCustomRoute(intent, routeConfig) {
    this.routes.set(intent, {
      capabilities: routeConfig.capabilities || [],
      fallback: routeConfig.fallback || ['general-fallback'],
      timeout: routeConfig.timeout || 30000,
      retries: routeConfig.retries || 2
    });
  }

  /**
   * Get route configuration for intent
   * @param {string} intent - Intent name
   * @returns {Object} - Route configuration
   */
  getRoute(intent) {
    return this.routes.get(intent) || this.routes.get('general');
  }

  /**
   * Get all routes
   * @returns {Object} - All route configurations
   */
  getAllRoutes() {
    const allRoutes = {};
    for (const [intent, config] of this.routes) {
      allRoutes[intent] = config;
    }
    return allRoutes;
  }

  /**
   * Record routing decision in history
   * @private
   */
  recordRoute(routeResult) {
    this.routingHistory.push(routeResult);

    // Keep history size bounded
    if (this.routingHistory.length > 1000) {
      this.routingHistory.shift();
    }
  }

  /**
   * Get routing statistics
   * @returns {Object} - Statistics about routing decisions
   */
  getStatistics() {
    const stats = {
      totalRoutes: this.routingHistory.length,
      byIntent: {},
      avgQueryTime: 0,
      successRate: 0,
      fallbackRate: 0
    };

    let totalTime = 0;
    let successCount = 0;
    let fallbackCount = 0;

    for (const route of this.routingHistory) {
      // Count by intent
      if (!stats.byIntent[route.intent]) {
        stats.byIntent[route.intent] = { total: 0, success: 0, fallback: 0 };
      }
      stats.byIntent[route.intent].total++;

      if (route.status === 'routed' || route.status === 'routed-fallback') {
        successCount++;
        stats.byIntent[route.intent].success++;
      }

      if (route.fallbackUsed) {
        fallbackCount++;
        stats.byIntent[route.intent].fallback++;
      }

      totalTime += route.queryTime || 0;
    }

    stats.avgQueryTime = Math.round(totalTime / Math.max(this.routingHistory.length, 1));
    stats.successRate = Math.round((successCount / Math.max(this.routingHistory.length, 1)) * 100);
    stats.fallbackRate = Math.round((fallbackCount / Math.max(this.routingHistory.length, 1)) * 100);

    return stats;
  }

  /**
   * Clear routing history
   */
  clearHistory() {
    this.routingHistory = [];
  }

  /**
   * Get recent routing decisions
   * @param {number} limit - Number of recent routes to return
   * @returns {Object[]} - Recent routing decisions
   */
  getRecentRoutes(limit = 10) {
    return this.routingHistory.slice(-limit);
  }
}

/**
 * Load Balancer - Selects best peer based on load and performance
 */
class LoadBalancer {
  constructor() {
    this.weights = {
      load: 0.4,
      responseTime: 0.3,
      reliability: 0.3
    };
  }

  /**
   * Select best peer from candidates
   * @param {Object[]} peers - Candidate peers
   * @returns {Object} - Selected peer
   */
  selectPeer(peers) {
    if (peers.length === 0) return null;
    if (peers.length === 1) return { ...peers[0], loadScore: 1.0 };

    // Score each peer
    const scoredPeers = peers.map(peer => ({
      ...peer,
      loadScore: this.calculateLoadScore(peer, peers)
    }));

    // Sort by score (descending)
    scoredPeers.sort((a, b) => b.loadScore - a.loadScore);

    return scoredPeers[0];
  }

  /**
   * Calculate load score for a peer
   * @private
   */
  calculateLoadScore(peer, allPeers) {
    // Normalize metrics (0-1 scale)
    const maxLoad = Math.max(...allPeers.map(p => p.load || 0), 1);
    const maxResponseTime = Math.max(...allPeers.map(p => p.responseTime || 0), 1);

    const loadScore = 1 - (peer.load / maxLoad);
    const responseScore = 1 - (peer.responseTime / maxResponseTime);
    const reliabilityScore = peer.reliability || 0.95;

    // Weighted calculation
    return (loadScore * this.weights.load +
            responseScore * this.weights.responseTime +
            reliabilityScore * this.weights.reliability);
  }

  /**
   * Set weight for scoring factor
   * @param {string} factor - Factor name (load, responseTime, reliability)
   * @param {number} weight - Weight value (0-1)
   */
  setWeight(factor, weight) {
    if (this.weights.hasOwnProperty(factor) && weight >= 0 && weight <= 1) {
      this.weights[factor] = weight;
    }
  }

  /**
   * Get current weights
   * @returns {Object} - Current weight configuration
   */
  getWeights() {
    return { ...this.weights };
  }
}

// Export for use in Node.js or browser environments
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { IntentRouter, LoadBalancer };
}

// Export for ES6 modules
if (typeof export !== 'undefined') {
  export { IntentRouter, LoadBalancer };
}
