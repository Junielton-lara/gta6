import './styles.css';
import {
  INPUT_HEARTBEAT_MS,
  INPUT_SEND_RATE_HZ,
  normalizeCode,
  normalizePin,
  type SessionStatus,
} from '@vco/shared';
import { Buttons } from './input/Buttons';
import { Joystick } from './input/Joystick';
import { ControllerLink, type LinkState } from './net/connection';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const screenJoin = $('screen-join');
const screenPad = $('screen-pad');
const form = $<HTMLFormElement>('join-form');
const inputCode = $<HTMLInputElement>('input-code');
const inputPin = $<HTMLInputElement>('input-pin');
const joinError = $('join-error');
const joinServer = $('join-server');
const status = $('status');
const session = $('session');
const latency = $('latency');
const banner = $('banner');

let tvConnected = false;
let currentCode = '';

const link = new ControllerLink(onLinkState, onSessionStatus);

const joystick = new Joystick($('zone-stick'), $('stick-base'), $('stick-knob'), () => sendNow());
const buttons = new Buttons(
  Array.from(document.querySelectorAll<HTMLElement>('[data-button]')),
  (button, pressed) => {
    if (button === 'Action') link.sendEvent({ type: 'action', pressed });
    else link.sendEvent({ type: 'button', button, pressed });
    sendNow();
  },
);

// ---- Envio do estado do controle ----

let seq = 0;
let lastSent = { x: 0, y: 0, buttons: 0 };
let lastSentAt = 0;
let pending = false;
const minInterval = 1000 / INPUT_SEND_RATE_HZ;

/** Limita a ~30 Hz, mas envia a mudança assim que a janela permite. */
function sendNow(): void {
  if (pending) return;
  const wait = minInterval - (performance.now() - lastSentAt);
  if (wait <= 0) return flush();
  pending = true;
  setTimeout(() => {
    pending = false;
    flush();
  }, wait);
}

function flush(): void {
  const state = { x: joystick.x, y: joystick.y, buttons: buttons.mask };
  lastSent = state;
  lastSentAt = performance.now();
  link.sendInput({ ...state, seq: seq++ });
}

// Heartbeat enquanto há input ativo: a TV zera o movimento se parar de receber.
setInterval(() => {
  const active = lastSent.x !== 0 || lastSent.y !== 0 || lastSent.buttons !== 0;
  if (active && performance.now() - lastSentAt >= INPUT_HEARTBEAT_MS) flush();
}, INPUT_HEARTBEAT_MS / 2);

// ---- Tela de entrada ----

const params = new URLSearchParams(location.search);
const urlCode = normalizeCode(params.get('code') ?? '');
const urlPin = normalizePin(params.get('pin') ?? '');
if (urlCode || urlPin) {
  // Não deixa o PIN visível na barra de endereço/histórico.
  history.replaceState(null, '', location.pathname);
}
if (urlCode.length === 4 && urlPin.length === 4) {
  link.join({ code: urlCode, pin: urlPin });
} else {
  inputCode.value = urlCode;
  inputPin.value = urlPin;
}

inputCode.addEventListener('input', () => {
  inputCode.value = normalizeCode(inputCode.value);
  if (inputCode.value.length === 4) inputPin.focus();
});
inputPin.addEventListener('input', () => {
  inputPin.value = normalizePin(inputPin.value);
});

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const code = normalizeCode(inputCode.value);
  const pin = normalizePin(inputPin.value);
  if (code.length !== 4 || pin.length !== 4) {
    joinError.textContent = 'Código tem 4 letras e PIN tem 4 números.';
    return;
  }
  joinError.textContent = '';
  enterImmersive();
  link.join({ code, pin });
});

$('btn-fullscreen').addEventListener('click', () => enterImmersive());
banner.addEventListener('click', () => {
  if (banner.dataset.action === 'rejoin') link.rejoin();
});

// ---- Estado da conexão ----

function onLinkState(state: LinkState): void {
  switch (state.kind) {
    case 'server-connecting':
      setJoinServer('warn', 'Conectando ao servidor…');
      break;
    case 'server-ready':
      setJoinServer('ok', 'Servidor online');
      showScreen('join');
      break;
    case 'joining':
      setJoinServer('warn', 'Entrando na sessão…');
      setStatus('warn', 'Entrando…');
      break;
    case 'joined':
      currentCode = state.code;
      tvConnected = state.tvConnected;
      session.textContent = `Sessão ${state.code}`;
      hideBanner();
      showScreen('pad');
      refreshStatus();
      navigator.vibrate?.([20, 40, 20]);
      flush();
      break;
    case 'reconnecting':
      buttons.releaseAll();
      setJoinServer('bad', 'Sem conexão com o servidor. Tentando de novo…');
      setStatus('bad', 'Reconectando…');
      if (link.hasCredentials) showBanner('Conexão perdida. Reconectando automaticamente…');
      break;
    case 'join-failed':
      showScreen('join');
      setJoinServer('ok', 'Servidor online');
      joinError.textContent = state.error;
      break;
    case 'replaced':
      setStatus('bad', 'Controle em outro celular');
      showBanner('Outro celular assumiu o controle. Toque aqui para retomar.', 'rejoin');
      break;
  }
}

function onSessionStatus(s: SessionStatus): void {
  if (s.code !== currentCode) return;
  const changed = tvConnected !== s.tvConnected;
  tvConnected = s.tvConnected;
  refreshStatus();
  if (changed) navigator.vibrate?.(tvConnected ? 30 : [60, 60, 60]);
}

function refreshStatus(): void {
  if (!link.isJoined) return;
  if (tvConnected) setStatus('ok', 'Conectado à TV');
  else setStatus('warn', 'TV desconectada');
}

setInterval(() => {
  latency.textContent = link.latencyMs === null ? '— ms' : `${link.latencyMs} ms`;
  latency.dataset.tone = link.latencyMs === null ? 'bad' : link.latencyMs < 60 ? 'ok' : 'warn';
}, 1000);

// ---- Helpers de UI ----

function showScreen(name: 'join' | 'pad'): void {
  screenJoin.hidden = name !== 'join';
  screenPad.hidden = name !== 'pad';
  document.body.dataset.screen = name;
}

function setStatus(tone: string, text: string): void {
  status.dataset.tone = tone;
  status.querySelector('span')!.textContent = text;
}

function setJoinServer(tone: string, text: string): void {
  joinServer.dataset.tone = tone;
  joinServer.querySelector('span')!.textContent = text;
}

function showBanner(text: string, action = ''): void {
  banner.textContent = text;
  banner.dataset.action = action;
  banner.hidden = false;
}

function hideBanner(): void {
  banner.hidden = true;
}

/** Tela cheia + trava em paisagem. Precisa de gesto do usuário; falha silenciosa onde não houver suporte. */
function enterImmersive(): void {
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  const request = el.requestFullscreen?.bind(el) ?? el.webkitRequestFullscreen?.bind(el);
  try {
    const p = request?.({ navigationUI: 'hide' } as FullscreenOptions) as Promise<void> | undefined;
    const lock = () => {
      const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
      orientation?.lock?.('landscape').catch(() => {});
    };
    if (p && typeof p.then === 'function') p.then(lock, () => {});
    else lock();
  } catch {
    /* sem suporte */
  }
}

document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('gesturestart', (e) => e.preventDefault());
showScreen('join');
