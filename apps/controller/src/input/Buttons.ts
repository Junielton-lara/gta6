import { Button, type ButtonName } from '@vco/shared';
import { vibrate } from './haptics';

export type ButtonListener = (button: ButtonName, pressed: boolean) => void;

/**
 * Botões digitais por Pointer Events. Arrastar o dedo de um botão do D-pad para outro
 * troca a direção sem precisar levantar o polegar.
 */
export class Buttons {
  mask = 0;
  private readonly pressedBy = new Map<number, HTMLElement>();

  constructor(
    private readonly elements: HTMLElement[],
    private readonly listener: ButtonListener,
  ) {
    for (const el of elements) {
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId);
        this.press(e.pointerId, el);
      });
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    }
    window.addEventListener('pointermove', (e) => {
      if (!this.pressedBy.has(e.pointerId)) return;
      const target = document.elementFromPoint(e.clientX, e.clientY);
      const el = this.elements.find((b) => b === target || b.contains(target));
      if (el && el.dataset.slide === 'true' && this.pressedBy.get(e.pointerId)?.dataset.slide === 'true') {
        this.press(e.pointerId, el);
      }
    });
    const release = (e: PointerEvent) => this.release(e.pointerId);
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
  }

  /** Aperto curto de um botão sem elemento próprio (ex.: toque no analógico = L3/R3). */
  tap(name: ButtonName, ms = 120): void {
    const bit = Button[name];
    if (this.mask & bit) return;
    this.mask |= bit;
    this.listener(name, true);
    vibrate(14);
    setTimeout(() => {
      this.mask &= ~bit;
      this.listener(name, false);
    }, ms);
  }

  releaseAll(): void {
    for (const id of [...this.pressedBy.keys()]) this.release(id);
  }

  private press(pointerId: number, el: HTMLElement): void {
    const current = this.pressedBy.get(pointerId);
    if (current === el) return;
    if (current) this.setState(current, false);
    this.pressedBy.set(pointerId, el);
    this.setState(el, true);
    vibrate(el.dataset.button === 'Action' || el.dataset.button === 'Cross' ? 18 : 10);
  }

  private release(pointerId: number): void {
    const el = this.pressedBy.get(pointerId);
    if (!el) return;
    this.pressedBy.delete(pointerId);
    this.setState(el, false);
  }

  private setState(el: HTMLElement, pressed: boolean): void {
    const name = el.dataset.button as ButtonName;
    // Outro dedo pode estar segurando o mesmo botão.
    if (!pressed && [...this.pressedBy.values()].includes(el)) return;
    el.classList.toggle('pressed', pressed);
    const bit = Button[name];
    const next = pressed ? this.mask | bit : this.mask & ~bit;
    if (next === this.mask) return;
    this.mask = next;
    this.listener(name, pressed);
  }
}
