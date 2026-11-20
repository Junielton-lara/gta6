import { PerspectiveCamera, Scene, WebGLRenderer, PCFShadowMap, SRGBColorSpace } from 'three';
import { StatsMonitor, type StatsSnapshot } from '../diagnostics/stats';

export interface QualityLevel {
  name: string;
  /** Altura alvo do framebuffer em pixels reais (limita o custo em TVs 4K). */
  targetHeight: number;
  shadows: boolean;
}

/** Do mais bonito ao mais leve. A engine só desce de nível, para não oscilar. */
export const QUALITY_LEVELS: QualityLevel[] = [
  { name: 'Alta', targetHeight: 1080, shadows: true },
  { name: 'Média', targetHeight: 720, shadows: true },
  { name: 'Baixa', targetHeight: 720, shadows: false },
  { name: 'Mínima', targetHeight: 540, shadows: false },
];

const ASPECT = 16 / 9;
const LOW_FPS = 42;
const WARMUP_MS = 3000;
const LOW_FPS_WINDOWS_TO_DROP = 4;

export type UpdateFn = (dt: number, time: number) => void;

export class Engine {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(60, ASPECT, 0.1, 500);
  readonly stats: StatsMonitor;

  onStats?: (stats: StatsSnapshot, quality: QualityLevel) => void;
  onQualityChange?: (quality: QualityLevel) => void;
  onFirstFrame?: () => void;

  private qualityIndex_ = 0;
  private lowFpsWindows = 0;
  private startedAt = 0;
  private lastTime = 0;
  private running = false;
  private renderedFrames = 0;
  private update: UpdateFn = () => {};

  constructor(private readonly stage: HTMLElement) {
    this.renderer = new WebGLRenderer({
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
      preserveDrawingBuffer: false,
    });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.shadowMap.type = PCFShadowMap;
    stage.appendChild(this.renderer.domElement);

    this.stats = new StatsMonitor(this.renderer);
    this.applyQuality();

    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 200));
    document.addEventListener('fullscreenchange', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      // Evita um dt gigante ao voltar de segundo plano.
      if (!document.hidden) this.lastTime = performance.now();
    });

    this.renderer.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.running = false;
    });
    this.renderer.domElement.addEventListener('webglcontextrestored', () => this.start(this.update));
  }

  get isWebGL2(): boolean {
    return this.renderer.capabilities.isWebGL2;
  }

  get qualityIndex(): number {
    return this.qualityIndex_;
  }

  get quality(): QualityLevel {
    return QUALITY_LEVELS[this.qualityIndex_]!;
  }

  setQuality(index: number): void {
    this.qualityIndex_ = Math.max(0, Math.min(QUALITY_LEVELS.length - 1, index));
    this.lowFpsWindows = 0;
    this.applyQuality();
    this.onQualityChange?.(this.quality);
  }

  start(update: UpdateFn): void {
    this.update = update;
    if (this.running) return;
    this.running = true;
    this.startedAt = this.lastTime = performance.now();
    requestAnimationFrame(this.tick);
  }

  private readonly tick = (now: number) => {
    if (!this.running) return;
    requestAnimationFrame(this.tick);

    const dt = Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;

    const t0 = performance.now();
    this.update(dt, now / 1000);
    this.renderer.render(this.scene, this.camera);
    if (++this.renderedFrames === 1) this.onFirstFrame?.();

    const snapshot = this.stats.frame(performance.now() - t0);
    if (snapshot) {
      this.adaptQuality(snapshot, now);
      this.onStats?.(snapshot, this.quality);
    }
  };

  private adaptQuality(stats: StatsSnapshot, now: number): void {
    if (now - this.startedAt < WARMUP_MS || document.hidden) return;
    if (stats.fps >= LOW_FPS) {
      this.lowFpsWindows = 0;
      return;
    }
    if (++this.lowFpsWindows >= LOW_FPS_WINDOWS_TO_DROP && this.qualityIndex_ < QUALITY_LEVELS.length - 1) {
      this.setQuality(this.qualityIndex_ + 1);
      this.startedAt = now;
    }
  }

  private applyQuality(): void {
    const { shadows } = this.quality;
    if (this.renderer.shadowMap.enabled !== shadows) {
      this.renderer.shadowMap.enabled = shadows;
      this.scene.traverse((obj) => {
        const material = (obj as { material?: { needsUpdate: boolean } | { needsUpdate: boolean }[] }).material;
        if (Array.isArray(material)) material.forEach((m) => (m.needsUpdate = true));
        else if (material) material.needsUpdate = true;
      });
    }
    this.resize();
  }

  /** Encaixa um quadro 16:9 na janela (letterbox) e limita a resolução interna. */
  resize(): void {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let width = vw;
    let height = Math.round(vw / ASPECT);
    if (height > vh) {
      height = vh;
      width = Math.round(vh * ASPECT);
    }

    this.stage.style.width = `${width}px`;
    this.stage.style.height = `${height}px`;

    const dpr = window.devicePixelRatio || 1;
    const pixelRatio = Math.min(dpr, this.quality.targetHeight / height);
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height);
    this.camera.aspect = ASPECT;
    this.camera.updateProjectionMatrix();
  }

  get drawingBufferSize(): string {
    const canvas = this.renderer.domElement;
    return `${canvas.width}×${canvas.height}`;
  }
}
