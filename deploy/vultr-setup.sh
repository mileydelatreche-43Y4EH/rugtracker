#!/bin/bash
# Installation Bundle Tracker bot sur Ubuntu (Vultr)
# Usage : bash vultr-setup.sh

set -e

APP_DIR="${APP_DIR:-$HOME/bundle-tracker}"
REPO_URL="${REPO_URL:-https://github.com/mileydelatreche-43Y4EH/rugtracker.git}"

echo "==> Mise à jour système"
sudo apt update && sudo apt upgrade -y

echo "==> Node.js 20"
if ! command -v node &>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt install -y nodejs
fi
node -v
npm -v

echo "==> Git + PM2"
sudo apt install -y git
sudo npm install -g pm2

if [ ! -d "$APP_DIR/.git" ]; then
  echo "==> Clone $REPO_URL"
  git clone "$REPO_URL" "$APP_DIR"
else
  echo "==> Pull dans $APP_DIR"
  cd "$APP_DIR" && git pull
fi

cd "$APP_DIR"
npm install --omit=dev

if [ ! -f .env ]; then
  echo ""
  echo "⚠️  Crée le fichier .env avant de démarrer :"
  echo "   nano $APP_DIR/.env"
  echo ""
  cp -n .env.example .env 2>/dev/null || true
fi

mkdir -p data

echo ""
echo "✅ Installation terminée."
echo "   1. Édite : nano $APP_DIR/.env"
echo "   2. Lance : cd $APP_DIR && pm2 start bot/discord-bot.mjs --name bundle-bot"
echo "   3. Auto   : pm2 save && pm2 startup"
