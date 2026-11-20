# Deploy — Vercel (front) + VPS Hostinger / Portainer (API)

Arquitetura igual à do Staltek / Gerenciador de OS:

- **Frontend** (TV + controle + landing) → **Vercel**
- **Backend** (Express + Socket.IO) → **Portainer na VPS** `187.127.23.89:47193`

O 3D roda no navegador da TV. A VPS só sincroniza sessão e input.

**Nesta etapa: só preparação. Não execute o deploy ainda.**

## Diagrama

```
TV / celular
    │  HTTPS
    ▼
 Vercel (dist-web)
    │  rewrite /socket.io  +  /health
    ▼
 VPS Hostinger :47193  →  container vco-api (Portainer)
```

Na Vercel, `VITE_SOCKET_URL` fica **vazio** (same-origin). O `vercel.json`
encaminha `/socket.io` e `/health` para a API na VPS — mesmo padrão do
Staltek com as rotas `/auth`, `/clients`, etc.

> WebSocket puro através do rewrite da Vercel pode cair para **polling** do
> Socket.IO. Isso é esperado e suficiente para o controle (~30 Hz).

## Portas na VPS

| Porta | Serviço |
|-------|---------|
| 3010 | API Staltek (já existente) |
| **47193** | **API Vice City Online** |
| 9443 | Portainer UI |

## 1. API no Portainer

1. Publique a imagem (GitHub Actions → `ghcr.io/junielton-lara/vco-api:latest`)
   ou use `infra/portainer/api.local.yml` para build local.
2. Stacks → Add stack → cole `infra/portainer/docker-compose.yml`.
3. Variáveis: `infra/portainer/stack.env.example`.
4. Confirme:

```bash
curl -s http://187.127.23.89:47193/health
```

| Variável | Valor |
|----------|-------|
| `APP_URL` | URL da Vercel, ex. `https://vice-city-online.vercel.app` |
| `API_URL` | `http://187.127.23.89:47193` |
| `API_ONLY` | `true` (já no compose) |
| `ALLOW_NON_LAN` | `true` |
| `TRUST_PROXY` | `true` |

O QR code usa `APP_URL` (página do controle na Vercel), não o IP da API.

## 2. Frontend na Vercel

1. Importe o repositório; root do projeto = raiz do monorepo.
2. A Vercel usa `vercel.json` (`buildCommand` → `npm run build:vercel`,
   `outputDirectory` → `dist-web`).
3. **Não** defina `VITE_SOCKET_URL` (deixe vazio / omita).
4. Ajuste o IP/porta em `vercel.json` se a API mudar de `187.127.23.89:47193`.
5. Depois do primeiro deploy, copie a URL HTTPS para `APP_URL` na stack
   Portainer e faça redeploy/recreate do container.

## 3. Variáveis de ambiente (resumo)

### VPS / Portainer

Ver `infra/portainer/stack.env.example` e `.env.example`.

### Vercel

| Variável | Produção |
|----------|----------|
| `VITE_SOCKET_URL` | *(vazio)* |

### Dev local

```bash
npm install
npm run dev
```

TV e celular na mesma Wi-Fi; QR usa o IP da LAN. Sem Vercel/Portainer.

## 4. Scripts

```bash
npm ci
npm run build          # game + controller
npm run build:vercel   # build + monta dist-web/
npm test
npm run typecheck
```

## 5. Atualização

**API**

```text
git push main  →  Actions publica GHCR  →  Portainer pull/recreate vco-api
```

Ou, com `api.local.yml`: rebuild da stack no Portainer.

**Frontend**

```text
git push  →  Vercel rebuild automático
```

## 6. Checklist

- [ ] Container `vco-api` healthy em `:47193`
- [ ] `APP_URL` = origem real da Vercel
- [ ] `vercel.json` aponta para `187.127.23.89:47193`
- [ ] `/tv/` abre, QR mostra link `https://…vercel.app/controller/?code=&pin=`
- [ ] Celular conecta; pedais e stick movem o carro
- [ ] `/health` via Vercel e via IP da VPS respondem `ok`

## Alternativa: tudo na VPS (Nginx + PM2)

Configs legadas em `deploy/` (Nginx, PM2, env). Use só se quiser abandonar a
Vercel. O caminho principal deste projeto é **Vercel + Portainer**, como o Staltek.
