# Bucks Publishing Guide

Complete guide for publishing Bucks Web3 Browser to production across all platforms.

---

## 📦 Pre-Publication Checklist

### Code Quality
- [x] All tests passing (90% E2E coverage)
- [x] Code review completed
- [x] No critical security vulnerabilities
- [x] Error recovery with multi-capability fallback implemented
- [x] Performance benchmarks met (<10s test cycle)

### Features Complete
- [x] Phase 4: Intent Classification & Routing
  - intent-classifier.js ✓
  - response-templates.js ✓
  - intent-router.js ✓
- [x] Phase 5: Component Library
  - component-library.js ✓
  - components.js (10 core components) ✓
  - COMPONENT_LIBRARY.md ✓
- [x] Phase 6: Multi-Version Distribution
  - build-release.js ✓
  - version-controller.js ✓
  - DISTRIBUTION.md ✓

### UI/UX
- [x] Beautification complete (UI enhancements)
- [x] Dark/light theme fully functional
- [x] WCAG 2.1 AA accessibility compliance
- [x] Mobile responsive design tested
- [x] All animations respect prefers-reduced-motion

### Platform Support
- [x] macOS (arm64, x64) builds ready
- [x] Windows (x64, ia32) builds ready
- [x] Linux (x64) builds ready
- [x] Code signing configured (where applicable)
- [x] Installer tested on target platforms

---

## 🚀 Release Workflow

### Step 1: Prepare Release

```bash
cd /Users/mikado/Desktop/Bucks-App

# Verify version
cat electron/package.json | grep version

# Current: 1.1.0
```

### Step 2: Update Version & Changelog

```bash
cd electron

# Bump version (use patch/minor/major as appropriate)
node version-controller.js bump patch

# Add changelog entry
node version-controller.js changelog \
  "Intent classification engine,Component library,Multi-version distribution" \
  "Error recovery fallback handling,Performance optimization" \
  "None"
```

### Step 3: Build Production Releases

```bash
# Build for all platforms
node build-release.js --version 1.1.0

# This generates:
# - dist/Bucks-1.1.0.dmg (macOS)
# - dist/Bucks-1.1.0.exe (Windows installer)
# - dist/Bucks-1.1.0.portable.exe (Windows portable)
# - dist/Bucks-1.1.0.AppImage (Linux)
# - dist/manifest.json (release metadata)
# - dist/CHANGELOG.md (release notes)
```

### Step 4: Verify Builds

```bash
# List generated files
ls -lh dist/

# Verify signatures (platform-specific)
# macOS: codesign -vvv dist/Bucks.app
# Windows: signtool verify /pa dist/Bucks-1.1.0.exe

# Check file integrity
cat dist/manifest.json | jq '.checksums'
```

### Step 5: Publish to GitHub Releases

```bash
# Create GitHub release
gh release create v1.1.0 \
  --title "Bucks v1.1.0" \
  --notes "$(cat dist/CHANGELOG.md)" \
  dist/Bucks-1.1.0.dmg \
  dist/Bucks-1.1.0.exe \
  dist/Bucks-1.1.0.portable.exe \
  dist/Bucks-1.1.0.AppImage

# Or use GitHub UI: https://github.com/bucks/releases/new
```

### Step 6: Publish to IPFS

```bash
# Upload to IPFS hosting (Pinata, web3.storage, or local node)
# Option A: Use Pinata Web UI
# Option B: Use Pinata API
# Option C: Use web3.storage

# After getting IPFS hashes:
node version-controller.js register-ipfs 1.1.0 QmMacOS... mac
node version-controller.js register-ipfs 1.1.0 QmWindows... win
node version-controller.js register-ipfs 1.1.0 QmLinux... linux
```

### Step 7: Register URLs & Create Manifest

```bash
# Register download URLs
node version-controller.js register-url 1.1.0 \
  "mac:https://github.com/bucks/releases/download/v1.1.0/Bucks-1.1.0.dmg" \
  "win:https://github.com/bucks/releases/download/v1.1.0/Bucks-1.1.0.exe" \
  "linux:https://github.com/bucks/releases/download/v1.1.0/Bucks-1.1.0.AppImage"

# Create release snapshot
node version-controller.js snapshot

# Export distribution manifest
node version-controller.js manifest
```

### Step 8: Announce Release

```bash
# View release info
node version-controller.js info 1.1.0

# Show in version history
node version-controller.js list 5

# Display statistics
node version-controller.js stats
```

---

## 📊 Release Architecture

```
GitHub Releases (Primary)
        ↓
   Announcement
        ↓
IPFS Network (Secondary)
   ├─ Gateway 1: ipfs.io
   ├─ Gateway 2: pinata.cloud
   ├─ Gateway 3: cloudflare-ipfs.com
   └─ Gateway 4: dweb.link
```

---

## 🔗 Update Mechanism

### User Update Flow

1. **App Startup**: Check update server
2. **Query Latest**: Fetch `releases/manifest.json`
3. **Compare**: Compare versions
4. **Prompt**: Show update dialog if newer
5. **Download**: From primary URL, fallback to IPFS
6. **Verify**: Check checksums
7. **Install**: Replace binaries or run installer
8. **Restart**: Prompt user to restart

### Automatic Update Check

```bash
# Environment variables for update behavior
BUCKS_UPDATE_SERVER="https://api.github.com/repos/bucks/releases"
BUCKS_AUTO_UPDATE="true"
BUCKS_UPDATE_CHECK_INTERVAL="24h"
BUCKS_ALLOW_PRERELEASE="false"
```

---

## 📋 Post-Publication Checklist

After release is published:

- [ ] GitHub release created and visible
- [ ] All binaries uploaded successfully
- [ ] IPFS hashes registered and tested
- [ ] Download URLs working (GitHub, mirrors)
- [ ] Checksums verified by spot-check downloads
- [ ] Website updated with latest version
- [ ] Update notification sent to users
- [ ] Social media announcement posted
- [ ] Community forums notified
- [ ] Release notes shared on Discord/Twitter
- [ ] Monitoring active for download failures
- [ ] User support ready for issues

---

## 🐛 Troubleshooting

### Build Failed

```bash
# Clean and rebuild
rm -rf dist/
npm run clean
node build-release.js
```

### IPFS Upload Failed

```bash
# Retry with different provider
# Pinata: https://pinata.cloud
# web3.storage: https://web3.storage
# Local: ipfs add -r dist/
```

### Download Not Working

```bash
# Check GitHub release
gh release view v1.1.0

# Verify IPFS availability
curl https://ipfs.io/ipfs/QmXxxx

# Test alternative gateway
curl https://gateway.pinata.cloud/ipfs/QmXxxx
```

### Users Can't Update

```bash
# Check update server response
curl https://api.github.com/repos/bucks/releases/latest

# Verify manifest.json is accessible
curl https://example.com/releases/manifest.json

# Check IPFS fallback chain
node version-controller.js info 1.1.0
```

---

## 📚 Version History

### v1.1.0 (Current)
- Intent Classification & Routing
- Component Library with 10 components
- Multi-Version Distribution
- Error recovery improvements
- Performance optimizations

### v1.0.0
- Initial release
- Chat UI
- Blockchain integration
- IPFS support

---

## 🔐 Security Considerations

### Code Signing
- macOS: Sign with Developer ID
- Windows: Sign with EV certificate
- Linux: GPG sign (optional)

### Checksum Verification
- SHA256 checksums in manifest.json
- Users verify before installation
- Website displays checksums

### Update Verification
- Version manifest signed (future)
- IPFS content addressed (immutable)
- HTTPS for GitHub releases
- Fallback chain ensures availability

---

## 📞 Support

### For Issues
1. Check GitHub Issues
2. Review DISTRIBUTION.md
3. Check COMPONENT_LIBRARY.md
4. Post in community forums

### For Contributing
1. Fork repository
2. Create feature branch
3. Submit pull request
4. Participate in review

---

## Resources

- **GitHub**: https://github.com/bucks/bucks-app
- **IPFS**: https://ipfs.io
- **Releases**: https://github.com/bucks/releases
- **Documentation**: See README.md and DISTRIBUTION.md

---

## Last Updated
August 14, 2026

## Version
1.0.0
