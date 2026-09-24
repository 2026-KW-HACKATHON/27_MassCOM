FROM node:24-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app
COPY apps/production-web/index.html ./index.html
COPY apps/production-web/assets ./assets
COPY apps/production-web/server.mjs ./server.mjs

USER node
EXPOSE 4173
CMD ["node", "server.mjs"]
