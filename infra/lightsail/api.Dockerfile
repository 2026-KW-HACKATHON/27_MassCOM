FROM node:22-bookworm-slim AS build

WORKDIR /workspace/apps/api
COPY apps/api/package.json apps/api/package-lock.json ./
RUN npm ci

COPY apps/api/tsconfig.json ./
COPY apps/api/src ./src
COPY apps/api/migrations ./migrations
RUN npm run build

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY apps/api/package.json apps/api/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /workspace/apps/api/dist ./dist
COPY --from=build /workspace/apps/api/migrations ./migrations

USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]
