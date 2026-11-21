import './styles.css';
import {
  INPUT_HEARTBEAT_MS,
  INPUT_SEND_RATE_HZ,
  normalizeCode,
  normalizePin,
  type ControlHints,
  type ControlMode,
  type SessionStatus,
} from '@vco/shared';
import { Buttons } from './input/Buttons';
import { vibrate } from './input/haptics';
import { Joystick } from './input/Joystick';
import { LookPad } from './input/LookPad';
import { ControllerLink, type LinkState } from './net/connection';
import { resetSettings, saveSettings, settings, type Layout } from './settings';
import { keepScreenOn } from './wakeLock';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const screenJoin = $('screen-join');
const screenPad = $('screen-pad');
const screenDs = $('screen-ds');
const statusbar = $('statusbar');
const form = $<HTMLFormElement>('join-form');
const inputCode = $<HTMLInputElement>('input-code');
const inputPin = $<HTMLInputElement>('input-pin');
const joinError = $('join-error');
const joinServer = $('join-server');
const status = $('status');
const session = $('session');
const latency = $('latency');
const banner = $('banner');
const modeChip = $('mode-chip');
const panelDrive = $('panel-drive');
const panelFoot = $('panel-foot');
const stickHint = $('stick-hint');
const btnAction = $('btn-action');
const dsHintLeft = $('ds-hint-left');
const dsHintRight = $('ds-hint-right');
const settingsSheet = $('settings');

let tvConnected = false;
let currentCode = '';
let stickBase = 'Mover';
let lastHints: ControlHints = {};

const link = new ControllerLink(onLinkState, onSessionStatus, onControlMode, applyHints, (ms) => vibrate(ms));
applyControlMode('on_foot');

// Layout clássico (mantido até o moderno ser validado).
const joystick = new Joystick($('zone-stick'), $('stick-base'), $('stick-knob'), () => sendNow(), {
  deadzone: () => settings.deadzoneLeft,
  sensitivity: () => settings.sensitivityLeft,
});
const lookPad = new LookPad($('zone-look'), $('look-dot'), () => sendNow());

// Layout moderno: analógico esquerdo = movimento, direito = câmera.
const leftStick = new Joystick($('ds-zone-left'), $('ds-base-left'), $('ds-knob-left'), () => sendNow(), {
  deadzone: () => settings.deadzoneLeft,
  sensitivity: () => settings.sensitivityLeft,
  rest: { x: 0.42, y: 0.55 },
  onTap: () => buttons.tap('L3'),
});
const rightStick = new Joystick($('ds-zone-right'), $('ds-base-right'), $('ds-knob-right'), () => sendNow(), {
  deadzone: () => settings.deadzoneRight,
  sensitivity: () => settings.sensitivityRight,
  rest: { x: 0.5, y: 0.55 },
  onTap: () => buttons.tap('R3'),
});

const buttons = new Buttons(
  Array.from(document.querySelectorAll<HTMLElement>('[data-button]')),
  (button, pressed) => {
    // Botões saem na hora (fora do limite de 30 Hz) para toques curtos não se perderem.
    flush();
    if (button === 'Action') link.sendEvent({ type: 'action', pressed });
    else link.sendEvent({ type: 'button', button, pressed });
  },
);

// ---- Envio do estado do controle ----

let seq = 0;
let lastSent = { x: 0, y: 0, buttons: 0, cx: 0, cy: 0 };
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

function readState(): typeof lastSent {
  if (settings.layout === 'modern') {
    const invert = settings.invertCameraY ? -1 : 1;
    return { x: leftStick.x, y: leftStick.y, buttons: buttons.mask, cx: rightStick.x, cy: rightStick.y * invert };
  }
  return { x: joystick.x, y: joystick.y, buttons: buttons.mask, cx: lookPad.cx, cy: lookPad.cy };
}

function flush(): void {
  const state = readState();
  const reliable = state.buttons !== lastSent.buttons;
  lastSent = state;
  lastSentAt = performance.now();
  link.sendInput({ ...state, seq: seq++ }, reliable);
}

// Heartbeat enquanto há input ativo: a TV zera o movimento se parar de receber.
setInterval(() => {
  const active =
    lastSent.x !== 0 || lastSent.y !== 0 || lastSent.buttons !== 0 || lastSent.cx !== 0 || lastSent.cy !== 0;
  if (active && performance.now() - lastSentAt >= INPUT_HEARTBEAT_MS) flush();
}, INPUT_HEARTBEAT_MS / 2);

// ---- Tela de entrada ----

const params = new URLSearchParams(location.search);
const urlCode = normalizeCode(params.get('code') ?? '');
const urlPin = normalizePin(params.get('pin') ?? '');
const urlLayout = params.get('layout');
if (urlLayout === 'classic' || urlLayout === 'modern') saveSettings({ layout: urlLayout });
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
      vibrate([20, 40, 20]);
      flush();
      break;
    case 'reconnecting':
      releaseAll();
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
  if (changed) vibrate(tvConnected ? 30 : [60, 60, 60]);
  if (s.controlMode) onControlMode(s.controlMode);
}

function onControlMode(mode: ControlMode): void {
  applyControlMode(mode);
}

function applyControlMode(mode: ControlMode): void {
  const driving = mode === 'driving';
  modeChip.textContent = driving ? 'Dirigindo' : 'A pé';
  panelDrive.hidden = !driving;
  panelFoot.hidden = driving;
  stickHint.textContent = driving ? 'Direção' : 'Mover';
  btnAction.textContent = driving ? 'A' : 'Pulo';
  stickBase = driving ? 'Direção' : 'Mover';
  renderStickHints();
}

/** Rótulos dinâmicos: botão sem função no contexto atual fica apagado. */
function applyHints(hints: ControlHints): void {
  lastHints = hints;
  for (const el of screenDs.querySelectorAll<HTMLElement>('[data-button]')) {
    const label = hints[el.dataset.button as keyof ControlHints];
    el.classList.toggle('idle', !label);
    el.querySelector('small')!.textContent = label ?? '';
  }
  renderStickHints();
}

function renderStickHints(): void {
  dsHintLeft.textContent = lastHints.L3 ? `${stickBase} · toque: ${lastHints.L3}` : stickBase;
  dsHintRight.textContent = lastHints.R3 ? `Câmera · toque: ${lastHints.R3}` : 'Câmera';
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

// ---- Ajustes ----

const ranges: { id: string; key: 'deadzoneLeft' | 'deadzoneRight' | 'sensitivityLeft' | 'sensitivityRight'; pct: boolean }[] = [
  { id: 'dzl', key: 'deadzoneLeft', pct: true },
  { id: 'snl', key: 'sensitivityLeft', pct: false },
  { id: 'dzr', key: 'deadzoneRight', pct: true },
  { id: 'snr', key: 'sensitivityRight', pct: false },
];

function renderSettings(): void {
  for (const r of ranges) {
    const input = $<HTMLInputElement>(`set-${r.id}`);
    input.value = String(settings[r.key]);
    $(`out-${r.id}`).textContent = r.pct ? `${Math.round(settings[r.key] * 100)}%` : `${settings[r.key].toFixed(2)}×`;
  }
  $<HTMLInputElement>('set-invy').checked = settings.invertCameraY;
  $<HTMLInputElement>('set-vib').checked = settings.vibration;
  for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="layout"]')) {
    radio.checked = radio.value === settings.layout;
  }
}

for (const r of ranges) {
  $<HTMLInputElement>(`set-${r.id}`).addEventListener('input', (e) => {
    saveSettings({ [r.key]: Number((e.target as HTMLInputElement).value) });
    renderSettings();
  });
}
$<HTMLInputElement>('set-invy').addEventListener('change', (e) =>
  saveSettings({ invertCameraY: (e.target as HTMLInputElement).checked }),
);
$<HTMLInputElement>('set-vib').addEventListener('change', (e) => {
  saveSettings({ vibration: (e.target as HTMLInputElement).checked });
  vibrate(30);
});
for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="layout"]')) {
  radio.addEventListener('change', () => {
    if (radio.checked) setLayout(radio.value as Layout);
  });
}
$('settings-reset').addEventListener('click', () => {
  resetSettings();
  renderSettings();
});
$('btn-settings').addEventListener('click', () => {
  releaseAll();
  renderSettings();
  settingsSheet.hidden = false;
});
$('settings-close').addEventListener('click', () => (settingsSheet.hidden = true));
settingsSheet.addEventListener('click', (e) => {
  if (e.target === settingsSheet) settingsSheet.hidden = true;
});

function setLayout(layout: Layout): void {
  releaseAll();
  saveSettings({ layout });
  if (document.body.dataset.screen !== 'join') showScreen('pad');
}

function releaseAll(): void {
  buttons.releaseAll();
  joystick.release();
  leftStick.release();
  rightStick.release();
  flush();
}

// ---- Helpers de UI ----

function showScreen(name: 'join' | 'pad'): void {
  const modern = settings.layout === 'modern';
  screenJoin.hidden = name !== 'join';
  screenPad.hidden = name !== 'pad' || modern;
  screenDs.hidden = name !== 'pad' || !modern;
  statusbar.hidden = name !== 'pad';
  document.body.dataset.screen = name;
  keepScreenOn(name === 'pad');
  if (name === 'pad') {
    // As zonas só têm tamanho depois de visíveis.
    requestAnimationFrame(() => {
      joystick.recenter();
      leftStick.recenter();
      rightStick.recenter();
    });
  }
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
  keepScreenOn(true);
}

document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('gesturestart', (e) => e.preventDefault());
showScreen('join');
