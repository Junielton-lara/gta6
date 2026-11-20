import { Vector3, type PerspectiveCamera } from 'three';

/** Câmera em terceira pessoa atrás do veículo, com suavização de posição e look-at. */
export class FollowCamera {
  private readonly desired = new Vector3();
  private readonly lookAt = new Vector3();
  private readonly currentOffset = new Vector3(0, 8, 14);
  /** Yaw da câmera (espelha o veículo com atraso). */
  yaw = 0;

  constructor(private readonly camera: PerspectiveCamera) {}

  snap(target: Vector3, vehicleYaw = 0): void {
    this.yaw = vehicleYaw;
    this.place(target, 1, vehicleYaw);
    this.camera.lookAt(this.lookAt.copy(target).setY(1.2));
  }

  update(dt: number, target: Vector3, speed: number, vehicleYaw: number): void {
    // Segue a orientação do carro com atraso — evita enjoo em curvas rápidas.
    let delta = vehicleYaw - this.yaw;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta));
    this.yaw += delta * (1 - Math.exp(-3.5 * dt));

    const zoom = 1 + Math.min(Math.abs(speed) / 18, 1) * 0.22;
    this.place(target, zoom, this.yaw);
    this.camera.position.lerp(this.desired, 1 - Math.exp(-5.5 * dt));
    this.lookAt.lerp(target, 1 - Math.exp(-10 * dt));
    this.camera.lookAt(this.lookAt.x, 1.2, this.lookAt.z);
  }

  private place(target: Vector3, zoom: number, yaw: number): void {
    const back = 14 * zoom;
    const height = 7.5 + zoom * 1.5;
    this.desired.set(
      target.x + Math.sin(yaw) * back,
      target.y + height,
      target.z + Math.cos(yaw) * back,
    );
    this.currentOffset.set(this.desired.x - target.x, height, this.desired.z - target.z);
  }
}
