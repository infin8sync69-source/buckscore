# 08. Product and UX: one surface

## 8.1 What Bucks is, in one line that all apps agree on

Today the site says "Web3 browser and AI runtime", the mobile README says "mobility + social core with community-only trust", the old repo says "social platform on IPFS", and the intelligence page is a gold supply-chain terminal. Pick one and let the others be features:

**Bucks: your identity, your people, your city's services, your AI, on devices you control.**

Mobile is the clearest expression of that already (rides, orders, local businesses, trust from real transactions). Desktop is where the agent and the browser live. The site is the door.

## 8.2 Information architecture (same on every platform)

| Tab | Phone | Desktop | What it is |
|---|---|---|---|
| **Home / Ask** | Search bar + voice | Agent composer (Soul Engine) | One box: find a provider, book, ask, pay |
| **Nearby** | Map + listings | Map + listings | Services, drivers, businesses in the user's locality |
| **People** | Feed, moments, messages | Feed, messages | Social graph, E2E chat |
| **Me** | Bucks ID card, devices, trust, wallet (if any), settings | Same | The identity card is identical pixel-for-pixel across platforms |
| **Browser** | — (opens in system browser) | Tabs, IPFS, app launcher | Desktop-only |

The Bucks ID card is the one screen to design first: UUID, short code, QR, verification badges, linked devices. It is the visual proof that "one ID everywhere" is real.

## 8.3 Design system

Three palettes exist: brand purple `#811FF0` and Manrope (mobile), teal on near-black (site), gold on near-black with Syne/JetBrains Mono (intelligence). Keep **purple + Manrope** as the brand; use the dark terminal look only for the intelligence dashboard and the desktop browser chrome. Tokens live once in `apps/web` and are exported to Compose, SwiftUI and Tailwind. Icons: Material Symbols on all three (mobile already dropped emojis for this reason).

## 8.4 Cut list

- Three browser codebases → one (Tauri). The Qt browser and the Next.js shell are gone.
- "Chain 8192" UI, fake contracts, miner manager: removed until ADR 0001 is revisited.
- Mock drivers, mock guardians, `OTP 1234` demo mode: keep demo mode on mobile behind a build flavour only.
- The Quran-derived constitution as a *trust gate*: becomes an optional agent persona (see `02 §2.2`).

## 8.5 Keep and promote

- Mobile's confirmation gate and biometric rule for money → shared policy in core, on desktop too.
- Mobile's "Lenses" (user-chosen voter sets, visible ranking formula) → the trust model for the whole network.
- Electron's app launcher and agent browser control → desktop differentiators.
- The gold-intelligence dashboard → a separate product page under bucks.global; it does not need identity or P2P and should not block on them.
