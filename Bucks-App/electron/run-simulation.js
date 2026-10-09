#!/usr/bin/env node
/**
 * RUN SIMULATION - CLI Entry Point
 *
 * Usage:
 *   node run-simulation.js [--export /path/to/file.json]
 */

const { SimulationOrchestrator } = require('./simulation-orchestrator');
const path = require('path');

async function main() {
  const args = process.argv.slice(2);
  const exportPath = args.includes('--export')
    ? args[args.indexOf('--export') + 1]
    : null;

  console.log('\n');
  console.log('╔════════════════════════════════════════════════════╗');
  console.log('║  BUCKS AI USER SIMULATION FRAMEWORK                ║');
  console.log('║  Simulating 10 AI agents with E2E testing          ║');
  console.log('╚════════════════════════════════════════════════════╝');

  const orchestrator = new SimulationOrchestrator();

  try {
    const result = await orchestrator.runFullSimulation();

    if (exportPath) {
      orchestrator.exportResults(exportPath);
    }

    // Exit with appropriate code
    process.exit(result.success ? 0 : 1);
  } catch (error) {
    console.error('\nFatal error:', error);
    process.exit(1);
  }
}

main();
