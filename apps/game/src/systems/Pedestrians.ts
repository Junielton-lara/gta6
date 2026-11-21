import { Group, type Vector3 } from 'three';
import type { HumanFactory, HumanRig } from '../actors/HumanModel';
import type { Vec2 } from '../world/mapData';

interface Ped {
  rig: HumanRig;
  line: Vec2[];
  i: number;
  dir: 1 | -1;
  speed: number;
  pause: number;
}

/** Pedestres ao longo das calçadas/calçadões, criados perto do jogador e removidos ao se afastar. */
export class PedestrianSystem {
  readonly root = new Group();
  private readonly peds: Ped[] = [];
  private seed = 7;
  private spawned = 0;

  constructor(
    private readonly lines: Vec2[][],
    private readonly factory: HumanFactory,
    private max: number,
  ) {}

  get count(): number {
    return this.peds.length;
  }

  setMax(max: number): void {
    this.max = max;
    while (this.peds.length > max) this.remove(this.peds.length - 1);
  }

  update(dt: number, player: Vector3, radius: number): void {
    if (this.peds.length < this.max) this.spawn(player, radius);
    for (let k = this.peds.length - 1; k >= 0; k--) {
      const p = this.peds[k]!;
      const pos = p.rig.root.position;
      if (Math.hypot(pos.x - player.x, pos.z - player.z) > radius * 1.3) {
        this.remove(k);
        continue;
      }
      if (p.pause > 0) {
        p.pause -= dt;
        p.rig.animate(dt, 0, false);
        continue;
      }
      const target = p.line[p.i]!;
      const dx = target.x - pos.x, dz = target.z - pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.4) {
        const next = p.i + p.dir;
        if (next < 0 || next >= p.line.length) {
          p.dir = p.dir === 1 ? -1 : 1;
          p.pause = 1 + this.rand() * 3;
        } else {
          p.i = next;
          if (this.rand() < 0.02) p.pause = 2 + this.rand() * 4;
        }
        continue;
      }
      const step = Math.min(d, p.speed * dt);
      pos.x += (dx / d) * step;
      pos.z += (dz / d) * step;
      const yaw = Math.atan2(-dx, -dz);
      let dy = yaw - p.rig.root.rotation.y;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      p.rig.root.rotation.y += dy * Math.min(1, dt * 8);
      p.rig.animate(dt, p.speed, false);
    }
  }

  private spawn(player: Vector3, radius: number): void {
    if (!this.lines.length) return;
    for (let attempt = 0; attempt < 8; attempt++) {
      const line = this.lines[Math.floor(this.rand() * this.lines.length)]!;
      const i = Math.floor(this.rand() * line.length);
      const pt = line[i]!;
      const d = Math.hypot(pt.x - player.x, pt.z - player.z);
      // nasce fora do campo imediato do jogador para não "brotar" na frente dele
      const minD = this.spawned < this.max ? 6 : 35;
      if (d < minD || d > radius) continue;
      const rig = this.factory.createNpc(this.spawned++);
      rig.root.position.set(pt.x, 0, pt.z);
      this.root.add(rig.root);
      this.peds.push({
        rig,
        line,
        i,
        dir: this.rand() < 0.5 ? 1 : -1,
        speed: 1.1 + this.rand() * 0.6,
        pause: 0,
      });
      return;
    }
  }

  private remove(k: number): void {
    this.root.remove(this.peds[k]!.rig.root);
    this.peds.splice(k, 1);
  }

  private rand(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }
}
