import type { Obstacle } from './types';

const CELL = 16;

/** Colisão 2D (planta) contra os polígonos reais dos prédios, com grade espacial. */
export class CollisionWorld {
  private readonly cells = new Map<number, Obstacle[]>();
  private readonly stamps: Int32Array;
  private stamp = 0;
  private readonly scratch: Obstacle[] = [];

  constructor(
    readonly obstacles: Obstacle[],
    readonly bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
  ) {
    this.stamps = new Int32Array(obstacles.length);
    obstacles.forEach((o, i) => {
      o.index = i;
      for (let ix = cell(o.minX); ix <= cell(o.maxX); ix++) {
        for (let iz = cell(o.minZ); iz <= cell(o.maxZ); iz++) {
          const k = key(ix, iz);
          let list = this.cells.get(k);
          if (!list) this.cells.set(k, (list = []));
          list.push(o);
        }
      }
    });
  }

  /** Obstáculos cujo AABB toca o retângulo (sem duplicatas). Reaproveita o mesmo array. */
  query(minX: number, minZ: number, maxX: number, maxZ: number): Obstacle[] {
    const out = this.scratch;
    out.length = 0;
    this.stamp++;
    for (let ix = cell(minX); ix <= cell(maxX); ix++) {
      for (let iz = cell(minZ); iz <= cell(maxZ); iz++) {
        const list = this.cells.get(key(ix, iz));
        if (!list) continue;
        for (const o of list) {
          if (this.stamps[o.index!] === this.stamp) continue;
          this.stamps[o.index!] = this.stamp;
          if (o.maxX < minX || o.minX > maxX || o.maxZ < minZ || o.minZ > maxZ) continue;
          out.push(o);
        }
      }
    }
    return out;
  }

  insideAny(x: number, z: number, margin = 0): boolean {
    for (const o of this.query(x - margin, z - margin, x + margin, z + margin)) {
      if (pointInPoly(o.poly, x, z)) return true;
      if (margin > 0 && nearestOnPoly(o.poly, x, z).d < margin) return true;
    }
    return false;
  }

  /** Empurra um círculo para fora dos prédios. Retorna true se houve contato. */
  resolveCircle(pos: { x: number; z: number }, radius: number): boolean {
    let hit = false;
    for (let pass = 0; pass < 2; pass++) {
      const list = this.query(pos.x - radius, pos.z - radius, pos.x + radius, pos.z + radius);
      let moved = false;
      for (const o of list) {
        const inside = pointInPoly(o.poly, pos.x, pos.z);
        const n = nearestOnPoly(o.poly, pos.x, pos.z);
        if (!inside && n.d >= radius) continue;
        let dx = inside ? n.x - pos.x : pos.x - n.x;
        let dz = inside ? n.z - pos.z : pos.z - n.z;
        const len = Math.hypot(dx, dz) || 1;
        dx /= len;
        dz /= len;
        pos.x = n.x + dx * radius;
        pos.z = n.z + dz * radius;
        hit = moved = true;
      }
      if (!moved) break;
    }
    const b = this.bounds;
    if (pos.x < b.minX + radius) (pos.x = b.minX + radius), (hit = true);
    if (pos.x > b.maxX - radius) (pos.x = b.maxX - radius), (hit = true);
    if (pos.z < b.minZ + radius) (pos.z = b.minZ + radius), (hit = true);
    if (pos.z > b.maxZ - radius) (pos.z = b.maxZ - radius), (hit = true);
    return hit;
  }

  /** Fração 0..1 do segmento até o primeiro prédio (1 = livre). Usado pela câmera. */
  raycast(ax: number, az: number, bx: number, bz: number): number {
    let best = 1;
    const list = this.query(Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz));
    for (const o of list) {
      const p = o.poly;
      const n = p.length;
      for (let i = 0; i < n; i += 2) {
        const j = (i + 2) % n;
        const t = segT(ax, az, bx, bz, p[i]!, p[i + 1]!, p[j]!, p[j + 1]!);
        if (t < best) best = t;
      }
    }
    return best;
  }
}

export function pointInPoly(p: Float32Array | number[], x: number, z: number): boolean {
  let inside = false;
  const n = p.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const xi = p[i]!, zi = p[i + 1]!, xj = p[j]!, zj = p[j + 1]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function nearestOnPoly(p: Float32Array | number[], x: number, z: number): { x: number; z: number; d: number } {
  let bx = x, bz = z, bd = Infinity;
  const n = p.length;
  for (let i = 0; i < n; i += 2) {
    const j = (i + 2) % n;
    const ax = p[i]!, az = p[i + 1]!, cx = p[j]!, cz = p[j + 1]!;
    const ex = cx - ax, ez = cz - az;
    const len2 = ex * ex + ez * ez || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / len2));
    const qx = ax + ex * t, qz = az + ez * t;
    const d = Math.hypot(x - qx, z - qz);
    if (d < bd) (bd = d), (bx = qx), (bz = qz);
  }
  return { x: bx, z: bz, d: bd };
}

function segT(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): number {
  const rx = bx - ax, rz = bz - az, sx = dx - cx, sz = dz - cz;
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-9) return 1;
  const t = ((cx - ax) * sz - (cz - az) * sx) / den;
  const u = ((cx - ax) * rz - (cz - az) * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : 1;
}

function cell(v: number): number {
  return Math.floor(v / CELL);
}

function key(ix: number, iz: number): number {
  return (ix + 2048) * 4096 + (iz + 2048);
}
