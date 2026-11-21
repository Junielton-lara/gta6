import QRCode from 'qrcode';
import type { Server, Socket } from 'socket.io';
import {
  PROTOCOL_VERSION,
  ROUTES,
  isValidEvent,
  isValidHints,
  isValidInput,
  isValidRumble,
  normalizeCode,
  normalizePin,
  type ClientToServerEvents,
  type ServerToClientEvents,
  type TvSessionInfo,
} from '@vco/shared';
import { AttemptLimiter, remoteAddressOf } from './auth';
import type { ServerConfig } from './config';
import { isLocalNetworkAddress, primaryLanAddress } from './network';
import type { Session, SessionManager } from './sessions';

type IO = Server<ClientToServerEvents, ServerToClientEvents>;
type ClientSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

const tvRoom = (code: string) => `tv:${code}`;
const controllerRoom = (code: string) => `ctrl:${code}`;

export function registerSocketHandlers(io: IO, sessions: SessionManager, config: ServerConfig): void {
  const limiter = new AttemptLimiter();

  const broadcastStatus = (session: Session) => {
    const status = sessions.status(session);
    io.to(tvRoom(session.code)).to(controllerRoom(session.code)).emit('session:status', status);
  };

  io.on('connection', (socket: ClientSocket) => {
    const ip = remoteAddressOf(socket.request);

    socket.on('tv:hello', async (req, ack) => {
      if (typeof ack !== 'function') return;
      if (req?.protocol !== PROTOCOL_VERSION) {
        return ack({ ok: false, error: 'Versão incompatível. Recarregue a página.' });
      }

      const session =
        sessions.resume(
          typeof req.resumeCode === 'string' ? req.resumeCode : undefined,
          typeof req.resumeToken === 'string' ? req.resumeToken : undefined,
        ) ?? sessions.create();

      const previousTv = sessions.attach(session, 'tv', socket.id);
      if (previousTv) io.in(previousTv).socketsLeave(tvRoom(session.code));
      socket.join(tvRoom(session.code));

      const controllerUrl = buildControllerUrl(socket, config, session);
      const info: TvSessionInfo = {
        ...sessions.status(session),
        pin: session.pin,
        tvToken: session.tvToken,
        controllerUrl,
        qrSvg: await QRCode.toString(controllerUrl, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }),
      };
      ack({ ok: true, data: info });
      broadcastStatus(session);
    });

    socket.on('controller:join', (req, ack) => {
      if (typeof ack !== 'function') return;
      if (req?.protocol !== PROTOCOL_VERSION) {
        return ack({ ok: false, error: 'Versão incompatível. Recarregue a página.' });
      }
      if (limiter.isBlocked(ip)) {
        return ack({ ok: false, error: 'Muitas tentativas. Aguarde um minuto.' });
      }

      const code = normalizeCode(String(req.code ?? ''));
      const pin = normalizePin(String(req.pin ?? ''));
      const session = sessions.verifyPin(code, pin);
      if (!session) {
        limiter.recordFailure(ip);
        return ack({ ok: false, error: 'Código ou PIN inválido.' });
      }
      limiter.reset(ip);

      const previous = sessions.attach(session, 'controller', socket.id);
      if (previous) {
        io.to(previous).emit('controller:replaced');
        io.in(previous).socketsLeave(controllerRoom(session.code));
      }
      socket.join(controllerRoom(session.code));
      ack({ ok: true, data: { code: session.code, tvConnected: session.tvSocketId !== null } });
      broadcastStatus(session);
    });

    socket.on('controller:input', (input) => {
      const session = controllerSession(socket.id);
      if (!session || !isValidInput(input)) return;
      sessions.touch(session);
      io.to(tvRoom(session.code)).volatile.emit('controller:input', {
        x: input.x,
        y: input.y,
        buttons: input.buttons,
        seq: input.seq,
        ...(input.cx !== undefined ? { cx: input.cx } : {}),
        ...(input.cy !== undefined ? { cy: input.cy } : {}),
      });
    });

    socket.on('controller:event', (event) => {
      const session = controllerSession(socket.id);
      if (!session || !isValidEvent(event)) return;
      io.to(tvRoom(session.code)).emit('controller:event', event);
    });

    socket.on('tv:control-mode', (mode) => {
      const binding = sessions.bindingOf(socket.id);
      if (binding?.role !== 'tv') return;
      if (mode !== 'on_foot' && mode !== 'driving') return;
      io.to(controllerRoom(binding.code)).emit('control:mode', mode);
    });

    socket.on('tv:control-hints', (hints) => {
      const binding = sessions.bindingOf(socket.id);
      if (binding?.role !== 'tv' || !isValidHints(hints)) return;
      io.to(controllerRoom(binding.code)).emit('control:hints', hints);
    });

    socket.on('tv:rumble', (ms) => {
      const binding = sessions.bindingOf(socket.id);
      if (binding?.role !== 'tv' || !isValidRumble(ms)) return;
      io.to(controllerRoom(binding.code)).volatile.emit('control:rumble', Math.round(ms));
    });

    socket.on('ping', (ack) => {
      if (typeof ack === 'function') ack(Date.now());
    });

    socket.on('disconnect', () => {
      const detached = sessions.detach(socket.id);
      if (detached) broadcastStatus(detached.session);
    });
  });

  function controllerSession(socketId: string): Session | undefined {
    const binding = sessions.bindingOf(socketId);
    if (binding?.role !== 'controller') return undefined;
    return sessions.get(binding.code);
  }
}

/**
 * QR / link do controle apontam para o frontend (Vercel = APP_URL).
 * O Socket.IO continua na API (VPS); o browser conecta via rewrite da Vercel
 * ou VITE_SOCKET_URL.
 */
function buildControllerUrl(socket: ClientSocket, config: ServerConfig, session: Session): string {
  const base = resolvePublicBase(socket, config);
  const url = new URL(ROUTES.controller, `${base}/`);
  url.searchParams.set('code', session.code);
  url.searchParams.set('pin', session.pin);
  return url.toString();
}

function resolvePublicBase(socket: ClientSocket, config: ServerConfig): string {
  // Prioridade: frontend na Vercel → URL pública explícita → LAN/auto.
  if (config.appUrl) return config.appUrl;
  if (config.publicUrl) return config.publicUrl;

  const requestHost = socket.handshake.headers.host ?? '';
  const [hostname = '', requestPort] = splitHost(requestHost);
  const forwardedProto = String(socket.handshake.headers['x-forwarded-proto'] ?? '')
    .split(',')[0]
    ?.trim()
    .toLowerCase();

  const protocol =
    config.publicProtocol ||
    (forwardedProto === 'https' || forwardedProto === 'http' ? forwardedProto : 'http');

  let host = config.publicHost;
  if (!host) {
    const reachable = hostname && hostname !== 'localhost' && !hostname.startsWith('127.');
    host = reachable && isLocalNetworkAddress(hostname) ? hostname : (primaryLanAddress() ?? hostname);
  }

  return `${protocol}://${host}${formatPort(protocol, requestPort, config)}`;
}

function formatPort(
  protocol: string,
  requestPort: string | undefined,
  config: ServerConfig,
): string {
  // VPS com HTTPS + domínio público: URL sem porta.
  if (config.publicHost && protocol === 'https') return '';
  if (protocol === 'https') return !requestPort || requestPort === '443' ? '' : `:${requestPort}`;
  if (requestPort === '80') return '';
  // Prefere a porta do Host da requisição (porta real, inclusive quando PORT=0 nos testes).
  if (requestPort) return `:${requestPort}`;
  if (config.port > 0) return `:${config.port}`;
  return '';
}

function splitHost(host: string): [string, string?] {
  const match = /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(host);
  return match ? [match[1]!, match[2]] : [host];
}
