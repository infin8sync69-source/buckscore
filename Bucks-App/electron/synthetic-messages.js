/**
 * SYNTHETIC MESSAGE GENERATOR
 *
 * Generates realistic multi-turn conversations with varied response styles.
 * Supports different query intents and personality-driven responses.
 */

class MessageGenerator {
  constructor(userManager) {
    this.userManager = userManager;
    this.conversationTemplates = this.initTemplates();
    this.intentPatterns = this.initIntentPatterns();
  }

  initTemplates() {
    return {
      // SEARCH intent
      search: [
        { query: 'What is {topic}?', responses: [
          'The concept of {topic} refers to...',
          'Based on current research, {topic} is defined as...',
          'Here\'s what I found about {topic}...'
        ]},
        { query: 'How do I find {topic}?', responses: [
          'To locate {topic}, you can try searching for...',
          'The best way to find {topic} is through...',
          'I\'d recommend looking for {topic} in these places...'
        ]}
      ],

      // ANALYSIS intent
      analysis: [
        { query: 'Analyze {content}', responses: [
          'Looking at {content}, the key points are: 1) {point1}, 2) {point2}, 3) {point3}',
          'Upon analysis of {content}, we can identify: • {finding1} • {finding2} • {finding3}',
          'The analysis reveals: {content} shows patterns in...'
        ]},
        { query: 'Compare {item1} and {item2}', responses: [
          '{item1} vs {item2}: {item1} is better at X, while {item2} excels at Y',
          'Comparing {item1} and {item2}: Similarities include... Differences: {item1}..., {item2}...',
          'Here\'s the breakdown: {item1} – advantages/disadvantages, {item2} – advantages/disadvantages'
        ]}
      ],

      // CREATION intent
      creation: [
        { query: 'Write me {content}', responses: [
          'Here\'s a {content} for you:\n\n{generated_text}',
          'I\'ve written a {content}:\n\n{generated_text}',
          'Here\'s your {content}:\n\n{generated_text}'
        ]},
        { query: 'Generate {code_type} code', responses: [
          'Here\'s {code_type} code for you:\n```\n{code_block}\n```',
          'Here\'s the {code_type} implementation:\n```\n{code_block}\n```',
          '{code_type} example:\n```\n{code_block}\n```'
        ]}
      ],

      // EXECUTION intent
      execution: [
        { query: 'Open {url}', responses: [
          'Opening {url} now...',
          'Loading {url}...',
          'I\'ll navigate to {url} for you.'
        ]},
        { query: 'Schedule {task}', responses: [
          '{task} scheduled for {time}.',
          'I\'ve scheduled {task}. You\'ll get a reminder {when}.',
          '{task} is now on your calendar for {time}.'
        ]}
      ],

      // ERROR intent
      debugging: [
        { query: 'Why is {issue} happening?', responses: [
          '{issue} occurs because... The root cause is typically...',
          'The issue with {issue} usually stems from...',
          '{issue} can happen when: • Cause 1, • Cause 2, • Cause 3'
        ]},
        { query: 'How do I fix {problem}?', responses: [
          'To fix {problem}, try: 1) Step 1, 2) Step 2, 3) Step 3',
          'Here are the steps to resolve {problem}: • {step1} • {step2}',
          'The solution to {problem} involves...'
        ]}
      ],

      // META intent
      meta: [
        { query: 'What can you do?', responses: [
          'I can help you with: searching, analyzing, writing, coding, scheduling, browsing...',
          'My capabilities include: {capabilities}',
          'I\'m specialized in: research, analysis, content creation, code generation...'
        ]},
        { query: 'Are you {attribute}?', responses: [
          'Yes, I am {attribute}.',
          'I\'d describe myself as {attribute}.',
          'In terms of {attribute}, yes - I\'m specifically...'
        ]}
      ],

      // SOCIAL intent
      social: [
        { query: 'Hi, how are you?', responses: [
          'Hello! I\'m doing well, thanks for asking. How can I help you today?',
          'Hey there! I\'m ready to assist. What do you need help with?',
          'Hi! All systems running smoothly. What\'s on your mind?'
        ]},
        { query: 'Thanks!', responses: [
          'You\'re welcome! Happy to help.',
          'Glad I could assist!',
          'Anytime! Feel free to ask if you need anything else.'
        ]}
      ]
    };
  }

  initIntentPatterns() {
    return {
      SEARCH: { keywords: ['what', 'find', 'search', 'look', 'tell me about', 'how to find'] },
      ANALYSIS: { keywords: ['analyze', 'compare', 'summarize', 'explain', 'break down'] },
      CREATION: { keywords: ['write', 'generate', 'create', 'code', 'design', 'compose'] },
      EXECUTION: { keywords: ['open', 'schedule', 'run', 'do', 'execute', 'go to'] },
      DEBUGGING: { keywords: ['error', 'bug', 'broken', 'fix', 'debug', 'wrong', 'issue'] },
      META: { keywords: ['can you', 'are you', 'what can', 'capabilities', 'help', 'able'] },
      SOCIAL: { keywords: ['hi', 'hello', 'thanks', 'please', 'how are you', 'nice'] }
    };
  }

  classifyIntent(text) {
    const lower = text.toLowerCase();
    for (const [intent, pattern] of Object.entries(this.intentPatterns)) {
      if (pattern.keywords.some(kw => lower.includes(kw))) {
        return intent;
      }
    }
    return 'SEARCH'; // default
  }

  generateResponse(intent, query, user) {
    const templates = this.conversationTemplates[intent.toLowerCase()] || this.conversationTemplates.search;
    if (!templates || templates.length === 0) {
      return `[Response from ${user.name}] I've processed your query about: ${query}`;
    }

    const template = templates[Math.floor(Math.random() * templates.length)];
    const responseTemplate = template.responses[Math.floor(Math.random() * template.responses.length)];

    // Simple variable substitution
    let response = responseTemplate
      .replace(/{topic}/g, 'the topic')
      .replace(/{content}/g, query)
      .replace(/{item1}/g, 'item 1')
      .replace(/{item2}/g, 'item 2')
      .replace(/{code_type}/g, 'JavaScript')
      .replace(/{code_block}/g, 'function example() {\n  return "Hello, World!";\n}')
      .replace(/{task}/g, 'your task')
      .replace(/{time}/g, 'tomorrow at 10am')
      .replace(/{when}/g, 'at the scheduled time')
      .replace(/{issue}/g, 'this')
      .replace(/{problem}/g, 'this issue')
      .replace(/{capabilities}/g, user.capabilities.join(', '))
      .replace(/{attribute}/g, 'helpful');

    return response;
  }

  generateMultiTurnConversation(user, iterations = 3) {
    const conversation = [];
    let context = 'Help me with something useful';

    for (let i = 0; i < iterations; i++) {
      const intent = this.classifyIntent(context);
      const userQuery = {
        type: 'message',
        sender: 'user',
        text: context,
        intent,
        timestamp: Date.now() + (i * 2000)
      };
      conversation.push(userQuery);

      const agentResponse = this.generateResponse(intent, context, user);
      const agentMsg = {
        type: 'message',
        sender: user.name,
        text: agentResponse,
        timestamp: Date.now() + (i * 2000) + 1000
      };
      conversation.push(agentMsg);

      // Generate follow-up context
      if (i < iterations - 1) {
        const followUps = [
          `Can you elaborate more on that?`,
          `What else can you tell me about it?`,
          `How does that work in practice?`,
          `Any other relevant points?`,
          `Can you provide an example?`
        ];
        context = followUps[Math.floor(Math.random() * followUps.length)];
      }
    }

    return conversation;
  }

  /**
   * Generate synthetic message batches for testing
   */
  generateMessageBatch(userIds, count = 10, delayMs = 100) {
    const messages = [];
    const users = userIds.map(id => this.userManager.users.get(id)).filter(u => u);

    for (let i = 0; i < count; i++) {
      const sender = users[Math.floor(Math.random() * users.length)];
      const receiver = users[Math.floor(Math.random() * users.length)];

      if (sender.id === receiver.id) continue; // Skip self-messages

      const intents = ['SEARCH', 'ANALYSIS', 'CREATION', 'EXECUTION', 'META'];
      const intent = intents[Math.floor(Math.random() * intents.length)];

      const query = `Query from ${sender.name} to ${receiver.name}`;
      const response = this.generateResponse(intent, query, receiver);

      messages.push({
        from: sender.id,
        to: receiver.id,
        query,
        response,
        intent,
        timestamp: Date.now() + (i * delayMs),
        latency: 50 + Math.random() * 450 // 50-500ms latency
      });
    }

    return messages;
  }
}

module.exports = { MessageGenerator };
