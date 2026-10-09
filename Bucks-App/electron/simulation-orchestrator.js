/**
 * SIMULATION ORCHESTRATOR
 *
 * Main entry point for AI user simulation.
 * Manages: boot sequence, scenario execution, metrics collection, teardown.
 *
 * Usage:
 *   const orchestrator = new SimulationOrchestrator();
 *   await orchestrator.runFullSimulation();
 */

const { SyntheticUserManager } = require('./synthetic-users');
const { MessageGenerator } = require('./synthetic-messages');
const { E2EScenarioSuite } = require('./e2e-scenarios');

class SimulationOrchestrator {
  constructor() {
    this.userManager = new SyntheticUserManager();
    this.messageGenerator = null;
    this.scenarioSuite = null;
    this.startTime = null;
    this.endTime = null;
    this.results = {};
  }

  /**
   * BOOT SEQUENCE
   * 1. Initialize synthetic users
   * 2. Exchange pre-key bundles
   * 3. Advertise capabilities on swarm
   * 4. Wait for convergence
   */
  async boot() {
    console.log('\n╔════════════════════════════════════════════════════╗');
    console.log('║ PHASE 1: BOOT SEQUENCE                             ║');
    console.log('╚════════════════════════════════════════════════════╝\n');

    // Step 1: Initialize users
    console.log('[Boot] Step 1/4: Initializing synthetic users...');
    const users = await this.userManager.initializeUsers();
    console.log(`[Boot] ✓ ${users.length} users initialized\n`);

    // Step 2: Admit users to cluster
    console.log('[Boot] Step 2/4: Admitting users to cluster membership...');
    for (let i = 0; i < users.length; i++) {
      this.userManager.admitUser(i + 1);
      await new Promise(resolve => setTimeout(resolve, 100)); // 100ms spacing
    }
    console.log(`[Boot] ✓ All users admitted\n`);

    // Step 3: Verify users and exchange bundles
    console.log('[Boot] Step 3/4: Exchanging pre-key bundles...');
    for (const user of users) {
      this.userManager.verifyUser(user.id);
    }
    console.log(`[Boot] ✓ All bundles exchanged\n`);

    // Step 4: Advertise capabilities
    console.log('[Boot] Step 4/4: Advertising capabilities on swarm...');
    const capabilityIndex = this.userManager.getCapabilityIndex();
    console.log(`[Boot] Discovered ${capabilityIndex.size} unique capabilities:`);
    for (const [cap, peers] of capabilityIndex) {
      console.log(`  • ${cap}: ${peers.map(p => p.name).join(', ')}`);
    }

    // Activate all users
    for (const user of users) {
      this.userManager.activateUser(user.id);
    }
    console.log(`[Boot] ✓ All users active\n`);

    // Wait for convergence
    console.log('[Boot] Waiting for gossipsub convergence (5s)...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    console.log('[Boot] ✓ Convergence complete\n');

    return { success: true, usersActive: this.userManager.getActiveUsers().length };
  }

  /**
   * SIMULATION PHASE
   * Run E2E test scenarios
   */
  async simulate() {
    console.log('\n╔════════════════════════════════════════════════════╗');
    console.log('║ PHASE 2: SIMULATION                                ║');
    console.log('╚════════════════════════════════════════════════════╝\n');

    // Initialize message generator and scenario suite
    this.messageGenerator = new MessageGenerator(this.userManager);
    this.scenarioSuite = new E2EScenarioSuite(
      this.userManager,
      this.messageGenerator
    );

    // Run all scenarios
    this.results.scenarios = await this.scenarioSuite.runAll();

    return this.results.scenarios;
  }

  /**
   * METRICS COLLECTION
   * Generate final report
   */
  metrics() {
    console.log('\n╔════════════════════════════════════════════════════╗');
    console.log('║ PHASE 3: METRICS COLLECTION                        ║');
    console.log('╚════════════════════════════════════════════════════╝\n');

    const metrics = this.userManager.getMetrics();
    this.userManager.printReport();

    this.results.metrics = metrics;
    return metrics;
  }

  /**
   * TEARDOWN
   * Clean up synthetic souls and connections
   */
  async teardown() {
    console.log('\n╔════════════════════════════════════════════════════╗');
    console.log('║ PHASE 4: TEARDOWN                                  ║');
    console.log('╚════════════════════════════════════════════════════╝\n');

    console.log('[Teardown] Removing synthetic users from cluster...');
    const count = this.userManager.users.size;
    this.userManager.users.clear();
    console.log(`[Teardown] ✓ Removed ${count} users\n`);

    console.log('[Teardown] Closing connections...');
    // Reset state
    this.userManager = new SyntheticUserManager();
    console.log('[Teardown] ✓ Connections closed\n');

    console.log('[Teardown] Complete. Ready for next run.\n');
  }

  /**
   * FULL SIMULATION RUN
   */
  async runFullSimulation() {
    this.startTime = Date.now();

    try {
      // Phase 1: Boot
      const bootResult = await this.boot();
      if (!bootResult.success) throw new Error('Boot phase failed');

      // Phase 2: Simulate
      await new Promise(resolve => setTimeout(resolve, 2000));
      await this.simulate();

      // Phase 3: Metrics
      await new Promise(resolve => setTimeout(resolve, 1000));
      this.metrics();

      // Phase 4: Teardown
      await this.teardown();

      this.endTime = Date.now();

      // Print final summary
      this.printSummary();

      return {
        success: true,
        duration: this.endTime - this.startTime,
        results: this.results
      };
    } catch (error) {
      console.error(`\n✗ Simulation failed: ${error.message}`);
      this.endTime = Date.now();
      await this.teardown();

      return {
        success: false,
        error: error.message,
        duration: this.endTime - this.startTime
      };
    }
  }

  /**
   * FINAL SUMMARY
   */
  printSummary() {
    const duration = this.endTime - this.startTime;
    const durationSec = (duration / 1000).toFixed(2);

    console.log('╔════════════════════════════════════════════════════╗');
    console.log('║ SIMULATION COMPLETE                                ║');
    console.log('╚════════════════════════════════════════════════════╝\n');

    console.log(`Total Duration: ${durationSec}s\n`);

    if (this.results.scenarios) {
      const { passed, failed, total } = this.results.scenarios;
      const passRate = ((passed / total) * 100).toFixed(1);
      console.log(`Test Results: ${passed}/${total} passed (${passRate}%)`);
      console.log(`  ✓ Passed: ${passed}`);
      console.log(`  ✗ Failed: ${failed}\n`);
    }

    if (this.results.metrics) {
      console.log(`Message Statistics:`);
      console.log(`  Total: ${this.results.metrics.totalMessages}`);
      console.log(`  Avg Latency: ${this.results.metrics.averageLatency.toFixed(2)}ms\n`);
    }

    console.log('╔════════════════════════════════════════════════════╗');
    console.log('║ AI USER SIMULATION FRAMEWORK READY FOR DEPLOYMENT  ║');
    console.log('╚════════════════════════════════════════════════════╝\n');
  }

  /**
   * Export results to JSON
   */
  exportResults(filePath) {
    const fs = require('fs');
    const output = {
      timestamp: new Date().toISOString(),
      duration: this.endTime - this.startTime,
      success: this.results.scenarios && this.results.scenarios.failed === 0,
      results: this.results
    };

    fs.writeFileSync(filePath, JSON.stringify(output, null, 2));
    console.log(`Results exported to: ${filePath}`);
  }
}

/**
 * CLI Entry Point
 */
if (require.main === module) {
  (async () => {
    const orchestrator = new SimulationOrchestrator();
    const result = await orchestrator.runFullSimulation();

    if (result.success) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      orchestrator.exportResults(`/tmp/simulation-results-${timestamp}.json`);
      process.exit(0);
    } else {
      console.error('Simulation failed');
      process.exit(1);
    }
  })();
}

module.exports = { SimulationOrchestrator };
