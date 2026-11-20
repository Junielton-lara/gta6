# API Vice City Online — imagem para Portainer / GHCR
# Build a partir da raiz do monorepo:
#   docker build -f apps/server/Dockerfile -t vco-api .

FROM node:22-bookworm-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared ./packages/shared
COPY apps/server ./apps/server
COPY tsconfig.base.json ./

RUN npm ci --workspace=@vco/server --include-workspace-root

FROM node:22-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV API_ONLY=true
ENV HOST=0.0.0.0
ENV ALLOW_NON_LAN=true
ENV TRUST_PROXY=true

COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/server ./apps/server
COPY --from=builder /app/tsconfig.base.json ./

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "run", "start", "-w", "@vco/server"]
