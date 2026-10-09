// launch.js — cross-platform entry point for `npm start`.
//
// start.sh does the same job on macOS/Linux, but the web installer's Windows
// launcher (install.ps1) can only call `npm start`, and Windows has no way to
// run a bash script. Routing `start` through Node keeps one launch path on all
// three platforms instead of forking the root package.json per OS.

const { spawn } = require('child_process');
const os = require('os');
const path = require('path');

const electronDir = path.join(__dirname, 'electron');

// Folders the agent's file tools (and the MCP server) may read and write.
// Mirrors start.sh — without this the tools are confined to the app directory,
// so anything under the user's home is refused with "Path outside allowed roots".
// Credential paths (.ssh, .aws, .env, Keychains, …) stay blocked regardless —
// see DENIED_NAMES in agent/tools/fs_impl.py.
if (!process.env.BUCKS_ALLOWED_ROOTS) {
  process.env.BUCKS_ALLOWED_ROOTS = os.homedir();
}

console.log('==========================================================');
console.log('  BUCKS AGENTIC BROWSER — PRODUCTION LAUNCHER');
console.log('==========================================================');
console.log(`  File access granted: ${process.env.BUCKS_ALLOWED_ROOTS}`);
console.log('==========================================================');

// Required from a plain Node process (not from inside Electron), the electron
// package exports the path to the platform binary — electron.exe on Windows,
// the Mach-O/ELF binary elsewhere. Electron 42 has no postinstall script and
// fetches that binary lazily on this first require, so a fresh `npm install`
// that skipped install scripts still resolves here rather than failing.
let electronBinary;
try {
  electronBinary = require(require.resolve('electron', { paths: [electronDir] }));
} catch (err) {
  console.error('Could not locate the Electron binary:', err.message);
  console.error('Run "npm --prefix electron install" and try again.');
  process.exit(1);
}

const child = spawn(electronBinary, ['.'], {
  cwd: electronDir,
  stdio: 'inherit',
  env: process.env,
});

child.on('error', (err) => {
  console.error('Failed to start Electron:', err.message);
  process.exit(1);
});
child.on('exit', (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 0);
});
