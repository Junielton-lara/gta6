import { io, type Socket } from 'socket.io-client';
import {
  PROTOCOL_VERSION,
  type ClientToServerEvents,
  type ControllerEvent,
  type ControllerInput,
  type ServerToClientEvents,
  type SessionStatus,
  type TvSessionInfo,
} from '@vco/shared';
import { socketClientOptions, socketUrl } from './socketUrl';

export type ServerState = 'connecting' | 'connected' | 'reconnecting' | 'error';

export interface TvConnectionHandlers {
  onServerState(state: ServerState, detail?: string): void;
  onSession(info: TvSessionInfo): void;
  onStatus(status: SessionStatus): void;
  onInput(input: ControllerInput): void;
  onEvent(event: ControllerEvent): void;
}

const STORAGE_KEY = 'vco:tv-session';

/** Conexão da TV: cria/retoma a sessão a cada (re)conexão do Socket.IO. */
export function connectTv(handlers: TvConnectionHandlers): Socket<ServerToClientEvents, ClientToServerEvents> {
  const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(socketUrl(), {
    ...socketClientOptions(),
    reconnectionDelay: 500,
    reconnectionDelayMax: 3000,
  });

  handlers.onServerState('connecting');

  socket.on('connect', () => {
    const saved = loadSaved();
    socket.timeout(8000).emit(
      'tv:hello',
      { protocol: PROTOCOL_VERSION, resumeCode: saved?.code, resumeToken: saved?.token },
      (err, res) => {
        if (err) return handlers.onServerState('error', 'Servidor não respondeu.');
        if (!res.ok) return handlers.onServerState('error', res.error);
        saveSession(res.data.code, res.data.tvToken);
        handlers.onServerState('connected');
        handlers.onSession(res.data);
      },
    );
  });

  socket.on('disconnect', (reason) => {
    handlers.onServerState('reconnecting', reason);
    if (reason === 'io server disconnect') socket.connect();
  });
  socket.on('connect_error', (err) => handlers.onServerState('reconnecting', err.message));

  socket.on('session:status', handlers.onStatus);
  socket.on('controller:input', handlers.onInput);
  socket.on('controller:event', handlers.onEvent);

  return socket;
}

function loadSaved(): { code: string; token: string } | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveSession(code: string, token: string): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ code, token }));
  } catch {
    // Modo privado / storage desabilitado: a sessão só não sobrevive a um reload.
  }
}
