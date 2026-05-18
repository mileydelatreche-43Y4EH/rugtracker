/** PM2 — lancer depuis la racine du projet : pm2 start deploy/ecosystem.config.cjs */
module.exports = {
  apps: [
    {
      name: 'bundle-bot',
      script: 'bot/discord-bot.mjs',
      cwd: __dirname + '/..',
      interpreter: 'node',
      autorestart: true,
      max_restarts: 20,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
