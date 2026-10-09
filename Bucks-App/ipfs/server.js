// Prevent EPIPE errors from crashing the process when stdout/stderr are closed
if (process.stdout && typeof process.stdout.on === 'function') {
  process.stdout.on('error', (err) => {
    if (err.code === 'EPIPE') {
      // Ignore EPIPE error
    }
  });
}
if (process.stderr && typeof process.stderr.on === 'function') {
  process.stderr.on('error', (err) => {
    if (err.code === 'EPIPE') {
      // Ignore EPIPE error
    }
  });
}

// IPFS Cluster File Manager — zero-dependency Node server.
// Proxies the cluster REST API (9094) and kubo gateway (8080) and serves the UI.
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3939;
const CLUSTER = { host: '127.0.0.1', port: 9094 };
const GATEWAY = { host: '127.0.0.1', port: 8080 };
const KUBO = { host: '127.0.0.1', port: 5001 };

function proxy(req, res, target, targetPath, opts = {}) {
  const headers = { ...req.headers, host: `${target.host}:${target.port}` };
  // kubo's API 403s requests carrying browser origins it doesn't know
  delete headers.origin;
  delete headers.referer;
  const p = http.request(
    {
      host: target.host,
      port: target.port,
      path: targetPath,
      method: opts.method || req.method,
      headers,
    },
    (up) => {
      res.writeHead(up.statusCode, up.headers);
      up.pipe(res);
    }
  );
  p.on('error', (e) => {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: `upstream unreachable: ${e.message}` }));
  });
  if (opts.body !== undefined) p.end(opts.body);
  else req.pipe(p);
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

http
  .createServer((req, res) => {
    const url = new URL(req.url, 'http://x');

    // Cluster REST API passthrough: /api/* -> :9094/*
    if (url.pathname.startsWith('/api/')) {
      return proxy(req, res, CLUSTER, req.url.slice(4));
    }
    // Gateway passthrough for downloads/previews: /ipfs/<cid>
    if (url.pathname.startsWith('/ipfs/')) {
      return proxy(req, res, GATEWAY, req.url);
    }
    // Kubo API passthrough for UnixFS dir listings: /kubo/* -> :5001/*
    if (url.pathname.startsWith('/kubo/')) {
      return proxy(req, res, KUBO, req.url.slice(5), { method: 'POST' });
    }
    // Static UI
    let file = url.pathname === '/' ? '/index.html' : url.pathname;
    const full = path.join(__dirname, 'public', path.normalize(file));
    if (!full.startsWith(path.join(__dirname, 'public'))) {
      res.writeHead(403);
      return res.end();
    }
    fs.readFile(full, (err, data) => {
      if (err) {
        res.writeHead(404);
        return res.end('not found');
      }
      res.writeHead(200, { 'content-type': MIME[path.extname(full)] || 'application/octet-stream' });
      res.end(data);
    });
  })
  .listen(PORT, () => console.log(`IPFS Cluster File Manager → http://localhost:${PORT}`));
