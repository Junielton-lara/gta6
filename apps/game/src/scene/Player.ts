import {
  BoxGeometry,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Vector3,
} from 'three';
import { WORLD_HALF_SIZE, type Obstacle } from './world';

const MAX_SPEED = 18;
const MAX_REVERSE = 6;
const ACCEL = 16;
const BRAKE_DECEL = 28;
const COAST_DECEL = 6;
const STEER_RATE = 2.1;
const JUMP_VELOCITY = 9;
const GRAVITY = 26;
const RADIUS = 0.9;

/**
 * Veículo arcade: aceleração/frenagem no eixo longitudinal e esterçamento
 * proporcional à velocidade (estilo GTA leve, sem física rígida).
 */
export class Player {
  readonly root = new Group();
  /** Velocidade longitudinal: positiva = frente, negativa = ré. */
  speed = 0;
  private readonly body: Mesh;
  private readonly bodyMaterial: MeshLambertMaterial;
  private readonly baseColor = '#ff4fa3';
  private verticalVelocity = 0;
  private flashTime = 0;

  constructor() {
    this.bodyMaterial = new MeshLambertMaterial({ color: this.baseColor, emissive: '#3a0020' });
    this.body = new Mesh(new BoxGeometry(1.6, 0.7, 3.2), this.bodyMaterial);
    this.body.position.y = 0.55;
    this.body.castShadow = true;

    const cabin = new Mesh(new BoxGeometry(1.3, 0.55, 1.2), new MeshLambertMaterial({ color: '#3de0ff' }));
    cabin.position.set(0, 1.15, -0.2);
    cabin.castShadow = true;

    const hood = new Mesh(new BoxGeometry(1.5, 0.25, 0.9), new MeshLambertMaterial({ color: '#ff7eb8' }));
    hood.position.set(0, 0.85, -1.1);
    hood.castShadow = true;

    const wheelGeo = new CylinderGeometry(0.35, 0.35, 0.28, 10);
    const wheelMat = new MeshLambertMaterial({ color: '#1a1220' });
    const wheels: Mesh[] = [];
    for (const [x, z] of [
      [-0.85, -1.0],
      [0.85, -1.0],
      [-0.85, 1.0],
      [0.85, 1.0],
    ] as const) {
      const wheel = new Mesh(wheelGeo, wheelMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, 0.35, z);
      wheel.castShadow = true;
      wheels.push(wheel);
    }

    const arrow = new Mesh(
      new ConeGeometry(0.28, 0.7, 4),
      new MeshBasicMaterial({ color: '#ffd36b' }),
    );
    arrow.rotation.x = -Math.PI / 2;
    arrow.position.set(0, 0.9, -1.85);

    const blob = new Mesh(
      new CircleGeometry(1.5, 16),
      new MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.35, depthWrite: false }),
    );
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.05;

    this.body.add(cabin, hood, arrow, ...wheels);
    this.root.add(this.body, blob);
  }

  get position(): Vector3 {
    return this.root.position;
  }

  get yaw(): number {
    return this.root.rotation.y;
  }

  jump(): void {
    if (this.body.position.y > 0.6) return;
    this.verticalVelocity = JUMP_VELOCITY;
    this.flashTime = 0.25;
  }

  /**
   * @param steer -1..1 (direita positiva)
   * @param throttle -1..1 (freio/ré negativo, aceleração positiva)
   */
  update(dt: number, steer: number, throttle: number, _cameraYaw: number, obstacles: Obstacle[]): void {
    if (throttle > 0.05) {
      this.speed += throttle * ACCEL * dt;
    } else if (throttle < -0.05) {
      // Freio: desacelera; se quase parado, vai de ré.
      if (this.speed > 0.4) this.speed -= BRAKE_DECEL * Math.abs(throttle) * dt;
      else this.speed += throttle * ACCEL * 0.55 * dt;
    } else {
      const coast = Math.sign(this.speed) * Math.min(Math.abs(this.speed), COAST_DECEL * dt);
      this.speed -= coast;
    }

    this.speed = Math.max(-MAX_REVERSE, Math.min(MAX_SPEED, this.speed));

    const speedFactor = Math.min(1, Math.abs(this.speed) / 4);
    const turn = steer * STEER_RATE * speedFactor * Math.sign(this.speed || 1) * dt;
    // rotation.y positivo gira para a esquerda (anti-horário visto de cima).
    this.root.rotation.y -= turn;

    const yaw = this.root.rotation.y;
    // Frente do modelo é -Z local.
    const pos = this.root.position;
    pos.x += -Math.sin(yaw) * this.speed * dt;
    pos.z += -Math.cos(yaw) * this.speed * dt;
    this.resolveCollisions(obstacles);

    const limit = WORLD_HALF_SIZE - RADIUS;
    pos.x = Math.max(-limit, Math.min(limit, pos.x));
    pos.z = Math.max(-limit, Math.min(limit, pos.z));

    this.verticalVelocity -= GRAVITY * dt;
    this.body.position.y = Math.max(0.55, this.body.position.y + this.verticalVelocity * dt);
    if (this.body.position.y <= 0.55) this.verticalVelocity = 0;

    // Inclinação leve nas curvas.
    const lean = -steer * Math.min(1, Math.abs(this.speed) / MAX_SPEED) * 0.12;
    this.body.rotation.z += (lean - this.body.rotation.z) * Math.min(1, 8 * dt);

    this.flashTime = Math.max(0, this.flashTime - dt);
    this.bodyMaterial.color.set(this.flashTime > 0 ? '#ffffff' : this.baseColor);
  }

  private resolveCollisions(obstacles: Obstacle[]): void {
    const pos = this.root.position;
    for (const o of obstacles) {
      const cx = Math.max(o.minX, Math.min(pos.x, o.maxX));
      const cz = Math.max(o.minZ, Math.min(pos.z, o.maxZ));
      const dx = pos.x - cx;
      const dz = pos.z - cz;
      const distSq = dx * dx + dz * dz;
      if (distSq >= RADIUS * RADIUS) continue;

      if (distSq > 1e-6) {
        const dist = Math.sqrt(distSq);
        pos.x = cx + (dx / dist) * RADIUS;
        pos.z = cz + (dz / dist) * RADIUS;
      } else {
        const pushes = [o.maxX - pos.x, pos.x - o.minX, o.maxZ - pos.z, pos.z - o.minZ];
        const min = Math.min(...pushes);
        if (min === pushes[0]) pos.x = o.maxX + RADIUS;
        else if (min === pushes[1]) pos.x = o.minX - RADIUS;
        else if (min === pushes[2]) pos.z = o.maxZ + RADIUS;
        else pos.z = o.minZ - RADIUS;
      }
      this.speed *= 0.35;
    }
  }
}
