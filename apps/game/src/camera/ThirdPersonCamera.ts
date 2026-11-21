import { Vector3, type PerspectiveCamera } from 'three';
import type { CollisionWorld } from '../world/collision';

export type CameraMode = 'foot' | 'vehicle';

const LOOK_RATE = 2.4;
const VEHICLE_VIEWS = [
  { name: 'Câmera perto', back: 6.5, pivot: 1.4 },
  { name: 'Câmera normal', back: 9.5, pivot: 1.5 },
  { name: 'Câmera longe', back: 13, pivot: 2.2 },
];

/**
 * Câmera em terceira pessoa (a pé / veículo). Aceita giro manual (celular, mouse, teclado)
 * e se aproxima do alvo quando um prédio fica entre ela e o jogador.
 */
export class ThirdPersonCamera {
  yaw = 0;
  pitch = 0.32;
  mode: CameraMode = 'foot';
  private vehicleView = 1;
  private lookOffset = 0;
  private manualTimer = 0;
  private dist = 5;
  private readonly desired = new Vector3();
  private readonly lookAt = new Vector3();

  /** Dentro de um interior: câmera mais perto e abaixo do teto. */
  indoorCeiling: number | null = null;

  constructor(
    private readonly camera: PerspectiveCamera,
    public collision: CollisionWorld | null = null,
  ) {}

  /** Altura do pivô a pé (agachado fica mais baixo); suavizada no update. */
  footPivot = 1.9;
  private pivotNow = 1.9;

  /** Volta a câmera para trás do personagem/carro. */
  recenter(targetYaw: number): void {
    this.yaw = targetYaw;
    this.lookOffset = 0;
    this.manualTimer = 0;
    this.pitch = 0.32;
  }

  /** Alterna a distância da câmera no carro; devolve o nome da vista. */
  cycleVehicleView(): string {
    this.vehicleView = (this.vehicleView + 1) % VEHICLE_VIEWS.length;
    return VEHICLE_VIEWS[this.vehicleView]!.name;
  }

  snap(target: Vector3, yaw = 0): void {
    this.yaw = yaw;
    this.lookOffset = 0;
    this.place(target, 1);
    this.camera.position.copy(this.desired);
    this.lookAt.copy(target);
    this.camera.lookAt(target.x, target.y + 1.4, target.z);
  }

  /**
   * lookX/lookY: −1..1 por segundo (stick/arrasto de câmera).
   * targetYaw: direção do personagem ou do carro.
   */
  update(dt: number, target: Vector3, speed: number, targetYaw: number, lookX = 0, lookY = 0): void {
    const manual = Math.abs(lookX) > 0.03 || Math.abs(lookY) > 0.03;
    if (manual) this.manualTimer = 2.5;
    else this.manualTimer = Math.max(0, this.manualTimer - dt);

    if (this.mode === 'vehicle') {
      // segue o carro; o giro manual é um desvio temporário que volta ao centro
      let delta = targetYaw - this.yaw;
      delta = Math.atan2(Math.sin(delta), Math.cos(delta));
      this.yaw += delta * (1 - Math.exp(-3.2 * dt));
      if (manual) this.lookOffset += lookX * LOOK_RATE * dt;
      else if (this.manualTimer === 0) this.lookOffset *= Math.exp(-2.5 * dt);
      this.lookOffset = Math.atan2(Math.sin(this.lookOffset), Math.cos(this.lookOffset));
    } else {
      this.lookOffset = 0;
      if (manual) this.yaw -= lookX * LOOK_RATE * dt;
      else if (speed > 0.6 && this.manualTimer === 0) {
        let delta = targetYaw - this.yaw;
        delta = Math.atan2(Math.sin(delta), Math.cos(delta));
        this.yaw += delta * (1 - Math.exp(-1.2 * dt));
      }
    }
    this.pitch = Math.max(0.05, Math.min(1.1, this.pitch + lookY * 1.4 * dt));
    this.pivotNow += (this.footPivot - this.pivotNow) * (1 - Math.exp(-6 * dt));

    const zoom = this.mode === 'vehicle' ? 1 + Math.min(Math.abs(speed) / 16, 1) * 0.25 : 1 + Math.min(speed / 6, 1) * 0.12;
    this.place(target, zoom);
    this.camera.position.lerp(this.desired, 1 - Math.exp(-8 * dt));
    this.lookAt.lerp(target, 1 - Math.exp(-12 * dt));
    const lookY0 = this.mode === 'foot' ? this.pivotNow - 0.4 : 1.3;
    this.camera.lookAt(this.lookAt.x, this.lookAt.y + lookY0, this.lookAt.z);
  }

  private place(target: Vector3, zoom: number): void {
    const yaw = this.yaw + (this.mode === 'vehicle' ? -this.lookOffset : 0);
    const pitch = this.mode === 'vehicle' ? Math.max(this.pitch, 0.22) : this.pitch;
    const view = VEHICLE_VIEWS[this.vehicleView]!;
    let back = (this.mode === 'foot' ? 6 : view.back) * zoom;
    if (this.indoorCeiling !== null) back = Math.min(back, 3.6);
    const pivotY = target.y + (this.mode === 'foot' ? this.pivotNow : view.pivot);
    const hx = Math.sin(yaw) * Math.cos(pitch);
    const hz = Math.cos(yaw) * Math.cos(pitch);
    if (this.collision) {
      const t = this.collision.raycast(target.x, target.z, target.x + hx * (back + 0.6), target.z + hz * (back + 0.6));
      if (t < 1) back = Math.max(1.2, (back + 0.6) * t - 0.6);
    }
    // suaviza a aproximação/afastamento para não "pular" quando a parede some
    this.dist += (back - this.dist) * (back < this.dist ? 0.5 : 0.08);
    let y = pivotY + Math.sin(pitch) * this.dist;
    if (this.indoorCeiling !== null) y = Math.min(y, this.indoorCeiling - 0.35);
    this.desired.set(target.x + hx * this.dist, y, target.z + hz * this.dist);
  }
}
