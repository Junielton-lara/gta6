import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Euler,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshDepthMaterial,
  MeshLambertMaterial,
  Object3D,
  Quaternion,
  RGBADepthPacking,
  type Scene,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CollisionWorld, pointInPoly } from './collision';
import { MeshBuilder } from './geometry';
import { type MapArea, type MapBuilding, type MapCurb, type MapData, type MapLandmark, type MapRoad, toPoints, type Vec2 } from './mapData';
import { type MatKey, MaterialLibrary } from './materials';
import type { Obstacle, RoadPath, WorldBudget } from './types';

const TILE = 80;

/** Fachadas genéricas: tons comuns no Centro de Curitiba (não são as cores reais de cada prédio). */
const PALETTE = ['#e9e1d0', '#d8cdb8', '#efe8da', '#cfc6b6', '#e6d3b3', '#d9c7a7', '#e2d6c8', '#c9cfc6', '#e8d2c4', '#d6dbe0'];
const TALL_PALETTE = ['#d6d6d2', '#c6c9cc', '#e0ddd6', '#bfc3c4', '#d8d2c8'];

/** Prédios com tratamento próprio. Geometria é representação, não réplica arquitetônica. */
const PACO_ID = 'w232899640';
const CATEDRAL_ID = 'r7783208';
const REPRESENTED_PREFIXES = ['Paço da Liberdade', 'Catedral Basílica'];

/** Marcos cujo modelo 3D é uma representação (o HUD avisa isso ao jogador). */
export function isRepresentedLandmark(name: string): boolean {
  return REPRESENTED_PREFIXES.some((p) => name.startsWith(p));
}

interface Tile {
  key: string;
  aabb: { minX: number; maxX: number; minZ: number; maxZ: number };
  buildings: MapBuilding[];
  roads: { road: MapRoad; pts: Vec2[] }[];
  curbs: { curb: MapCurb; pts: Vec2[] }[];
  crossings: { pts: Vec2[]; width: number }[];
  areas: MapArea[];
  state: 0 | 1 | 2;
  group: Group | null;
}

export interface MinimapData {
  roads: { pts: Vec2[]; width: number; kind: MapRoad['kind'] }[];
  landmarks: MapLandmark[];
}

export class CityWorld {
  readonly root = new Group();
  readonly sun: DirectionalLight;
  readonly hemi: HemisphereLight;
  readonly collision: CollisionWorld;
  readonly roads: RoadPath[];
  readonly walkLines: Vec2[][];
  readonly plazaAreas: Vec2[][];
  readonly bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  readonly minimap: MinimapData;
  readonly materials: MaterialLibrary;
  private readonly tiles: Tile[] = [];
  private readonly props = new Group();
  private readonly lampHeads: MeshLambertMaterial;
  private readonly namedLines: { name: string; pts: Vec2[] }[];
  private budget: WorldBudget;
  private readonly sunDir = new Vector3(0.4, 0.8, 0.3).normalize();

  constructor(
    scene: Scene,
    readonly data: MapData,
    budget: WorldBudget,
    anisotropy = 1,
  ) {
    this.budget = budget;
    this.root.name = 'curitiba-tiradentes';
    this.bounds = { ...data.meta.bounds };
    this.materials = new MaterialLibrary(budget.materialTier, anisotropy);

    this.hemi = new HemisphereLight('#dfeaff', '#6d6458', 0.9);
    this.sun = new DirectionalLight('#fff3df', 2);
    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -45;
    sc.right = sc.top = 45;
    sc.near = 1;
    sc.far = 260;
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.04;
    this.sun.shadow.mapSize.set(budget.shadowMapSize, budget.shadowMapSize);
    scene.add(this.hemi, this.sun, this.sun.target);

    this.collision = new CollisionWorld(buildObstacles(data.buildings), this.bounds);
    this.roads = data.roads
      .filter((r) => r.kind === 'road')
      .map((r) => ({ id: r.id, name: r.name, width: r.width, lanes: r.lanes, oneway: r.oneway, points: toPoints(r.pts) }));
    this.namedLines = data.roads.filter((r) => r.name).map((r) => ({ name: r.name, pts: toPoints(r.pts) }));
    this.plazaAreas = data.areas.filter((a) => a.kind !== 'road').map((a) => toPoints(a.ring));
    this.walkLines = buildWalkLines(data, this.collision);
    this.minimap = {
      roads: data.roads.map((r) => ({ pts: toPoints(r.pts), width: r.width, kind: r.kind })),
      landmarks: data.landmarks,
    };

    this.root.add(this.buildGround());
    this.splitIntoTiles();

    this.lampHeads = new MeshLambertMaterial({ color: '#d8d4c8', emissive: '#ffdca0', emissiveIntensity: 0 });
    this.buildProps();
    this.root.add(this.props);
    scene.add(this.root);
  }

  get loadedTiles(): { near: number; far: number; total: number } {
    let near = 0, far = 0;
    for (const t of this.tiles) {
      if (t.state === 2) near++;
      else if (t.state === 1) far++;
    }
    return { near, far, total: this.tiles.length };
  }

  /** Carrega tudo o que estiver no raio de uma vez (usado antes do primeiro quadro). */
  warmup(x: number, z: number): void {
    for (let i = 0; i < this.tiles.length; i++) this.update(x, z, Infinity);
  }

  /**
   * Streaming por proximidade: descarrega o que saiu do raio e constrói no máximo
   * `maxBuilds` blocos por chamada, do mais próximo para o mais distante (sem engasgos).
   */
  update(x: number, z: number, maxBuilds = 1): void {
    const { viewRadius, detailRadius } = this.budget;
    const pending: { tile: Tile; want: 1 | 2; d: number }[] = [];
    for (const t of this.tiles) {
      const d = distToBox(x, z, t.aabb);
      let want: 0 | 1 | 2 = d < detailRadius ? 2 : d < viewRadius ? 1 : 0;
      // histerese: evita carregar/descarregar na borda do raio
      if (want < t.state) {
        const limit = t.state === 2 ? detailRadius : viewRadius;
        if (d < limit + 15) want = t.state;
      }
      if (want === t.state) continue;
      if (want === 0) this.unload(t);
      else pending.push({ tile: t, want, d });
    }
    pending.sort((a, b) => a.d - b.d);
    for (let i = 0; i < pending.length && i < maxBuilds; i++) this.load(pending[i]!.tile, pending[i]!.want);
    this.materials.sync();
  }

  setBudget(budget: WorldBudget): void {
    const tierChanged = this.materials.setTier(budget.materialTier);
    if (budget.shadowMapSize !== this.budget.shadowMapSize) {
      this.sun.shadow.mapSize.set(budget.shadowMapSize, budget.shadowMapSize);
      this.sun.shadow.map?.dispose();
      (this.sun.shadow as { map: unknown }).map = null;
    }
    this.budget = budget;
    if (tierChanged) {
      this.root.traverse((o) => {
        const key = o.userData.mat as MatKey | undefined;
        if (key && (o as Mesh).isMesh) (o as Mesh).material = this.materials.get(key);
      });
    }
  }

  /** f: 0 = dia, 1 = noite. */
  setNight(f: number): void {
    this.materials.setNight(f);
    this.lampHeads.emissiveIntensity = f * 1.4;
  }

  setSunDirection(dir: Vector3): void {
    this.sunDir.copy(dir).normalize();
  }

  followSun(target: Vector3): void {
    this.sun.target.position.set(target.x, 0, target.z);
    this.sun.position.set(target.x + this.sunDir.x * 120, Math.max(20, this.sunDir.y * 120), target.z + this.sunDir.z * 120);
  }

  nearestStreetName(x: number, z: number, maxDist = 18): string | null {
    let best: string | null = null;
    let bd = maxDist;
    for (const l of this.namedLines) {
      for (let i = 0; i < l.pts.length - 1; i++) {
        const d = distToSegment(x, z, l.pts[i]!, l.pts[i + 1]!);
        if (d < bd) (bd = d), (best = l.name);
      }
    }
    return best;
  }

  nearestLandmark(x: number, z: number, maxDist = 35): MapLandmark | null {
    let best: MapLandmark | null = null;
    let bd = maxDist;
    for (const l of this.data.landmarks) {
      // prédios com modelo próprio têm prioridade sobre monumentos pequenos ao lado
      const d = Math.hypot(l.x - x, l.z - z) * (isRepresentedLandmark(l.name) ? 0.5 : 1);
      if (d < bd) (bd = d), (best = l);
    }
    return best;
  }

  /** Ponto livre de prédios mais próximo de uma via (spawn de jogador/carros). */
  roadPointNear(x: number, z: number): { x: number; z: number; yaw: number; road: RoadPath } | null {
    let best: { x: number; z: number; yaw: number; road: RoadPath } | null = null;
    let bd = Infinity;
    for (const road of this.roads) {
      if (road.width < 6) continue;
      for (let i = 0; i < road.points.length - 1; i++) {
        const a = road.points[i]!, b = road.points[i + 1]!;
        const m = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
        const d = Math.hypot(m.x - x, m.z - z);
        if (d < bd) {
          bd = d;
          best = { ...m, yaw: Math.atan2(-(b.x - a.x), -(b.z - a.z)), road };
        }
      }
    }
    return best;
  }

  // ---------------- construção ----------------

  private buildGround(): Mesh {
    const b = this.bounds;
    const m = 80;
    const mb = new MeshBuilder();
    mb.polygon(
      [
        { x: b.minX - m, z: b.minZ - m },
        { x: b.maxX + m, z: b.minZ - m },
        { x: b.maxX + m, z: b.maxZ + m },
        { x: b.minX - m, z: b.maxZ + m },
      ],
      0,
    );
    return this.mesh(mb, 'ground', false, true)!;
  }

  private splitIntoTiles(): void {
    const map = new Map<string, Tile>();
    const tileAt = (x: number, z: number): Tile => {
      const ix = Math.floor(x / TILE), iz = Math.floor(z / TILE);
      const key = `${ix},${iz}`;
      let t = map.get(key);
      if (!t) {
        t = {
          key,
          aabb: { minX: ix * TILE, maxX: (ix + 1) * TILE, minZ: iz * TILE, maxZ: (iz + 1) * TILE },
          buildings: [], roads: [], curbs: [], crossings: [], areas: [],
          state: 0, group: null,
        };
        map.set(key, t);
      }
      return t;
    };
    const grow = (t: Tile, pts: Vec2[]) => {
      for (const p of pts) {
        t.aabb.minX = Math.min(t.aabb.minX, p.x);
        t.aabb.maxX = Math.max(t.aabb.maxX, p.x);
        t.aabb.minZ = Math.min(t.aabb.minZ, p.z);
        t.aabb.maxZ = Math.max(t.aabb.maxZ, p.z);
      }
    };

    for (const b of this.data.buildings) {
      const ring = toPoints(b.ring);
      const c = centroid(ring);
      const t = tileAt(c.x, c.z);
      t.buildings.push(b);
      grow(t, ring);
    }
    for (const a of this.data.areas) {
      const ring = toPoints(a.ring);
      const c = centroid(ring);
      const t = tileAt(c.x, c.z);
      t.areas.push(a);
      grow(t, ring);
    }
    const splitLine = (pts: Vec2[], push: (t: Tile, part: Vec2[]) => void): void => {
      let cur: Vec2[] = [pts[0]!];
      let curTile: Tile | null = null;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i]!, b = pts[i + 1]!;
        const t = tileAt((a.x + b.x) / 2, (a.z + b.z) / 2);
        if (curTile && t !== curTile) {
          push(curTile, cur);
          cur = [a];
        }
        curTile = t;
        cur.push(b);
      }
      if (curTile && cur.length >= 2) push(curTile, cur);
    };
    for (const road of this.data.roads) {
      splitLine(toPoints(road.pts), (t, part) => {
        t.roads.push({ road, pts: part });
        grow(t, part);
      });
    }
    for (const curb of this.data.curbs) {
      splitLine(toPoints(curb.pts), (t, part) => {
        t.curbs.push({ curb, pts: part });
        grow(t, part);
      });
    }
    for (const c of this.data.crossings) {
      const pts = toPoints(c.pts);
      const m = centroid(pts);
      tileAt(m.x, m.z).crossings.push({ pts, width: c.width });
    }
    this.tiles.push(...map.values());
  }

  private load(tile: Tile, state: 1 | 2): void {
    this.unload(tile);
    const group = new Group();
    group.name = `tile ${tile.key} ${state === 2 ? 'near' : 'far'}`;
    const detail = state === 2;

    // ---- chão: vias, calçadões, praças ----
    const asphalt = new MeshBuilder();
    const petit = new MeshBuilder();
    const grass = new MeshBuilder();
    for (const a of tile.areas) {
      const ring = toPoints(a.ring);
      if (a.kind === 'park') grass.polygon(ring, 0.012);
      else if (a.kind === 'road') asphalt.polygon(ring, 0.028);
      else petit.polygon(ring, 0.016);
    }
    for (const { road, pts } of tile.roads) {
      if (road.kind === 'road') asphalt.ribbon(pts, road.width, 0.03);
      else if (road.kind === 'pedestrian') petit.ribbon(pts, road.width, 0.02);
      else petit.ribbon(pts, road.width, 0.022);
    }
    this.add(group, asphalt, 'asphalt', false, true);
    this.add(group, petit, 'petit', false, true);
    this.add(group, grass, 'grass', false, true);

    if (detail) {
      const curbs = new MeshBuilder();
      const yellow = new MeshBuilder();
      const white = new MeshBuilder();
      for (const { curb, pts } of tile.curbs) {
        const half = curb.width / 2;
        curbs.curb(pts, half, 0.15, 0.25);
        curbs.curb(pts, -half, 0.15, 0.25);
        if (curb.lanes >= 2 && curb.width >= 6) {
          if (!curb.oneway) yellow.dashes(pts, 0, 0.14, 3, 4, 0.05);
          else {
            for (let k = 1; k < curb.lanes; k++) white.dashes(pts, -half + (k * curb.width) / curb.lanes, 0.12, 3, 5, 0.05);
          }
        }
      }
      for (const c of tile.crossings) white.dashes(c.pts, 0, c.width, 0.5, 0.5, 0.055);
      this.add(group, curbs, 'curb', false, true);
      this.add(group, yellow, 'markYellow', false, false);
      this.add(group, white, 'markWhite', false, false);
    }

    // ---- prédios ----
    if (detail) this.buildDetailedBuildings(group, tile.buildings);
    else this.buildFarBuildings(group, tile.buildings);

    tile.group = group;
    tile.state = state;
    this.root.add(group);
  }

  private unload(tile: Tile): void {
    if (!tile.group) {
      tile.state = 0;
      return;
    }
    tile.group.traverse((o) => (o as Mesh).geometry?.dispose());
    this.root.remove(tile.group);
    tile.group = null;
    tile.state = 0;
  }

  private buildDetailedBuildings(group: Group, buildings: MapBuilding[]): void {
    const facade = new MeshBuilder();
    const tall = new MeshBuilder();
    const store = new MeshBuilder();
    const roof = new MeshBuilder();
    const trim = new MeshBuilder();

    for (const b of buildings) {
      const ring = toPoints(b.ring);
      const holes = (b.holes ?? []).map(toPoints);
      const tint = buildingColor(b);
      const minH = b.minH ?? 0;

      if (b.kind === 'roof') {
        const y0 = Math.max(minH, b.h - 0.35);
        trim.walls(ring, y0, b.h, new Color('#9aa0a4'));
        roof.polygon(ring, b.h, new Color('#8a9094'), holes);
        roof.polygon(ring, y0, new Color('#6e7478'), holes, true);
        continue;
      }

      const isTall = b.h > 24;
      const special = b.id === PACO_ID || b.id === CATEDRAL_ID;
      const church = b.kind === 'church' || b.kind === 'cathedral' || b.id === CATEDRAL_ID;
      const shop = !special && !b.historic && !church && b.kind !== 'house' && b.h >= 7 && minH === 0;
      // igrejas: paredes lisas (janelas de apartamento descaracterizariam o templo)
      const walls = church ? trim : isTall ? tall : facade;
      if (shop) {
        store.walls(ring, 0, 4);
        walls.walls(ring, 4, b.h, tint);
        trim.walls(MeshBuilder.offsetRing(ring, 0.25), 3.9, 4.35, new Color('#6b645a'));
      } else {
        walls.walls(ring, minH, b.h, tint);
      }
      roof.polygon(ring, b.h, roofColor(b), holes);
      // platibanda
      const parapet = special ? 1.2 : isTall ? 1 : 0.6;
      trim.walls(ring, b.h, b.h + parapet, tint.clone().multiplyScalar(0.92));
      if (b.id === PACO_ID) this.decoratePaco(trim, ring, b.h);
      if (b.id === CATEDRAL_ID) this.decorateCatedral(trim, ring, b.h, tint);
    }
    this.add(group, facade, 'facade', true, true);
    this.add(group, tall, 'facadeTall', true, true);
    this.add(group, store, 'storefront', true, true);
    this.add(group, roof, 'roof', false, true);
    this.add(group, trim, 'trim', true, true);
  }

  private buildFarBuildings(group: Group, buildings: MapBuilding[]): void {
    const flat = new MeshBuilder();
    for (const b of buildings) {
      const ring = toPoints(b.ring);
      const c = buildingColor(b).multiplyScalar(0.9);
      const y0 = b.kind === 'roof' ? Math.max(b.minH ?? 0, b.h - 0.35) : b.minH ?? 0;
      flat.walls(ring, y0, b.h, c);
      flat.polygon(ring, b.h, roofColor(b));
    }
    this.add(group, flat, 'flatBuilding', false, true);
  }

  /** Paço da Liberdade: cornijas e platibanda claras sobre o contorno real (representação). */
  private decoratePaco(trim: MeshBuilder, ring: Vec2[], h: number): void {
    const white = new Color('#f2ece0');
    const out = MeshBuilder.offsetRing(ring, 0.3);
    trim.walls(out, h - 0.9, h - 0.4, white);
    trim.walls(out, 4.6, 5.0, white);
    trim.walls(MeshBuilder.offsetRing(ring, 0.12), 0, 0.9, new Color('#8c7b68'));
    trim.walls(ring, h + 0.2, h + 1.2, white);
  }

  /** Catedral: duas torres com coruchéu na fachada voltada para a Praça Tiradentes (representação). */
  private decorateCatedral(trim: MeshBuilder, ring: Vec2[], h: number, tint: Color): void {
    const praca = this.data.landmarks.find((l) => l.name === 'Praça Tiradentes');
    const c = centroid(ring);
    const target = praca ?? { x: c.x, z: c.z + 50 };
    let best = -Infinity;
    let edge: [Vec2, Vec2] | null = null;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!, b = ring[(i + 1) % ring.length]!;
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len < 8) continue;
      const m = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
      const to = { x: target.x - m.x, z: target.z - m.z };
      const out = { x: m.x - c.x, z: m.z - c.z };
      const score = (to.x * out.x + to.z * out.z) / (Math.hypot(to.x, to.z) * Math.hypot(out.x, out.z) || 1);
      if (score > best) (best = score), (edge = [a, b]);
    }
    if (!edge) return;
    const [a, b] = edge;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const ux = (b.x - a.x) / len, uz = (b.z - a.z) / len;
    const yaw = Math.atan2(ux, uz);
    // normal para dentro do prédio
    let nx = -uz, nz = ux;
    const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
    if ((c.x - mid.x) * nx + (c.z - mid.z) * nz < 0) (nx = -nx), (nz = -nz);
    const size = Math.min(6, len * 0.22);
    const towerH = h + 14;
    const color = tint.clone().multiplyScalar(0.97);
    const roofC = new Color('#5d6a72');
    for (const t of [size / 2 + 0.5, len - size / 2 - 0.5]) {
      const x = a.x + ux * t + nx * (size / 2);
      const z = a.z + uz * t + nz * (size / 2);
      trim.box(x, towerH / 2, z, size, towerH, size, yaw, color);
      trim.box(x, towerH + 0.4, z, size + 0.6, 0.8, size + 0.6, yaw, new Color('#ece8e0'));
      trim.pyramid(x, towerH + 0.8, z, size * 0.9, 12, yaw, roofC);
    }
    // frontão central
    const fx = mid.x + nx * 0.6, fz = mid.z + nz * 0.6;
    trim.pyramid(fx, h, fz, Math.min(10, len * 0.4), 5, yaw, color);
  }

  private add(group: Group, mb: MeshBuilder, mat: MatKey, cast: boolean, receive: boolean): void {
    const m = this.mesh(mb, mat, cast, receive);
    if (m) group.add(m);
  }

  private mesh(mb: MeshBuilder, mat: MatKey, cast: boolean, receive: boolean): Mesh | null {
    const geo = mb.build();
    if (!geo) return null;
    const m = new Mesh(geo, this.materials.get(mat));
    m.userData.mat = mat;
    m.castShadow = cast;
    m.receiveShadow = receive;
    m.matrixAutoUpdate = false;
    return m;
  }

  // ---------------- mobiliário urbano (instanciado) ----------------

  private buildProps(): void {
    const pts = this.data.points;
    const dummy = new Object3D();

    // Árvores: as do OSM + preenchimento ilustrativo dentro de praças/parques do OSM.
    const trees: Vec2[] = pts.filter((p) => p.kind === 'tree').map((p) => ({ x: p.x, z: p.z }));
    for (const a of this.data.areas) {
      if (a.kind !== 'park' && a.kind !== 'square') continue;
      const ring = toPoints(a.ring);
      const flat = new Float32Array(a.ring);
      const box = bbox(ring);
      for (let x = box.minX + 4; x < box.maxX; x += 11) {
        for (let z = box.minZ + 4; z < box.maxZ; z += 11) {
          const jx = x + (hash2(x, z) - 0.5) * 6;
          const jz = z + (hash2(z, x) - 0.5) * 6;
          if (!pointInPoly(flat, jx, jz)) continue;
          if (this.collision.insideAny(jx, jz, 2)) continue;
          if (this.nearRoad(jx, jz, 2.5)) continue;
          trees.push({ x: jx, z: jz });
        }
      }
    }
    if (trees.length) {
      const leafTex = leafClusterTexture();
      const trunks = new InstancedMesh(treeTrunkGeometry(), new MeshLambertMaterial({ color: '#5a4636' }), trees.length);
      const cores = new InstancedMesh(treeCoreGeometry(), new MeshLambertMaterial({ color: '#2f4a24' }), trees.length);
      const crowns = new InstancedMesh(
        treeCrownGeometry(),
        new MeshLambertMaterial({ map: leafTex, alphaTest: 0.5, side: DoubleSide }),
        trees.length,
      );
      crowns.customDepthMaterial = new MeshDepthMaterial({ depthPacking: RGBADepthPacking, map: leafTex, alphaTest: 0.5 });
      const tmpColor = new Color();
      trees.forEach((t, i) => {
        const s = 0.8 + hash2(t.x, t.z) * 0.6;
        dummy.position.set(t.x, 0, t.z);
        dummy.rotation.set(0, hash2(t.z, t.x) * Math.PI * 2, 0);
        dummy.scale.set(s, s * (0.9 + hash2(t.x + 3, t.z) * 0.25), s);
        dummy.updateMatrix();
        trunks.setMatrixAt(i, dummy.matrix);
        cores.setMatrixAt(i, dummy.matrix);
        crowns.setMatrixAt(i, dummy.matrix);
        crowns.setColorAt(i, tmpColor.setHSL(0.2 + hash2(t.x + 1, t.z) * 0.1, 0.3, 0.86 + hash2(t.x, t.z + 1) * 0.14));
      });
      trunks.castShadow = cores.castShadow = crowns.castShadow = true;
      this.finishInstanced(trunks);
      this.finishInstanced(cores);
      this.finishInstanced(crowns);
    }

    // Semáforos (posições do OSM).
    const signals = pts.filter((p) => p.kind === 'signal');
    if (signals.length) {
      const poleGeo = new CylinderGeometry(0.07, 0.09, 3.6, 6);
      poleGeo.translate(0, 1.8, 0);
      const headGeo = new BoxGeometry(0.32, 0.9, 0.3);
      headGeo.translate(0, 3.9, 0);
      const poles = new InstancedMesh(poleGeo, new MeshLambertMaterial({ color: '#2d3033' }), signals.length);
      const heads = new InstancedMesh(headGeo, new MeshLambertMaterial({ color: '#1b1d1f', emissive: '#20ff60', emissiveIntensity: 0.15 }), signals.length);
      signals.forEach((s, i) => {
        const yaw = this.roadYawNear(s.x, s.z);
        dummy.position.set(s.x, 0, s.z);
        dummy.rotation.set(0, yaw, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        poles.setMatrixAt(i, dummy.matrix);
        heads.setMatrixAt(i, dummy.matrix);
      });
      this.finishInstanced(poles);
      this.finishInstanced(heads);
    }

    // Pontos de ônibus (posições do OSM): abrigo genérico alinhado à via mais próxima.
    const stops = pts.filter((p) => p.kind === 'bus_stop');
    if (stops.length) {
      const roofGeo = new BoxGeometry(3.2, 0.12, 1.5);
      roofGeo.translate(0, 2.5, 0);
      const backGeo = new BoxGeometry(3.2, 1.8, 0.06);
      backGeo.translate(0, 1.4, -0.65);
      const roofs = new InstancedMesh(roofGeo, new MeshLambertMaterial({ color: '#4b5560' }), stops.length);
      const backs = new InstancedMesh(backGeo, new MeshLambertMaterial({ color: '#9fc4d8', transparent: true, opacity: 0.55 }), stops.length);
      stops.forEach((s, i) => {
        dummy.position.set(s.x, 0, s.z);
        dummy.rotation.set(0, this.roadYawNear(s.x, s.z) + Math.PI / 2, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        roofs.setMatrixAt(i, dummy.matrix);
        backs.setMatrixAt(i, dummy.matrix);
      });
      roofs.castShadow = true;
      this.finishInstanced(roofs);
      this.finishInstanced(backs);
    }

    // Postes: o OSM deste recorte não tem postes mapeados; distribuição ilustrativa ao longo do meio-fio.
    const lamps: { x: number; z: number; yaw: number }[] = [];
    for (const c of this.data.curbs) {
      const line = toPoints(c.pts);
      let acc = 10;
      let side = 1;
      for (let i = 0; i < line.length - 1; i++) {
        const a = line[i]!, b = line[i + 1]!;
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        const ux = (b.x - a.x) / (len || 1), uz = (b.z - a.z) / (len || 1);
        while (acc < len) {
          const off = (c.width / 2 + 0.6) * side;
          const x = a.x + ux * acc - uz * off;
          const z = a.z + uz * acc + ux * off;
          if (!this.collision.insideAny(x, z, 0.4)) lamps.push({ x, z, yaw: Math.atan2(uz * side, -ux * side) });
          side = -side;
          acc += 26;
        }
        acc -= len;
      }
    }
    if (lamps.length) {
      const poleGeo = new CylinderGeometry(0.06, 0.1, 6.5, 6);
      poleGeo.translate(0, 3.25, 0);
      const headGeo = new BoxGeometry(0.3, 0.14, 1.1);
      headGeo.translate(0, 6.45, 0.45);
      const poles = new InstancedMesh(poleGeo, new MeshLambertMaterial({ color: '#3a3d40' }), lamps.length);
      const heads = new InstancedMesh(headGeo, this.lampHeads, lamps.length);
      lamps.forEach((l, i) => {
        dummy.position.set(l.x, 0, l.z);
        dummy.rotation.set(0, l.yaw, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        poles.setMatrixAt(i, dummy.matrix);
        heads.setMatrixAt(i, dummy.matrix);
      });
      this.finishInstanced(poles);
      this.finishInstanced(heads);
    }
  }

  private finishInstanced(m: InstancedMesh): void {
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
    m.matrixAutoUpdate = false;
    this.props.add(m);
  }

  private nearRoad(x: number, z: number, margin: number): boolean {
    for (const r of this.data.roads) {
      if (r.kind !== 'road') continue;
      const pts = toPoints(r.pts);
      for (let i = 0; i < pts.length - 1; i++) {
        if (distToSegment(x, z, pts[i]!, pts[i + 1]!) < r.width / 2 + margin) return true;
      }
    }
    return false;
  }

  private roadYawNear(x: number, z: number): number {
    let bd = Infinity;
    let yaw = 0;
    for (const r of this.roads) {
      for (let i = 0; i < r.points.length - 1; i++) {
        const a = r.points[i]!, b = r.points[i + 1]!;
        const d = distToSegment(x, z, a, b);
        if (d < bd) (bd = d), (yaw = Math.atan2(b.x - a.x, b.z - a.z));
      }
    }
    return yaw;
  }
}

// ---------------- árvores ----------------

const CROWN_CENTER_Y = 4.6;

/** Cachos de folhas pintados num canvas com transparência (recortados por alphaTest). */
function leafClusterTexture(): CanvasTexture {
  const W = 256;
  const c = document.createElement('canvas');
  c.width = c.height = W;
  const ctx = c.getContext('2d')!;
  let s = 97;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 520; i++) {
    const a = r() * Math.PI * 2;
    const d = Math.sqrt(r()) * W * 0.44;
    const x = W / 2 + Math.cos(a) * d, y = W / 2 + Math.sin(a) * d;
    const shade = 0.55 + r() * 0.45 - (d / W) * 0.3;
    const g = Math.round(130 * shade + 35), rr = Math.round(80 * shade + 20), b = Math.round(40 * shade + 12);
    ctx.fillStyle = `rgb(${rr},${g},${b})`;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(r() * Math.PI);
    ctx.beginPath();
    ctx.ellipse(0, 0, 5 + r() * 5, 2.5 + r() * 2.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

/** Cartões de folhagem espalhados num elipsoide; normais esféricas para a copa parecer volume. */
function treeCrownGeometry(): BufferGeometry {
  const cards = 18;
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  let s = 31;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const m = new Matrix4(), q = new Quaternion(), e = new Euler(), v = new Vector3(), center = new Vector3(0, CROWN_CENTER_Y, 0);
  for (let k = 0; k < cards; k++) {
    const theta = r() * Math.PI * 2, phi = Math.acos(2 * r() - 1), rad = 0.55 + r() * 0.45;
    const cx = Math.sin(phi) * Math.cos(theta) * 1.6 * rad;
    const cy = Math.cos(phi) * 1.25 * rad + CROWN_CENTER_Y;
    const cz = Math.sin(phi) * Math.sin(theta) * 1.6 * rad;
    const size = 1.9 + r() * 0.8;
    q.setFromEuler(e.set(r() * Math.PI, r() * Math.PI, r() * Math.PI));
    m.compose(new Vector3(cx, cy, cz), q, new Vector3(size, size, size));
    const base = pos.length / 3;
    for (const [px, py, u, w] of [[-0.5, -0.5, 0, 0], [0.5, -0.5, 1, 0], [0.5, 0.5, 1, 1], [-0.5, 0.5, 0, 1]] as const) {
      v.set(px, py, 0).applyMatrix4(m);
      pos.push(v.x, v.y, v.z);
      v.sub(center).normalize();
      nor.push(v.x, v.y, v.z);
      uv.push(u, w);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** Massa escura dentro da copa: evita ver o céu através dos cartões. */
function treeCoreGeometry(): BufferGeometry {
  const g = new IcosahedronGeometry(1.25, 1);
  g.scale(1.15, 0.9, 1.15);
  g.translate(0, CROWN_CENTER_Y, 0);
  return g;
}

function treeTrunkGeometry(): BufferGeometry {
  const trunk = new CylinderGeometry(0.13, 0.24, 3.8, 7);
  trunk.translate(0, 1.9, 0);
  const parts: BufferGeometry[] = [trunk];
  for (let i = 0; i < 3; i++) {
    const b = new CylinderGeometry(0.05, 0.09, 1.7, 5);
    b.translate(0, 0.85, 0);
    b.rotateZ(0.75);
    b.rotateY((i / 3) * Math.PI * 2 + 0.4);
    b.translate(0, 3 + i * 0.25, 0);
    parts.push(b);
  }
  return mergeGeometries(parts)!;
}

// ---------------- helpers ----------------

function buildObstacles(buildings: MapBuilding[]): Obstacle[] {
  const out: Obstacle[] = [];
  for (const b of buildings) {
    if (b.kind === 'roof' || (b.minH ?? 0) > 2) continue;
    const poly = new Float32Array(b.ring);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < poly.length; i += 2) {
      minX = Math.min(minX, poly[i]!);
      maxX = Math.max(maxX, poly[i]!);
      minZ = Math.min(minZ, poly[i + 1]!);
      maxZ = Math.max(maxZ, poly[i + 1]!);
    }
    out.push({ minX, maxX, minZ, maxZ, poly });
  }
  return out;
}

/** Linhas de caminhada: calçadas paralelas às vias + calçadões, cortadas onde entram em prédios. */
function buildWalkLines(data: MapData, collision: CollisionWorld): Vec2[][] {
  const lines: Vec2[][] = [];
  const pushClean = (pts: Vec2[]) => {
    let cur: Vec2[] = [];
    for (const p of resample(pts, 3)) {
      if (collision.insideAny(p.x, p.z, 0.5)) {
        if (cur.length >= 4) lines.push(cur);
        cur = [];
      } else cur.push(p);
    }
    if (cur.length >= 4) lines.push(cur);
  };
  for (const c of data.curbs) {
    const pts = toPoints(c.pts);
    const off = c.width / 2 + 1.7;
    pushClean(offsetLine(pts, off));
    pushClean(offsetLine(pts, -off));
  }
  for (const r of data.roads) {
    if (r.kind !== 'pedestrian') continue;
    const pts = toPoints(r.pts);
    if (r.width > 6) {
      pushClean(offsetLine(pts, r.width / 2 - 1.8));
      pushClean(offsetLine(pts, -(r.width / 2 - 1.8)));
    } else pushClean(pts);
  }
  return lines;
}

function offsetLine(pts: Vec2[], d: number): Vec2[] {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)]!, b = pts[Math.min(pts.length - 1, i + 1)]!;
    const dx = b.x - a.x, dz = b.z - a.z;
    const l = Math.hypot(dx, dz) || 1;
    return { x: p.x - (dz / l) * d, z: p.z + (dx / l) * d };
  });
}

function resample(pts: Vec2[], step: number): Vec2[] {
  const out: Vec2[] = [pts[0]!];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!, b = pts[i + 1]!;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(1, Math.round(len / step));
    for (let k = 1; k <= n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n });
  }
  return out;
}

function buildingColor(b: MapBuilding): Color {
  if (b.id === PACO_ID) return new Color('#d9925a');
  if (b.color) {
    try {
      return new Color().setStyle(b.color);
    } catch {
      /* cor inválida no OSM */
    }
  }
  const h = hashStr(b.id);
  const pal = b.h > 24 ? TALL_PALETTE : PALETTE;
  return new Color(pal[Math.floor(h * pal.length)]!);
}

function roofColor(b: MapBuilding): Color {
  if (b.roofColor) {
    try {
      return new Color().setStyle(b.roofColor);
    } catch {
      /* ignore */
    }
  }
  const h = hashStr(b.id + 'r');
  return new Color().setHSL(0.08, 0.06, 0.38 + h * 0.15);
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

function hash2(x: number, z: number): number {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

function centroid(pts: Vec2[]): Vec2 {
  let x = 0, z = 0;
  for (const p of pts) (x += p.x), (z += p.z);
  return { x: x / pts.length, z: z / pts.length };
}

function bbox(pts: Vec2[]) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  return { minX, maxX, minZ, maxZ };
}

function distToBox(x: number, z: number, b: { minX: number; maxX: number; minZ: number; maxZ: number }): number {
  const dx = Math.max(b.minX - x, 0, x - b.maxX);
  const dz = Math.max(b.minZ - z, 0, z - b.maxZ);
  return Math.hypot(dx, dz);
}

export function distToSegment(x: number, z: number, a: Vec2, b: Vec2): number {
  const ex = b.x - a.x, ez = b.z - a.z;
  const l2 = ex * ex + ez * ez || 1;
  const t = Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / l2));
  return Math.hypot(x - (a.x + ex * t), z - (a.z + ez * t));
}