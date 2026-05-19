FROM node:22-slim
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY api ./api
COPY bot ./bot
COPY worker ./worker

ENV NODE_ENV=production
CMD ["node", "bot/discord-bot.mjs"]
