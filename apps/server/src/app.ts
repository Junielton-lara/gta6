import express, { type RequestHandler } from 'express';
import { existsSync } from 'node:fs';
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { ROUTES, type ClientToServerEvents, type ServerToClientEvents } from '@vco/shared';
import { lanOnlyHttp, lanOnlySocket } from './auth';
import { corsOriginList, type ServerConfig } from './config';
import { SessionManager } from './sessions';
import { registerSocketHandlers } from './socket';
import { landingPage } from './landing';

const appsDir = fileURLToPath(new URL('../../', import.meta.url));
const clients = [
  { name: 'game', route: ROUTES.tv, root: `${appsDir}game`, hmrPort: 24678 },
  { name: 'controller', route: ROUTES.controller, root: `${appsDir}controller`, hmrPort: 24679 },
] as const;

export interface RunningServer {
  httpServer: HttpServer;
  sessions: SessionManager;
  port: number;
  close(): Promise<void>;
}

export interface StartOptions {
  /** Não serve os front-ends (testes / API-only no Portainer). */
  apiOnly?: boolean;
}

export async function startServer(config: ServerConfig, options: StartOptions = {}): Promise<RunningServer> {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);
  app.use(lanOnlyHttp(config.allowNonLan));

  const origins = corsOriginList(config);
  app.use((req, res, next) => {
    const requestOrigin = req.headers.origin;
    if (origins === true) {
      if (requestOrigin) res.setHeader('Access-Control-Allow-Origin', requestOrigin);
    } else if (requestOrigin && origins.includes(requestOrigin)) {
      res.setHeader('Access-Control-Allow-Origin', requestOrigin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  const httpServer = createServer(app);
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    allowRequest: lanOnlySocket(config.allowNonLan),
    cors: {
      origin: origins,
      methods: ['GET', 'POST'],
    },
    pingInterval: 5_000,
    pingTimeout: 5_000,
    transports: ['websocket', 'polling'],
  });

  const sessions = new SessionManager(config.sessionTtlMs);
  registerSocketHandlers(io, sessions, config);
  const sweeper = setInterval(() => sessions.sweep(), 60_000);
  sweeper.unref();

  app.get('/health', (_req, res) => {
    res.json({
      ok: true,
      sessions: sessions.size,
      uptime: process.uptime(),
      appUrl: config.appUrl || null,
      apiUrl: config.apiUrl || null,
    });
  });

  const serveFrontends = !(options.apiOnly || config.apiOnly);
  const closers: Array<() => Promise<void>> = [];
  if (serveFrontends) {
    for (const client of clients) {
      if (config.production) {
        const dist = `${client.root}/dist`;
        if (!existsSync(dist)) {
          throw new Error(`Build de "${client.name}" não encontrado. Rode "npm run build" antes de "npm start".`);
        }
        app.use(client.route, express.static(dist, { index: 'index.html', maxAge: '1h' }));
      } else {
        const { createServer: createVite } = await import('vite');
        const vite = await createVite({
          root: client.root,
          configFile: `${client.root}/vite.config.ts`,
          server: { middlewareMode: true, hmr: { port: client.hmrPort } },
          appType: 'spa',
        });
        app.use(mountAt(client.route, vite.middlewares));
        closers.push(() => vite.close());
      }
    }
    app.get(['/tv', '/controller'], (req, res) => res.redirect(`${req.path}/`));
    app.get('/', (_req, res) => res.type('html').send(landingPage()));
  } else {
    app.get('/', (_req, res) => {
      res.json({
        ok: true,
        service: 'vice-city-online-api',
        tv: config.appUrl ? `${config.appUrl}/tv/` : null,
        controller: config.appUrl ? `${config.appUrl}/controller/` : null,
        health: '/health',
      });
    });
  }

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(config.port, config.host, resolve);
  });

  return {
    httpServer,
    sessions,
    port: (httpServer.address() as AddressInfo).port,
    async close() {
      clearInterval(sweeper);
      await Promise.all(closers.map((c) => c()));
      await io.close();
    },
  };
}

/** Mantém a URL original (o Vite precisa do prefixo do `base`). */
function mountAt(prefix: string, handler: RequestHandler | ((...args: any[]) => void)): RequestHandler {
  return (req, res, next) => {
    if (req.url.startsWith(prefix)) return (handler as RequestHandler)(req, res, next);
    next();
  };
}
