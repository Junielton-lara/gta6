import { Group, type Vector3 } from 'three';
import { Vehicle } from '../actors/Vehicle';
import type { RoadPath } from '../world/types';

const COLORS = ['#e8e8e8', '#202326', '#9aa3ab', '#6b0f1a', '#1d3557', '#c9b27c', '#2f4f3a', '#d0d0cc', '#3a3f45'];
const LINK_DIST = 2.5;

interface Lane {
  road: RoadPath;
  /** 1 = sentido do traçado, −1 = contrário */
  dir: 1 | -1;
  pts: { x: number; z: number }[];
  cum: number[];
  length: number;
}

interface AiCar {
  vehicle: Vehicle;
  lane: Lane;
  s: number;
  speed: number;
  cruise: number;
}

/** Trânsito simples sobre o grafo real de vias (OSM): mão de direção, mão única e conexões. */
export class TrafficSystem {
  readonly root = new Group();
  private readonly cars: AiCar[] = [];
  private readonly lanes: Lane[] = [];
  private max: number;
  private seed = 1;

  constructor(roads: RoadPath[], max: number) {
    this.max = max;
    for (const road of roads) {
      if (road.points.length < 2 || road.width < 4) continue;
      const dirs: (1 | -1)[] = road.oneway === 1 ? [1] : road.oneway === -1 ? [-1] : [1, -1];
      for (const dir of dirs) this.lanes.push(makeLane(road, dir));
    }
  }

  get count(): number {
    return this.cars.length;
  }

  setMax(max: number): void {
    this.max = max;
    while (this.cars.length > max) this.removeCar(this.cars.length - 1);
  }

  /** Alvos que os carros evitam atropelar (jogador, carro do jogador). */
  update(dt: number, player: Vector3, obstacles: { x: number; z: number }[], spawnRadius: number): void {
    while (this.cars.length < this.max && this.lanes.length) {
      if (!this.spawn(player, spawnRadius)) break;
    }
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const car = this.cars[i]!;
      if (car.vehicle.occupied) {
        // virou carro do jogador: sai do controle da IA
        this.cars.splice(i, 1);
        continue;
      }
      const p = car.vehicle.position;
      if (Math.hypot(p.x - player.x, p.z - player.z) > spawnRadius * 1.25) {
        this.removeCar(i);
        continue;
      }
      // freia se houver algo à frente na mesma direção
      const yaw = car.vehicle.yaw;
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
      let gap = Infinity;
      const check = (x: number, z: number) => {
        const dx = x - p.x, dz = z - p.z;
        const ahead = dx * fx + dz * fz;
        const side = Math.abs(dx * -fz + dz * fx);
        if (ahead > 0 && side < 2.2) gap = Math.min(gap, ahead);
      };
      for (const o of this.cars) if (o !== car) check(o.vehicle.position.x, o.vehicle.position.z);
      for (const o of obstacles) check(o.x, o.z);
      const target = gap < 6 ? 0 : gap < 14 ? car.cruise * ((gap - 6) / 8) : car.cruise;
      car.speed += Math.sign(target - car.speed) * Math.min(Math.abs(target - car.speed), (target < car.speed ? 9 : 3) * dt);

      car.s += car.speed * dt;
      if (car.s >= car.lane.length) {
        const next = this.nextLane(car.lane);
        if (next) {
          car.s -= car.lane.length;
          car.lane = next;
        } else {
          car.s = car.lane.length;
          car.speed = 0;
          const u = this.uTurn(car.lane);
          if (u) (car.lane = u), (car.s = 0);
        }
      }
      const pose = poseAt(car.lane, car.s);
      const ahead = poseAt(car.lane, Math.min(car.lane.length, car.s + 4));
      const steer = Math.atan2(Math.sin(ahead.yaw - pose.yaw), Math.cos(ahead.yaw - pose.yaw));
      car.vehicle.setPose(pose.x, pose.z, pose.yaw, car.speed, dt, steer * 2);
    }
  }

  nearestFree(x: number, z: number, maxDist: number): Vehicle | null {
    let best: Vehicle | null = null;
    let bestD = maxDist;
    for (const c of this.cars) {
      if (c.vehicle.occupied) continue;
      const d = Math.hypot(c.vehicle.position.x - x, c.vehicle.position.z - z);
      if (d < bestD) (bestD = d), (best = c.vehicle);
    }
    return best;
  }

  setNight(on: boolean): void {
    for (const c of this.cars) c.vehicle.setNightLights(on);
  }

  get positions(): { x: number; z: number }[] {
    return this.cars.map((c) => ({ x: c.vehicle.position.x, z: c.vehicle.position.z }));
  }

  private spawn(player: Vector3, radius: number): boolean {
    for (let attempt = 0; attempt < 12; attempt++) {
      const lane = this.lanes[Math.floor(this.rand() * this.lanes.length)]!;
      const s = this.rand() * lane.length;
      const pose = poseAt(lane, s);
      const d = Math.hypot(pose.x - player.x, pose.z - player.z);
      if (d < 25 || d > radius) continue;
      if (this.cars.some((c) => Math.hypot(c.vehicle.position.x - pose.x, c.vehicle.position.z - pose.z) < 12)) continue;
      const vehicle = new Vehicle(COLORS[Math.floor(this.rand() * COLORS.length)]);
      vehicle.setPose(pose.x, pose.z, pose.yaw, 0, 0);
      this.root.add(vehicle.root);
      const cruise = lane.road.width >= 8 ? 8 + this.rand() * 3 : 5 + this.rand() * 2;
      this.cars.push({ vehicle, lane, s, speed: cruise * 0.6, cruise });
      return true;
    }
    return false;
  }

  private removeCar(i: number): void {
    const c = this.cars[i]!;
    this.root.remove(c.vehicle.root);
    this.cars.splice(i, 1);
  }

  private nextLane(lane: Lane): Lane | null {
    const end = lane.pts[lane.pts.length - 1]!;
    const options = this.lanes.filter((l) => {
      if (l.road === lane.road) return false;
      const start = l.pts[0]!;
      return Math.hypot(start.x - end.x, start.z - end.z) < LINK_DIST + l.road.width / 2;
    });
    if (!options.length) return null;
    return options[Math.floor(this.rand() * options.length)]!;
  }

  private uTurn(lane: Lane): Lane | null {
    return this.lanes.find((l) => l.road === lane.road && l.dir !== lane.dir) ?? null;
  }

  private rand(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }
}

function makeLane(road: RoadPath, dir: 1 | -1): Lane {
  const src = dir === 1 ? road.points : [...road.points].reverse();
  // mão de direção (direita): desloca para a direita do sentido em vias de mão dupla
  const offset = road.oneway === 0 ? road.width / 4 : 0;
  const pts = src.map((p, i) => {
    const a = src[Math.max(0, i - 1)]!, b = src[Math.min(src.length - 1, i + 1)]!;
    const dx = b.x - a.x, dz = b.z - a.z;
    const l = Math.hypot(dx, dz) || 1;
    // direita de (dx, dz) com x = leste, z = sul: (−dz, dx)
    return { x: p.x + (-dz / l) * offset, z: p.z + (dx / l) * offset };
  });
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1]! + Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.z - pts[i - 1]!.z));
  return { road, dir, pts, cum, length: cum[cum.length - 1]! };
}

function poseAt(lane: Lane, s: number): { x: number; z: number; yaw: number } {
  const { pts, cum } = lane;
  let i = 0;
  while (i < pts.length - 2 && cum[i + 1]! < s) i++;
  const a = pts[i]!, b = pts[i + 1]!;
  const t = Math.max(0, Math.min(1, (s - cum[i]!) / Math.max(1e-6, cum[i + 1]! - cum[i]!)));
  return {
    x: a.x + (b.x - a.x) * t,
    z: a.z + (b.z - a.z) * t,
    yaw: Math.atan2(-(b.x - a.x), -(b.z - a.z)),
  };
}
