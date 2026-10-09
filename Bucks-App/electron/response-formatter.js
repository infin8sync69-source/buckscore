/**
 * RESPONSE FORMATTER
 *
 * Formats agent responses based on intent type.
 * Uses Bucks branding. Clean, professional layout.
 * Rates information quality and template design.
 */

class ResponseFormatter {
  /**
   * Response templates by intent
   */
  static TEMPLATES = {
    question: {
      name: 'Question Response',
      intro: 'Here is what I found:',
      layout: 'narrative',
      rating: {
        information: 8,
        design: 7
      }
    },
    generation: {
      name: 'Generated Content',
      intro: 'Generated content:',
      layout: 'code',
      rating: {
        information: 9,
        design: 8
      }
    },
    search: {
      name: 'Search Results',
      intro: 'Search results found:',
      layout: 'list',
      rating: {
        information: 8,
        design: 7
      }
    },
    assistance: {
      name: 'Assistance',
      intro: 'How I can help:',
      layout: 'steps',
      rating: {
        information: 7,
        design: 6
      }
    },
    analysis: {
      name: 'Analysis',
      intro: 'Analysis results:',
      layout: 'structured',
      rating: {
        information: 9,
        design: 8
      }
    },
    default: {
      name: 'Response',
      intro: 'Here is my response:',
      layout: 'narrative',
      rating: {
        information: 6,
        design: 6
      }
    }
  };

  /**
   * Format response based on intent
   */
  static format(response, intent = 'default') {
    const template = this.TEMPLATES[intent] || this.TEMPLATES.default;

    return {
      header: {
        title: template.name,
        intent: intent,
        rating: template.rating
      },
      content: this.formatContent(response, template.layout),
      template: template,
      timestamp: new Date().toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit'
      })
    };
  }

  /**
   * Format content based on layout type
   */
  static formatContent(response, layout) {
    switch (layout) {
      case 'code':
        return this.formatCode(response);
      case 'list':
        return this.formatList(response);
      case 'steps':
        return this.formatSteps(response);
      case 'structured':
        return this.formatStructured(response);
      default:
        return this.formatNarrative(response);
    }
  }

  /**
   * Format narrative response
   */
  static formatNarrative(text) {
    return {
      type: 'text',
      content: text,
      sections: text.split('\n\n').filter(s => s.trim())
    };
  }

  /**
   * Format code response
   */
  static formatCode(text) {
    const codeBlocks = text.match(/```[\s\S]*?```/g) || [];
    const language = this.detectLanguage(codeBlocks[0] || '');

    return {
      type: 'code',
      language: language,
      content: text,
      blocks: codeBlocks.map(block => ({
        lang: this.detectLanguage(block),
        code: block.replace(/```/g, '').trim()
      }))
    };
  }

  /**
   * Format list response
   */
  static formatList(text) {
    const items = text.split('\n')
      .filter(line => line.trim())
      .map(line => line.replace(/^[-*•]\s*/, '').trim());

    return {
      type: 'list',
      items: items,
      count: items.length
    };
  }

  /**
   * Format step-by-step response
   */
  static formatSteps(text) {
    const lines = text.split('\n').filter(l => l.trim());
    const steps = [];
    let current = null;

    for (const line of lines) {
      if (/^\d+\./.test(line)) {
        if (current) steps.push(current);
        current = {
          number: parseInt(line),
          description: line.replace(/^\d+\.\s*/, '').trim(),
          details: []
        };
      } else if (current && line.trim()) {
        current.details.push(line.trim());
      }
    }
    if (current) steps.push(current);

    return {
      type: 'steps',
      steps: steps,
      total: steps.length
    };
  }

  /**
   * Format structured response (key-value pairs)
   */
  static formatStructured(text) {
    const pairs = {};
    const lines = text.split('\n');

    for (const line of lines) {
      const match = line.match(/^([^:]+):\s*(.*)$/);
      if (match) {
        pairs[match[1].trim()] = match[2].trim();
      }
    }

    return {
      type: 'structured',
      data: pairs,
      fields: Object.keys(pairs).length
    };
  }

  /**
   * Detect programming language from code block
   */
  static detectLanguage(codeBlock) {
    if (!codeBlock) return 'text';

    const langMatch = codeBlock.match(/```(\w+)/);
    if (langMatch) return langMatch[1];

    if (codeBlock.includes('function') || codeBlock.includes('const ')) return 'javascript';
    if (codeBlock.includes('def ')) return 'python';
    if (codeBlock.includes('class ')) return 'java';
    if (codeBlock.includes('SELECT ') || codeBlock.includes('INSERT ')) return 'sql';

    return 'text';
  }

  /**
   * Get rating for a template
   */
  static getRating(intent) {
    const template = this.TEMPLATES[intent] || this.TEMPLATES.default;
    return {
      intent: intent,
      template: template.name,
      information: template.rating.information,
      design: template.rating.design,
      overall: Math.round((template.rating.information + template.rating.design) / 2)
    };
  }

  /**
   * Test 10 different response types
   */
  static generateTestResponses() {
    return [
      {
        id: 1,
        intent: 'question',
        message: 'What is blockchain technology?',
        response: 'Blockchain is a distributed ledger that records transactions across a network. Each block contains cryptographically linked data, making it secure and immutable.',
        rating: this.getRating('question')
      },
      {
        id: 2,
        intent: 'generation',
        message: 'Write a JavaScript function to check if a number is prime',
        response: '```javascript\nfunction isPrime(num) {\n  if (num < 2) return false;\n  for (let i = 2; i < num; i++) {\n    if (num % i === 0) return false;\n  }\n  return true;\n}\n```',
        rating: this.getRating('generation')
      },
      {
        id: 3,
        intent: 'search',
        message: 'Find information about Web3',
        response: '- Web3 is the next iteration of the internet\n- Uses blockchain and decentralized protocols\n- Emphasizes user ownership of data\n- Built on distributed networks',
        rating: this.getRating('search')
      },
      {
        id: 4,
        intent: 'assistance',
        message: 'Help me set up Bucks',
        response: '1. Download the installer from bucks.global\n2. Run the installation script\n3. Configure your wallet\n4. Start browsing with local-first privacy',
        rating: this.getRating('assistance')
      },
      {
        id: 5,
        intent: 'analysis',
        message: 'Analyze this transaction pattern',
        response: 'Transaction Volume: 1000+\nAverage Size: 0.5 BTC\nFrequency: Hourly\nStatus: Normal\nRisk Level: Low',
        rating: this.getRating('analysis')
      },
      {
        id: 6,
        intent: 'question',
        message: 'How does Bucks differ from Chrome?',
        response: 'Bucks prioritizes local-first architecture and privacy. Unlike Chrome, it uses IPFS for distributed content delivery and supports local businesses through its marketplace.',
        rating: this.getRating('question')
      },
      {
        id: 7,
        intent: 'generation',
        message: 'Create a Python script for data processing',
        response: '```python\nimport pandas as pd\n\ndef process_data(filename):\n    df = pd.read_csv(filename)\n    df = df.dropna()\n    return df.describe()\n```',
        rating: this.getRating('generation')
      },
      {
        id: 8,
        intent: 'search',
        message: 'Find local resources',
        response: '- Coffee shops: 5 nearby\n- Libraries: 3 within 2km\n- Community centers: 2 active\n- Local markets: 4 in area',
        rating: this.getRating('search')
      },
      {
        id: 9,
        intent: 'default',
        message: 'Tell me a fact',
        response: 'The internet was designed to be decentralized, but became increasingly centralized. Bucks brings back the distributed spirit of the original web.',
        rating: this.getRating('default')
      },
      {
        id: 10,
        intent: 'assistance',
        message: 'How to use IPFS with Bucks',
        response: '1. IPFS is integrated into Bucks\n2. Files are automatically pinned\n3. Access content via hash\n4. Share securely with peers',
        rating: this.getRating('assistance')
      }
    ];
  }
}

module.exports = { ResponseFormatter };
