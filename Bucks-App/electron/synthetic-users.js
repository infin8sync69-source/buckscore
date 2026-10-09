/**
 * SYNTHETIC USERS FRAMEWORK
 *
 * Defines 10 AI user personas for comprehensive E2E testing.
 * Each persona has unique capabilities, personality markers, and load tracking.
 * Integrates with existing cluster membership and agent swarm systems.
 */

const crypto = require('crypto');
const signalStore = require('./signal-store');

class SyntheticUser {
  constructor(id, name, specialties, capabilities) {
    this.id = id;
    this.name = name;
    this.specialties = specialties;
    this.capabilities = capabilities;

    // Generate mock keypair
    this.keypair = crypto.generateKeyPairSync('ed25519');
    this.soulId = crypto.createHash('sha256')
      .update(this.name + this.id)
      .digest('hex')
      .slice(0, 32);

    // Status tracking
    this.status = 'pending'; // pending → admitted → verified → active
    this.load = 0;
    this.maxLoad = 5;
    this.lastHeartbeat = Date.now();
    this.messagesSent = 0;
    this.messagesReceived = 0;
    this.conversationHistory = new Map(); // peerId → messages[]
  }

  incrementLoad() {
    if (this.load < this.maxLoad) this.load++;
  }

  decrementLoad() {
    if (this.load > 0) this.load--;
  }

  recordMessage(direction, peerId, message) {
    if (direction === 'sent') this.messagesSent++;
    if (direction === 'received') this.messagesReceived++;

    if (!this.conversationHistory.has(peerId)) {
      this.conversationHistory.set(peerId, []);
    }
    this.conversationHistory.get(peerId).push({
      direction,
      timestamp: Date.now(),
      text: message
    });
  }

  toCapabilityAdvertisement() {
    return {
      nodeId: this.soulId,
      soulId: this.soulId.slice(0, 16),
      worldSoulHash: this.soulId.slice(0, 16),
      model: this.specialties[0] + '-model',
      modelReady: true,
      capabilities: this.capabilities,
      tools: this.capabilities.length,
      load: this.load,
      maxLoad: this.maxLoad,
      locality: 'global',
      status: this.status,
      ts: Date.now(),
      displayName: this.name
    };
  }
}

/**
 * USER PERSONAS - 10 AI specialists
 */
const USER_PERSONAS = [
  new SyntheticUser(
    1,
    'SearchMaster',
    ['search', 'retrieval', 'qa'],
    ['search', 'retrieval', 'knowledge_base', 'indexing']
  ),
  new SyntheticUser(
    2,
    'AnalysisBot',
    ['analysis', 'data_processing', 'insights'],
    ['analysis', 'summarization', 'comparison', 'synthesis']
  ),
  new SyntheticUser(
    3,
    'ResearchAgent',
    ['research', 'documentation', 'writing'],
    ['research', 'citation', 'documentation', 'academic_writing']
  ),
  new SyntheticUser(
    4,
    'BrowserControl',
    ['web_automation', 'navigation', 'interaction'],
    ['browser_control', 'web_scraping', 'interaction', 'screenshot']
  ),
  new SyntheticUser(
    5,
    'TaskRunner',
    ['execution', 'automation', 'workflow'],
    ['execution', 'tool_use', 'automation', 'workflow_management']
  ),
  new SyntheticUser(
    6,
    'ScheduleBot',
    ['scheduling', 'planning', 'coordination'],
    ['scheduling', 'calendar', 'reminders', 'coordination']
  ),
  new SyntheticUser(
    7,
    'CodeGenerator',
    ['coding', 'generation', 'debugging'],
    ['code_generation', 'programming', 'debugging', 'syntax']
  ),
  new SyntheticUser(
    8,
    'CreativeWriter',
    ['writing', 'content_creation', 'storytelling'],
    ['creative_writing', 'content_generation', 'storytelling', 'editing']
  ),
  new SyntheticUser(
    9,
    'DesignArtist',
    ['design', 'visual_creation', 'aesthetics'],
    ['design', 'image_generation', 'visual_composition', 'styling']
  ),
  new SyntheticUser(
    10,
    'Coordinator',
    ['orchestration', 'planning', 'multi_step_tasks'],
    ['coordination', 'task_delegation', 'planning', 'synthesis']
  )
];

class SyntheticUserManager {
  constructor() {
    this.users = new Map();
    this.peerIdToUser = new Map(); // map gossipsub peerId → user
    this.metrics = {
      totalMessages: 0,
      totalMessagesSent: 0,
      totalMessagesReceived: 0,
      totalLatency: 0,
      messageCount: 0,
      errors: []
    };
  }

  async initializeUsers() {
    console.log('[SyntheticUsers] Initializing 10 AI user personas...');

    for (const user of USER_PERSONAS) {
      this.users.set(user.id, user);
      user.status = 'initialized';
      console.log(`  ✓ ${user.name} (ID: ${user.id}, Capabilities: ${user.capabilities.join(', ')})`);
    }

    console.log(`[SyntheticUsers] Initialized ${this.users.size} users`);
    return Array.from(this.users.values());
  }

  getUserByName(name) {
    return Array.from(this.users.values()).find(u => u.name === name);
  }

  getAllUsers() {
    return Array.from(this.users.values());
  }

  getCapabilityIndex() {
    // Build an index of capability → users who have it
    const index = new Map();
    for (const user of this.users.values()) {
      for (const capability of user.capabilities) {
        if (!index.has(capability)) index.set(capability, []);
        index.get(capability).push(user);
      }
    }
    return index;
  }

  findUsersByCapability(capability) {
    const users = Array.from(this.users.values())
      .filter(u => u.capabilities.includes(capability) && u.load < u.maxLoad);
    return users.sort((a, b) => a.load - b.load); // Return least-loaded first
  }

  recordMessage(senderId, receiverId, message, latency) {
    const sender = this.users.get(senderId);
    const receiver = this.users.get(receiverId);

    if (sender && receiver) {
      sender.recordMessage('sent', receiverId, message);
      receiver.recordMessage('received', senderId, message);

      this.metrics.totalMessagesSent++;
      this.metrics.totalMessagesReceived++;
      this.metrics.totalMessages++;
      this.metrics.totalLatency += latency;
      this.metrics.messageCount++;
    }
  }

  getMetrics() {
    return {
      ...this.metrics,
      averageLatency: this.metrics.messageCount > 0
        ? this.metrics.totalLatency / this.metrics.messageCount
        : 0,
      userStats: Array.from(this.users.values()).map(u => ({
        name: u.name,
        status: u.status,
        load: u.load,
        maxLoad: u.maxLoad,
        messagesSent: u.messagesSent,
        messagesReceived: u.messagesReceived,
        capabilities: u.capabilities
      }))
    };
  }

  admitUser(userId) {
    const user = this.users.get(userId);
    if (user) {
      user.status = 'admitted';
      user.lastHeartbeat = Date.now();
      return true;
    }
    return false;
  }

  verifyUser(userId) {
    const user = this.users.get(userId);
    if (user) {
      user.status = 'verified';
      return true;
    }
    return false;
  }

  activateUser(userId) {
    const user = this.users.get(userId);
    if (user) {
      user.status = 'active';
      return true;
    }
    return false;
  }

  getActiveUsers() {
    return Array.from(this.users.values()).filter(u => u.status === 'active');
  }

  printReport() {
    console.log('\n╔═══════════════════════════════════════════════════════╗');
    console.log('║ SYNTHETIC USER METRICS                                ║');
    console.log('╚═══════════════════════════════════════════════════════╝\n');

    const metrics = this.getMetrics();
    console.log(`Total Messages: ${metrics.totalMessages}`);
    console.log(`  Sent: ${metrics.totalMessagesSent}`);
    console.log(`  Received: ${metrics.totalMessagesReceived}`);
    console.log(`Average Latency: ${metrics.averageLatency.toFixed(2)}ms`);
    console.log(`Errors: ${metrics.errors.length}\n`);

    console.log('User Status:');
    for (const stat of metrics.userStats) {
      const loadBar = '█'.repeat(Math.floor(stat.load / stat.maxLoad * 10)) +
                     '░'.repeat(10 - Math.floor(stat.load / stat.maxLoad * 10));
      console.log(`  ${stat.name.padEnd(20)} [${loadBar}] ${stat.status} (${stat.messagesSent}↑ ${stat.messagesReceived}↓)`);
    }
  }
}

module.exports = {
  SyntheticUser,
  SyntheticUserManager,
  USER_PERSONAS
};
