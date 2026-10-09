# Bucks Distribution Guide

Complete distribution strategy for Bucks Web3 Browser including multi-platform releases, IPFS publishing, version management, and installer verification.

---

## 📋 Overview

Bucks uses a multi-channel distribution strategy:

1. **Primary**: GitHub Releases (latest + archives)
2. **Secondary**: IPFS Network (decentralized, censorship-resistant)
3. **Tertiary**: Official website & mirrors
4. **Fallback**: 4-gateway IPFS fallback chain

This ensures availability even if primary channels are compromised or unavailable.

---

## 🚀 Release Process

### Step 1: Version Management

```bash
# Bump version (patch, minor, or major)
node version-controller.js bump patch

# This updates:
# - package.json (root and electron/)
# - version number throughout the project
```

### Step 2: Add Changelog Entry

```bash
# Add changelog for the release
node version-controller.js changelog \
  "feature1,feature2" \
  "bugfix1,bugfix2" \
  "breaking1"

# Generates entry in CHANGELOG.md
```

### Step 3: Build Release Binaries

```bash
# Build for all platforms
node build-release.js

# Or specific platforms
node build-release.js --platforms mac,win,linux

# Options:
# --version X.Y.Z     Override version
# --no-ipfs            Skip IPFS publishing
# --platforms mac,win  Specific platforms only
```

**Output**: `dist/` directory with:
- macOS: `.dmg`, `.zip`
- Windows: `.exe`, `.msi`, `.portable.exe`
- Linux: `.AppImage`, `.deb`, `.rpm`
- `manifest.json` - Release metadata
- `CHANGELOG.md` - Release notes

### Step 4: Verify Binaries

```bash
# Checksums automatically generated in manifest.json
# Verify specific binary:

sha256sum dist/Bucks-1.1.0.dmg
# Compare with manifest.json checksums
```

### Step 5: Register IPFS Hash

```bash
# After uploading to IPFS (via Pinata, web3.storage, etc.)
node version-controller.js register-ipfs 1.1.0 QmXxxx mac
node version-controller.js register-ipfs 1.1.0 QmYyyy win
node version-controller.js register-ipfs 1.1.0 QmZzzz linux

# This creates fallback chains across 4 gateways
```

### Step 6: Register Download URLs

```bash
# Register download locations
node version-controller.js register-url 1.1.0 \
  "mac:https://github.com/bucks/releases/download/v1.1.0/Bucks-1.1.0.dmg" \
  "win:https://github.com/bucks/releases/download/v1.1.0/Bucks-1.1.0.exe" \
  "linux:https://github.com/bucks/releases/download/v1.1.0/Bucks-1.1.0.AppImage"
```

### Step 7: Create Release Snapshot

```bash
# Capture all release metadata
node version-controller.js snapshot

# Generates: releases/v1.1.0/snapshot.json
# Contains version info, hashes, URLs, system info
```

### Step 8: Export Distribution Manifest

```bash
# Final manifest for all versions
node version-controller.js manifest

# Generates: releases/manifest.json
# Use for update checks and fallback resolution
```

---

## 📦 Platform-Specific Instructions

### macOS (arm64, x64)

**Distribution Formats:**
- `.dmg` - Disk image (standard installer)
- `.zip` - Portable archive

**Code Signing:**
```bash
# Sign binary (required for distribution)
codesign --deep --force --verify --verbose \
  --sign "Developer ID Application: Your Name" \
  Bucks.app

# Notarize with Apple
xcrun altool --notarize-app \
  -f Bucks-1.1.0.dmg \
  -t osx \
  -u your@apple.id \
  -p your-app-password
```

**Hosting:**
- Primary: GitHub Releases
- Secondary: IPFS (Pinata/web3.storage)
- Fallback: Dropbox, AWS S3

### Windows (x64, ia32)

**Distribution Formats:**
- `.exe` - NSIS installer
- `.portable.exe` - Portable executable

**Code Signing:**
```bash
# Sign executable
signtool.exe sign /f certificate.pfx /p password \
  /t http://timestamp.sectigo.com \
  Bucks-1.1.0.exe
```

**Hosting:**
- Primary: GitHub Releases
- Secondary: IPFS
- Fallback: Windows Update (optional)

### Linux (x64)

**Distribution Formats:**
- `.AppImage` - Universal Linux format
- `.deb` - Debian/Ubuntu package
- `.rpm` - Fedora/RHEL package

**Hosting:**
- Primary: GitHub Releases
- Secondary: IPFS
- Tertiary: Snap Store (optional)

---

## 🌐 IPFS Distribution

### Publishing to IPFS

**Via Pinata (Recommended):**
```bash
# 1. Upload dist/ folder to Pinata
# 2. Get IPFS hash
# 3. Register with version controller

node version-controller.js register-ipfs 1.1.0 Qm... mac
```

**Via web3.storage:**
```bash
# 1. Upload files to web3.storage
# 2. Get content hash
# 3. Register with version controller
```

**Via Local IPFS Node:**
```bash
# Start local node
ipfs daemon

# Add files
ipfs add -r dist/

# Pin for permanent availability
ipfs pin add Qm...
```

### IPFS Gateway Fallback Chain

Bucks uses 4-gateway fallback for maximum availability:

1. **Primary**: `https://ipfs.io/ipfs/{hash}`
   - Largest public gateway
   - ~99.9% uptime

2. **Secondary**: `https://gateway.pinata.cloud/ipfs/{hash}`
   - Pinata's gateway
   - High performance

3. **Tertiary**: `https://cloudflare-ipfs.com/ipfs/{hash}`
   - Cloudflare's gateway
   - Excellent performance

4. **Fallback**: `https://dweb.link/ipfs/{hash}`
   - Backup gateway
   - Alternative provider

Each gateway is tried in order until success.

---

## 🔐 Security & Verification

### Checksum Verification

**Provided in manifest.json:**
```json
{
  "checksums": {
    "Bucks-1.1.0.dmg": "sha256:abcd1234...",
    "Bucks-1.1.0.exe": "sha256:efgh5678...",
    "Bucks-1.1.0.AppImage": "sha256:ijkl9012..."
  }
}
```

**User Verification:**
```bash
# macOS/Linux
sha256sum Bucks-1.1.0.dmg
# Compare with manifest

# Windows
certutil -hashfile Bucks-1.1.0.exe SHA256
# Compare with manifest
```

### Signature Verification

**macOS:**
```bash
# Check code signature
codesign -vvv Bucks.app

# Verify notarization
spctl -a -v Bucks.app
```

**Windows:**
```bash
# Check digital signature
signtool verify /pa Bucks-1.1.0.exe

# Check certificate chain
wmic datafile where name="C:\\Program Files\\Bucks\\Bucks.exe" get Version
```

---

## 📥 Installation Methods

### Standard Installer

**macOS:**
1. Download `.dmg` from GitHub Release
2. Double-click to mount disk image
3. Drag Bucks app to Applications folder
4. Eject disk image

**Windows:**
1. Download `.exe` installer from GitHub Release
2. Run installer with admin privileges
3. Follow setup wizard
4. Installer creates Start Menu shortcuts

**Linux:**
1. Download `.AppImage` from GitHub Release
2. Make executable: `chmod +x Bucks-*.AppImage`
3. Run: `./Bucks-*.AppImage`

### Portable Installation

**Windows:**
1. Download `.portable.exe`
2. Extract to desired folder (no admin needed)
3. Run `Bucks.exe`
4. No installation required

**Linux:**
```bash
# AppImage is portable by default
./Bucks-*.AppImage
```

### Package Manager

**Linux (if registered):**
```bash
# Ubuntu/Debian
sudo apt install bucks

# Fedora/RHEL
sudo dnf install bucks
```

---

## 🔄 Update Mechanism

### Update Check Process

1. **On Startup**: Check update server
2. **Query Version**: Get `releases/manifest.json`
3. **Compare Versions**: Compare installed vs latest
4. **Notify User**: Show update dialog if newer available
5. **Download**: Use primary URL, fallback to IPFS if needed
6. **Verify**: Check checksums against manifest
7. **Install**: Run installer or replace binaries
8. **Restart**: Prompt user to restart app

### Configuration

**Environment Variables:**
```bash
# Custom update server
BUCKS_UPDATE_SERVER="https://updates.example.com"

# Disable auto-check
BUCKS_AUTO_UPDATE="false"

# Check interval (hours)
BUCKS_UPDATE_CHECK_INTERVAL="24"
```

---

## 📊 Version Management

### View Release History

```bash
# List latest 10 releases
node version-controller.js list 10

# Get info for specific version
node version-controller.js info 1.1.0

# Show version statistics
node version-controller.js stats
```

### Next Release Planning

```bash
# Show recommendations for next version
node version-controller.js next

# Output:
# Current: v1.1.0
#   Patch: v1.1.1 (bug fixes)
#   Minor: v1.2.0 (new features)
#   Major: v2.0.0 (breaking changes)
```

---

## 🐛 Troubleshooting

### "Cannot verify installer"
1. Check if checksum matches manifest.json
2. Verify file wasn't corrupted during download
3. Try alternative gateway (IPFS) or GitHub release URL

### "Application won't install on macOS"
1. Check if code signature is valid: `codesign -vvv`
2. Verify notarization: `spctl -a -v`
3. Allow unsigned apps: System Preferences → Security

### "Update fails to download"
1. Check internet connection
2. Verify primary server (GitHub) is accessible
3. System automatically retries with IPFS fallback
4. Check firewall/proxy settings

### "IPFS gateway timeout"
1. Try alternative gateway manually:
   ```bash
   curl https://gateway.pinata.cloud/ipfs/Qm...
   ```
2. Check IPFS network status: `ipfs ping <hash>`
3. Re-pin with IPFS hosting service

---

## 📋 Distribution Checklist

Before releasing:

- [ ] Version bumped in package.json
- [ ] Changelog updated with release notes
- [ ] All tests passing (E2E, unit, integration)
- [ ] Code review completed
- [ ] Release notes written
- [ ] Binaries built for all platforms
- [ ] Binaries tested on target platforms
- [ ] Checksums verified
- [ ] Code signatures applied (macOS/Windows)
- [ ] Published to GitHub Releases
- [ ] Uploaded to IPFS
- [ ] IPFS hashes registered
- [ ] Download URLs registered
- [ ] Snapshot created
- [ ] Manifest exported
- [ ] Update server notified

---

## 🔗 Resources

- [IPFS Documentation](https://docs.ipfs.io/)
- [Electron Builder Docs](https://www.electron.build/)
- [Semantic Versioning](https://semver.org/)
- [Release Notes Best Practices](https://keepachangelog.com/)

---

## Support

For distribution-related issues:
- File an issue in the Bucks repository
- Check existing distribution troubleshooting docs
- Contact the development team

**Last Updated**: August 2026
**Version**: 1.0.0
