#!/bin/bash
cd "$HOME/Desktop/Bucks Core/bucks.global"
rm -f .git/index.lock
git add install
git commit -m "Fix: detect missing Xcode CLT before nvm install"
git push
echo ""
echo "Done! Press any key to close."
read -n 1
