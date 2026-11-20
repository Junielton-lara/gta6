import {
  BoxGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  Fog,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  Object3D,
  PlaneGeometry,
  RepeatWrapping,
  SRGBColorSpace,
  type Scene,
  type Vector3,
} from 'three';

export const WORLD_HALF_SIZE = 90;

export interface Obstacle {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface World {
  sun: DirectionalLight;
  obstacles: Obstacle[];
  /** Mantém a sombra do sol centrada no jogador (shadow map pequeno = barato). */
  followSun(target: Vector3): void;
}

const PALETTE = ['#ff6fb5', '#3de0ff', '#ffd36b', '#b98cff', '#ff9a6b', '#7dffb0', '#f4ecff'];

/** Cenário de teste: chão, ruas, prédios e palmeiras com poucos draw calls (instancing). */
export function buildWorld(scene: Scene): World {
  scene.background = new Color('#2a1446');
  scene.fog = new Fog('#5a2a6e', 60, 170);

  const hemi = new HemisphereLight('#ffb3d9', '#3a2a55', 1.4);
  scene.add(hemi);

  const sun = new DirectionalLight('#ffd2a1', 2.2);
  sun.position.set(30, 50, 20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  const sc = sun.shadow.camera;
  sc.left = -35;
  sc.right = 35;
  sc.top = 35;
  sc.bottom = -35;
  sc.near = 1;
  sc.far = 140;
  sun.shadow.bias = -0.0015;
  scene.add(sun, sun.target);

  scene.add(buildGround());
  scene.add(buildRoads());

  const rng = mulberry32(20261120);
  const { mesh: buildings, obstacles } = buildBuildings(rng);
  scene.add(buildings, ...buildPalms(rng));

  const sunOffset = sun.position.clone();
  return {
    sun,
    obstacles,
    followSun(target) {
      sun.position.copy(target).add(sunOffset);
      sun.target.position.copy(target);
    },
  };
}

function buildGround(): Mesh {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#3b2d4f';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = '#56437a';
  ctx.lineWidth = 4;
  ctx.strokeRect(0, 0, size, size);
  ctx.strokeStyle = '#4a3a66';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(size / 2, 0);
  ctx.lineTo(size / 2, size);
  ctx.moveTo(0, size / 2);
  ctx.lineTo(size, size / 2);
  ctx.stroke();

  const texture = new CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.repeat.set(WORLD_HALF_SIZE / 4, WORLD_HALF_SIZE / 4);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;

  const ground = new Mesh(
    new PlaneGeometry(WORLD_HALF_SIZE * 2 + 40, WORLD_HALF_SIZE * 2 + 40),
    new MeshLambertMaterial({ map: texture }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  return ground;
}

function buildRoads(): Object3D {
  const group = new Object3D();
  const asphalt = new MeshLambertMaterial({ color: '#1d1726' });
  const stripe = new MeshLambertMaterial({ color: '#ffd36b', emissive: '#4a3400' });
  const length = WORLD_HALF_SIZE * 2;

  for (const rotation of [0, Math.PI / 2]) {
    const road = new Mesh(new PlaneGeometry(10, length), asphalt);
    road.rotation.set(-Math.PI / 2, 0, rotation);
    road.position.y = 0.02;
    road.receiveShadow = true;
    group.add(road);
  }

  const dashCount = 36;
  const dashes = new InstancedMesh(new PlaneGeometry(0.4, 2.4), stripe, dashCount * 2);
  const m = new Matrix4();
  const dummy = new Object3D();
  let i = 0;
  for (let d = 0; d < dashCount; d++) {
    const pos = -WORLD_HALF_SIZE + 2.5 + d * 5;
    if (Math.abs(pos) < 6) continue;
    dummy.rotation.set(-Math.PI / 2, 0, 0);
    dummy.position.set(0, 0.04, pos);
    dummy.updateMatrix();
    dashes.setMatrixAt(i++, m.copy(dummy.matrix));
    dummy.rotation.set(-Math.PI / 2, 0, Math.PI / 2);
    dummy.position.set(pos, 0.04, 0);
    dummy.updateMatrix();
    dashes.setMatrixAt(i++, m.copy(dummy.matrix));
  }
  dashes.count = i;
  group.add(dashes);
  return group;
}

function buildBuildings(rng: () => number): { mesh: InstancedMesh; obstacles: Obstacle[] } {
  const placedObstacles: Obstacle[] = [];
  const count = 70;
  const mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshLambertMaterial(), count);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const dummy = new Object3D();
  const color = new Color();
  let placed = 0;
  for (let attempt = 0; attempt < count * 10 && placed < count; attempt++) {
    const w = 4 + rng() * 8;
    const d = 4 + rng() * 8;
    const h = 3 + rng() ** 2 * 22;
    const x = (rng() * 2 - 1) * (WORLD_HALF_SIZE - 8);
    const z = (rng() * 2 - 1) * (WORLD_HALF_SIZE - 8);

    // Ruas livres e área de spawn livre.
    if (Math.abs(x) < w / 2 + 7 || Math.abs(z) < d / 2 + 7) continue;
    const box = { minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 };
    if (placedObstacles.some((o) => overlaps(o, box, 2))) continue;

    dummy.position.set(x, h / 2, z);
    dummy.scale.set(w, h, d);
    dummy.updateMatrix();
    mesh.setMatrixAt(placed, dummy.matrix);
    mesh.setColorAt(placed, color.set(PALETTE[Math.floor(rng() * PALETTE.length)]!));
    placedObstacles.push(box);
    placed++;
  }
  mesh.count = placed;
  return { mesh, obstacles: placedObstacles };
}

function buildPalms(rng: () => number): Object3D[] {
  const count = 40;
  const trunks = new InstancedMesh(
    new CylinderGeometry(0.25, 0.4, 6, 6),
    new MeshLambertMaterial({ color: '#8a5a3c' }),
    count,
  );
  const leaves = new InstancedMesh(
    new ConeGeometry(2.4, 1.6, 7),
    new MeshLambertMaterial({ color: '#2fd08a' }),
    count,
  );
  trunks.castShadow = leaves.castShadow = true;

  const dummy = new Object3D();
  for (let i = 0; i < count; i++) {
    // Calçadas ao longo das duas avenidas.
    const along = (rng() * 2 - 1) * (WORLD_HALF_SIZE - 4);
    const side = (rng() < 0.5 ? -1 : 1) * (6.5 + rng() * 1.5);
    const [x, z] = i % 2 === 0 ? [side, along] : [along, side];
    const tilt = (rng() - 0.5) * 0.25;

    dummy.position.set(x, 3, z);
    dummy.rotation.set(tilt, rng() * Math.PI, tilt);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);

    dummy.position.set(x + tilt * 6, 6.4, z + tilt * 6);
    dummy.updateMatrix();
    leaves.setMatrixAt(i, dummy.matrix);
  }
  return [trunks, leaves];
}

function overlaps(a: Obstacle, b: Obstacle, margin: number): boolean {
  return a.minX - margin < b.maxX && a.maxX + margin > b.minX && a.minZ - margin < b.maxZ && a.maxZ + margin > b.minZ;
}

/** PRNG determinístico: a cidade é igual em toda execução. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
