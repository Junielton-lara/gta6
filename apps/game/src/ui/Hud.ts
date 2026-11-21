import type { ControlMode, SessionStatus, TvSessionInfo } from '@vco/shared';
import type { StatsSnapshot } from '../diagnostics/stats';
import type { WebGLSupport } from '../diagnostics/webgl';
import type { QualityLevel } from '../engine/Engine';
import type { ServerState } from '../net/connection';
import type { MinimapData } from '../world/CityWorld';

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
  private readonly modeLabel: HTMLElement;
  private readonly toast: HTMLElement;
  private readonly minimap: HTMLCanvasElement;
  private readonly minimapCtx: CanvasRenderingContext2D;
  private toastTimer = 0;
  private everHadController = false;
  private controllerConnected = false;
  private gpuLine = '';
  private lastShownSpeed = Number.NaN;
  private map: MinimapData | null = null;
  private readonly place: HTMLElement;
  private readonly loading: HTMLElement;
  private modeText = 'A pé';
  private clockText = '';
  private crouched = false;
  private readonly staminaEl: HTMLElement;
  private readonly promptEl: HTMLElement;
  private readonly infoEl: HTMLElement;
  private readonly interiorNote: HTMLElement;
  private promptText = '';
  private pois: { x: number; z: number; color: string }[] = [];
  infoOpen = false;
  private readonly staminaFill: HTMLElement;
  /** Linha extra no painel de desempenho (blocos carregados, entidades). */
  extraStats = '';

  constructor(private readonly root: HTMLElement) {
    root.innerHTML = `
      <header class="topbar">
        <div class="brand">CURITIBA <span>OPEN WORLD</span></div>
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
      <canvas class="minimap" id="minimap" width="160" height="160" aria-label="Minimapa"></canvas>
      <div class="speedo" id="speed"><strong>0</strong><small>km/h</small></div>
      <div class="mode-label" id="mode-label">A pé</div>
      <div class="stamina hidden" id="stamina" aria-label="Fôlego"><i></i></div>
      <div class="prompt hidden" id="prompt"><kbd>□</kbd><span></span></div>
      <div class="info-card hidden" id="info"><h3></h3><ul></ul><p class="note"></p><p class="close">○ ou □ fecha</p></div>
      <div class="interior-note hidden" id="interior-note"></div>
      <div class="place" id="place"><strong></strong><small></small></div>
      <p class="osm-credit">Mapa: © OpenStreetMap contributors (ODbL) · Texturas: Poly Haven (CC0)</p>
      <div class="loading" id="loading"><div class="spinner"></div><p>Carregando Centro de Curitiba…</p></div>
      <pre class="stats" id="stats">Iniciando…</pre>
      <div class="toast" id="toast"></div>
      <div class="actions">
        <button type="button" id="btn-fullscreen" autofocus>⛶ Tela cheia</button>
        <button type="button" id="btn-quality">Qualidade</button>
      </div>
      <p class="help">WASD mover · Shift correr · Espaço pula / freio de mão · Z agachar · R centralizar câmera · E entrar/sair do carro · H interagir / buzina · C câmera do carro · M mapa · P pausa · J/L/I/K ou arrastar: câmera · Q qualidade</p>
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
    this.modeLabel = $('mode-label');
    this.stats = $('stats');
    this.toast = $('toast');
    this.place = $('place');
    this.loading = $('loading');
    this.promptEl = $('prompt');
    this.infoEl = $('info');
    this.interiorNote = $('interior-note');
    this.staminaEl = $('stamina');
    this.staminaFill = this.staminaEl.querySelector('i')!;
    this.minimap = root.querySelector('#minimap') as HTMLCanvasElement;
    this.minimapCtx = this.minimap.getContext('2d')!;

    $('btn-fullscreen').addEventListener('click', () => toggleFullscreen());
    $('btn-quality').addEventListener('click', () => {
      this.root.dispatchEvent(new CustomEvent('vco:cycle-quality', { bubbles: true }));
    });
  }

  setMinimap(map: MinimapData): void {
    this.map = map;
  }

  setPois(pois: { x: number; z: number; color: string }[]): void {
    this.pois = pois;
  }

  /** Aviso "□ Entrar · Café do Paço" perto de algo interativo. */
  setPrompt(text: string | null): void {
    const t = text ?? '';
    if (t === this.promptText) return;
    this.promptText = t;
    this.promptEl.classList.toggle('hidden', !t);
    if (t) this.promptEl.querySelector('span')!.textContent = t;
  }

  showInfo(title: string, lines: string[], note = ''): void {
    this.infoEl.querySelector('h3')!.textContent = title;
    const ul = this.infoEl.querySelector('ul')!;
    ul.innerHTML = '';
    for (const l of lines) {
      const li = document.createElement('li');
      li.textContent = l;
      ul.appendChild(li);
    }
    this.infoEl.querySelector('.note')!.textContent = note;
    this.infoEl.classList.remove('hidden');
    this.infoOpen = true;
  }

  hideInfo(): void {
    this.infoEl.classList.add('hidden');
    this.infoOpen = false;
  }

  setInteriorNote(text: string | null): void {
    this.interiorNote.classList.toggle('hidden', !text);
    if (text) this.interiorNote.textContent = text;
  }

  setLoading(text: string | null): void {
    this.loading.classList.toggle('hidden', text === null);
    if (text) this.loading.querySelector('p')!.textContent = text;
  }

  setMode(mode: ControlMode): void {
    this.modeText = mode === 'driving' ? 'Dirigindo' : 'A pé';
    this.renderModeLabel();
  }

  setClock(clock: string): void {
    this.clockText = clock;
    this.renderModeLabel();
  }

  /** Barra de fôlego (aparece ao correr/recuperar) e estado agachado. */
  setFoot(onFoot: boolean, stamina: number, exhausted: boolean, crouched: boolean): void {
    const show = onFoot && stamina < 0.995;
    this.staminaEl.classList.toggle('hidden', !show);
    if (show) {
      const pct = `${Math.round(stamina * 100)}%`;
      if (this.staminaFill.style.width !== pct) this.staminaFill.style.width = pct;
      this.staminaEl.classList.toggle('exhausted', exhausted);
    }
    const c = onFoot && crouched;
    if (c !== this.crouched) {
      this.crouched = c;
      this.renderModeLabel();
    }
  }

  private renderModeLabel(): void {
    const mode = this.crouched ? `${this.modeText} · agachado` : this.modeText;
    this.modeLabel.textContent = this.clockText ? `${mode} · ${this.clockText}` : mode;
  }

  /** Rua atual e marco próximo. `note` sinaliza quando o modelo é representação. */
  setPlace(street: string | null, landmark: string | null, note: string | null): void {
    const strong = this.place.querySelector('strong')!;
    const small = this.place.querySelector('small')!;
    const title = landmark ?? street ?? '';
    if (strong.textContent !== title) strong.textContent = title;
    const sub = [landmark && street ? street : null, note].filter(Boolean).join(' · ');
    if (small.textContent !== sub) small.textContent = sub;
    this.place.classList.toggle('hidden', !title);
  }

  /** Minimapa voltado para a câmera; ruas reais do OSM. */
  drawMinimap(playerX: number, playerZ: number, yaw: number, cameraYaw = yaw): void {
    const ctx = this.minimapCtx;
    const w = this.minimap.width;
    const h = this.minimap.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(12, 18, 22, 0.72)';
    ctx.fillRect(0, 0, w, h);

    const scale = 0.5;
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(cameraYaw);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const range = (w / scale) * 0.8;
    for (const pass of ['pedestrian', 'road'] as const) {
      for (const road of this.map?.roads ?? []) {
        const isRoad = road.kind === 'road';
        if ((pass === 'road') !== isRoad || road.pts.length < 2) continue;
        const a = road.pts[0]!;
        if (Math.abs(a.x - playerX) > range * 2 && Math.abs(a.z - playerZ) > range * 2) continue;
        ctx.strokeStyle = isRoad ? '#9aa8b4' : '#6d6a5c';
        ctx.lineWidth = Math.max(1.2, road.width * scale * (isRoad ? 0.8 : 0.5));
        ctx.beginPath();
        road.pts.forEach((p, i) => {
          const x = (p.x - playerX) * scale;
          const y = (p.z - playerZ) * scale;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
      }
    }
    for (const p of this.pois) {
      const x = (p.x - playerX) * scale;
      const y = (p.z - playerZ) * scale;
      if (Math.abs(x) > w || Math.abs(y) > h) continue;
      ctx.fillStyle = p.color;
      ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
    }
    ctx.fillStyle = '#ffc24d';
    for (const l of this.map?.landmarks ?? []) {
      const x = (l.x - playerX) * scale;
      const y = (l.z - playerZ) * scale;
      if (Math.abs(x) > w || Math.abs(y) > h) continue;
      ctx.beginPath();
      ctx.arc(x, y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    // norte
    ctx.fillStyle = '#ff5a6e';
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('N', 0, -h / 2 + 14);
    ctx.restore();

    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(cameraYaw - yaw);

    ctx.fillStyle = '#3de0ff';
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(5, 6);
    ctx.lineTo(-5, 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
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
      setPill(
        this.controllerPill,
        this.everHadController ? 'bad' : 'idle',
        this.everHadController ? 'desconectado' : 'aguardando',
      );
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
      if (!was) this.showToast('Controle conectado', 'ok');
    } else if (this.everHadController) {
      setPill(this.controllerPill, 'bad', 'desconectado');
      if (was) this.showToast('Controle desconectado', 'bad');
    } else {
      setPill(this.controllerPill, 'idle', 'aguardando');
    }
    this.pairing.classList.toggle('compact', status.controllerConnected);
  }

  setStats(s: StatsSnapshot, quality: QualityLevel, resolution: string): void {
    const heap =
      s.heapUsedMb !== null ? `${s.heapUsedMb.toFixed(0)} / ${s.heapLimitMb!.toFixed(0)} MB` : 'n/d';
    this.stats.dataset.tone = s.fps >= 50 ? 'ok' : s.fps >= 28 ? 'warn' : 'bad';
    this.stats.textContent =
      `FPS      ${s.fps.toFixed(0).padStart(3)}   (${s.frameMs.toFixed(1)} ms)\n` +
      `Draws    ${s.drawCalls}   Tris ${(s.triangles / 1000).toFixed(1)}k\n` +
      `GPU mem  ${s.geometries} geo · ${s.textures} tex\n` +
      `JS heap  ${heap}\n` +
      `Render   ${resolution} · ${quality.name}\n` +
      (this.extraStats ? `${this.extraStats}\n` : '') +
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
    /* TV sem Fullscreen API */
  }
}
