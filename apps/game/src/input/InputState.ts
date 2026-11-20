import { Button, INPUT_STALE_MS, type ControllerInput } from '@vco/shared';

export interface DriveInput {
  /** -1..1, direita positiva. */
  steer: number;
  /** -1..1, aceleração positiva / freio-ré negativo. */
  throttle: number;
}

/** Junta o controle remoto (celular) e o teclado (testes no PC). */
export class InputState {
  private remote: ControllerInput = { x: 0, y: 0, buttons: 0, seq: -1 };
  private remoteAt = 0;
  private readonly keys = new Set<string>();

  constructor(private readonly onAction: () => void) {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'Space') this.onAction();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  applyRemote(input: ControllerInput): void {
    // seq volta para 0 quando o celular recarrega; aceita também nesse caso.
    if (input.seq <= this.remote.seq && input.seq > 5) return;
    this.remote = input;
    this.remoteAt = performance.now();
  }

  resetRemote(): void {
    this.remote = { x: 0, y: 0, buttons: 0, seq: -1 };
  }

  get remoteActive(): boolean {
    return performance.now() - this.remoteAt < INPUT_STALE_MS;
  }

  read(): DriveInput {
    let steer = 0;
    let throttle = 0;

    if (this.remoteActive) {
      const b = this.remote.buttons;
      steer = this.remote.x;
      if (Math.abs(steer) < 0.05) {
        steer = (b & Button.Right ? 1 : 0) - (b & Button.Left ? 1 : 0);
      }

      const pedalAccel = b & Button.Accel ? 1 : 0;
      const pedalBrake = b & Button.Brake ? 1 : 0;
      if (pedalAccel || pedalBrake) {
        throttle = pedalAccel - pedalBrake;
      } else {
        // Fallback: eixo Y do joystick (frente = acelerar).
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
    };
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
