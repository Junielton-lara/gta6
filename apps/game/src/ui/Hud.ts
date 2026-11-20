import type { SessionStatus, TvSessionInfo } from '@vco/shared';
import type { StatsSnapshot } from '../diagnostics/stats';
import type { WebGLSupport } from '../diagnostics/webgl';
import type { QualityLevel } from '../engine/Engine';
import type { ServerState } from '../net/connection';

type PillTone = 'ok' | 'warn' | 'bad' | 'idle';

export class Hud {
  private readonly serverPill: HTMLElement;
  private readonly controllerPill: HTMLElement;
  private readonly pairing: HTMLElement;
  private readonly qr: HTMLElement;
  private readonly code: HTMLElement;
  private readonly pin: HTMLElement;
  private readonly url: HTMLElement;
  private readonly stats: HTMLElement;
  private readonly speed: HTMLElement;
  private readonly toast: HTMLElement;
  private toastTimer = 0;
  private everHadController = false;
  private controllerConnected = false;
  private gpuLine = '';
  private lastShownSpeed = Number.NaN;

  constructor(private readonly root: HTMLElement) {
    root.innerHTML = `
      <header class="topbar">
        <div class="brand">VICE CITY <span>ONLINE</span></div>
        <div class="pills">
          <div class="pill" data-tone="idle" id="pill-server"><i></i><b>Servidor</b><span>conectando…</span></div>
          <div class="pill" data-tone="idle" id="pill-controller"><i></i><b>Controle</b><span>aguardando</span></div>
        </div>
      </header>
      <section class="pairing" id="pairing">
        <h2>Conecte o celular</h2>
        <p class="hint">Aponte a câmera do celular para o QR code</p>
        <div class="qr" id="qr"><div class="spinner"></div></div>
        <div class="codes">
          <div><small>Código</small><strong id="code">····</strong></div>
          <div><small>PIN</small><strong id="pin">····</strong></div>
        </div>
        <p class="url" id="url"></p>
        <p class="compact-label">Sessão <strong></strong></p>
      </section>
      <div class="speedo" id="speed"><strong>0</strong><small>km/h</small></div>
      <pre class="stats" id="stats">Iniciando…</pre>
      <div class="toast" id="toast"></div>
      <div class="actions">
        <button type="button" id="btn-fullscreen" autofocus>⛶ Tela cheia</button>
        <button type="button" id="btn-quality">Qualidade</button>
      </div>
      <p class="help">Celular: stick dirige · R acelera · L freia · A pula &nbsp;|&nbsp; PC: WASD · Espaço · Q qualidade</p>
    `;

    const $ = (id: string) => root.querySelector<HTMLElement>(`#${id}`)!;
    this.serverPill = $('pill-server');
    this.controllerPill = $('pill-controller');
    this.pairing = $('pairing');
    this.qr = $('qr');
    this.code = $('code');
    this.pin = $('pin');
    this.url = $('url');
    this.speed = $('speed');
    this.stats = $('stats');
    this.toast = $('toast');

    $('btn-fullscreen').addEventListener('click', () => toggleFullscreen());
    $('btn-quality').addEventListener('click', () => {
      this.root.dispatchEvent(new CustomEvent('vco:cycle-quality', { bubbles: true }));
    });
  }

  setSpeed(speed: number): void {
    const kmh = Math.round(Math.abs(speed) * 4.2);
    if (kmh === this.lastShownSpeed) return;
    this.lastShownSpeed = kmh;
    this.speed.querySelector('strong')!.textContent = String(kmh);
  }

  setGpu(info: WebGLSupport, isWebGL2: boolean): void {
    this.gpuLine = `WebGL ${isWebGL2 ? 2 : 1} · ${info.renderer}`;
  }

  setServerState(state: ServerState, detail?: string): void {
    const map: Record<ServerState, [PillTone, string]> = {
      connecting: ['idle', 'conectando…'],
      connected: ['ok', 'online'],
      reconnecting: ['warn', 'reconectando…'],
      error: ['bad', detail ?? 'erro'],
    };
    const [tone, text] = map[state];
    setPill(this.serverPill, tone, text);
    if (state !== 'connected') {
      setPill(this.controllerPill, this.everHadController ? 'bad' : 'idle', this.everHadController ? 'desconectado' : 'aguardando');
    }
  }

  setSession(info: TvSessionInfo): void {
    this.qr.innerHTML = info.qrSvg;
    this.code.textContent = info.code;
    this.pin.textContent = info.pin;
    this.url.textContent = info.controllerUrl.split('?')[0] ?? '';
    this.pairing.querySelector('.compact-label strong')!.textContent = `${info.code} · PIN ${info.pin}`;
    this.setStatus(info);
  }

  setStatus(status: SessionStatus): void {
    const was = this.controllerConnected;
    this.controllerConnected = status.controllerConnected;

    if (status.controllerConnected) {
      this.everHadController = true;
      setPill(this.controllerPill, 'ok', 'conectado');
      if (!was) this.showToast('🎮 Controle conectado', 'ok');
    } else if (this.everHadController) {
      setPill(this.controllerPill, 'bad', 'desconectado');
      if (was) this.showToast('⚠ Controle desconectado — aguardando reconexão', 'bad');
    } else {
      setPill(this.controllerPill, 'idle', 'aguardando');
    }
    this.pairing.classList.toggle('compact', status.controllerConnected);
  }

  setStats(s: StatsSnapshot, quality: QualityLevel, resolution: string): void {
    const heap = s.heapUsedMb !== null ? `${s.heapUsedMb.toFixed(0)} / ${s.heapLimitMb!.toFixed(0)} MB` : 'n/d neste navegador';
    this.stats.dataset.tone = s.fps >= 50 ? 'ok' : s.fps >= 30 ? 'warn' : 'bad';
    this.stats.textContent =
      `FPS      ${s.fps.toFixed(0).padStart(3)}   (${s.frameMs.toFixed(1)} ms, pior ${s.worstFrameMs.toFixed(1)} ms)\n` +
      `Draws    ${s.drawCalls}   Tris ${(s.triangles / 1000).toFixed(1)}k\n` +
      `GPU mem  ${s.geometries} geo · ${s.textures} tex\n` +
      `JS heap  ${heap}\n` +
      `Render   ${resolution} · qualidade ${quality.name}\n` +
      this.gpuLine;
  }

  showToast(message: string, tone: PillTone = 'idle'): void {
    this.toast.textContent = message;
    this.toast.dataset.tone = tone;
    this.toast.classList.add('visible');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toast.classList.remove('visible'), 3500);
  }

  showFatal(title: string, details: string[]): void {
    const box = document.createElement('div');
    box.className = 'fatal';
    box.innerHTML = `<h1>${title}</h1><ul>${details.map((d) => `<li>${d}</li>`).join('')}</ul>`;
    this.root.appendChild(box);
  }
}

function setPill(el: HTMLElement, tone: PillTone, text: string): void {
  el.dataset.tone = tone;
  el.querySelector('span')!.textContent = text;
}

function toggleFullscreen(): void {
  const doc = document as Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void };
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  if (document.fullscreenElement || doc.webkitFullscreenElement) {
    (document.exitFullscreen?.bind(document) ?? doc.webkitExitFullscreen?.bind(doc))?.();
    return;
  }
  const request = el.requestFullscreen?.bind(el) ?? el.webkitRequestFullscreen?.bind(el);
  try {
    const result = request?.();
    if (result instanceof Promise) result.catch(() => {});
  } catch {
    // Alguns navegadores de TV não expõem a Fullscreen API; o app continua em tela normal.
  }
}
