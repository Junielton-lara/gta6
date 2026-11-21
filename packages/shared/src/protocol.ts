/**
 * Contrato de comunicação entre servidor, TV (game) e celular (controller).
 * Qualquer mudança aqui afeta os três lados — incremente PROTOCOL_VERSION.
 */

export const PROTOCOL_VERSION = 2;

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
  Run: 1 << 7,
  Interact: 1 << 8,
  Horn: 1 << 9,
  // Botões físicos do layout estilo DualSense: a TV decide a função conforme o contexto.
  Cross: 1 << 10,
  Circle: 1 << 11,
  Square: 1 << 12,
  Triangle: 1 << 13,
  L1: 1 << 14,
  R1: 1 << 15,
  L2: 1 << 16,
  R2: 1 << 17,
  L3: 1 << 18,
  R3: 1 << 19,
  Options: 1 << 20,
  TouchPad: 1 << 21,
} as const;
export type ButtonName = keyof typeof Button;

/** Botões do layout de controle moderno, na ordem em que aparecem nas dicas. */
export const PAD_BUTTONS = [
  'Cross', 'Circle', 'Square', 'Triangle', 'L1', 'R1', 'L2', 'R2', 'L3', 'R3', 'Options', 'TouchPad',
] as const;
export type PadButton = (typeof PAD_BUTTONS)[number];

/**
 * Função atual de cada botão, enviada pela TV ao celular. Botão ausente = sem função
 * no momento (o celular mostra apagado). Textos curtos (até HINT_MAX_LENGTH).
 */
export type ControlHints = Partial<Record<PadButton, string>>;
export const HINT_MAX_LENGTH = 16;
const BUTTON_LIMIT = 1 << 24;

export type ControlMode = 'on_foot' | 'driving';

export interface ControllerInput {
  /** Eixo horizontal do joystick, -1 (esquerda) a 1 (direita). */
  x: number;
  /** Eixo vertical do joystick, -1 (trás) a 1 (frente). */
  y: number;
  /** Bitmask de `Button`. */
  buttons: number;
  /** Sequência crescente, permite descartar pacotes fora de ordem. */
  seq: number;
  /** Giro da câmera (arrasto no celular), −1..1. Opcional: controles antigos não enviam. */
  cx?: number;
  /** Inclinação da câmera, −1 (baixo) a 1 (cima). Opcional. */
  cy?: number;
}

export type ControllerEvent =
  | { type: 'action'; pressed: boolean }
  | { type: 'button'; button: ButtonName; pressed: boolean };

export interface SessionStatus {
  code: string;
  tvConnected: boolean;
  controllerConnected: boolean;
  /** Modo de UI sugerido ao celular (pé vs dirigir). */
  controlMode?: ControlMode;
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
  /** TV informa ao controle o modo atual (pé/dirigir). */
  'control:mode': (mode: ControlMode) => void;
  /** Função atual de cada botão (rótulos dinâmicos no celular). */
  'control:hints': (hints: ControlHints) => void;
  /** Pedido de vibração (ms), ex.: batida do carro. */
  'control:rumble': (ms: number) => void;
}

export interface ClientToServerEvents {
  'tv:hello': (req: TvHelloRequest, ack: (res: Ack<TvSessionInfo>) => void) => void;
  'controller:join': (
    req: ControllerJoinRequest,
    ack: (res: Ack<ControllerJoinResult>) => void,
  ) => void;
  'controller:input': (input: ControllerInput) => void;
  'controller:event': (event: ControllerEvent) => void;
  /** TV publica modo de controle para o celular da sessão. */
  'tv:control-mode': (mode: ControlMode) => void;
  'tv:control-hints': (hints: ControlHints) => void;
  'tv:rumble': (ms: number) => void;
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
    (v.buttons as number) < BUTTON_LIMIT &&
    Number.isInteger(v.seq) &&
    (v.cx === undefined || isFiniteInRange(v.cx, -1, 1)) &&
    (v.cy === undefined || isFiniteInRange(v.cy, -1, 1))
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

export function isValidHints(value: unknown): value is ControlHints {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > PAD_BUTTONS.length) return false;
  return entries.every(
    ([k, v]) =>
      (PAD_BUTTONS as readonly string[]).includes(k) && typeof v === 'string' && v.length <= HINT_MAX_LENGTH,
  );
}

export function isValidRumble(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 5 && value <= 600;
}

function isFiniteInRange(n: unknown, min: number, max: number): boolean {
  return typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
}
