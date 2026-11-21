import { Button, INPUT_STALE_MS, type ControllerInput } from '@vco/shared';

export interface DriveInput {
  steer: number;
  throttle: number;
  handbrake: boolean;
}

export interface FootInput {
  x: number;
  y: number;
  run: boolean;
  interact: boolean;
  jump: boolean;
}

const MENU_UP = 1;
const MENU_DOWN = 2;

/** Teclado do PC emulando os botões do layout moderno (testes sem celular). */
const KEY_TO_PAD: Record<string, number> = {
  KeyH: Button.Square,
  KeyC: Button.Circle,
  KeyT: Button.Triangle,
  KeyM: Button.TouchPad,
  Escape: Button.Options,
  KeyP: Button.Options,
  KeyX: Button.Cross,
  KeyZ: Button.L3,
  ControlLeft: Button.L3,
  KeyR: Button.R3,
};

/** Junta o controle remoto (celular) e o teclado (testes no PC). */
export class InputState {
  private remote: ControllerInput = { x: 0, y: 0, buttons: 0, seq: -1 };
  private remoteAt = 0;
  private readonly keys = new Set<string>();
  private jumpQueued = false;
  private interactQueued = false;
  private edges = 0;
  private menuEdges = 0;
  /** Celular usando o layout moderno: acelerar só pelos gatilhos, nunca pelo stick. */
  private modernPad = false;

  private mouseDx = 0;
  private mouseDy = 0;

  constructor(private readonly onAction: () => void, dragSurface?: HTMLElement) {
    if (dragSurface) {
      let dragging: number | null = null;
      dragSurface.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 && e.pointerType === 'mouse') return;
        dragging = e.pointerId;
      });
      window.addEventListener('pointermove', (e) => {
        if (e.pointerId !== dragging) return;
        this.mouseDx += e.movementX || 0;
        this.mouseDy += e.movementY || 0;
      });
      window.addEventListener('pointerup', (e) => {
        if (e.pointerId === dragging) dragging = null;
      });
    }
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'Space') {
        this.jumpQueued = true;
        this.onAction();
      }
      if (e.code === 'KeyE' || e.code === 'KeyF') this.interactQueued = true;
      const pad = KEY_TO_PAD[e.code];
      if (pad) this.edges |= pad;
      if (e.code === 'ArrowUp' || e.code === 'KeyW') this.menuEdges |= MENU_UP;
      if (e.code === 'ArrowDown' || e.code === 'KeyS') this.menuEdges |= MENU_DOWN;
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  /** Botões apertados desde a última chamada (borda de subida), celular + teclado. */
  takePressed(): number {
    const v = this.edges;
    this.edges = 0;
    return v;
  }

  /** Navegação de menu pelo analógico: devolve −1 (cima), 1 (baixo) ou 0. */
  takeMenuMove(): number {
    const v = this.menuEdges;
    this.menuEdges = 0;
    return v & MENU_UP ? -1 : v & MENU_DOWN ? 1 : 0;
  }

  /** Botão segurado agora (celular ou tecla equivalente). */
  held(bit: number): boolean {
    if (this.remoteActive && this.remote.buttons & bit) return true;
    for (const [code, b] of Object.entries(KEY_TO_PAD)) if (b === bit && this.keys.has(code)) return true;
    return false;
  }

  applyRemote(input: ControllerInput): void {
    if (input.seq <= this.remote.seq && input.seq > 5) return;
    const prev = this.remote.buttons;
    this.edges |= input.buttons & ~prev;
    if (input.buttons >= Button.Cross) this.modernPad = true;
    else if (input.buttons & (Button.Accel | Button.Brake | Button.Action | Button.Run)) this.modernPad = false;
    const prevY = this.remote.y;
    if (input.y > 0.6 && prevY <= 0.6) this.menuEdges |= MENU_UP;
    if (input.y < -0.6 && prevY >= -0.6) this.menuEdges |= MENU_DOWN;
    this.remote = input;
    this.remoteAt = performance.now();
    if ((input.buttons & Button.Action) && !(prev & Button.Action)) {
      this.jumpQueued = true;
      this.onAction();
    }
    if ((input.buttons & Button.Interact) && !(prev & Button.Interact)) {
      this.interactQueued = true;
    }
  }

  resetRemote(): void {
    this.remote = { x: 0, y: 0, buttons: 0, seq: -1 };
  }

  get remoteActive(): boolean {
    return performance.now() - this.remoteAt < INPUT_STALE_MS;
  }

  consumeJump(): boolean {
    const v = this.jumpQueued;
    this.jumpQueued = false;
    return v;
  }

  consumeInteract(): boolean {
    const v = this.interactQueued;
    this.interactQueued = false;
    return v;
  }

  readFoot(): FootInput {
    let x = 0;
    let y = 0;
    let run = false;

    if (this.remoteActive) {
      const b = this.remote.buttons;
      x = this.remote.x;
      y = this.remote.y;
      if (Math.abs(x) < 0.05 && Math.abs(y) < 0.05) {
        x = (b & Button.Right ? 1 : 0) - (b & Button.Left ? 1 : 0);
        y = (b & Button.Up ? 1 : 0) - (b & Button.Down ? 1 : 0);
      }
      run = !!(b & (Button.Run | Button.Circle));
    }

    const k = this.keys;
    const kx =
      (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const ky =
      (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    if (kx || ky) {
      x = kx;
      y = ky;
    }
    if (k.has('ShiftLeft') || k.has('ShiftRight')) run = true;

    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    return {
      x,
      y,
      run,
      interact: false,
      jump: false,
    };
  }

  /** Giro de câmera: celular (cx/cy), teclas J/L/I/K e arrasto do mouse na TV/PC. */
  readLook(dt: number): { x: number; y: number } {
    let x = 0;
    let y = 0;
    if (this.remoteActive) {
      x = this.remote.cx ?? 0;
      y = this.remote.cy ?? 0;
    }
    const k = this.keys;
    const kx = (k.has('KeyL') ? 1 : 0) - (k.has('KeyJ') ? 1 : 0);
    const ky = (k.has('KeyI') ? 1 : 0) - (k.has('KeyK') ? 1 : 0);
    if (kx) x = kx;
    if (ky) y = ky;
    if (dt > 0 && (this.mouseDx || this.mouseDy)) {
      x += (this.mouseDx * 0.005) / (2.4 * dt);
      y += (this.mouseDy * 0.004) / (1.4 * dt);
      this.mouseDx = this.mouseDy = 0;
    }
    return { x, y };
  }

  readDrive(): DriveInput {
    let steer = 0;
    let throttle = 0;

    if (this.remoteActive) {
      const b = this.remote.buttons;
      steer = this.remote.x;
      if (Math.abs(steer) < 0.05) {
        steer = (b & Button.Right ? 1 : 0) - (b & Button.Left ? 1 : 0);
      }
      const pedalAccel = b & (Button.Accel | Button.R2) ? 1 : 0;
      const pedalBrake = b & (Button.Brake | Button.L2) ? 1 : 0;
      if (pedalAccel || pedalBrake) throttle = pedalAccel - pedalBrake;
      else if (!this.modernPad) {
        // Layout clássico sem pedais pressionados: o eixo Y do stick também acelera/freia.
        throttle = this.remote.y;
        if (Math.abs(throttle) < 0.05) {
          throttle = (b & Button.Up ? 1 : 0) - (b & Button.Down ? 1 : 0);
        }
      }
    }

    const k = this.keys;
    const keySteer =
      (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const keyThrottle =
      (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    if (keySteer) steer = keySteer;
    if (keyThrottle) throttle = keyThrottle;

    return {
      steer: clamp(steer, -1, 1),
      throttle: clamp(throttle, -1, 1),
      handbrake: this.held(Button.Cross) || k.has('Space'),
    };
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
