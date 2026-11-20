/**
 * Contrato de comunicação entre servidor, TV (game) e celular (controller).
 * Qualquer mudança aqui afeta os três lados — incremente PROTOCOL_VERSION.
 */

export const PROTOCOL_VERSION = 1;

export const SESSION_CODE_LENGTH = 4;
export const SESSION_PIN_LENGTH = 4;
/** Sem I, O, 0, 1 para evitar confusão ao digitar no celular. */
export const SESSION_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

/** Frequência máxima de envio do estado do controle (Hz). */
export const INPUT_SEND_RATE_HZ = 30;
/** Reenvio periódico mesmo sem mudança, para a TV saber que o controle segue ativo. */
export const INPUT_HEARTBEAT_MS = 250;
/** Sem input por esse tempo, a TV zera o movimento. */
export const INPUT_STALE_MS = 1000;

export const ROUTES = {
  tv: '/tv/',
  controller: '/controller/',
} as const;

/** Bitmask dos botões digitais. */
export const Button = {
  Up: 1 << 0,
  Down: 1 << 1,
  Left: 1 << 2,
  Right: 1 << 3,
  Action: 1 << 4,
  Accel: 1 << 5,
  Brake: 1 << 6,
} as const;
export type ButtonName = keyof typeof Button;

export interface ControllerInput {
  /** Eixo horizontal do joystick, -1 (esquerda) a 1 (direita). */
  x: number;
  /** Eixo vertical do joystick, -1 (trás) a 1 (frente). */
  y: number;
  /** Bitmask de `Button`. */
  buttons: number;
  /** Sequência crescente, permite descartar pacotes fora de ordem. */
  seq: number;
}

export type ControllerEvent =
  | { type: 'action'; pressed: boolean }
  | { type: 'button'; button: ButtonName; pressed: boolean };

export interface SessionStatus {
  code: string;
  tvConnected: boolean;
  controllerConnected: boolean;
}

export interface TvSessionInfo extends SessionStatus {
  pin: string;
  /** Token secreto que permite à TV retomar a mesma sessão após recarregar. */
  tvToken: string;
  controllerUrl: string;
  /** QR code em SVG com a URL do controle já com código e PIN. */
  qrSvg: string;
}

export type Ack<T> = { ok: true; data: T } | { ok: false; error: string };

export interface TvHelloRequest {
  protocol: number;
  resumeCode?: string;
  resumeToken?: string;
}

export interface ControllerJoinRequest {
  protocol: number;
  code: string;
  pin: string;
}

export interface ControllerJoinResult {
  code: string;
  tvConnected: boolean;
}

export interface ServerToClientEvents {
  'session:status': (status: SessionStatus) => void;
  'controller:input': (input: ControllerInput) => void;
  'controller:event': (event: ControllerEvent) => void;
  /** Outro celular assumiu o controle desta sessão. */
  'controller:replaced': () => void;
  'session:closed': (reason: string) => void;
}

export interface ClientToServerEvents {
  'tv:hello': (req: TvHelloRequest, ack: (res: Ack<TvSessionInfo>) => void) => void;
  'controller:join': (
    req: ControllerJoinRequest,
    ack: (res: Ack<ControllerJoinResult>) => void,
  ) => void;
  'controller:input': (input: ControllerInput) => void;
  'controller:event': (event: ControllerEvent) => void;
  ping: (ack: (serverTime: number) => void) => void;
}

export function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z]/g, '').slice(0, SESSION_CODE_LENGTH);
}

export function normalizePin(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, SESSION_PIN_LENGTH);
}

export function isValidInput(value: unknown): value is ControllerInput {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    isFiniteInRange(v.x, -1, 1) &&
    isFiniteInRange(v.y, -1, 1) &&
    Number.isInteger(v.buttons) &&
    (v.buttons as number) >= 0 &&
    (v.buttons as number) < 1 << 8 &&
    Number.isInteger(v.seq)
  );
}

export function isValidEvent(value: unknown): value is ControllerEvent {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (typeof v.pressed !== 'boolean') return false;
  if (v.type === 'action') return true;
  return (
    v.type === 'button' &&
    typeof v.button === 'string' &&
    Object.prototype.hasOwnProperty.call(Button, v.button)
  );
}

function isFiniteInRange(n: unknown, min: number, max: number): boolean {
  return typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
}
