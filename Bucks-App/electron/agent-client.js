/* ─────────────────────────────────────────────────────────────────────────
   Agent client — attaches the Soul Engine token to the shell's requests.

   The engine refuses requests without `Authorization: Bearer <token>`
   (agent/local_auth.py), because loopback is reachable from any web page.
   Shell code talks to the engine with plain fetch() in dozens of places, so
   rather than thread a header through each call site, this wraps fetch once:
   any request whose origin is the engine gets the token, everything else is
   untouched. Load it before every other script on a shell page.

   The token comes from the preload (bucksAPI / ephemeralAPI.getAgentAuth),
   which main.js answers only for the top frame of our own shell pages.

   Public API (for new code; existing fetch() calls need nothing):
     BucksAgent.url(path)          -> absolute engine URL
     BucksAgent.fetch(path, init)  -> fetch against the engine, authenticated
     BucksAgent.authHeaders()      -> Promise<{Authorization}>
   ───────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';
  if (window.BucksAgent) return;

  const preload = window.bucksAPI || window.ephemeralAPI || null;
  const DEFAULT_BASE = 'http://127.0.0.1:8765';
  // Shell code addresses the engine by both names; main.js may report a
  // different port (BUCKS_SOUL_PORT), which auth() adds once it is known.
  const engineOrigins = new Set(['http://127.0.0.1:8765', 'http://localhost:8765']);
  let base = DEFAULT_BASE;
  let pending = null;

  function auth() {
    if (!pending) {
      const ask = preload && typeof preload.getAgentAuth === 'function'
        ? preload.getAgentAuth()
        : Promise.resolve(null);
      pending = Promise.resolve(ask).then((a) => {
        if (!a || !a.token) throw new Error('agent token unavailable on this page');
        try {
          base = new URL(a.baseUrl).origin;
          engineOrigins.add(base);
        } catch (_) {}
        return a;
      });
      // Retry on the next request rather than caching a failure forever (the
      // main process may not have registered the handler yet at first paint).
      pending.catch(() => { pending = null; });
    }
    return pending;
  }

  function targetsEngine(input) {
    const raw = typeof input === 'string' ? input
      : input instanceof URL ? input.href
      : input && typeof input.url === 'string' ? input.url
      : '';
    if (!raw) return false;
    try { return engineOrigins.has(new URL(raw, location.href).origin); }
    catch (_) { return false; }
  }

  const nativeFetch = window.fetch.bind(window);

  async function authorisedFetch(input, init) {
    let token;
    try { ({ token } = await auth()); }
    catch (_) {
      // No token for this page: send the request as-is and let the engine's
      // 401 reach the caller, which already treats non-OK as "engine offline".
      return nativeFetch(input, init);
    }
    const request = new Request(input, init);
    const headers = new Headers(request.headers);
    headers.set('Authorization', `Bearer ${token}`);
    return nativeFetch(new Request(request, { headers }));
  }

  window.fetch = function fetch(input, init) {
    return targetsEngine(input) ? authorisedFetch(input, init) : nativeFetch(input, init);
  };

  window.BucksAgent = Object.freeze({
    url: (path) => new URL(path, base).href,
    fetch: (path, init) => window.fetch(new URL(path, base).href, init),
    authHeaders: () => auth().then(({ token }) => ({ Authorization: `Bearer ${token}` })),
  });

  // Warm the token so the first real request does not pay the IPC round trip.
  auth().catch(() => {});
})();
