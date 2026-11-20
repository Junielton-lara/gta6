const DEADZONE = 0.12;

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

  constructor(
    private readonly zone: HTMLElement,
    private readonly base: HTMLElement,
    private readonly knob: HTMLElement,
    private readonly onChange: () => void,
  ) {
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

  private readonly down = (e: PointerEvent) => {
    if (this.pointerId !== null) return;
    e.preventDefault();
    this.pointerId = e.pointerId;
    this.zone.setPointerCapture?.(e.pointerId);

    const rect = this.zone.getBoundingClientRect();
    this.radius = this.base.offsetWidth / 2;
    // Mantém a base inteira dentro da zona.
    this.originX = clamp(e.clientX - rect.left, this.radius, rect.width - this.radius);
    this.originY = clamp(e.clientY - rect.top, this.radius, rect.height - this.radius);
    this.placeBase(this.originX, this.originY);
    this.base.classList.add('active');
    this.update(e);
    navigator.vibrate?.(8);
  };

  private readonly move = (e: PointerEvent) => {
    if (e.pointerId !== this.pointerId) return;
    e.preventDefault();
    this.update(e);
  };

  private readonly up = (e: PointerEvent) => {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = null;
    this.base.classList.remove('active');
    this.knob.style.transform = 'translate(-50%, -50%)';
    this.recenter();
    this.set(0, 0);
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

    // Zona morta com reescala: sem salto de 0 para 0.12 ao sair dela.
    const magnitude = Math.min(dist / this.radius, 1);
    if (magnitude < DEADZONE) return this.set(0, 0);
    const scaled = (magnitude - DEADZONE) / (1 - DEADZONE);
    const angle = Math.atan2(dy, dx);
    // Direção no eixo X. Y segue o polegar para fallback (TV aceita se não houver pedais).
    this.set(round(Math.cos(angle) * scaled), round(-Math.sin(angle) * scaled));
  }

  private set(x: number, y: number): void {
    if (x === this.x && y === this.y) return;
    this.x = x;
    this.y = y;
    this.onChange();
  }

  private recenter(): void {
    if (this.active) return;
    const rect = this.zone.getBoundingClientRect();
    this.placeBase(rect.width * 0.45, rect.height * 0.58);
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
