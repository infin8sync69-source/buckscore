// Bootstrap: Fix require('electron') resolving to the npm package
// instead of the built-in Electron API module.
// We delete the cached npm electron package so Electron's internal
// module resolver (c._load) can intercept and provide the real API.

const path = require('path');

// Remove the npm 'electron' package from Node's module resolution
// by deleting its entry from the cache and patching _resolveFilename
const Module = require('module');
const electronPkgPath = path.join(__dirname, 'node_modules', 'electron');

const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
    if (request === 'electron') {
        // Check if this resolves to the npm package (which just returns a path string)
        try {
            const resolved = origResolve.call(this, request, parent, isMain, options);
            if (resolved && resolved.includes('node_modules')) {
                // Skip this — throw so Electron's c._load can handle it
                const err = new Error(`Cannot find module '${request}'`);
                err.code = 'MODULE_NOT_FOUND';
                throw err;
            }
            return resolved;
        } catch (e) {
            if (e.code === 'MODULE_NOT_FOUND') throw e;
            const err = new Error(`Cannot find module '${request}'`);
            err.code = 'MODULE_NOT_FOUND';
            throw err;
        }
    }
    return origResolve.call(this, request, parent, isMain, options);
};

// Load the real main
require('./main.js');
