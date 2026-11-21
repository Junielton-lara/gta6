import { CircleGeometry, Group, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import type { CollisionWorld } from '../world/collision';
import type { HumanRig } from './HumanModel';

export type Gait = 'idle' | 'walk' | 'jog' | 'sprint' | 'crouch';

const WALK_SPEED = 1.7;
const JOG_SPEED = 3.6;
const SPRINT_SPEED = 6.6;
const CROUCH_SPEED = 1.35;
/** stick abaixo disso anda; acima, trota */
const JOG_THRESHOLD = 0.6;
const ACCEL = 7;
const DECEL = 11;
const AIR_CONTROL = 1.6;
const JUMP_V = 6.2;
const GRAVITY = 22;
const RADIUS = 0.35;
/** fôlego: corrida gasta, descanso recupera (fração por segundo) */
const STAMINA_DRAIN = 0.11;
const STAMINA_REGEN = 0.22;
const STAMINA_REGEN_DELAY = 0.9;
const STAMINA_RECOVERED = 0.3;

export class Character {
  readonly root = new Group();
  readonly velocity = new Vector3();
  onFoot = true;
  crouched = false;
  /** 0..1 */
  stamina = 1;
  gait: Gait = 'idle';
  private readonly body = new Group();
  private verticalV = 0;
  private grounded = true;
  private exhausted = false;
  private regenDelay = 0;
  private landingLock = 0;

  constructor(private readonly rig: HumanRig) {
    this.body.add(rig.root);
    const blob = new Mesh(
      new CircleGeometry(0.45, 12),
      new MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.25, depthWrite: false }),
    );
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.06;
    this.root.add(this.body, blob);
  }

  get position(): Vector3 {
    return this.root.position;
  }

  get yaw(): number {
    return this.root.rotation.y;
  }

  get speed(): number {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  get airborne(): boolean {
    return !this.grounded;
  }

  /** Agachado, o pulo só levanta (como nos jogos de mundo aberto). */
  jump(): void {
    if (!this.onFoot || !this.grounded || this.landingLock > 0) return;
    if (this.crouched) {
      this.crouched = false;
      return;
    }
    this.verticalV = JUMP_V;
    this.grounded = false;
  }

  toggleCrouch(): void {
    if (!this.onFoot || !this.grounded) return;
    this.crouched = !this.crouched;
  }

  /** moveX/moveY relativos à câmera: x direita, y frente. Intensidade do stick escolhe andar/trotar. */
  update(dt: number, moveX: number, moveY: number, run: boolean, cameraYaw: number, collision: CollisionWorld): void {
    if (!this.onFoot) {
      this.root.visible = false;
      return;
    }
    this.root.visible = true;

    const mag = Math.min(1, Math.hypot(moveX, moveY));
    // Correr levanta do agachado.
    if (run && mag > 0.2 && this.crouched) this.crouched = false;

    const wantsSprint = run && mag > 0.2 && !this.crouched && !this.exhausted;
    let max: number;
    if (mag < 0.08) {
      max = 0;
      this.gait = 'idle';
    } else if (this.crouched) {
      max = CROUCH_SPEED * Math.min(1, 0.4 + mag);
      this.gait = 'crouch';
    } else if (wantsSprint) {
      max = SPRINT_SPEED;
      this.gait = 'sprint';
    } else if (mag >= JOG_THRESHOLD) {
      max = JOG_SPEED;
      this.gait = 'jog';
    } else {
      max = WALK_SPEED * (0.45 + mag);
      this.gait = 'walk';
    }
    if (this.landingLock > 0) {
      this.landingLock -= dt;
      max *= 0.35;
    }
    this.updateStamina(dt, this.gait === 'sprint' && this.speed > 3);

    const sin = Math.sin(cameraYaw);
    const cos = Math.cos(cameraYaw);
    const dirX = mag > 0 ? moveX / mag : 0;
    const dirY = mag > 0 ? moveY / mag : 0;
    const tx = (dirX * cos - dirY * sin) * max;
    const tz = (-dirX * sin - dirY * cos) * max;

    // Arranque mais lento que a parada; no ar quase não dá para mudar a direção.
    const speeding = tx * tx + tz * tz > this.velocity.x ** 2 + this.velocity.z ** 2;
    const rate = !this.grounded ? AIR_CONTROL : speeding ? ACCEL : DECEL;
    const blend = 1 - Math.exp(-rate * dt);
    this.velocity.x += (tx - this.velocity.x) * blend;
    this.velocity.z += (tz - this.velocity.z) * blend;

    this.root.position.x += this.velocity.x * dt;
    this.root.position.z += this.velocity.z * dt;
    collision.resolveCircle(this.root.position, RADIUS);

    if (this.speed > 0.3 && this.grounded) {
      const targetYaw = Math.atan2(-this.velocity.x, -this.velocity.z);
      let d = targetYaw - this.root.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      // gira rápido parado/andando, pesado correndo
      const turn = this.gait === 'sprint' ? 6 : this.gait === 'jog' ? 9 : 13;
      this.root.rotation.y += d * Math.min(1, turn * dt);
    }

    this.verticalV -= GRAVITY * dt;
    this.body.position.y += this.verticalV * dt;
    if (this.body.position.y <= 0) {
      if (!this.grounded && this.verticalV < -7.5) this.landingLock = 0.18;
      this.body.position.y = 0;
      this.verticalV = 0;
      this.grounded = true;
    }

    this.rig.animate(dt, this.speed, this.gait === 'sprint', {
      crouch: this.crouched,
      airborne: !this.grounded,
      verticalV: this.verticalV,
    });
  }

  private updateStamina(dt: number, sprinting: boolean): void {
    if (sprinting) {
      this.stamina = Math.max(0, this.stamina - STAMINA_DRAIN * dt);
      this.regenDelay = STAMINA_REGEN_DELAY;
      if (this.stamina === 0) this.exhausted = true;
      return;
    }
    if (this.regenDelay > 0) {
      this.regenDelay -= dt;
      return;
    }
    this.stamina = Math.min(1, this.stamina + STAMINA_REGEN * dt);
    if (this.exhausted && this.stamina >= STAMINA_RECOVERED) this.exhausted = false;
  }

  /** Cansado: não consegue correr até recuperar parte do fôlego. */
  get isExhausted(): boolean {
    return this.exhausted;
  }
}
