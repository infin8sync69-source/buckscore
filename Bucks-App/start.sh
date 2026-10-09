#!/usr/bin/env bash
# 🚀 Launch Bucks Production Ready AI Web3 Browser & Agent Engine
#
# Thin wrapper kept for the documented `./start.sh` entry point. The real
# launch logic lives in launch.js so that macOS, Linux and Windows (where
# install.ps1 can only call `npm start`) all go through one code path.
cd "$(dirname "$0")"
exec node launch.js "$@"
