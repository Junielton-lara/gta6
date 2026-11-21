const RANGE = 70;
const DEADZONE = 0.1;

/**
 * Área de arrasto para girar a câmera. Funciona como um stick relativo: quanto mais longe
 * do ponto onde o dedo encostou, mais rápido gira. Toques em botões são ignorados.
 */
export class LookPad {
  cx = 0;
  cy = 0;
  private pointerId: number | null = null;
  private ox = 0;
  private oy = 0;

  constructor(
    private readonly zone: HTMLElement,
    private readonly indicator: HTMLElement,
    private readonly onChange: () => void,
  ) {
    zone.addEventListener('pointerdown', this.down);
    zone.addEventListener('pointermove', this.move);
    zone.addEventListener('pointerup', this.up);
    zone.addEventListener('pointercancel', this.up);
    zone.addEventListener('lostpointercapture', this.up);
  }

  private readonly down = (e: PointerEvent) => {
    if (this.pointerId !== null) return;
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    this.pointerId = e.pointerId;
    this.zone.setPointerCapture?.(e.pointerId);
    this.ox = e.clientX;
    this.oy = e.clientY;
    const rect = this.zone.getBoundingClientRect();
    this.indicator.style.left = `${e.clientX - rect.left}px`;
    this.indicator.style.top = `${e.clientY - rect.top}px`;
    this.indicator.classList.add('active');
  };

  private readonly move = (e: PointerEvent) => {
    if (e.pointerId !== this.pointerId) return;
    e.preventDefault();
    this.set(axis((e.clientX - this.ox) / RANGE), axis(-(e.clientY - this.oy) / RANGE));
  };

  private readonly up = (e: PointerEvent) => {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = null;
    this.indicator.classList.remove('active');
    this.set(0, 0);
  };

  private set(cx: number, cy: number): void {
    if (cx === this.cx && cy === this.cy) return;
    this.cx = cx;
    this.cy = cy;
    this.onChange();
  }
}

function axis(v: number): number {
  const c = Math.max(-1, Math.min(1, v));
  if (Math.abs(c) < DEADZONE) return 0;
  const s = (Math.abs(c) - DEADZONE) / (1 - DEADZONE);
  return Math.round(Math.sign(c) * s * 1000) / 1000;
}
