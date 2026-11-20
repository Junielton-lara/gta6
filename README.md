# Vice City Online

Jogo 3D no navegador da TV, com o celular como volante/pedais.
O render roda no aparelho (Three.js). Servidor só sincroniza sessão e input.

## Arquitetura de produção (igual Staltek)

| Camada | Onde |
|--------|------|
| Frontend (`/tv`, `/controller`) | **Vercel** |
| API Socket.IO | **VPS Hostinger / Portainer** `:3020` |

Detalhes: **[docs/DEPLOY.md](docs/DEPLOY.md)**.

```
apps/game         → TV (Three.js + Vite)
apps/controller   → celular (joystick + pedais)
apps/server       → Node + Socket.IO (Docker/Portainer)
packages/shared   → protocolo
infra/portainer/  → stack da API
vercel.json       → build + rewrite /socket.io → VPS
```

## Dev local

```bash
npm install
npm run dev
```

Abra o endereço impresso no terminal (TV na LAN). Controles:

| Aparelho | Ação |
|----------|------|
| Celular | Stick = direção · **R** acelera · **L** freia · **A** pula |
| PC | WASD · Espaço · **Q** qualidade |

```bash
npm test
npm run build
npm run build:vercel   # monta dist-web/ para a Vercel
npm run typecheck
```

## Produção (resumo)

1. **Portainer:** stack `infra/portainer/docker-compose.yml` + `stack.env.example`
2. **Vercel:** root do monorepo; `VITE_SOCKET_URL` vazio
3. `APP_URL` na API = URL HTTPS da Vercel (QR code)

Não é necessário deixar o notebook ligado.
