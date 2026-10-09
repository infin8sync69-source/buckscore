# 07. Security triage: this week

Ordered by blast radius. Values are deliberately not reproduced here; the file paths are.

1. **Rotate the Supabase Postgres password** referenced in the tarball `agent/memory/session_store.py:29`, then delete that connection path. Users' prompts and responses can be written to that DB. Also rotate the service keys of the other two Supabase projects (`lboxctryrktwdsvywfqp`, `rianaojvckrbboeneots`) as a precaution.
2. **Rotate the IPFS cluster secret and re-bootstrap** (`ipfs/cluster-config.env` in the tarball; the file itself says it leaked). Anyone with it can join your cluster as a trusted peer (`CLUSTER_CRDT_TRUSTEDPEERS: "*"`).
3. **Revoke the Google API key** in `Bucks-browser/legacy_v1/next-shell/test_*.js` and `list_models.js`; rewrite history (`git filter-repo --replace-text`), force-push, then archive the repo.
4. **Take `Bucks-global` backend offline** (Railway service) or at minimum remove `/api/recovery/restore`, `/api/auth/generate-identity`, `/api/messages/send` server-side signing, and drop `users.secret_key`. The DB holds user private keys; export nothing, delete the column.
5. **Shut down the C++ node's exposed endpoints** anywhere it runs on a reachable interface: `/api/wallets/sign`, `/api/wallets/primary`, `/api/transactions/send`, `/api/mining/*`. It binds `0.0.0.0:8080` with no auth.
6. **Electron app, before the next tarball:** per-launch bearer token on :8765 and :9999, `allow_origins` limited to the app's own origin, `BUCKS_ALLOWED_ROOTS` scoped to `~/Bucks`, shell tool allowlist evaluated after shell-splitting (no `shell=True`), no `kill -9` of foreign processes, `MODEL_PROVIDER` default `edge`, remove `blockchain.db`, `utxodb.sqlite`, `.bak`, screenshots and `get_dimensions.py` from the build.
7. **Mobile:** restrict the Firebase API key by package name + SHA-256 in Google Cloud console; remove fallback Supabase literals from the four workflows; move the Gemini key out of `BuildConfig` (phase 1 removes it entirely).
8. **Installer:** fill `version.json.cid`, pin the tarball on a publicly reachable node (even one VPS Kubo), host the HTTPS mirror as a GitHub Release asset instead of a 34 MB blob in git, and make `install` verify `BUCKS_SHA256` against `version.json` rather than a constant that drifts.
9. **Add gitleaks** as a pre-commit hook and CI step in every repo that is not archived.
