/**
 * Component Library - Centralized registry and factory for reusable UI components
 * Provides component versioning, lifecycle management, and composition
 */

class ComponentLibrary {
  constructor() {
    this.components = new Map();
    this.versions = new Map();
    this.composites = new Map();
    this.themes = new Map();
    this.hooks = new Map();
    this.initializeComponents();
    this.initializeThemes();
  }

  /**
   * Initialize core components
   * @private
   */
  initializeComponents() {
    // ChatBubble - Message container
    this.registerComponent('ChatBubble', {
      version: '1.0.0',
      props: ['message', 'sender', 'timestamp', 'status', 'theme'],
      methods: ['render', 'updateStatus', 'animate'],
      styles: 'chat-bubble',
      description: 'Displays a single chat message'
    });

    // ChatInput - Rich message composer
    this.registerComponent('ChatInput', {
      version: '1.0.0',
      props: ['placeholder', 'value', 'disabled', 'theme', 'formatting'],
      methods: ['focus', 'clear', 'getValue', 'setText', 'insertMarkdown'],
      styles: 'chat-input',
      description: 'Rich text input with markdown formatting'
    });

    // ResponseCard - Rich content display
    this.registerComponent('ResponseCard', {
      version: '1.0.0',
      props: ['title', 'content', 'format', 'actions', 'theme'],
      methods: ['render', 'addAction', 'updateContent', 'setFormat'],
      styles: 'response-card',
      description: 'Card component for displaying rich responses'
    });

    // StatusIndicator - Status display
    this.registerComponent('StatusIndicator', {
      version: '1.0.0',
      props: ['status', 'label', 'animated', 'size'],
      methods: ['updateStatus', 'setLabel', 'animate'],
      styles: 'status-indicator',
      description: 'Shows message delivery/encryption status'
    });

    // PeerIndicator - User/peer avatar
    this.registerComponent('PeerIndicator', {
      version: '1.0.0',
      props: ['peerId', 'name', 'avatar', 'status', 'size'],
      methods: ['render', 'setStatus', 'updateAvatar'],
      styles: 'peer-indicator',
      description: 'Displays peer/user avatar and status'
    });

    // IntentBadge - Intent label
    this.registerComponent('IntentBadge', {
      version: '1.0.0',
      props: ['intent', 'confidence', 'clickable', 'theme'],
      methods: ['render', 'updateIntent', 'setConfidence'],
      styles: 'intent-badge',
      description: 'Shows classified intent with confidence level'
    });

    // LoadingSkeleton - Placeholder
    this.registerComponent('LoadingSkeleton', {
      version: '1.0.0',
      props: ['type', 'count', 'animated', 'theme'],
      methods: ['render', 'setType', 'stop'],
      styles: 'loading-skeleton',
      description: 'Shimmer placeholder during loading'
    });

    // NotificationToast - Toast alerts
    this.registerComponent('NotificationToast', {
      version: '1.0.0',
      props: ['message', 'type', 'duration', 'actions'],
      methods: ['show', 'hide', 'update', 'remove'],
      styles: 'notification-toast',
      description: 'Toast notification for alerts and messages'
    });

    // TypingIndicator - Animated typing dots
    this.registerComponent('TypingIndicator', {
      version: '1.0.0',
      props: ['animated', 'color', 'size'],
      methods: ['render', 'start', 'stop'],
      styles: 'typing-indicator',
      description: 'Animated typing indicator for peer activity'
    });

    // CodeBlock - Syntax highlighted code
    this.registerComponent('CodeBlock', {
      version: '1.0.0',
      props: ['code', 'language', 'showLineNumbers', 'copyable'],
      methods: ['render', 'updateCode', 'copyToClipboard', 'setLanguage'],
      styles: 'code-block',
      description: 'Displays code with syntax highlighting'
    });
  }

  /**
   * Initialize theme configurations
   * @private
   */
  initializeThemes() {
    this.registerTheme('light', {
      name: 'Light Theme',
      colors: {
        primary: '#007AFF',
        secondary: '#5AC8FA',
        background: '#FFFFFF',
        surface: '#F2F2F7',
        text: '#000000',
        textSecondary: '#999999',
        success: '#34C759',
        error: '#FF3B30',
        warning: '#FF9500'
      },
      shadows: 'light'
    });

    this.registerTheme('dark', {
      name: 'Dark Theme',
      colors: {
        primary: '#0A84FF',
        secondary: '#5AC8FA',
        background: '#000000',
        surface: '#1C1C1E',
        text: '#FFFFFF',
        textSecondary: '#666666',
        success: '#30B0C0',
        error: '#FF453B',
        warning: '#FF9500'
      },
      shadows: 'dark'
    });
  }

  /**
   * Register a new component
   * @param {string} name - Component name
   * @param {Object} config - Component configuration
   */
  registerComponent(name, config) {
    const fullConfig = {
      name,
      version: config.version || '1.0.0',
      props: config.props || [],
      methods: config.methods || [],
      styles: config.styles || '',
      description: config.description || '',
      tags: config.tags || [],
      dependencies: config.dependencies || [],
      created: Date.now()
    };

    this.components.set(name, fullConfig);
    this.versions.set(name, [fullConfig.version]);
  }

  /**
   * Get component definition
   * @param {string} name - Component name
   * @param {string} version - Component version (optional)
   * @returns {Object} - Component configuration
   */
  getComponent(name, version = null) {
    const component = this.components.get(name);
    if (!component) return null;

    if (version && version !== component.version) {
      // Handle version fallback
      console.warn(`Component ${name} version ${version} not found, using ${component.version}`);
    }

    return { ...component };
  }

  /**
   * Create component instance
   * @param {string} name - Component name
   * @param {Object} props - Initial properties
   * @returns {Object} - Component instance
   */
  createComponent(name, props = {}) {
    const component = this.getComponent(name);
    if (!component) {
      throw new Error(`Component ${name} not found`);
    }

    const instance = {
      id: `${name}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: name,
      props: this.validateProps(name, props),
      state: {},
      mounted: false,
      destroyed: false,
      events: new Map(),
      lifecycle: {
        created: Date.now(),
        mounted: null,
        destroyed: null
      }
    };

    return instance;
  }

  /**
   * Validate component props
   * @private
   */
  validateProps(componentName, props) {
    const component = this.getComponent(componentName);
    const validated = {};

    for (const prop of component.props) {
      validated[prop] = props[prop] || null;
    }

    return validated;
  }

  /**
   * Register a composite component
   * @param {string} name - Composite name
   * @param {Object} config - Composite configuration
   */
  registerComposite(name, config) {
    this.composites.set(name, {
      name,
      components: config.components || [],
      layout: config.layout || 'flex',
      props: config.props || [],
      description: config.description || '',
      created: Date.now()
    });
  }

  /**
   * Get composite component definition
   * @param {string} name - Composite name
   * @returns {Object} - Composite configuration
   */
  getComposite(name) {
    return this.composites.get(name);
  }

  /**
   * Create composite instance
   * @param {string} name - Composite name
   * @param {Object} props - Initial properties
   * @returns {Object} - Composite instance with child components
   */
  createComposite(name, props = {}) {
    const composite = this.getComposite(name);
    if (!composite) {
      throw new Error(`Composite ${name} not found`);
    }

    const instance = {
      id: `${name}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: name,
      isComposite: true,
      props,
      children: composite.components.map(childName => this.createComponent(childName, {})),
      layout: composite.layout,
      mounted: false
    };

    return instance;
  }

  /**
   * Register a theme
   * @param {string} name - Theme name
   * @param {Object} config - Theme configuration
   */
  registerTheme(name, config) {
    this.themes.set(name, {
      name: config.name || name,
      colors: config.colors || {},
      shadows: config.shadows || 'default',
      typography: config.typography || {},
      spacing: config.spacing || {},
      created: Date.now()
    });
  }

  /**
   * Get theme configuration
   * @param {string} name - Theme name
   * @returns {Object} - Theme configuration
   */
  getTheme(name = 'light') {
    return this.themes.get(name);
  }

  /**
   * Register lifecycle hook
   * @param {string} componentName - Component name
   * @param {string} hookName - Hook name (mount, unmount, update)
   * @param {Function} callback - Hook callback
   */
  onHook(componentName, hookName, callback) {
    const key = `${componentName}:${hookName}`;
    if (!this.hooks.has(key)) {
      this.hooks.set(key, []);
    }
    this.hooks.get(key).push(callback);
  }

  /**
   * Trigger lifecycle hooks
   * @param {Object} instance - Component instance
   * @param {string} hookName - Hook name
   */
  triggerHook(instance, hookName) {
    const key = `${instance.type}:${hookName}`;
    const callbacks = this.hooks.get(key) || [];

    for (const callback of callbacks) {
      try {
        callback(instance);
      } catch (error) {
        console.error(`Hook error for ${key}:`, error);
      }
    }
  }

  /**
   * List all registered components
   * @returns {string[]} - Component names
   */
  listComponents() {
    return Array.from(this.components.keys());
  }

  /**
   * List all registered composites
   * @returns {string[]} - Composite names
   */
  listComposites() {
    return Array.from(this.composites.keys());
  }

  /**
   * List all available themes
   * @returns {string[]} - Theme names
   */
  listThemes() {
    return Array.from(this.themes.keys());
  }

  /**
   * Get component statistics
   * @returns {Object} - Library statistics
   */
  getStatistics() {
    return {
      totalComponents: this.components.size,
      totalComposites: this.composites.size,
      totalThemes: this.themes.size,
      components: this.listComponents(),
      composites: this.listComposites(),
      themes: this.listThemes()
    };
  }

  /**
   * Export library configuration
   * @returns {string} - JSON representation
   */
  export() {
    const componentsList = {};
    for (const [name, config] of this.components) {
      componentsList[name] = config;
    }

    const compositesList = {};
    for (const [name, config] of this.composites) {
      compositesList[name] = config;
    }

    const themesList = {};
    for (const [name, config] of this.themes) {
      themesList[name] = config;
    }

    return JSON.stringify({
      components: componentsList,
      composites: compositesList,
      themes: themesList,
      timestamp: new Date().toISOString()
    }, null, 2);
  }

  /**
   * Import library configuration
   * @param {string} jsonConfig - JSON library configuration
   */
  import(jsonConfig) {
    try {
      const config = JSON.parse(jsonConfig);

      if (config.components) {
        for (const [name, compConfig] of Object.entries(config.components)) {
          this.registerComponent(name, compConfig);
        }
      }

      if (config.composites) {
        for (const [name, compConfig] of Object.entries(config.composites)) {
          this.registerComposite(name, compConfig);
        }
      }

      if (config.themes) {
        for (const [name, themeConfig] of Object.entries(config.themes)) {
          this.registerTheme(name, themeConfig);
        }
      }
    } catch (error) {
      console.error('Failed to import component library:', error);
    }
  }

  /**
   * Mount component instance to DOM
   * @param {Object} instance - Component instance
   * @param {Element} container - DOM container
   */
  mount(instance, container) {
    if (!container) {
      throw new Error('Container element required for mounting');
    }

    instance.mounted = true;
    instance.lifecycle.mounted = Date.now();
    this.triggerHook(instance, 'mount');

    // Create DOM element (simplified)
    const element = document.createElement('div');
    element.id = instance.id;
    element.className = `component ${instance.type}`;
    element.innerHTML = this.renderComponent(instance);

    container.appendChild(element);
    instance.element = element;
  }

  /**
   * Unmount component instance
   * @param {Object} instance - Component instance
   */
  unmount(instance) {
    if (!instance.mounted) return;

    this.triggerHook(instance, 'unmount');
    if (instance.element && instance.element.parentNode) {
      instance.element.parentNode.removeChild(instance.element);
    }

    instance.destroyed = true;
    instance.lifecycle.destroyed = Date.now();
  }

  /**
   * Render component to HTML string
   * @private
   */
  renderComponent(instance) {
    // This would be replaced with actual rendering logic
    const component = this.getComponent(instance.type);
    return `<!-- ${component.name} component instance ${instance.id} -->`;
  }
}

// Export for use in Node.js or browser environments
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ComponentLibrary;
}

// Export for ES6 modules
if (typeof export !== 'undefined') {
  export default ComponentLibrary;
}
