# syntax=docker/dockerfile:1
# VGR API image (decision 241). Two stages: the build needs dev
# dependencies (tsc, tsc-alias); the runtime ships only production ones and
# the compiled dist/ (docs/adr/RELEASE.md).

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY scripts ./scripts
COPY src ./src
# The smoke test fails the image build if dist/ cannot load or lost a
# migration (plano-producao.md B1/B2).
RUN npm run build && npm run verify:build

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000
# /health includes the database (decision 245).
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
# Applies pending migrations, then serves (src/server.ts).
CMD ["node", "dist/server.js"]
