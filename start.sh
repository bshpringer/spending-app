#!/bin/bash

echo "======================================"
echo " Starting Budget App & Checking Updates"
echo "======================================"

# 0. Check Node Version
if ! command -v node >/dev/null 2>&1; then
    echo "❌ Node.js is not installed!"
    echo "Please download and install it from here: https://nodejs.org/"
    echo "Once installed, close this terminal, open a new one, and try again."
    exit 1
fi

NODE_MAJOR="$(node -v | sed 's/v\([0-9]*\).*/\1/')"
if [ "$NODE_MAJOR" -lt 22 ]; then
    echo "❌ Your Node.js is too old ($(node -v))."
    echo "This app needs Node 22 or newer. Update from https://nodejs.org and try again."
    exit 1
fi

# 1. Pull latest updates automatically (only if it's a git repo)
if [ -d .git ]; then
    echo "→ Checking for updates from GitHub..."
    git pull origin main
else
    echo "→ (No Git repository found, skipping auto-update)"
fi

# 2. Install dependencies (npm is smart and skips if nothing changed)
echo "→ Installing any new dependencies..."
npm install

# 3. Create .env.local if it doesn't exist
if [ ! -f .env.local ]; then
    echo "→ First time setup: Creating .env.local..."
    cp .env.example .env.local
    
    echo ""
    echo "=========================================================="
    echo " We need your Plaid keys to connect the app to your bank!"
    echo " Get them for free by signing up at: https://dashboard.plaid.com/signup"
    echo " Then go to: https://dashboard.plaid.com/developers/keys"
    echo "=========================================================="
    
    read -p "Paste your Plaid client_id and press Enter: " client_id
    read -p "Paste your Plaid secret (sandbox) and press Enter: " secret
    echo ""
    
    # Save the keys into the file automatically
    sed -i.bak "s/^PLAID_CLIENT_ID=.*/PLAID_CLIENT_ID=$client_id/" .env.local
    sed -i.bak "s/^PLAID_SECRET=.*/PLAID_SECRET=$secret/" .env.local
    sed -i.bak "s/^PLAID_ENV=.*/PLAID_ENV=sandbox/" .env.local
    rm -f .env.local.bak
    
    echo "✅ Keys saved successfully!"
fi

# 4. Boot the app
echo "→ Starting the server..."
npx next dev
