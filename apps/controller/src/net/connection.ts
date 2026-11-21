import { io, type Socket } from 'socket.io-client';
import {
  PROTOCOL_VERSION,
  type ClientToServerEvents,
  type ControlHints,
  type ControlMode,
  type ControllerEvent,
  type ControllerInput,
  type ServerToClientEvents,
  type SessionStatus,
} from '@vco/shared';
import { socketClientOptions, socketUrl } from './socketUrl';

export type LinkState =
  | { kind: 'server-connecting' }
  | { kind: 'server-ready' }
  | { kind: 'joining' }
  | { kind: 'joined'; code: string; tvConnected: boolean }
  | { kind: 'reconnecting'; reason: string }
  | { kind: 'join-failed'; error: string }
  | { kind: 'replaced' };

export interface Credentials {
  code: string;
  pin: string;
}

const STORAGE_KEY = 'vco:controller-credentials';

/**
 * Conexão do celular. Guarda código+PIN na sessionStorage para reentrar
 * automaticamente depois de queda de Wi-Fi, troca de app ou reload.
 */
export class ControllerLink {
  private readonly socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  private credentials: Credentials | null = loadCredentials();
  private joined = false;
  latencyMs: number | null = null;

  constructor(
    private readonly onState: (state: LinkState) => void,
    onStatus: (status: SessionStatus) => void,
    onMode: (mode: ControlMode) => void = () => {},
    onHints: (hints: ControlHints) => void = () => {},
    onRumble: (ms: number) => void = () => {},
  ) {
    this.socket = io(socketUrl(), {
      ...socketClientOptions(),
      reconnectionDelay: 400,
      reconnectionDelayMax: 2000,
    });

    onState({ kind: 'server-connecting' });

    this.socket.on('connect', () => {
      if (this.credentials) this.join(this.credentials);
      else onState({ kind: 'server-ready' });
    });
    this.socket.on('disconnect', (reason) => {
      this.joined = false;
      onState({ kind: 'reconnecting', reason });
      if (reason === 'io server disconnect') this.socket.connect();
    });
    this.socket.on('connect_error', () => onState({ kind: 'reconnecting', reason: 'servidor inacessível' }));
    this.socket.on('session:status', (status) => onStatus(status));
    this.socket.on('control:mode', onMode);
    this.socket.on('control:hints', onHints);
    this.socket.on('control:rumble', onRumble);
    this.socket.on('controller:replaced', () => {
      this.joined = false;
      onState({ kind: 'replaced' });
    });

    // Celular bloqueou a tela / trocou de app: ao voltar, força reconexão imediata.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && !this.socket.connected) this.socket.connect();
    });

    setInterval(() => this.measureLatency(), 2000);
  }

  get hasCredentials(): boolean {
    return this.credentials !== null;
  }

  get isJoined(): boolean {
    return this.joined;
  }

  get serverConnected(): boolean {
    return this.socket.connected;
  }

  join(credentials: Credentials): void {
    this.credentials = credentials;
    if (!this.socket.connected) {
      this.socket.connect();
      return;
    }
    this.onState({ kind: 'joining' });
    this.socket
      .timeout(6000)
      .emit('controller:join', { protocol: PROTOCOL_VERSION, ...credentials }, (err, res) => {
        if (err) {
          this.onState({ kind: 'reconnecting', reason: 'sem resposta do servidor' });
          return;
        }
        if (!res.ok) {
          this.credentials = null;
          clearCredentials();
          this.onState({ kind: 'join-failed', error: res.error });
          return;
        }
        this.joined = true;
        saveCredentials(credentials);
        this.onState({ kind: 'joined', code: res.data.code, tvConnected: res.data.tvConnected });
      });
  }

  /** Volta a assumir o controle depois de outro celular ter entrado. */
  rejoin(): void {
    if (this.credentials) this.join(this.credentials);
  }

  leave(): void {
    this.credentials = null;
    this.joined = false;
    clearCredentials();
    this.socket.disconnect().connect();
  }

  /**
   * Analógico contínuo pode ser descartado (o próximo pacote corrige). Mudança de botão
   * não: um toque curto perdido é um pulo/buzina que não acontece.
   */
  sendInput(input: ControllerInput, reliable = false): void {
    if (!this.joined) return;
    if (reliable) this.socket.emit('controller:input', input);
    else this.socket.volatile.emit('controller:input', input);
  }

  sendEvent(event: ControllerEvent): void {
    if (this.joined) this.socket.emit('controller:event', event);
  }

  private measureLatency(): void {
    if (!this.socket.connected || document.hidden) return;
    const start = performance.now();
    this.socket.timeout(2000).emit('ping', (err) => {
      this.latencyMs = err ? null : Math.round(performance.now() - start);
    });
  }
}

function loadCredentials(): Credentials | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Credentials) : null;
  } catch {
    return null;
  }
}

function saveCredentials(c: Credentials): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(c));
  } catch {
    /* storage indisponível */
  }
}

function clearCredentials(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage indisponível */
  }
}
