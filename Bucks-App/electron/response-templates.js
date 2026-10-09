/**
 * Response Templates - Template registry and selector for intent-based responses
 * Maps intents to response formats with contextual variations
 */

class ResponseTemplates {
  constructor() {
    this.templates = {
      'search': {
        summary: 'Quick summary of findings',
        detailed: 'Comprehensive research results',
        list: 'Bullet-point list of results',
        comparison: 'Side-by-side comparison',
        timeline: 'Chronological or step-by-step guide',
        sources: 'Cited sources with references'
      },
      'transaction': {
        confirmation: 'Transaction confirmation with details',
        preview: 'Preview before execution',
        status: 'Real-time status updates',
        receipt: 'Transaction receipt and history',
        error: 'Error handling with recovery steps'
      },
      'navigation': {
        redirect: 'Direct navigation to page',
        breadcrumb: 'Navigation path with steps',
        menu: 'Menu options and choices',
        suggestion: 'Suggested pages or sections',
        error: 'Page not found with alternatives'
      },
      'settings': {
        form: 'Configuration form',
        toggle: 'Simple on/off toggle',
        selector: 'Multi-option selector',
        preview: 'Live preview of changes',
        confirmation: 'Confirmation before applying'
      },
      'help': {
        tutorial: 'Step-by-step tutorial',
        faq: 'Frequently asked questions',
        guide: 'User guide or manual',
        video: 'Video tutorial link',
        support: 'Support contact information'
      },
      'command': {
        started: 'Command started indicator',
        progress: 'Progress bar or status',
        completed: 'Completion confirmation',
        error: 'Error message with recovery',
        log: 'Execution log or output'
      },
      'general': {
        greeting: 'Friendly greeting response',
        acknowledgment: 'Simple acknowledgment',
        prompt: 'Prompt for more information',
        suggestion: 'Helpful suggestion'
      }
    };

    this.responseStyles = {
      formal: { tone: 'professional', length: 'detailed', emoji: false },
      casual: { tone: 'friendly', length: 'medium', emoji: true },
      concise: { tone: 'direct', length: 'brief', emoji: false },
      verbose: { tone: 'thorough', length: 'comprehensive', emoji: false }
    };

    this.formatters = new Map();
    this.initializeFormatters();
  }

  /**
   * Initialize built-in formatters
   * @private
   */
  initializeFormatters() {
    this.formatters.set('markdown', (content) => {
      return { format: 'markdown', content, rendered: true };
    });

    this.formatters.set('html', (content) => {
      return { format: 'html', content, rendered: true };
    });

    this.formatters.set('json', (content) => {
      return { format: 'json', content: JSON.stringify(content, null, 2), rendered: true };
    });

    this.formatters.set('plain', (content) => {
      return { format: 'plain', content, rendered: false };
    });

    this.formatters.set('card', (content) => {
      return {
        format: 'card',
        content,
        rendered: true,
        style: 'glass-morphism'
      };
    });

    this.formatters.set('table', (data) => {
      if (!Array.isArray(data)) return null;
      return {
        format: 'table',
        content: data,
        rendered: true,
        columns: Object.keys(data[0] || {})
      };
    });

    this.formatters.set('code', (content, language = 'javascript') => {
      return {
        format: 'code',
        content,
        language,
        rendered: true
      };
    });
  }

  /**
   * Get response template for an intent
   * @param {string} intent - The intent type
   * @param {string} templateType - The template type (optional)
   * @returns {Object} - Response template configuration
   */
  getTemplate(intent, templateType = null) {
    const intentTemplates = this.templates[intent];

    if (!intentTemplates) {
      return this.getTemplate('general', 'suggestion');
    }

    if (templateType && intentTemplates[templateType]) {
      return {
        intent,
        templateType,
        description: intentTemplates[templateType],
        formatter: this.getDefaultFormatter(intent, templateType)
      };
    }

    // Return default template if type not specified
    const defaultType = Object.keys(intentTemplates)[0];
    return {
      intent,
      templateType: defaultType,
      description: intentTemplates[defaultType],
      formatter: this.getDefaultFormatter(intent, defaultType)
    };
  }

  /**
   * Get all available templates for an intent
   * @param {string} intent - The intent type
   * @returns {Object} - All templates for the intent
   */
  getTemplatesForIntent(intent) {
    return this.templates[intent] || {};
  }

  /**
   * Select best template based on context
   * @param {string} intent - The intent type
   * @param {Object} context - Contextual information
   * @returns {Object} - Selected template configuration
   */
  selectTemplate(intent, context = {}) {
    const templates = this.getTemplatesForIntent(intent);

    // Selection logic based on context
    let selectedType = 'summary'; // default

    if (context.format) {
      selectedType = context.format;
    } else if (context.length === 'brief') {
      selectedType = 'summary';
    } else if (context.length === 'detailed') {
      selectedType = 'detailed';
    } else if (context.showSources) {
      selectedType = 'sources';
    } else if (context.isList) {
      selectedType = 'list';
    }

    return this.getTemplate(intent, selectedType);
  }

  /**
   * Format response content
   * @param {string} intent - The intent type
   * @param {*} content - The content to format
   * @param {Object} options - Formatting options
   * @returns {Object} - Formatted response
   */
  formatResponse(intent, content, options = {}) {
    const template = this.selectTemplate(intent, options);
    const formatter = options.formatter || template.formatter || 'markdown';

    let formatFunction = this.formatters.get(formatter);
    if (!formatFunction) {
      formatFunction = this.formatters.get('markdown');
    }

    const formatted = formatFunction(content);

    return {
      intent,
      template: template.templateType,
      ...formatted,
      style: options.style || this.getStyleForIntent(intent),
      timestamp: Date.now()
    };
  }

  /**
   * Get recommended style for an intent
   * @private
   */
  getStyleForIntent(intent) {
    const styleMap = {
      'search': 'detailed',
      'transaction': 'formal',
      'navigation': 'casual',
      'settings': 'formal',
      'help': 'verbose',
      'command': 'concise',
      'general': 'casual'
    };

    return styleMap[intent] || 'casual';
  }

  /**
   * Get default formatter for intent and template
   * @private
   */
  getDefaultFormatter(intent, templateType) {
    const formatterMap = {
      'search/detailed': 'markdown',
      'search/list': 'list',
      'search/comparison': 'table',
      'search/sources': 'markdown',
      'transaction/confirmation': 'card',
      'transaction/receipt': 'markdown',
      'settings/form': 'card',
      'settings/preview': 'card',
      'command/log': 'code',
      'help/tutorial': 'markdown',
      'help/faq': 'markdown'
    };

    const key = `${intent}/${templateType}`;
    return formatterMap[key] || 'markdown';
  }

  /**
   * Create custom template
   * @param {string} intent - Intent to add template to
   * @param {string} templateName - Name of new template
   * @param {string} description - Template description
   */
  addCustomTemplate(intent, templateName, description) {
    if (!this.templates[intent]) {
      this.templates[intent] = {};
    }

    this.templates[intent][templateName] = description;
  }

  /**
   * Register custom formatter
   * @param {string} name - Formatter name
   * @param {Function} formatterFunction - Formatting function
   */
  registerFormatter(name, formatterFunction) {
    if (typeof formatterFunction === 'function') {
      this.formatters.set(name, formatterFunction);
    }
  }

  /**
   * Get all registered formatters
   * @returns {Array} - Array of formatter names
   */
  getFormatters() {
    return Array.from(this.formatters.keys());
  }

  /**
   * Generate response wrapper with metadata
   * @param {string} intent - The intent type
   * @param {*} content - Response content
   * @param {Object} metadata - Additional metadata
   * @returns {Object} - Complete response object
   */
  generateResponse(intent, content, metadata = {}) {
    const formatted = this.formatResponse(intent, content, metadata);

    return {
      ...formatted,
      metadata: {
        intent,
        confidence: metadata.confidence || 0.85,
        peer: metadata.peer || null,
        queryTime: metadata.queryTime || 0,
        ...metadata
      },
      headers: {
        'Content-Type': formatted.format,
        'X-Intent-Type': intent,
        'X-Template-Type': formatted.template
      }
    };
  }

  /**
   * Get template statistics
   * @returns {Object} - Statistics about available templates
   */
  getStatistics() {
    const stats = {
      totalIntents: Object.keys(this.templates).length,
      totalTemplates: 0,
      byIntent: {},
      formattersAvailable: this.getFormatters().length
    };

    for (const [intent, templates] of Object.entries(this.templates)) {
      stats.byIntent[intent] = Object.keys(templates).length;
      stats.totalTemplates += Object.keys(templates).length;
    }

    return stats;
  }

  /**
   * List all available templates
   * @returns {Object} - Complete template registry
   */
  listAllTemplates() {
    return JSON.parse(JSON.stringify(this.templates));
  }

  /**
   * Export template configuration
   * @returns {string} - JSON representation of templates
   */
  export() {
    return JSON.stringify({
      templates: this.templates,
      styles: this.responseStyles,
      formatters: this.getFormatters(),
      timestamp: new Date().toISOString()
    }, null, 2);
  }

  /**
   * Import template configuration
   * @param {string} jsonConfig - JSON template configuration
   */
  import(jsonConfig) {
    try {
      const config = JSON.parse(jsonConfig);
      if (config.templates) {
        this.templates = { ...this.templates, ...config.templates };
      }
      if (config.styles) {
        this.responseStyles = { ...this.responseStyles, ...config.styles };
      }
    } catch (error) {
      console.error('Failed to import template configuration:', error);
    }
  }
}

// Export for use in Node.js or browser environments
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ResponseTemplates;
}

// Export for ES6 modules
if (typeof export !== 'undefined') {
  export default ResponseTemplates;
}
