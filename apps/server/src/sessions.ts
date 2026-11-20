import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import {
  SESSION_CODE_ALPHABET,
  SESSION_CODE_LENGTH,
  SESSION_PIN_LENGTH,
  type SessionStatus,
} from '@vco/shared';

export type Role = 'tv' | 'controller';

export interface Session {
  code: string;
  pin: string;
  tvToken: string;
  tvSocketId: string | null;
  controllerSocketId: string | null;
  createdAt: number;
  lastActivity: number;
}

interface SocketBinding {
  code: string;
  role: Role;
}

/** Estado das sessões em memória. Sem I/O, para ser testável isoladamente. */
export class SessionManager {
  private readonly sessions = new Map<string, Session>();
  private readonly sockets = new Map<string, SocketBinding>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  get size(): number {
    return this.sessions.size;
  }

  get(code: string): Session | undefined {
    return this.sessions.get(code);
  }

  bindingOf(socketId: string): SocketBinding | undefined {
    return this.sockets.get(socketId);
  }

  create(): Session {
    let code: string;
    do {
      code = Array.from(
        { length: SESSION_CODE_LENGTH },
        () => SESSION_CODE_ALPHABET[randomInt(SESSION_CODE_ALPHABET.length)],
      ).join('');
    } while (this.sessions.has(code));

    const pin = Array.from({ length: SESSION_PIN_LENGTH }, () => randomInt(10)).join('');
    const session: Session = {
      code,
      pin,
      tvToken: randomBytes(24).toString('base64url'),
      tvSocketId: null,
      controllerSocketId: null,
      createdAt: this.now(),
      lastActivity: this.now(),
    };
    this.sessions.set(code, session);
    return session;
  }

  /** A TV recarregou a página: volta para a mesma sessão se provar o token. */
  resume(code: string | undefined, token: string | undefined): Session | undefined {
    if (!code || !token) return undefined;
    const session = this.sessions.get(code);
    if (!session || !safeEqual(session.tvToken, token)) return undefined;
    return session;
  }

  verifyPin(code: string, pin: string): Session | undefined {
    const session = this.sessions.get(code);
    if (!session || !safeEqual(session.pin, pin)) return undefined;
    return session;
  }

  /** Associa o socket ao papel. Retorna o socket anterior desse papel, se houver. */
  attach(session: Session, role: Role, socketId: string): string | null {
    this.detach(socketId);
    const key = role === 'tv' ? 'tvSocketId' : 'controllerSocketId';
    const previous = session[key];
    if (previous && previous !== socketId) this.sockets.delete(previous);
    session[key] = socketId;
    session.lastActivity = this.now();
    this.sockets.set(socketId, { code: session.code, role });
    return previous && previous !== socketId ? previous : null;
  }

  detach(socketId: string): { session: Session; role: Role } | undefined {
    const binding = this.sockets.get(socketId);
    if (!binding) return undefined;
    this.sockets.delete(socketId);
    const session = this.sessions.get(binding.code);
    if (!session) return undefined;
    const key = binding.role === 'tv' ? 'tvSocketId' : 'controllerSocketId';
    if (session[key] === socketId) session[key] = null;
    session.lastActivity = this.now();
    return { session, role: binding.role };
  }

  touch(session: Session): void {
    session.lastActivity = this.now();
  }

  status(session: Session): SessionStatus {
    return {
      code: session.code,
      tvConnected: session.tvSocketId !== null,
      controllerConnected: session.controllerSocketId !== null,
    };
  }

  /** Remove sessões sem nenhum aparelho conectado há mais que o TTL. */
  sweep(): string[] {
    const removed: string[] = [];
    const limit = this.now() - this.ttlMs;
    for (const [code, s] of this.sessions) {
      if (!s.tvSocketId && !s.controllerSocketId && s.lastActivity < limit) {
        this.sessions.delete(code);
        removed.push(code);
      }
    }
    return removed;
  }
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}
