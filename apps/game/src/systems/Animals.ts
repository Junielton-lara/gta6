import {
  BoxGeometry,
  CapsuleGeometry,
  ConeGeometry,
  Group,
  Mesh,
  MeshLambertMaterial,
  SphereGeometry,
  type Vector3,
} from 'three';
import { pointInPoly } from '../world/collision';
import type { Vec2 } from '../world/mapData';

// ---------------- modelos procedurais ----------------

const dogGeo = {
  body: (() => {
    const g = new CapsuleGeometry(0.16, 0.42, 3, 8);
    g.rotateX(Math.PI / 2);
    return g;
  })(),
  head: new SphereGeometry(0.13, 10, 8),
  snout: new BoxGeometry(0.09, 0.08, 0.14),
  ear: new ConeGeometry(0.05, 0.1, 4),
  leg: (() => {
    const g = new CapsuleGeometry(0.035, 0.22, 2, 6);
    g.translate(0, -0.14, 0);
    return g;
  })(),
  tail: (() => {
    const g = new CapsuleGeometry(0.025, 0.22, 2, 5);
    g.translate(0, 0.13, 0);
    return g;
  })(),
};
const DOG_COLORS = ['#7a5230', '#2b2522', '#c9a36b', '#e8e0d0', '#5a4636'];

class Dog {
  readonly root = new Group();
  private readonly legs: Group[] = [];
  private readonly tail: Group;
  private phase = 0;

  constructor(color: string) {
    const m = new MeshLambertMaterial({ color });
    const dark = new MeshLambertMaterial({ color: '#1a1512' });
    const body = new Mesh(dogGeo.body, m);
    body.position.y = 0.42;
    const head = new Mesh(dogGeo.head, m);
    head.position.set(0, 0.6, -0.4);
    const snout = new Mesh(dogGeo.snout, m);
    snout.position.set(0, -0.03, -0.13);
    const nose = new Mesh(dogGeo.snout, dark);
    nose.scale.set(0.5, 0.5, 0.2);
    nose.position.set(0, 0, -0.08);
    snout.add(nose);
    head.add(snout);
    for (const s of [-1, 1]) {
      const ear = new Mesh(dogGeo.ear, m);
      ear.position.set(0.07 * s, 0.11, 0.02);
      head.add(ear);
    }
    this.root.add(body, head);
    for (const [x, z] of [[-0.09, -0.24], [0.09, -0.24], [-0.09, 0.24], [0.09, 0.24]] as const) {
      const g = new Group();
      g.position.set(x, 0.36, z);
      g.add(new Mesh(dogGeo.leg, m));
      this.legs.push(g);
      this.root.add(g);
    }
    this.tail = new Group();
    this.tail.position.set(0, 0.5, 0.36);
    this.tail.rotation.x = 0.7;
    this.tail.add(new Mesh(dogGeo.tail, m));
    this.root.add(this.tail);
  }

  animate(dt: number, speed: number): void {
    this.phase += dt * speed * 7;
    const s = Math.sin(this.phase) * Math.min(1, speed) * 0.6;
    this.legs[0]!.rotation.x = s;
    this.legs[3]!.rotation.x = s;
    this.legs[1]!.rotation.x = -s;
    this.legs[2]!.rotation.x = -s;
    this.tail.rotation.z = Math.sin(this.phase * 1.7 + performance.now() / 150) * 0.5;
  }
}

const pigeonGeo = {
  body: (() => {
    const g = new SphereGeometry(0.09, 8, 6);
    g.scale(0.8, 0.75, 1.3);
    return g;
  })(),
  head: new SphereGeometry(0.045, 6, 5),
  wing: new BoxGeometry(0.2, 0.015, 0.11),
};
const pigeonMat = new MeshLambertMaterial({ color: '#7d8590' });
const pigeonHead = new MeshLambertMaterial({ color: '#4d5a66' });

class Pigeon {
  readonly root = new Group();
  readonly wings: Mesh[] = [];
  private readonly head: Mesh;
  vy = 0;
  vx = 0;
  vz = 0;
  flying = false;
  peck = Math.random() * 6;

  constructor() {
    const body = new Mesh(pigeonGeo.body, pigeonMat);
    body.position.y = 0.11;
    this.head = new Mesh(pigeonGeo.head, pigeonHead);
    this.head.position.set(0, 0.19, -0.1);
    this.root.add(body, this.head);
    for (const s of [-1, 1]) {
      const w = new Mesh(pigeonGeo.wing, pigeonMat);
      w.position.set(0.1 * s, 0.14, 0);
      this.wings.push(w);
      this.root.add(w);
    }
  }

  animate(dt: number): void {
    if (this.flying) {
      const f = Math.sin(performance.now() / 45) * 0.9;
      this.wings[0]!.rotation.z = f;
      this.wings[1]!.rotation.z = -f;
      return;
    }
    this.wings[0]!.rotation.z = 0.1;
    this.wings[1]!.rotation.z = -0.1;
    this.peck += dt;
    this.head.position.y = 0.19 - Math.max(0, Math.sin(this.peck * 3)) * 0.07;
  }
}

// ---------------- sistema ----------------

interface DogAgent {
  dog: Dog;
  line: Vec2[];
  i: number;
  dir: 1 | -1;
  speed: number;
  pause: number;
}

interface Flock {
  root: Group;
  birds: Pigeon[];
  cx: number;
  cz: number;
  state: 'ground' | 'flying' | 'gone';
  timer: number;
}

/** Cães nas calçadas e bandos de pombos nas praças (áreas reais do OSM). */
export class AnimalSystem {
  readonly root = new Group();
  private readonly dogs: DogAgent[] = [];
  private readonly flocks: Flock[] = [];
  private seed = 31;

  constructor(
    private readonly lines: Vec2[][],
    private readonly plazas: Vec2[][],
    private max: number,
  ) {}

  setMax(max: number): void {
    this.max = max;
    while (this.dogs.length > Math.ceil(max / 4)) this.root.remove(this.dogs.pop()!.dog.root);
    while (this.flocks.length > Math.floor(max / 3)) this.root.remove(this.flocks.pop()!.root);
  }

  get count(): number {
    return this.dogs.length + this.flocks.reduce((n, f) => n + f.birds.length, 0);
  }

  update(dt: number, player: Vector3, radius: number): void {
    const maxDogs = Math.ceil(this.max / 4);
    const maxFlocks = Math.floor(this.max / 3);
    if (this.dogs.length < maxDogs) this.spawnDog(player, radius * 0.7);
    if (this.flocks.length < maxFlocks) this.spawnFlock(player, radius * 0.7);

    for (let k = this.dogs.length - 1; k >= 0; k--) {
      const a = this.dogs[k]!;
      const pos = a.dog.root.position;
      if (Math.hypot(pos.x - player.x, pos.z - player.z) > radius) {
        this.root.remove(a.dog.root);
        this.dogs.splice(k, 1);
        continue;
      }
      if (a.pause > 0) {
        a.pause -= dt;
        a.dog.animate(dt, 0);
        continue;
      }
      const t = a.line[a.i]!;
      const dx = t.x - pos.x, dz = t.z - pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.3) {
        const n = a.i + a.dir;
        if (n < 0 || n >= a.line.length) (a.dir = a.dir === 1 ? -1 : 1), (a.pause = 2 + this.rand() * 3);
        else {
          a.i = n;
          if (this.rand() < 0.04) a.pause = 1.5 + this.rand() * 3;
        }
        continue;
      }
      const step = Math.min(d, a.speed * dt);
      pos.x += (dx / d) * step;
      pos.z += (dz / d) * step;
      a.dog.root.rotation.y = Math.atan2(-dx, -dz);
      a.dog.animate(dt, a.speed);
    }

    for (let k = this.flocks.length - 1; k >= 0; k--) {
      const f = this.flocks[k]!;
      const dist = Math.hypot(f.cx - player.x, f.cz - player.z);
      if (dist > radius) {
        this.root.remove(f.root);
        this.flocks.splice(k, 1);
        continue;
      }
      if (f.state === 'ground' && dist < 7) {
        f.state = 'flying';
        f.timer = 6;
        for (const b of f.birds) {
          b.flying = true;
          const ang = Math.atan2(b.root.position.z + f.cz - player.z, b.root.position.x + f.cx - player.x) + (this.rand() - 0.5);
          b.vx = Math.cos(ang) * (4 + this.rand() * 2);
          b.vz = Math.sin(ang) * (4 + this.rand() * 2);
          b.vy = 3 + this.rand() * 2;
        }
      }
      if (f.state === 'flying') {
        f.timer -= dt;
        for (const b of f.birds) {
          b.root.position.x += b.vx * dt;
          b.root.position.y += b.vy * dt;
          b.root.position.z += b.vz * dt;
          b.vy = Math.max(0.6, b.vy - dt * 0.8);
          b.root.rotation.y = Math.atan2(-b.vx, -b.vz);
          b.animate(dt);
        }
        if (f.timer <= 0) {
          this.root.remove(f.root);
          this.flocks.splice(k, 1);
        }
        continue;
      }
      for (const b of f.birds) b.animate(dt);
    }
  }

  private spawnDog(player: Vector3, radius: number): void {
    if (!this.lines.length) return;
    for (let attempt = 0; attempt < 6; attempt++) {
      const line = this.lines[Math.floor(this.rand() * this.lines.length)]!;
      const i = Math.floor(this.rand() * line.length);
      const p = line[i]!;
      const d = Math.hypot(p.x - player.x, p.z - player.z);
      if (d < 15 || d > radius) continue;
      const dog = new Dog(DOG_COLORS[Math.floor(this.rand() * DOG_COLORS.length)]!);
      dog.root.position.set(p.x, 0, p.z);
      const s = 0.8 + this.rand() * 0.5;
      dog.root.scale.setScalar(s);
      this.root.add(dog.root);
      this.dogs.push({ dog, line, i, dir: this.rand() < 0.5 ? 1 : -1, speed: 1.2 + this.rand() * 1.2, pause: 0 });
      return;
    }
  }

  private spawnFlock(player: Vector3, radius: number): void {
    if (!this.plazas.length) return;
    for (let attempt = 0; attempt < 6; attempt++) {
      const ring = this.plazas[Math.floor(this.rand() * this.plazas.length)]!;
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const p of ring) {
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
      }
      const cx = minX + this.rand() * (maxX - minX);
      const cz = minZ + this.rand() * (maxZ - minZ);
      const flat = ring.flatMap((p) => [p.x, p.z]);
      if (!pointInPoly(flat, cx, cz)) continue;
      const d = Math.hypot(cx - player.x, cz - player.z);
      if (d < 20 || d > radius) continue;
      const root = new Group();
      root.position.set(cx, 0, cz);
      const birds: Pigeon[] = [];
      const n = 4 + Math.floor(this.rand() * 4);
      for (let i = 0; i < n; i++) {
        const b = new Pigeon();
        b.root.position.set((this.rand() - 0.5) * 4, 0, (this.rand() - 0.5) * 4);
        b.root.rotation.y = this.rand() * Math.PI * 2;
        birds.push(b);
        root.add(b.root);
      }
      this.root.add(root);
      this.flocks.push({ root, birds, cx, cz, state: 'ground', timer: 0 });
      return;
    }
  }

  private rand(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }
}
