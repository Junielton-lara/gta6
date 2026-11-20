import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const rootEnv = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

export interface ServerConfig {
  port: number;
  host: string;
  sessionTtlMs: number;
  /**
   * Origem do frontend (Vercel). QR code e CORS usam este valor.
   * Ex.: https://vice-city-online.vercel.app
   */
  appUrl: string;
  /** URL pública da API na VPS (documentação / health). Ex.: http://187.127.23.89:3020 */
  apiUrl: string;
  /** Host fixo legado para QR; vazio = derivado da requisição / LAN. */
  publicHost: string;
  /** http | https | vazio (deriva de X-Forwarded-Proto / handshake). */
  publicProtocol: 'http' | 'https' | '';
  /** URL pública completa legada. Se setada sem APP_URL, também serve de base do QR. */
  publicUrl: string;
  /** Origens extras permitidas no CORS (separadas por vírgula). */
  corsOrigins: string[];
  trustProxy: boolean;
  allowNonLan: boolean;
  /** Só API/Socket.IO — front fica na Vercel (modo Portainer). */
  apiOnly: boolean;
  production: boolean;
}

export function loadConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  const env = process.env;
  const protocolRaw = (env.PUBLIC_PROTOCOL ?? '').trim().toLowerCase();
  const publicProtocol =
    protocolRaw === 'https' || protocolRaw === 'http' ? protocolRaw : ('' as const);

  return {
    port: Number(env.PORT) || 3000,
    host: env.HOST || '0.0.0.0',
    sessionTtlMs: (Number(env.SESSION_TTL_MINUTES) || 15) * 60_000,
    appUrl: stripTrailingSlash(env.APP_URL?.trim() ?? ''),
    apiUrl: stripTrailingSlash(env.API_URL?.trim() ?? ''),
    publicHost: env.PUBLIC_HOST?.trim() ?? '',
    publicProtocol,
    publicUrl: stripTrailingSlash(env.PUBLIC_URL?.trim() ?? ''),
    corsOrigins: parseOrigins(env.CORS_ORIGINS),
    trustProxy: env.TRUST_PROXY === 'true',
    allowNonLan: env.ALLOW_NON_LAN === 'true',
    apiOnly: env.API_ONLY === 'true',
    production: env.NODE_ENV === 'production' || process.argv.includes('--production'),
    ...overrides,
  };
}

export function corsOriginList(config: ServerConfig): string[] | true {
  const origins = new Set<string>();
  if (config.appUrl) origins.add(config.appUrl);
  if (config.publicUrl) origins.add(config.publicUrl);
  for (const o of config.corsOrigins) origins.add(o);
  if (origins.size === 0) return true;
  return [...origins];
}

function parseOrigins(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(',')
    .map((s) => stripTrailingSlash(s.trim()))
    .filter(Boolean);
}

function stripTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}
