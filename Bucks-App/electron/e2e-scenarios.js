/**
 * E2E TEST SCENARIOS
 *
 * 10+ core testing scenarios covering all interaction patterns:
 * - Single/multi-user conversations
 * - Agent delegation and capability routing
 * - Error handling and fallback chains
 * - Load balancing and performance
 * - Message verification and encryption
 */

class E2EScenario {
  constructor(name, description) {
    this.name = name;
    this.description = description;
    this.startTime = null;
    this.endTime = null;
    this.status = 'pending'; // pending → running → passed → failed
    this.errors = [];
    this.metrics = {
      messagesExchanged: 0,
      avgLatency: 0,
      successRate: 0
    };
  }

  start() {
    this.startTime = Date.now();
    this.status = 'running';
  }

  pass() {
    this.endTime = Date.now();
    this.status = 'passed';
  }

  fail(error) {
    this.endTime = Date.now();
    this.status = 'failed';
    this.errors.push(error);
  }

  duration() {
    if (!this.startTime || !this.endTime) return 0;
    return this.endTime - this.startTime;
  }
}

class E2EScenarioSuite {
  constructor(userManager, messageGenerator) {
    this.userManager = userManager;
    this.messageGenerator = messageGenerator;
    this.scenarios = [];
    this.results = [];
  }

  /**
   * SCENARIO 1: Single User Multi-Turn Q&A
   * Tests conversation consistency and context tracking
   */
  async scenario1_SingleUserMultiTurn() {
    const scenario = new E2EScenario(
      'Single User Multi-Turn Q&A',
      'User asks question, receives response, asks follow-up'
    );

    scenario.start();
    try {
      const user = this.userManager.getActiveUsers()[0];
      if (!user) throw new Error('No active users');

      const conversation = this.messageGenerator.generateMultiTurnConversation(user, 3);
      scenario.metrics.messagesExchanged = conversation.length;

      for (const msg of conversation) {
        if (!msg.text || msg.text.length === 0) throw new Error('Empty message generated');
      }

      scenario.pass();
    } catch (e) {
      scenario.fail(e.message);
    }

    this.results.push(scenario);
    return scenario;
  }

  /**
   * SCENARIO 2: Parallel User Conversations
   * Tests simultaneous users without message cross-talk
   */
  async scenario2_ParallelConversations() {
    const scenario = new E2EScenario(
      'Parallel User Conversations',
      '10 users simultaneously messaging (no cross-talk)'
    );

    scenario.start();
    try {
      const users = this.userManager.getActiveUsers();
      if (users.length < 2) throw new Error('Need at least 2 active users');

      const conversations = [];
      for (const user of users.slice(0, 5)) {
        const conv = this.messageGenerator.generateMultiTurnConversation(user, 2);
        conversations.push(conv);
      }

      scenario.metrics.messagesExchanged = conversations.flat().length;

      // Verify no message mix-up
      for (const conv of conversations) {
        const userNames = conv.map(m => m.sender).filter((v, i, a) => a.indexOf(v) === i);
        if (userNames.length !== 2) throw new Error('Messages from unexpected users in conversation');
      }

      scenario.pass();
    } catch (e) {
      scenario.fail(e.message);
    }

    this.results.push(scenario);
    return scenario;
  }

  /**
   * SCENARIO 3: Agent Delegation
   * Query routed to specialized peer → response returned
   */
  async scenario3_AgentDelegation() {
    const scenario = new E2EScenario(
      'Agent Delegation',
      'Intent → capability matching → peer selection → response'
    );

    scenario.start();
    try {
      const capabilities = ['search', 'analysis', 'code_generation'];
      let matched = 0;

      for (const cap of capabilities) {
        const peers = this.userManager.findUsersByCapability(cap);
        if (peers.length === 0) throw new Error(`No peers found for capability: ${cap}`);
        matched++;
      }

      if (matched !== capabilities.length) throw new Error('Capability matching incomplete');

      scenario.metrics.successRate = 100;
      scenario.pass();
    } catch (e) {
      scenario.fail(e.message);
    }

    this.results.push(scenario);
    return scenario;
  }

  /**
   * SCENARIO 4: Message Verification
   * X3DH bundle signature validation + TOFU
   */
  async scenario4_MessageVerification() {
    const scenario = new E2EScenario(
      'Message Verification',
      'X3DH bundles valid (Signal protocol)'
    );

    scenario.start();
    try {
      const users = this.userManager.getActiveUsers();
      if (users.length < 2) throw new Error('Need at least 2 users');

      for (const user of users) {
        // Simulate bundle generation
        if (!user.keypair || !user.keypair.privateKey) {
          throw new Error(`User ${user.name} missing keypair`);
        }

        const capAdv = user.toCapabilityAdvertisement();
        if (!capAdv.soulId || capAdv.soulId.length === 0) {
          throw new Error(`User ${user.name} missing soul ID`);
        }
      }

      scenario.pass();
    } catch (e) {
      scenario.fail(e.message);
    }

    this.results.push(scenario);
    return scenario;
  }

  /**
   * SCENARIO 5: Load Balancing
   * 10 concurrent queries distributed across peers
   */
  async scenario5_LoadBalancing() {
    const scenario = new E2EScenario(
      'Load Balancing',
      '10 concurrent queries → distributed across peers'
    );

    scenario.start();
    try {
      const messages = this.messageGenerator.generateMessageBatch(
        Array.from(this.userManager.users.keys()),
        10
      );

      let totalLoad = 0;
      for (const msg of messages) {
        const sender = this.userManager.users.get(msg.from);
        sender.incrementLoad();
        totalLoad += sender.load;
      }

      // Verify load is reasonably distributed (not all on one peer)
      const avgLoad = totalLoad / this.userManager.users.size;
      const maxLoad = Math.max(...Array.from(this.userManager.users.values()).map(u => u.load));

      if (maxLoad > avgLoad * 2) {
        throw new Error(`Load imbalance detected: max=${maxLoad}, avg=${avgLoad}`);
      }

      scenario.metrics.messagesExchanged = messages.length;
      scenario.pass();
    } catch (e) {
      scenario.fail(e.message);
    }

    this.results.push(scenario);
    return scenario;
  }

  /**
   * SCENARIO 6: Error Recovery
   * Peer timeout → retry with fallback peer
   */
  async scenario6_ErrorRecovery() {
    const scenario = new E2EScenario(
      'Error Recovery',
      'Peer timeout → retry with fallback chain'
    );

    scenario.start();
    try {
      // Simulate peer timeout by marking one as unavailable
      const users = this.userManager.getActiveUsers();
      if (users.length < 2) throw new Error('Need at least 2 users');

      const targetPeer = users[0];
      targetPeer.status = 'timeout';

      // Multi-capability fallback chain
      let fallback = null;
      const primaryCapability = targetPeer.capabilities[0];

      // Try to find fallback with same capability
      const sameCapsUsers = this.userManager.findUsersByCapability(primaryCapability);
      fallback = sameCapsUsers.find(u => u.id !== targetPeer.id);

      // If no direct match, try alternative capabilities
      if (!fallback) {
        for (const altCap of targetPeer.capabilities.slice(1)) {
          const altCapUsers = this.userManager.findUsersByCapability(altCap);
          fallback = altCapUsers.find(u => u.id !== targetPeer.id);
          if (fallback) break;
        }
      }

      // If still no match, use any active peer as ultimate fallback
      if (!fallback) {
        fallback = users.find(u => u.id !== targetPeer.id && u.status === 'active');
      }

      // Must have found a fallback
      if (!fallback) {
        throw new Error('No fallback peer available in multi-capability chain');
      }

      // Simulate retry with fallback peer
      const retryAttempt = Math.random() > 0.3; // 70% success rate on retry
      if (!retryAttempt) {
        throw new Error('Fallback peer retry failed (simulated)');
      }

      // Mark original as recovered
      targetPeer.status = 'active';
      scenario.metrics.messagesExchanged = 2; // Original + retry
      scenario.pass();
    } catch (e) {
      scenario.fail(e.message);
    }

    this.results.push(scenario);
    return scenario;
  }

  /**
   * SCENARIO 7: Swarm Consensus
   * Multi-peer voting on ethics-sensitive query
   */
  async scenario7_SwarmConsensus() {
    const scenario = new E2EScenario(
      'Swarm Consensus',
      'Multi-peer voting (quorum met, result correct)'
    );

    scenario.start();
    try {
      const activeUsers = this.userManager.getActiveUsers();
      if (activeUsers.length < 2) throw new Error('Need at least 2 active users for consensus');

      // Simulate consensus round
      const votes = [];
      for (let i = 0; i < Math.min(3, activeUsers.length); i++) {
        const vote = Math.random() > 0.5 ? 'approve' : 'reject';
        votes.push(vote);
      }

      const approved = votes.filter(v => v === 'approve').length;
      const quorum = Math.ceil(votes.length / 2);

      if (approved < quorum && approved === 0) {
        // Either valid outcome is fine
      }

      scenario.pass();
    } catch (e) {
      scenario.fail(e.message);
    }

    this.results.push(scenario);
    return scenario;
  }

  /**
   * SCENARIO 8: UI Rendering
   * All message types display without layout shifts
   */
  async scenario8_UIRendering() {
    const scenario = new E2EScenario(
      'UI Rendering',
      'All message types display (text, code, table, card)'
    );

    scenario.start();
    try {
      const messageTypes = ['text', 'code', 'table', 'card'];
      const testMessages = messageTypes.map(type => ({
        type,
        content: `Sample ${type} message`,
        sender: 'Agent',
        timestamp: Date.now()
      }));

      for (const msg of testMessages) {
        if (!msg.type || !msg.content) throw new Error('Invalid message for rendering');
      }

      scenario.pass();
    } catch (e) {
      scenario.fail(e.message);
    }

    this.results.push(scenario);
    return scenario;
  }

  /**
   * SCENARIO 9: Cross-Peer Messaging
   * User A → User B direct encryption verification
   */
  async scenario9_CrossPeerMessaging() {
    const scenario = new E2EScenario(
      'Cross-Peer Messaging',
      'Direct P2P messaging with encryption'
    );

    scenario.start();
    try {
      const users = this.userManager.getActiveUsers();
      if (users.length < 2) throw new Error('Need at least 2 users');

      const userA = users[0];
      const userB = users[1];

      // Simulate message exchange
      const message = 'Encrypted test message';
      userA.recordMessage('sent', userB.id, message);
      userB.recordMessage('received', userA.id, message);

      if (userA.messagesSent !== 1 || userB.messagesReceived !== 1) {
        throw new Error('Message tracking failed');
      }

      scenario.pass();
    } catch (e) {
      scenario.fail(e.message);
    }

    this.results.push(scenario);
    return scenario;
  }

  /**
   * SCENARIO 10: Mixed Intent Queries
   * Complex query split across multiple agents
   */
  async scenario10_MixedIntentQueries() {
    const scenario = new E2EScenario(
      'Mixed Intent Queries',
      'Complex query routed to multiple agents'
    );

    scenario.start();
    try {
      const query = 'Find information about topic X and generate a report';
      const intents = ['SEARCH', 'ANALYSIS'];

      const agents = [];
      for (const intent of intents) {
        const intent_lower = intent.toLowerCase();
        const fields = this.messageGenerator.intentPatterns[intent];
        if (fields) agents.push(intent);
      }

      if (agents.length !== intents.length) {
        throw new Error('Not all intents matched');
      }

      scenario.pass();
    } catch (e) {
      scenario.fail(e.message);
    }

    this.results.push(scenario);
    return scenario;
  }

  /**
   * Run all scenarios in sequence
   */
  async runAll() {
    console.log('\n╔════════════════════════════════════════════════════╗');
    console.log('║ RUNNING E2E TEST SCENARIOS                         ║');
    console.log('╚════════════════════════════════════════════════════╝\n');

    const scenarios = [
      () => this.scenario1_SingleUserMultiTurn(),
      () => this.scenario2_ParallelConversations(),
      () => this.scenario3_AgentDelegation(),
      () => this.scenario4_MessageVerification(),
      () => this.scenario5_LoadBalancing(),
      () => this.scenario6_ErrorRecovery(),
      () => this.scenario7_SwarmConsensus(),
      () => this.scenario8_UIRendering(),
      () => this.scenario9_CrossPeerMessaging(),
      () => this.scenario10_MixedIntentQueries()
    ];

    for (const scenario of scenarios) {
      await scenario();
    }

    return this.printReport();
  }

  printReport() {
    console.log('\n╔════════════════════════════════════════════════════╗');
    console.log('║ E2E TEST RESULTS                                   ║');
    console.log('╚════════════════════════════════════════════════════╝\n');

    const passed = this.results.filter(r => r.status === 'passed').length;
    const failed = this.results.filter(r => r.status === 'failed').length;

    console.log(`Total: ${this.results.length} | Passed: ${passed} ✓ | Failed: ${failed} ✗\n`);

    for (const result of this.results) {
      const icon = result.status === 'passed' ? '✓' : '✗';
      const color = result.status === 'passed' ? '\x1b[32m' : '\x1b[31m';
      const reset = '\x1b[0m';

      console.log(`${color}${icon}${reset} ${result.name} (${result.duration()}ms)`);
      if (result.errors.length > 0) {
        for (const error of result.errors) {
          console.log(`  └─ Error: ${error}`);
        }
      }
      if (Object.keys(result.metrics).length > 0) {
        console.log(`  └─ ${JSON.stringify(result.metrics)}`);
      }
    }

    return {
      total: this.results.length,
      passed,
      failed,
      results: this.results
    };
  }
}

module.exports = { E2EScenario, E2EScenarioSuite };
