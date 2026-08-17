/**
 * deploy.ts — Master deployment script for the Bucks contract suite.
 *
 * Deployment order:
 *   1. ContractRegistry  — protocol address book
 *   2. BucksTransfer     — user↔user transfers and payment agreements
 *   3. BucksEscrow       — conditional escrow
 *   4. CommunityTreasury — community governance & treasury (example instance)
 *   5. BusinessAgreement — business milestone contracts
 *
 * All contracts are registered in ContractRegistry after deployment.
 *
 * Usage:
 *   npx hardhat run scripts/deploy.ts --network bucks
 *   npx hardhat run scripts/deploy.ts --network localhost
 */

import { ethers, network } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const SOUL_ENGINE_ADDRESS: string =
  process.env.SOUL_ENGINE_ADDRESS ?? ethers.ZeroAddress;

const COMMUNITY_NAME        = 'Bucks Genesis Community';
const COMMUNITY_DESCRIPTION = 'The founding community of the Bucks Network';
const COMMUNITY_FEE         = ethers.parseEther('0'); // free to join
const COMMUNITY_VOTING      = 3 * 24 * 60 * 60;       // 3 days in seconds
const COMMUNITY_QUORUM      = 3000;                    // 30%
const COMMUNITY_SOUL_GATED  = false;                   // open membership

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function separator(label: string) {
  const line = '─'.repeat(60);
  console.log(`\n${line}`);
  console.log(`  ${label}`);
  console.log(`${line}`);
}

function addr(a: string) { return a.slice(0, 6) + '…' + a.slice(-4); }

async function registerContract(
  registry: Awaited<ReturnType<typeof ethers.getContractAt>>,
  name: string,
  address: string,
  meta: string
) {
  const tx = await (registry as any).registerByName(name, address, meta);
  await tx.wait();
  console.log(`  ✓  Registered "${name}" → ${addr(address)}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log(`\n${'═'.repeat(62)}`);
  console.log(`  Bucks Contract Suite — Deployment`);
  console.log(`  Network   : ${network.name}  (Chain ID ${(await ethers.provider.getNetwork()).chainId})`);
  console.log(`  Deployer  : ${deployer.address}`);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`  Balance   : ${ethers.formatEther(balance)} BUCKS`);
  console.log(`  SoulEngine: ${SOUL_ENGINE_ADDRESS === ethers.ZeroAddress ? 'disabled (dev mode)' : SOUL_ENGINE_ADDRESS}`);
  console.log(`${'═'.repeat(62)}`);

  const deployments: Record<string, string> = {};

  // ─── 1. ContractRegistry ──────────────────────────────────────────────────

  separator('1 / 5  ContractRegistry');

  const RegistryFactory = await ethers.getContractFactory('ContractRegistry');
  const registry        = await RegistryFactory.deploy();
  await registry.waitForDeployment();

  const registryAddress = await registry.getAddress();
  deployments['ContractRegistry'] = registryAddress;
  console.log(`  Deployed at ${registryAddress}`);

  // Self-register.
  await registerContract(registry, 'ContractRegistry', registryAddress, 'v0.1.0');

  // ─── 2. BucksTransfer ─────────────────────────────────────────────────────

  separator('2 / 5  BucksTransfer');

  const TransferFactory = await ethers.getContractFactory('BucksTransfer');
  const transfer        = await TransferFactory.deploy(SOUL_ENGINE_ADDRESS);
  await transfer.waitForDeployment();

  const transferAddress = await transfer.getAddress();
  deployments['BucksTransfer'] = transferAddress;
  console.log(`  Deployed at ${transferAddress}`);
  await registerContract(registry, 'BucksTransfer', transferAddress, 'v0.1.0');

  // ─── 3. BucksEscrow ───────────────────────────────────────────────────────

  separator('3 / 5  BucksEscrow');

  const EscrowFactory = await ethers.getContractFactory('BucksEscrow');
  const escrow        = await EscrowFactory.deploy(
    SOUL_ENGINE_ADDRESS,
    deployer.address   // fee collector — deployer for now, transfer post-deploy
  );
  await escrow.waitForDeployment();

  const escrowAddress = await escrow.getAddress();
  deployments['BucksEscrow'] = escrowAddress;
  console.log(`  Deployed at ${escrowAddress}`);
  await registerContract(registry, 'BucksEscrow', escrowAddress, 'v0.1.0');

  // ─── 4. CommunityTreasury ─────────────────────────────────────────────────

  separator('4 / 5  CommunityTreasury');

  const CommunityFactory = await ethers.getContractFactory('CommunityTreasury');
  const community        = await CommunityFactory.deploy(
    COMMUNITY_NAME,
    COMMUNITY_DESCRIPTION,
    COMMUNITY_FEE,
    COMMUNITY_VOTING,
    COMMUNITY_QUORUM,
    COMMUNITY_SOUL_GATED,
    SOUL_ENGINE_ADDRESS
  );
  await community.waitForDeployment();

  const communityAddress = await community.getAddress();
  deployments['CommunityTreasury'] = communityAddress;
  console.log(`  Deployed at ${communityAddress}`);
  console.log(`  Name      : ${COMMUNITY_NAME}`);
  console.log(`  Voting    : ${COMMUNITY_VOTING / 86400} days  |  Quorum: ${COMMUNITY_QUORUM / 100}%`);
  await registerContract(registry, 'CommunityTreasury', communityAddress, 'v0.1.0');

  // ─── 5. BusinessAgreement ─────────────────────────────────────────────────

  separator('5 / 5  BusinessAgreement');

  const BusinessFactory = await ethers.getContractFactory('BusinessAgreement');
  const business        = await BusinessFactory.deploy(
    SOUL_ENGINE_ADDRESS,
    deployer.address   // protocol admin / arbiter
  );
  await business.waitForDeployment();

  const businessAddress = await business.getAddress();
  deployments['BusinessAgreement'] = businessAddress;
  console.log(`  Deployed at ${businessAddress}`);
  await registerContract(registry, 'BusinessAgreement', businessAddress, 'v0.1.0');

  // ─── Summary ──────────────────────────────────────────────────────────────

  separator('Deployment Summary');

  for (const [name, address] of Object.entries(deployments)) {
    console.log(`  ${name.padEnd(22)} ${address}`);
  }

  // Persist to deployments/ folder for reference.
  const outDir = path.join(__dirname, '..', 'deployments');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const outFile = path.join(outDir, `${network.name}.json`);
  const out = {
    network:    network.name,
    chainId:    Number((await ethers.provider.getNetwork()).chainId),
    deployedAt: new Date().toISOString(),
    deployer:   deployer.address,
    soulEngine: SOUL_ENGINE_ADDRESS,
    contracts:  deployments,
  };
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
  console.log(`\n  Saved to deployments/${network.name}.json`);

  console.log(`\n${'═'.repeat(62)}`);
  console.log(`  Done. Registry: ${registryAddress}`);
  console.log(`  All contracts discoverable via lookupByName().`);
  console.log(`${'═'.repeat(62)}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
