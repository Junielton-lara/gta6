import type { RequestHandler } from 'express';
import type { IncomingMessage } from 'node:http';
import { isLocalNetworkAddress, normalizeAddress } from './network';

export function remoteAddressOf(req: IncomingMessage): string {
  return normalizeAddress(req.socket.remoteAddress);
}

export function lanOnlyHttp(allowNonLan: boolean): RequestHandler {
  return (req, res, next) => {
    if (allowNonLan || isLocalNetworkAddress(remoteAddressOf(req))) return next();
    res.status(403).type('text/plain').send('Acesso permitido apenas pela rede local.');
  };
}

export function lanOnlySocket(allowNonLan: boolean) {
  return (req: IncomingMessage, callback: (err: string | null, success: boolean) => void) => {
    const allowed = allowNonLan || isLocalNetworkAddress(remoteAddressOf(req));
    callback(allowed ? null : 'forbidden', allowed);
  };
}

/** Limita tentativas erradas de PIN por IP, contra força bruta. */
export class AttemptLimiter {
  private readonly failures = new Map<string, { count: number; windowStart: number }>();

  constructor(
    private readonly maxFailures = 8,
    private readonly windowMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  isBlocked(key: string): boolean {
    const entry = this.failures.get(key);
    if (!entry) return false;
    if (this.now() - entry.windowStart > this.windowMs) {
      this.failures.delete(key);
      return false;
    }
    return entry.count >= this.maxFailures;
  }

  recordFailure(key: string): void {
    const entry = this.failures.get(key);
    if (!entry || this.now() - entry.windowStart > this.windowMs) {
      this.failures.set(key, { count: 1, windowStart: this.now() });
    } else {
      entry.count++;
    }
  }

  reset(key: string): void {
    this.failures.delete(key);
  }
}
