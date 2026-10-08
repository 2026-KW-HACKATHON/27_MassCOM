FROM node:22-bookworm-slim AS build

WORKDIR /workspace/apps/worker
COPY apps/worker/package.json apps/worker/package-lock.json ./
RUN npm ci

COPY apps/worker/tsconfig.json ./
COPY apps/worker/src ./src
RUN npm run build

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
# Worker는 자기 위치(dist/)에서 세 단계 위를 저장소 루트로 보고, keystore·비밀번호 파일이 그 안에 있으면 시작을 거절한다
# (apps/worker/src/minter-signer-config.ts). 그래서 api처럼 /app/dist에 두지 않고 /app/apps/worker/dist에 둔다.
# 이렇게 하면 루트가 /app이 되어 /run/minter 같은 밖의 경로를 쓸 수 있다.
WORKDIR /app/apps/worker

COPY apps/worker/package.json apps/worker/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /workspace/apps/worker/dist ./dist

USER node
CMD ["node", "dist/run-worker-loop.js"]
