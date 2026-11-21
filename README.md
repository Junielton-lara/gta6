# Curitiba Open World

Mundo aberto 3D no navegador da TV (Curitiba Centro–Batel), com o celular como controle.
Render local (Three.js). Servidor só sincroniza sessão e input.

## Arquitetura de produção

| Camada | Onde |
|--------|------|
| Frontend (`/tv`, `/controller`) | **Vercel** |
| API Socket.IO | **VPS Hostinger / Portainer** `:47193` |

Detalhes: **[docs/DEPLOY.md](docs/DEPLOY.md)** · 1ª entrega: **[docs/DELIVERY_1.md](docs/DELIVERY_1.md)** · Assets: **[docs/ASSETS.md](docs/ASSETS.md)**

```
apps/game         → TV (Three.js + Vite)
apps/controller   → celular (pé / dirigir)
apps/server       → Node + Socket.IO
packages/shared   → protocolo (v2)
infra/portainer/  → stack da API
```

## Dev local

```bash
npm install
npm run dev
```

| Aparelho | A pé | Dirigindo |
|----------|------|-----------|
| Celular | Stick move · Correr · Entrar · Pulo | Stick direção · R/L · Sair |
| PC | WASD · Shift · E · Espaço | WASD · E sair · Q qualidade |

```bash
npm test
npm run build
npm run build:vercel
npm run typecheck
```
