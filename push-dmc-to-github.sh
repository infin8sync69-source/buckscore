#!/bin/bash
# Push DMC Mix website to GitHub (one-time setup)
# Run this once from Terminal when you're ready

set -e

REPO_DIR="$(dirname "$0")/dmc-mix-website"
REMOTE="https://github.com/infin8sync69-source/dmc-mix-website.git"

echo "📦 Setting up git for DMC Mix website..."
cd "$REPO_DIR"

# Init git if not already done
if [ ! -d ".git" ]; then
  git init -b main
fi

# Remove lock file if stuck
rm -f .git/index.lock

# Create .gitignore
cat > .gitignore << 'GITEOF'
node_modules/
.next/
.env
.env.local
out/
*.log
.DS_Store
next.config.mjs.bak
next.config.ts
GITEOF

git config user.email "admin@mikado.biz"
git config user.name "Mikado"

# Stage all source files
git add -A
git commit -m "feat: DMC Mix Next.js website — 8 product groups, contact form" 2>/dev/null || echo "(already committed)"

# Set remote and push
git remote remove origin 2>/dev/null || true
git remote add origin "$REMOTE"
git push -u origin main

echo ""
echo "✅ Pushed to GitHub! Now connect to Vercel:"
echo "   https://vercel.com/new/import?s=https://github.com/infin8sync69-source/dmc-mix-website"
