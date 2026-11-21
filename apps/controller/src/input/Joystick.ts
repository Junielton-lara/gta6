import { vibrate } from './haptics';

export interface JoystickOptions {
  /** zona morta 0..0.4 (lida a cada movimento, então ajustes valem na hora) */
  deadzone: () => number;
  /** curva de resposta: 1 = linear, >1 responde mais cedo */
  sensitivity: () => number;
  /** posição de repouso da base, em fração da zona */
  rest?: { x: number; y: number };
  /** toque rápido sem arrastar (equivale a apertar o analógico: L3/R3) */
  onTap?: () => void;
}

const TAP_MS = 230;
const TAP_TRAVEL = 0.25;

/**
 * Joystick analógico flutuante: a base aparece onde o polegar tocar dentro da zona.
 * Usa Pointer Events com captura, então funciona com multitoque junto dos botões.
 */
export class Joystick {
  x = 0;
  y = 0;
  private pointerId: number | null = null;
  private originX = 0;
  private originY = 0;
  private radius = 60;
  private downAt = 0;
  private travel = 0;
  private readonly opts: JoystickOptions;

  constructor(
    private readonly zone: HTMLElement,
    private readonly base: HTMLElement,
    private readonly knob: HTMLElement,
    private readonly onChange: () => void,
    opts: Partial<JoystickOptions> = {},
  ) {
    this.opts = { deadzone: () => 0.12, sensitivity: () => 1, ...opts };
    zone.addEventListener('pointerdown', this.down);
    zone.addEventListener('pointermove', this.move);
    zone.addEventListener('pointerup', this.up);
    zone.addEventListener('pointercancel', this.up);
    zone.addEventListener('lostpointercapture', this.up);
    window.addEventListener('resize', () => this.recenter());
    this.recenter();
  }

  get active(): boolean {
    return this.pointerId !== null;
  }

  /** Solta o stick (ex.: troca de layout ou perda de conexão). */
  release(): void {
    if (this.pointerId === null) return;
    this.pointerId = null;
    this.base.classList.remove('active');
    this.knob.style.transform = 'translate(-50%, -50%)';
    this.recenter();
    this.set(0, 0);
  }

  recenter(): void {
    if (this.active) return;
    const rect = this.zone.getBoundingClientRect();
    const rest = this.opts.rest ?? { x: 0.45, y: 0.58 };
    this.placeBase(rect.width * rest.x, rect.height * rest.y);
  }

  private readonly down = (e: PointerEvent) => {
    if (this.pointerId !== null) return;
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    this.pointerId = e.pointerId;
    try {
      this.zone.setPointerCapture?.(e.pointerId);
    } catch {
      /* ponteiro já liberado pelo navegador: segue sem captura */
    }

    const rect = this.zone.getBoundingClientRect();
    this.radius = this.base.offsetWidth / 2;
    // Mantém a base inteira dentro da zona.
    this.originX = clamp(e.clientX - rect.left, this.radius, rect.width - this.radius);
    this.originY = clamp(e.clientY - rect.top, this.radius, rect.height - this.radius);
    this.placeBase(this.originX, this.originY);
    this.base.classList.add('active');
    this.downAt = performance.now();
    this.travel = 0;
    this.update(e);
    vibrate(8);
  };

  private readonly move = (e: PointerEvent) => {
    if (e.pointerId !== this.pointerId) return;
    e.preventDefault();
    this.update(e);
  };

  private readonly up = (e: PointerEvent) => {
    if (e.pointerId !== this.pointerId) return;
    const tapped = e.type === 'pointerup' && performance.now() - this.downAt < TAP_MS && this.travel < TAP_TRAVEL;
    this.release();
    if (tapped && this.opts.onTap) {
      this.base.classList.add('tapped');
      setTimeout(() => this.base.classList.remove('tapped'), 160);
      this.opts.onTap();
    }
  };

  private update(e: PointerEvent): void {
    const rect = this.zone.getBoundingClientRect();
    let dx = e.clientX - rect.left - this.originX;
    let dy = e.clientY - rect.top - this.originY;
    const dist = Math.hypot(dx, dy);
    if (dist > this.radius) {
      dx = (dx / dist) * this.radius;
      dy = (dy / dist) * this.radius;
    }
    this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;

    // Zona morta com reescala: sem salto de 0 para a borda da zona morta ao sair dela.
    const dead = clamp(this.opts.deadzone(), 0, 0.4);
    const magnitude = Math.min(dist / this.radius, 1);
    this.travel = Math.max(this.travel, magnitude);
    if (magnitude < dead) return this.set(0, 0);
    const scaled = Math.pow((magnitude - dead) / (1 - dead), 1 / clamp(this.opts.sensitivity(), 0.5, 2));
    const angle = Math.atan2(dy, dx);
    this.set(round(Math.cos(angle) * scaled), round(-Math.sin(angle) * scaled));
  }

  private set(x: number, y: number): void {
    if (x === this.x && y === this.y) return;
    this.x = x;
    this.y = y;
    this.onChange();
  }

  private placeBase(x: number, y: number): void {
    this.base.style.left = `${x}px`;
    this.base.style.top = `${y}px`;
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}
