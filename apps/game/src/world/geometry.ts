import { BufferAttribute, BufferGeometry, Color, ShapeUtils, Vector2 } from 'three';
import type { Vec2 } from './mapData';

const WHITE = new Color(1, 1, 1);

/**
 * Acumula triângulos de várias peças e gera um único BufferGeometry por material:
 * um bloco do mapa vira poucos draw calls. UVs em metros (a escala fica na textura).
 */
export class MeshBuilder {
  private pos: number[] = [];
  private nor: number[] = [];
  private uv: number[] = [];
  private col: number[] = [];
  private idx: number[] = [];

  get empty(): boolean {
    return this.idx.length === 0;
  }

  private vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number, c: Color): number {
    this.pos.push(x, y, z);
    this.nor.push(nx, ny, nz);
    this.uv.push(u, v);
    this.col.push(c.r, c.g, c.b);
    return this.pos.length / 3 - 1;
  }

  /** Faixa horizontal ao longo de uma polilinha (vias, calçadões). UV no plano XZ do mundo. */
  ribbon(pts: Vec2[], width: number, y: number, color = WHITE, offset = 0): void {
    if (pts.length < 2) return;
    const half = width / 2;
    const left: Vec2[] = [];
    const right: Vec2[] = [];
    for (let i = 0; i < pts.length; i++) {
      const n = miterNormal(pts, i);
      const o = offset;
      left.push({ x: pts[i]!.x + n.x * (o + half * n.s), z: pts[i]!.z + n.z * (o + half * n.s) });
      right.push({ x: pts[i]!.x + n.x * (o - half * n.s), z: pts[i]!.z + n.z * (o - half * n.s) });
    }
    for (let i = 0; i < pts.length - 1; i++) {
      const a = this.vertex(left[i]!.x, y, left[i]!.z, 0, 1, 0, left[i]!.x, -left[i]!.z, color);
      const b = this.vertex(right[i]!.x, y, right[i]!.z, 0, 1, 0, right[i]!.x, -right[i]!.z, color);
      const c = this.vertex(right[i + 1]!.x, y, right[i + 1]!.z, 0, 1, 0, right[i + 1]!.x, -right[i + 1]!.z, color);
      const d = this.vertex(left[i + 1]!.x, y, left[i + 1]!.z, 0, 1, 0, left[i + 1]!.x, -left[i + 1]!.z, color);
      this.faceUp(a, b, c);
      this.faceUp(a, c, d);
    }
  }

  /** Polígono horizontal (praças, telhados). */
  polygon(ring: Vec2[], y: number, color = WHITE, holes: Vec2[][] = [], down = false): void {
    if (ring.length < 3) return;
    const contour = ring.map((p) => new Vector2(p.x, p.z));
    const holeVecs = holes.filter((h) => h.length >= 3).map((h) => h.map((p) => new Vector2(p.x, p.z)));
    let faces: number[][];
    try {
      faces = ShapeUtils.triangulateShape(contour, holeVecs);
    } catch {
      return;
    }
    const all = contour.concat(...holeVecs);
    const base = this.pos.length / 3;
    for (const p of all) this.vertex(p.x, y, p.y, 0, down ? -1 : 1, 0, p.x, -p.y, color);
    for (const f of faces) {
      const before = this.idx.length;
      this.faceUp(base + f[0]!, base + f[1]!, base + f[2]!);
      if (down) {
        const b = this.idx[before + 1]!;
        this.idx[before + 1] = this.idx[before + 2]!;
        this.idx[before + 2] = b;
      }
    }
  }

  /** Anel deslocado para fora (cornijas, platibandas). */
  static offsetRing(ring: Vec2[], d: number): Vec2[] {
    const sign = signedArea(ring) > 0 ? -1 : 1;
    const closed = ring.concat([ring[0]!]);
    const out: Vec2[] = [];
    for (let i = 0; i < ring.length; i++) {
      const prev = ring[(i - 1 + ring.length) % ring.length]!;
      const cur = ring[i]!;
      const next = closed[i + 1]!;
      const n1 = segNormal(prev, cur);
      const n2 = segNormal(cur, next);
      let x = n1.x + n2.x, z = n1.z + n2.z;
      const l = Math.hypot(x, z) || 1;
      x /= l;
      z /= l;
      const s = Math.min(2, 1 / Math.max(x * n1.x + z * n1.z, 0.5));
      // segNormal aponta para a esquerda; anel com área ≤ 0 tem o exterior em (−dz, dx) = esquerda
      out.push({ x: cur.x + x * d * s * sign, z: cur.z + z * d * s * sign });
    }
    return out;
  }

  /** Paredes verticais de um anel; normais para fora independente da orientação. */
  walls(ring: Vec2[], y0: number, y1: number, color = WHITE, closed = true): void {
    if (ring.length < 2 || y1 - y0 < 0.05) return;
    const sign = signedArea(ring) > 0 ? -1 : 1;
    let u = 0;
    const n = closed ? ring.length : ring.length - 1;
    for (let i = 0; i < n; i++) {
      const a = ring[i]!;
      const b = ring[(i + 1) % ring.length]!;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      if (len < 0.05) continue;
      const nx = (-dz / len) * sign;
      const nz = (dx / len) * sign;
      const v0 = this.vertex(a.x, y0, a.z, nx, 0, nz, u, y0, color);
      const v1 = this.vertex(b.x, y0, b.z, nx, 0, nz, u + len, y0, color);
      const v2 = this.vertex(b.x, y1, b.z, nx, 0, nz, u + len, y1, color);
      const v3 = this.vertex(a.x, y1, a.z, nx, 0, nz, u, y1, color);
      if (sign === 1) {
        this.idx.push(v0, v1, v2, v0, v2, v3);
      } else {
        this.idx.push(v0, v2, v1, v0, v3, v2);
      }
      u += len;
    }
  }

  /** Caixa orientada (torres, postes, abrigos). */
  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, yaw = 0, color = WHITE): void {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const hx = sx / 2, hz = sz / 2;
    const corners: Vec2[] = [
      { x: -hx, z: -hz }, { x: hx, z: -hz }, { x: hx, z: hz }, { x: -hx, z: hz },
    ].map((p) => ({ x: cx + p.x * c + p.z * s, z: cz - p.x * s + p.z * c }));
    this.walls(corners, cy - sy / 2, cy + sy / 2, color);
    this.polygon(corners, cy + sy / 2, color);
  }

  /** Pirâmide de base quadrada (coruchéus). */
  pyramid(cx: number, y0: number, cz: number, size: number, height: number, yaw = 0, color = WHITE): void {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const h = size / 2;
    const base = [
      { x: -h, z: -h }, { x: h, z: -h }, { x: h, z: h }, { x: -h, z: h },
    ].map((p) => ({ x: cx + p.x * c + p.z * s, z: cz - p.x * s + p.z * c }));
    for (let i = 0; i < 4; i++) {
      const a = base[i]!, b = base[(i + 1) % 4]!;
      const v0 = this.vertex(a.x, y0, a.z, 0, 1, 0, 0, 0, color);
      const v1 = this.vertex(b.x, y0, b.z, 0, 1, 0, size, 0, color);
      const v2 = this.vertex(cx, y0 + height, cz, 0, 1, 0, size / 2, height, color);
      this.idx.push(v0, v1, v2);
    }
    this.orientLast(4, cx, y0 + height / 4, cz);
  }

  /** Meio-fio: topo + face voltada para a via, deslocado `offset` da linha central. */
  curb(pts: Vec2[], offset: number, height: number, width: number, color = WHITE): void {
    if (pts.length < 2) return;
    const side = Math.sign(offset) || 1;
    const inner: Vec2[] = [];
    const outer: Vec2[] = [];
    for (let i = 0; i < pts.length; i++) {
      const n = miterNormal(pts, i);
      const d0 = offset * n.s;
      const d1 = (offset + side * width) * n.s;
      inner.push({ x: pts[i]!.x + n.x * d0, z: pts[i]!.z + n.z * d0 });
      outer.push({ x: pts[i]!.x + n.x * d1, z: pts[i]!.z + n.z * d1 });
    }
    for (let i = 0; i < pts.length - 1; i++) {
      const a = this.vertex(inner[i]!.x, height, inner[i]!.z, 0, 1, 0, inner[i]!.x, -inner[i]!.z, color);
      const b = this.vertex(outer[i]!.x, height, outer[i]!.z, 0, 1, 0, outer[i]!.x, -outer[i]!.z, color);
      const c = this.vertex(outer[i + 1]!.x, height, outer[i + 1]!.z, 0, 1, 0, outer[i + 1]!.x, -outer[i + 1]!.z, color);
      const d = this.vertex(inner[i + 1]!.x, height, inner[i + 1]!.z, 0, 1, 0, inner[i + 1]!.x, -inner[i + 1]!.z, color);
      this.faceUp(a, b, c);
      this.faceUp(a, c, d);
      // face vertical voltada para o centro da via
      const p = inner[i]!, q = inner[i + 1]!;
      const dx = q.x - p.x, dz = q.z - p.z;
      const len = Math.hypot(dx, dz) || 1;
      const mid = pts[i]!;
      let nx = -dz / len, nz = dx / len;
      if ((mid.x - p.x) * nx + (mid.z - p.z) * nz < 0) (nx = -nx), (nz = -nz);
      const v0 = this.vertex(p.x, 0, p.z, nx, 0, nz, 0, 0, color);
      const v1 = this.vertex(q.x, 0, q.z, nx, 0, nz, len, 0, color);
      const v2 = this.vertex(q.x, height, q.z, nx, 0, nz, len, height, color);
      const v3 = this.vertex(p.x, height, p.z, nx, 0, nz, 0, height, color);
      this.orientQuad(v0, v1, v2, v3, nx, nz);
    }
  }

  /** Faixa tracejada (sinalização horizontal). */
  dashes(pts: Vec2[], offset: number, width: number, dash: number, gap: number, y: number, color = WHITE): void {
    let carry = 0;
    let drawing = true;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]!, b = pts[i + 1]!;
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len < 0.01) continue;
      let t = 0;
      while (t < len) {
        const step = Math.min((drawing ? dash : gap) - carry, len - t);
        if (drawing && step > 0.2) {
          const p0 = lerp(a, b, t / len);
          const p1 = lerp(a, b, (t + step) / len);
          this.ribbon([p0, p1], width, y, color, offset);
        }
        t += step;
        carry += step;
        if (carry >= (drawing ? dash : gap) - 1e-6) {
          carry = 0;
          drawing = !drawing;
        }
      }
    }
  }

  build(): BufferGeometry | null {
    if (this.empty) return null;
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(this.nor), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(this.uv), 2));
    g.setAttribute('color', new BufferAttribute(new Float32Array(this.col), 3));
    const count = this.pos.length / 3;
    g.setIndex(new BufferAttribute(count > 65535 ? new Uint32Array(this.idx) : new Uint16Array(this.idx), 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }

  private faceUp(a: number, b: number, c: number): void {
    const p = this.pos;
    const ax = p[a * 3]!, az = p[a * 3 + 2]!;
    const bx = p[b * 3]!, bz = p[b * 3 + 2]!;
    const cx = p[c * 3]!, cz = p[c * 3 + 2]!;
    // y do produto vetorial (b−a)×(c−a); positivo = face para cima
    const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    if (ny >= 0) this.idx.push(a, b, c);
    else this.idx.push(a, c, b);
  }

  private orientQuad(v0: number, v1: number, v2: number, v3: number, nx: number, nz: number): void {
    const p = this.pos;
    const ex = p[v1 * 3]! - p[v0 * 3]!, ez = p[v1 * 3 + 2]! - p[v0 * 3 + 2]!;
    // normal de (v0,v1,v2) ∝ (−ez, 0, ex)
    if (-ez * nx + ex * nz >= 0) this.idx.push(v0, v1, v2, v0, v2, v3);
    else this.idx.push(v0, v2, v1, v0, v3, v2);
  }

  /** Garante que os últimos `n` triângulos apontem para fora de um centro. */
  private orientLast(n: number, cx: number, cy: number, cz: number): void {
    const p = this.pos;
    for (let k = this.idx.length - n * 3; k < this.idx.length; k += 3) {
      const a = this.idx[k]!, b = this.idx[k + 1]!, c = this.idx[k + 2]!;
      const ux = p[b * 3]! - p[a * 3]!, uy = p[b * 3 + 1]! - p[a * 3 + 1]!, uz = p[b * 3 + 2]! - p[a * 3 + 2]!;
      const vx = p[c * 3]! - p[a * 3]!, vy = p[c * 3 + 1]! - p[a * 3 + 1]!, vz = p[c * 3 + 2]! - p[a * 3 + 2]!;
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const ox = p[a * 3]! - cx, oy = p[a * 3 + 1]! - cy, oz = p[a * 3 + 2]! - cz;
      const flip = nx * ox + ny * oy + nz * oz < 0;
      if (flip) {
        this.idx[k + 1] = c;
        this.idx[k + 2] = b;
      }
      const l = Math.hypot(nx, ny, nz) || 1;
      const s = flip ? -1 : 1;
      for (const v of [a, b, c]) {
        this.nor[v * 3] = (nx / l) * s;
        this.nor[v * 3 + 1] = (ny / l) * s;
        this.nor[v * 3 + 2] = (nz / l) * s;
      }
    }
  }
}

/** Normal à esquerda da direção do traçado no ponto i, com fator de mitra limitado. */
function miterNormal(pts: Vec2[], i: number): { x: number; z: number; s: number } {
  const prev = pts[Math.max(0, i - 1)]!;
  const next = pts[Math.min(pts.length - 1, i + 1)]!;
  const cur = pts[i]!;
  const n1 = segNormal(i > 0 ? prev : cur, i > 0 ? cur : next);
  const n2 = segNormal(i < pts.length - 1 ? cur : prev, i < pts.length - 1 ? next : cur);
  let x = n1.x + n2.x;
  let z = n1.z + n2.z;
  const l = Math.hypot(x, z);
  if (l < 1e-6) return { x: n1.x, z: n1.z, s: 1 };
  x /= l;
  z /= l;
  const cos = x * n1.x + z * n1.z;
  return { x, z, s: Math.min(2, 1 / Math.max(cos, 0.5)) };
}

function segNormal(a: Vec2, b: Vec2): { x: number; z: number } {
  const dx = b.x - a.x, dz = b.z - a.z;
  const l = Math.hypot(dx, dz) || 1;
  return { x: -dz / l, z: dx / l };
}

function lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
}

export function signedArea(ring: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]!, q = ring[(i + 1) % ring.length]!;
    a += p.x * q.z - q.x * p.z;
  }
  return a / 2;
}
