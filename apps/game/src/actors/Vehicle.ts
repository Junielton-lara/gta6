import {
  BoxGeometry,
  CircleGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  Vector3,
} from 'three';
import type { CollisionWorld } from '../world/collision';

const MAX_SPEED = 16;
const MAX_REVERSE = 5;
const ACCEL = 9;
const BRAKE_DECEL = 22;
const COAST_DECEL = 3.5;
const HANDBRAKE_DECEL = 13;
const STEER_RATE = 1.9;
const RADIUS = 0.95;
const AXLE = 1.25;

const geo = {
  body: new BoxGeometry(1.78, 0.62, 4.2),
  cabin: new BoxGeometry(1.56, 0.56, 2.1),
  glassSide: new BoxGeometry(1.6, 0.42, 1.9),
  glassFront: new BoxGeometry(1.5, 0.46, 0.06),
  bumper: new BoxGeometry(1.84, 0.22, 0.18),
  tire: new CylinderGeometry(0.33, 0.33, 0.24, 14),
  rim: new CylinderGeometry(0.2, 0.2, 0.26, 10),
  light: new BoxGeometry(0.36, 0.13, 0.06),
  plate: new BoxGeometry(0.42, 0.13, 0.03),
  mirror: new BoxGeometry(0.14, 0.1, 0.16),
};
const mats = {
  glass: new MeshStandardMaterial({ color: '#1d2a33', roughness: 0.15, metalness: 0.6 }),
  tire: new MeshLambertMaterial({ color: '#141414' }),
  rim: new MeshLambertMaterial({ color: '#b8bcc0' }),
  bumper: new MeshLambertMaterial({ color: '#2a2a2c' }),
  plate: new MeshLambertMaterial({ color: '#e8e8e0' }),
};
const shadowGeo = new CircleGeometry(1, 16);

export class Vehicle {
  readonly root = new Group();
  speed = 0;
  occupied = false;
  private readonly wheels: Mesh[] = [];
  private readonly frontWheels: Group[] = [];
  private readonly headMat = new MeshBasicMaterial({ color: '#d8d2b8' });
  private readonly tailMat = new MeshBasicMaterial({ color: '#6a0c0c' });
  private night = false;
  private steerVisual = 0;
  private readonly tmp = { x: 0, z: 0 };

  constructor(color = '#c0392b', x = 0, z = 0) {
    const paint = new MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.45 });
    const body = new Group();
    body.position.y = 0.3;

    const chassis = new Mesh(geo.body, paint);
    chassis.position.y = 0.38;
    const cabin = new Mesh(geo.cabin, paint);
    cabin.position.set(0, 0.96, 0.15);
    const glass = new Mesh(geo.glassSide, mats.glass);
    glass.position.set(0, 0.98, 0.15);
    const windshield = new Mesh(geo.glassFront, mats.glass);
    windshield.position.set(0, 0.95, -0.92);
    windshield.rotation.x = -0.5;
    const rear = new Mesh(geo.glassFront, mats.glass);
    rear.position.set(0, 0.95, 1.22);
    rear.rotation.x = 0.55;
    const fb = new Mesh(geo.bumper, mats.bumper);
    fb.position.set(0, 0.16, -2.12);
    const rb = new Mesh(geo.bumper, mats.bumper);
    rb.position.set(0, 0.16, 2.12);
    const plate = new Mesh(geo.plate, mats.plate);
    plate.position.set(0, 0.3, 2.13);
    body.add(chassis, cabin, glass, windshield, rear, fb, rb, plate);
    for (const sx of [-0.92, 0.92]) {
      const m = new Mesh(geo.mirror, paint);
      m.position.set(sx, 0.82, -0.6);
      body.add(m);
    }

    for (const sx of [-0.6, 0.6]) {
      const hl = new Mesh(geo.light, this.headMat);
      hl.position.set(sx, 0.48, -2.1);
      const tl = new Mesh(geo.light, this.tailMat);
      tl.position.set(sx, 0.5, 2.1);
      body.add(hl, tl);
    }

    for (const [wx, wz] of [
      [-0.86, -AXLE],
      [0.86, -AXLE],
      [-0.86, AXLE],
      [0.86, AXLE],
    ] as const) {
      const holder = new Group();
      holder.position.set(wx, 0.33, wz);
      const spin = new Group();
      const tire = new Mesh(geo.tire, mats.tire);
      tire.rotation.z = Math.PI / 2;
      const rim = new Mesh(geo.rim, mats.rim);
      rim.rotation.z = Math.PI / 2;
      spin.add(tire, rim);
      holder.add(spin);
      this.wheels.push(tire, rim);
      if (wz < 0) this.frontWheels.push(holder);
      this.root.add(holder);
      (holder.userData as { spin: Group }).spin = spin;
    }

    const blob = new Mesh(shadowGeo, new MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.35, depthWrite: false }));
    blob.scale.set(1.1, 2.3, 1);
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.05;

    this.root.add(body, blob);
    this.root.traverse((o) => {
      if ((o as Mesh).isMesh && o !== blob) o.castShadow = true;
    });
    this.root.position.set(x, 0, z);
  }

  get position(): Vector3 {
    return this.root.position;
  }

  get yaw(): number {
    return this.root.rotation.y;
  }

  setNightLights(on: boolean): void {
    if (on === this.night) return;
    this.night = on;
    this.headMat.color.set(on ? '#fff6d0' : '#d8d2b8');
    this.tailMat.color.set(on ? '#ff2a2a' : '#6a0c0c');
  }

  /**
   * Jogador: física arcade. steer −1..1, throttle −1..1. Freio de mão trava as rodas
   * traseiras: desacelera forte e deixa a traseira escorregar nas curvas.
   * Retorna a velocidade perdida numa batida (0 sem batida).
   */
  update(dt: number, steer: number, throttle: number, collision: CollisionWorld, handbrake = false): number {
    if (handbrake) {
      const decel = Math.sign(this.speed) * Math.min(Math.abs(this.speed), HANDBRAKE_DECEL * dt);
      this.speed -= decel;
    } else if (throttle > 0.05) {
      if (this.speed < -0.3) this.speed += BRAKE_DECEL * throttle * dt;
      else this.speed += throttle * ACCEL * (1 - this.speed / (MAX_SPEED * 1.1)) * dt;
    } else if (throttle < -0.05) {
      if (this.speed > 0.4) this.speed -= BRAKE_DECEL * Math.abs(throttle) * dt;
      else this.speed += throttle * ACCEL * 0.6 * dt;
    } else {
      const coast = Math.sign(this.speed) * Math.min(Math.abs(this.speed), COAST_DECEL * dt);
      this.speed -= coast;
    }
    this.speed = Math.max(-MAX_REVERSE, Math.min(MAX_SPEED, this.speed));

    // menos esterço em alta velocidade
    const speedFactor = Math.min(1, Math.abs(this.speed) / 3) * (1 - Math.min(0.45, Math.abs(this.speed) / 40));
    const slide = handbrake && Math.abs(this.speed) > 4 ? 1.7 : 1;
    this.root.rotation.y += steer * STEER_RATE * slide * speedFactor * Math.sign(this.speed || 1) * dt;

    const yaw = this.root.rotation.y;
    this.root.position.x += -Math.sin(yaw) * this.speed * dt;
    this.root.position.z += -Math.cos(yaw) * this.speed * dt;
    let impact = 0;
    if (this.resolve(collision)) {
      impact = Math.abs(this.speed) * 0.6;
      this.speed *= 0.4;
    }
    this.animateParts(dt, steer, handbrake || throttle < -0.1 || this.speed < -0.5);
    return impact;
  }

  /** IA: posição calculada pelo sistema de trânsito. */
  setPose(x: number, z: number, yaw: number, speed: number, dt: number, steer = 0): void {
    this.root.position.set(x, 0, z);
    this.root.rotation.y = yaw;
    this.speed = speed;
    this.animateParts(dt, steer, speed < 1);
  }

  private animateParts(dt: number, steer: number, braking: boolean): void {
    this.steerVisual += (steer * 0.45 - this.steerVisual) * Math.min(1, dt * 10);
    for (const f of this.frontWheels) f.rotation.y = -this.steerVisual;
    const spin = (this.speed * dt) / 0.33;
    this.root.children.forEach((c) => {
      const s = (c.userData as { spin?: Group }).spin;
      if (s) s.rotation.x -= spin;
    });
    this.tailMat.color.set(braking ? '#ff2020' : this.night ? '#c01818' : '#6a0c0c');
  }

  private resolve(collision: CollisionWorld): boolean {
    const yaw = this.root.rotation.y;
    const fx = -Math.sin(yaw) * AXLE, fz = -Math.cos(yaw) * AXLE;
    let hit = false;
    for (const s of [1, -1]) {
      this.tmp.x = this.root.position.x + fx * s;
      this.tmp.z = this.root.position.z + fz * s;
      if (collision.resolveCircle(this.tmp, RADIUS)) {
        this.root.position.x = this.tmp.x - fx * s;
        this.root.position.z = this.tmp.z - fz * s;
        hit = true;
      }
    }
    return hit;
  }
}
