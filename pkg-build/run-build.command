#!/bin/bash
# Double-click this file to build Install Bucks.pkg
cd "$(dirname "$0")"
bash build.sh
echo ""
echo "Press any key to close..."
read -n 1
