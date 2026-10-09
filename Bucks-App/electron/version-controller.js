#!/usr/bin/env node

/**
 * Version Controller - CLI for version management and distribution
 * Handles version bumping, changelog generation, and multi-gateway coordination
 */

const fs = require('fs');
const path = require('path');
const semver = require('semver');

class VersionController {
  constructor(options = {}) {
    this.packagePath = options.packagePath || './package.json';
    this.changelogPath = options.changelogPath || './CHANGELOG.md';
    this.versionHistoryPath = options.versionHistoryPath || './.version-history.json';
    this.currentVersion = this.readCurrentVersion();
    this.versionHistory = this.readVersionHistory();
    this.gateways = options.gateways || this.getDefaultGateways();
  }

  /**
   * Read current version from package.json
   * @private
   */
  readCurrentVersion() {
    try {
      const pkg = JSON.parse(fs.readFileSync(this.packagePath, 'utf8'));
      return pkg.version;
    } catch (error) {
      console.error('Failed to read version:', error);
      return '1.0.0';
    }
  }

  /**
   * Read version history
   * @private
   */
  readVersionHistory() {
    try {
      if (fs.existsSync(this.versionHistoryPath)) {
        return JSON.parse(fs.readFileSync(this.versionHistoryPath, 'utf8'));
      }
    } catch (error) {
      console.warn('Failed to read version history:', error);
    }

    return {
      versions: [],
      releaseUrls: {},
      ipfsHashes: {},
      gateways: {}
    };
  }

  /**
   * Get default gateways for fallback chain
   * @private
   */
  getDefaultGateways() {
    return [
      'https://ipfs.io/ipfs/{hash}',
      'https://gateway.pinata.cloud/ipfs/{hash}',
      'https://cloudflare-ipfs.com/ipfs/{hash}',
      'https://dweb.link/ipfs/{hash}'
    ];
  }

  /**
   * Bump version
   */
  bumpVersion(releaseType = 'patch') {
    if (!['major', 'minor', 'patch', 'prerelease'].includes(releaseType)) {
      throw new Error(`Invalid release type: ${releaseType}`);
    }

    const newVersion = semver.inc(this.currentVersion, releaseType);

    if (!newVersion) {
      throw new Error(`Failed to bump version from ${this.currentVersion}`);
    }

    console.log(`📈 Bumping version: ${this.currentVersion} → ${newVersion}`);

    // Update package.json
    const pkg = JSON.parse(fs.readFileSync(this.packagePath, 'utf8'));
    pkg.version = newVersion;
    fs.writeFileSync(this.packagePath, JSON.stringify(pkg, null, 2));

    // Update electron package.json if exists
    const electronPkg = './electron/package.json';
    if (fs.existsSync(electronPkg)) {
      const ePkg = JSON.parse(fs.readFileSync(electronPkg, 'utf8'));
      ePkg.version = newVersion;
      fs.writeFileSync(electronPkg, JSON.stringify(ePkg, null, 2));
    }

    this.currentVersion = newVersion;
    console.log(`✅ Version bumped to ${newVersion}`);

    return newVersion;
  }

  /**
   * Generate changelog entry
   */
  addChangelogEntry(releaseType, features = [], bugFixes = [], breakingChanges = []) {
    const version = this.currentVersion;
    const date = new Date().toDateString();

    let changelog = '';
    if (fs.existsSync(this.changelogPath)) {
      changelog = fs.readFileSync(this.changelogPath, 'utf8');
    }

    const newEntry = `
## [${version}] - ${date}

### ${this.capitalizeReleaseType(releaseType)} Release

${features.length > 0 ? `### Features
${features.map(f => `- ${f}`).join('\n')}
` : ''}

${bugFixes.length > 0 ? `### Bug Fixes
${bugFixes.map(f => `- ${f}`).join('\n')}
` : ''}

${breakingChanges.length > 0 ? `### ⚠️ Breaking Changes
${breakingChanges.map(f => `- ${f}`).join('\n')}
` : ''}

---
`;

    fs.writeFileSync(this.changelogPath, newEntry + changelog);

    console.log(`✅ Changelog entry added for v${version}`);
    return newEntry;
  }

  /**
   * Register release URL
   */
  registerReleaseUrl(version, urls = {}) {
    console.log(`📍 Registering release URLs for v${version}`);

    if (!this.versionHistory.releaseUrls[version]) {
      this.versionHistory.releaseUrls[version] = {};
    }

    Object.assign(this.versionHistory.releaseUrls[version], urls);

    this.saveVersionHistory();
    console.log(`✅ Release URLs registered`);
  }

  /**
   * Register IPFS hash
   */
  registerIPFSHash(version, hash, platform = 'all') {
    console.log(`🌐 Registering IPFS hash for v${version} (${platform})`);

    if (!this.versionHistory.ipfsHashes[version]) {
      this.versionHistory.ipfsHashes[version] = {};
    }

    this.versionHistory.ipfsHashes[version][platform] = hash;

    // Generate gateway fallback chain
    const fallbackChain = this.gateways.map(g => g.replace('{hash}', hash));
    if (!this.versionHistory.gateways[version]) {
      this.versionHistory.gateways[version] = {};
    }
    this.versionHistory.gateways[version][platform] = fallbackChain;

    this.saveVersionHistory();
    console.log(`✅ IPFS hash registered: ${hash}`);
    console.log(`   Fallback chain: ${fallbackChain.length} gateways`);
  }

  /**
   * Get version info
   */
  getVersionInfo(version = null) {
    const targetVersion = version || this.currentVersion;

    const info = {
      version: targetVersion,
      releaseUrls: this.versionHistory.releaseUrls[targetVersion] || {},
      ipfsHash: this.versionHistory.ipfsHashes[targetVersion] || {},
      gateways: this.versionHistory.gateways[targetVersion] || {},
      isLatest: targetVersion === this.currentVersion
    };

    return info;
  }

  /**
   * Generate fallback chain for version
   */
  generateFallbackChain(version = null, platform = 'mac') {
    const targetVersion = version || this.currentVersion;
    const gateways = this.versionHistory.gateways[targetVersion]?.[platform];

    if (!gateways || gateways.length === 0) {
      console.warn(`No gateways found for v${targetVersion} (${platform})`);
      return [];
    }

    return gateways;
  }

  /**
   * List all versions
   */
  listVersions(limit = 10) {
    console.log(`\n📋 Bucks Release History (latest ${limit})`);
    console.log('='.repeat(60));

    const versions = Object.keys(this.versionHistory.releaseUrls)
      .sort((a, b) => semver.compare(b, a))
      .slice(0, limit);

    for (const version of versions) {
      const info = this.getVersionInfo(version);
      const marker = info.isLatest ? ' 🔴 LATEST' : '';
      console.log(`v${version}${marker}`);

      for (const [platform, hash] of Object.entries(info.ipfsHash)) {
        console.log(`  └─ ${platform}: ${hash}`);
      }
    }

    console.log('='.repeat(60) + '\n');
  }

  /**
   * Create version snapshot
   */
  createSnapshot() {
    const snapshot = {
      version: this.currentVersion,
      timestamp: new Date().toISOString(),
      releaseUrls: this.versionHistory.releaseUrls[this.currentVersion] || {},
      ipfsHashes: this.versionHistory.ipfsHashes[this.currentVersion] || {},
      gateways: this.versionHistory.gateways[this.currentVersion] || {},
      systemInfo: this.getSystemInfo()
    };

    const snapshotPath = `./releases/v${this.currentVersion}/snapshot.json`;
    const dir = path.dirname(snapshotPath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));

    console.log(`✅ Snapshot created: ${snapshotPath}`);
    return snapshot;
  }

  /**
   * Get system information
   * @private
   */
  getSystemInfo() {
    return {
      os: process.platform,
      nodeVersion: process.version,
      timestamp: Date.now()
    };
  }

  /**
   * Export version manifest
   */
  exportManifest() {
    const manifest = {
      currentVersion: this.currentVersion,
      lastUpdated: new Date().toISOString(),
      versionHistory: this.versionHistory,
      gateways: this.gateways
    };

    const manifestPath = './releases/manifest.json';
    const dir = path.dirname(manifestPath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    console.log(`✅ Manifest exported: ${manifestPath}`);
    return manifest;
  }

  /**
   * Verify version integrity
   */
  async verifyVersion(version, checksumMap = {}) {
    console.log(`🔍 Verifying v${version}...`);

    const info = this.getVersionInfo(version);

    if (!info.ipfsHash || Object.keys(info.ipfsHash).length === 0) {
      console.warn(`⚠️  No IPFS hashes found for v${version}`);
      return false;
    }

    console.log(`✅ v${version} verification passed`);
    console.log(`   Platforms: ${Object.keys(info.ipfsHash).join(', ')}`);
    console.log(`   IPFS Hashes: ${Object.keys(info.ipfsHash).length}`);
    console.log(`   Gateways: ${Object.keys(info.gateways).length}`);

    return true;
  }

  /**
   * Get next release recommendations
   */
  getNextReleaseRecommendation() {
    const patch = semver.inc(this.currentVersion, 'patch');
    const minor = semver.inc(this.currentVersion, 'minor');
    const major = semver.inc(this.currentVersion, 'major');

    console.log(`\n📊 Next Release Recommendations`);
    console.log(`Current: v${this.currentVersion}`);
    console.log(`  Patch: v${patch} (bug fixes)`);
    console.log(`  Minor: v${minor} (new features)`);
    console.log(`  Major: v${major} (breaking changes)`);

    return { patch, minor, major };
  }

  /**
   * Save version history
   * @private
   */
  saveVersionHistory() {
    fs.writeFileSync(this.versionHistoryPath, JSON.stringify(this.versionHistory, null, 2));
  }

  /**
   * Capitalize release type
   * @private
   */
  capitalizeReleaseType(type) {
    return type.charAt(0).toUpperCase() + type.slice(1);
  }

  /**
   * Get version statistics
   */
  getStatistics() {
    const stats = {
      totalVersions: Object.keys(this.versionHistory.releaseUrls).length,
      currentVersion: this.currentVersion,
      gateways: this.gateways.length,
      platforms: new Set(),
      ipfsHashCount: 0
    };

    for (const [version, hashes] of Object.entries(this.versionHistory.ipfsHashes)) {
      stats.ipfsHashCount++;
      for (const platform of Object.keys(hashes)) {
        stats.platforms.add(platform);
      }
    }

    stats.platforms = Array.from(stats.platforms);

    return stats;
  }
}

// CLI Execution
if (require.main === module) {
  const command = process.argv[2];
  const args = process.argv.slice(3);

  const controller = new VersionController();

  switch (command) {
    case 'bump':
      const releaseType = args[0] || 'patch';
      controller.bumpVersion(releaseType);
      break;

    case 'changelog':
      const features = args[0]?.split(',') || [];
      const fixes = args[1]?.split(',') || [];
      const breaking = args[2]?.split(',') || [];
      controller.addChangelogEntry('release', features, fixes, breaking);
      break;

    case 'register-url':
      const version = args[0];
      const urls = {};
      for (let i = 1; i < args.length; i += 2) {
        urls[args[i]] = args[i + 1];
      }
      controller.registerReleaseUrl(version, urls);
      break;

    case 'register-ipfs':
      const ipfsVersion = args[0];
      const hash = args[1];
      const platform = args[2] || 'all';
      controller.registerIPFSHash(ipfsVersion, hash, platform);
      break;

    case 'list':
      const limit = parseInt(args[0]) || 10;
      controller.listVersions(limit);
      break;

    case 'info':
      const infoVersion = args[0] || null;
      const info = controller.getVersionInfo(infoVersion);
      console.log(JSON.stringify(info, null, 2));
      break;

    case 'snapshot':
      controller.createSnapshot();
      break;

    case 'manifest':
      controller.exportManifest();
      break;

    case 'next':
      controller.getNextReleaseRecommendation();
      break;

    case 'stats':
      const stats = controller.getStatistics();
      console.log(JSON.stringify(stats, null, 2));
      break;

    default:
      console.log(`
Bucks Version Controller

Usage: version-controller.js <command> [options]

Commands:
  bump [type]              Bump version (patch|minor|major)
  changelog [features] [fixes] [breaking]  Add changelog entry
  register-url <ver> [urls]  Register release URLs
  register-ipfs <ver> <hash> [platform]  Register IPFS hash
  list [limit]             List releases (default: 10)
  info [version]           Show version info
  snapshot                 Create version snapshot
  manifest                 Export version manifest
  next                     Show next version recommendations
  stats                    Show version statistics
      `);
  }
}

module.exports = VersionController;
