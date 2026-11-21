import {
  BoxGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  type Material,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  RepeatWrapping,
  SphereGeometry,
  SRGBColorSpace,
  type Texture,
} from 'three';
import type { HumanRig } from '../actors/HumanModel';
import { CollisionWorld } from './collision';
import type { MapPoi } from './mapData';
import { CATEGORY_COLOR, kindLabel, poiTitle } from './poiLabels';
import type { Obstacle } from './types';

/** Interiores ficam longe do mapa para não interferir em colisão/streaming. */
export const INTERIOR_ORIGIN = { x: 4000, z: 4000 };
const W = 11;
const D = 13;
export const INTERIOR_CEILING = 3.4;

export interface BuiltInterior {
  group: Group;
  collision: CollisionWorld;
  spawn: { x: number; z: number; yaw: number };
  exit: { x: number; z: number };
  update(dt: number): void;
  dispose(): void;
}

type NpcFactory = (seed: number) => HumanRig;

/**
 * Sala genérica por categoria (o OSM não descreve interiores). Só a placa com o nome
 * vem do mapa; o resto é representação e o HUD avisa isso.
 */
export function buildInterior(poi: MapPoi, npc: NpcFactory): BuiltInterior {
  const g = new Group();
  const ox = INTERIOR_ORIGIN.x;
  const oz = INTERIOR_ORIGIN.z;
  g.position.set(ox, 0, oz);
  const obstacles: Obstacle[] = [];
  const disposables: (Material | Texture | BoxGeometry | PlaneGeometry | CylinderGeometry | SphereGeometry)[] = [];
  const rigs: HumanRig[] = [];
  const seed = hashString(poi.id);

  const matCache = new Map<string, MeshLambertMaterial>();
  const mat = (color: string) => {
    let m = matCache.get(color);
    if (!m) {
      m = new MeshLambertMaterial({ color });
      matCache.set(color, m);
      disposables.push(m);
    }
    return m;
  };

  /** Caixa com base em y0; colide por padrão. Coordenadas locais (centro da sala = 0,0). */
  const box = (w: number, h: number, d: number, x: number, z: number, y0: number, material: Material, collide = true) => {
    const geo = new BoxGeometry(w, h, d);
    disposables.push(geo);
    const m = new Mesh(geo, material);
    m.position.set(x, y0 + h / 2, z);
    g.add(m);
    if (collide) obstacles.push(rect(ox + x - w / 2, ox + x + w / 2, oz + z - d / 2, oz + z + d / 2));
    return m;
  };

  // ---- casca: piso, paredes, teto ----
  const floorTex = canvasTexture(256, 256, (c) => paintFloor(c, poi.cat));
  floorTex.wrapS = floorTex.wrapT = RepeatWrapping;
  floorTex.repeat.set(W / 2, D / 2);
  disposables.push(floorTex);
  const floorMat = new MeshLambertMaterial({ map: floorTex });
  disposables.push(floorMat);
  const floorGeo = new PlaneGeometry(W, D);
  disposables.push(floorGeo);
  const floor = new Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  g.add(floor);

  const wallColor = { food: '#e9dcc6', shop: '#f2f2ee', bank: '#dfe3e6', pharmacy: '#f7f9f8', hotel: '#d9cbb8', culture: '#ece8e0', artwork: '#ece8e0', service: '#e3e6e8' }[poi.cat];
  const wallMat = new MeshLambertMaterial({ color: wallColor, side: DoubleSide });
  disposables.push(wallMat);
  const T = 0.3;
  box(W + T * 2, INTERIOR_CEILING, T, 0, -D / 2 - T / 2, 0, wallMat);
  box(W + T * 2, INTERIOR_CEILING, T, 0, D / 2 + T / 2, 0, wallMat);
  box(T, INTERIOR_CEILING, D, -W / 2 - T / 2, 0, 0, wallMat);
  box(T, INTERIOR_CEILING, D, W / 2 + T / 2, 0, 0, wallMat);
  const ceilGeo = new PlaneGeometry(W, D);
  disposables.push(ceilGeo);
  const ceiling = new Mesh(ceilGeo, mat('#f4f4f2'));
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = INTERIOR_CEILING;
  g.add(ceiling);
  const lampMat = new MeshBasicMaterial({ color: '#fffbe8' });
  disposables.push(lampMat);
  for (const lz of [-3.5, 0.5, 4]) for (const lx of [-2.6, 2.6]) box(1.2, 0.04, 0.6, lx, lz, INTERIOR_CEILING - 0.05, lampMat, false);

  // rodapé escuro e porta de saída (parede sul)
  for (const [w, x, z, rot] of [[W, 0, -D / 2 + 0.02, 0], [W, 0, D / 2 - 0.02, 0], [D, -W / 2 + 0.02, 0, 1], [D, W / 2 - 0.02, 0, 1]] as const) {
    const b = box(rot ? 0.02 : w, 0.12, rot ? w : 0.02, x, z, 0, mat('#3a3430'), false);
    b.position.y = 0.06;
  }
  box(1.6, 2.3, 0.08, 0, D / 2 - 0.06, 0, mat('#3d3a36'), false);
  const doorGlass = new MeshLambertMaterial({ color: '#7d8a8f', transparent: true, opacity: 0.85 });
  disposables.push(doorGlass);
  box(1.3, 2.1, 0.1, 0, D / 2 - 0.08, 0, doorGlass, false);
  const exitSign = signTexture('SAÍDA', '#1e9e57', 256, 64);
  disposables.push(exitSign);
  const exitMat = new MeshBasicMaterial({ map: exitSign });
  disposables.push(exitMat);
  const exitGeo = new PlaneGeometry(0.8, 0.2);
  disposables.push(exitGeo);
  const exitMesh = new Mesh(exitGeo, exitMat);
  exitMesh.position.set(0, 2.5, D / 2 - 0.1);
  exitMesh.rotation.y = Math.PI;
  g.add(exitMesh);

  // ---- placa com o nome real (OSM) na parede do fundo ----
  const title = poiTitle(poi);
  const sign = signTexture(title, CATEGORY_COLOR[poi.cat], 1024, 160);
  disposables.push(sign);
  const signMat = new MeshBasicMaterial({ map: sign });
  disposables.push(signMat);
  const signGeo = new PlaneGeometry(5.2, 0.8);
  disposables.push(signGeo);
  const signMesh = new Mesh(signGeo, signMat);
  signMesh.position.set(0, 2.75, -D / 2 + 0.04);
  g.add(signMesh);

  const attendant = (x: number, z: number, yaw = Math.PI) => {
    const rig = npc(seed + rigs.length * 7);
    rig.root.position.set(x, 0, z);
    rig.root.rotation.y = yaw;
    g.add(rig.root);
    rigs.push(rig);
  };

  // ---- mobília por categoria ----
  const wood = mat('#7a5634');
  const counterTop = mat('#2f2b28');
  switch (poi.cat) {
    case 'food': {
      box(6.5, 1.05, 0.8, 0, -D / 2 + 1.8, 0, wood);
      box(6.7, 0.05, 1.0, 0, -D / 2 + 1.8, 1.05, counterTop, false);
      box(3.2, 1.2, 0.05, 0, -D / 2 + 0.03, 1.35, mat('#1d1d1d'), false); // quadro do cardápio
      attendant(-1.2, -D / 2 + 0.9);
      for (const tz of [-1.2, 1.6]) {
        for (const tx of [-3.3, 0, 3.3]) {
          box(0.9, 0.05, 0.9, tx, tz, 0.72, wood, false);
          box(0.08, 0.72, 0.08, tx, tz, 0, mat('#2a2a2a'));
          for (const s of [-1, 1]) box(0.42, 0.45, 0.42, tx + s * 0.75, tz, 0, mat('#8c3b2a'));
        }
      }
      break;
    }
    case 'shop': {
      const shelfTex = canvasTexture(256, 256, paintShelf);
      disposables.push(shelfTex);
      const shelfMat = new MeshLambertMaterial({ map: shelfTex });
      disposables.push(shelfMat);
      for (const sx of [-3.6, -1.2]) box(0.7, 1.8, 6.5, sx, -1.2, 0, shelfMat);
      box(0.5, 2.2, 8, -W / 2 + 0.25, -1, 0, shelfMat);
      box(2.6, 1.0, 0.8, 3.3, 2.6, 0, wood);
      box(0.5, 0.35, 0.4, 3.0, 2.6, 1.0, mat('#222'), false); // caixa registradora
      attendant(3.3, 1.7);
      box(0.6, 1.9, 4.5, W / 2 - 0.3, -2.5, 0, shelfMat);
      break;
    }
    case 'bank': {
      box(8.5, 1.1, 0.7, 0, -D / 2 + 2, 0, mat('#4a5560'));
      const glass = new MeshLambertMaterial({ color: '#a9c7d6', transparent: true, opacity: 0.35 });
      disposables.push(glass);
      box(8.5, 1.3, 0.05, 0, -D / 2 + 2.3, 1.1, glass, false);
      for (const ax of [-2.8, 0, 2.8]) attendant(ax, -D / 2 + 1.1);
      for (const az of [-1, 0.5, 2]) {
        box(0.7, 1.6, 0.6, -W / 2 + 0.4, az, 0, mat('#59636b'));
        box(0.05, 0.35, 0.45, -W / 2 + 0.73, az, 1.15, mat('#3de0ff'), false);
      }
      for (const qz of [0.5, 2.5]) for (const qx of [1.5, 3.5]) box(0.12, 1.0, 0.12, qx, qz, 0, mat('#c0c4c8'), false);
      break;
    }
    case 'pharmacy': {
      const white = mat('#fbfbfb');
      box(0.55, 2.1, 9, -W / 2 + 0.3, 0, 0, white);
      box(0.55, 2.1, 9, W / 2 - 0.3, 0, 0, white);
      box(1, 1.5, 4, 0, 0.3, 0, white);
      box(5, 1.05, 0.7, 0, -D / 2 + 1.7, 0, white);
      attendant(0.8, -D / 2 + 0.9);
      const green = new MeshBasicMaterial({ color: '#16a34a' });
      disposables.push(green);
      box(0.25, 0.8, 0.05, 3.8, -D / 2 + 0.04, 1.9, green, false);
      box(0.8, 0.25, 0.05, 3.8, -D / 2 + 0.04, 2.17, green, false);
      break;
    }
    case 'hotel': {
      box(4.5, 1.1, 0.9, 0, -D / 2 + 2, 0, wood);
      attendant(0.6, -D / 2 + 1.1);
      for (const s of [-1, 1]) box(2.2, 0.45, 0.9, s * 2.6, 2.4, 0, mat('#6b4f3a'));
      box(1.2, 0.4, 0.7, 0, 2.4, 0, wood);
      for (const ez of [-2.5, 0]) box(0.1, 2.3, 1.4, -W / 2 + 0.05, ez, 0, mat('#b9bec2'), false);
      plant(g, disposables, W / 2 - 0.8, D / 2 - 1.2);
      plant(g, disposables, -W / 2 + 0.8, D / 2 - 1.2);
      obstacles.push(rect(ox + W / 2 - 1.1, ox + W / 2 - 0.5, oz + D / 2 - 1.5, oz + D / 2 - 0.9));
      break;
    }
    case 'culture':
    case 'artwork': {
      if (poi.kind === 'library') {
        const shelfTex = canvasTexture(256, 256, paintBooks);
        disposables.push(shelfTex);
        const books = new MeshLambertMaterial({ map: shelfTex });
        disposables.push(books);
        box(0.5, 2.4, 10, -W / 2 + 0.25, 0, 0, books);
        box(0.5, 2.4, 10, W / 2 - 0.25, 0, 0, books);
        for (const tz of [-2, 1.5]) box(3, 0.78, 1.2, 0, tz, 0, wood);
        box(3, 1.0, 0.7, 0, -D / 2 + 1.5, 0, wood);
        attendant(0, -D / 2 + 0.8);
      } else {
        for (let i = 0; i < 6; i++) {
          const side = i < 3 ? -1 : 1;
          const tex = canvasTexture(128, 160, (c) => paintArt(c, seed + i));
          disposables.push(tex);
          const m = new MeshBasicMaterial({ map: tex });
          disposables.push(m);
          const geo = new PlaneGeometry(1.4, 1.75);
          disposables.push(geo);
          const frame = new Mesh(geo, m);
          frame.position.set(side * (W / 2 - 0.05), 1.7, -3.5 + (i % 3) * 3.2);
          frame.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;
          g.add(frame);
        }
        for (const px of [-1.8, 1.8]) {
          box(0.7, 1.0, 0.7, px, -0.5, 0, mat('#f2f0ea'));
          const geo = new SphereGeometry(0.25, 14, 10);
          disposables.push(geo);
          const s = new Mesh(geo, mat('#b08d57'));
          s.position.set(px, 1.25, -0.5);
          g.add(s);
        }
        box(2.4, 1.0, 0.7, 3.4, 3.4, 0, wood);
        attendant(3.4, 2.6);
      }
      break;
    }
    case 'service': {
      box(8, 1.1, 0.7, 0, -D / 2 + 1.8, 0, mat('#5c6770'));
      for (const ax of [-2.5, 0, 2.5]) attendant(ax, -D / 2 + 1);
      for (const rz of [0.8, 2.4]) box(6, 0.45, 0.55, 0, rz, 0, mat('#2f5d8a'));
      box(0.6, 1.5, 0.5, W / 2 - 0.4, 3.5, 0, mat('#e8a33d'));
      break;
    }
  }

  // ---- luz própria (a cidade fica oculta enquanto o jogador está dentro) ----
  const hemi = new HemisphereLight('#fffaf0', '#6f675c', 1.15);
  const key = new DirectionalLight('#ffffff', 0.55);
  key.position.set(2, 6, 3);
  g.add(hemi, key);

  const bounds = { minX: ox - W / 2, maxX: ox + W / 2, minZ: oz - D / 2, maxZ: oz + D / 2 };
  const collision = new CollisionWorld(obstacles, bounds);
  const label = kindLabel(poi);
  g.name = `interior:${label}`;

  return {
    group: g,
    collision,
    spawn: { x: ox, z: oz + D / 2 - 1.4, yaw: 0 },
    exit: { x: ox, z: oz + D / 2 - 0.6 },
    update(dt: number) {
      for (const r of rigs) r.animate(dt, 0, false);
    },
    dispose() {
      g.removeFromParent();
      for (const d of disposables) d.dispose();
    },
  };
}

function rect(minX: number, maxX: number, minZ: number, maxZ: number): Obstacle {
  return { minX, maxX, minZ, maxZ, poly: new Float32Array([minX, minZ, minX, maxZ, maxX, maxZ, maxX, minZ]) };
}

function plant(g: Group, disposables: { dispose(): void }[], x: number, z: number): void {
  const pot = new CylinderGeometry(0.28, 0.22, 0.5, 10);
  const leaves = new SphereGeometry(0.5, 10, 8);
  const pm = new MeshLambertMaterial({ color: '#5a4a3a' });
  const lm = new MeshLambertMaterial({ color: '#3f7d3a' });
  disposables.push(pot, leaves, pm, lm);
  const p = new Mesh(pot, pm);
  p.position.set(x, 0.25, z);
  const l = new Mesh(leaves, lm);
  l.position.set(x, 0.95, z);
  g.add(p, l);
}

function canvasTexture(w: number, h: number, paint: (c: CanvasRenderingContext2D, w: number, h: number) => void): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  paint(canvas.getContext('2d')!, w, h);
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  return t;
}

function signTexture(text: string, bg: string, w: number, h: number): CanvasTexture {
  return canvasTexture(w, h, (c) => {
    c.fillStyle = bg;
    c.fillRect(0, 0, w, h);
    c.fillStyle = new Color(bg).getHSL({ h: 0, s: 0, l: 0 }).l > 0.6 ? '#1a1a1a' : '#ffffff';
    let size = Math.round(h * 0.55);
    c.font = `800 ${size}px system-ui, sans-serif`;
    while (c.measureText(text).width > w * 0.92 && size > 12) {
      size -= 2;
      c.font = `800 ${size}px system-ui, sans-serif`;
    }
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(text, w / 2, h / 2);
  });
}

function paintFloor(c: CanvasRenderingContext2D, cat: MapPoi['cat']): void {
  const [a, b] =
    cat === 'food' ? ['#8a5f3c', '#7a5232'] : cat === 'bank' || cat === 'hotel' ? ['#d8d4cc', '#c9c4ba'] : cat === 'culture' ? ['#9b7650', '#8c6945'] : ['#e6e6e2', '#d2d2cc'];
  c.fillStyle = a;
  c.fillRect(0, 0, 256, 256);
  c.fillStyle = b;
  if (cat === 'food' || cat === 'culture') {
    for (let i = 0; i < 8; i++) c.fillRect(0, i * 32, 256, 2);
    for (let i = 0; i < 16; i++) c.fillRect(((i * 97) % 256), Math.floor(i / 2) * 32, 2, 32);
  } else {
    c.fillRect(0, 0, 128, 128);
    c.fillRect(128, 128, 128, 128);
    c.fillStyle = 'rgba(0,0,0,0.12)';
    c.fillRect(0, 127, 256, 2);
    c.fillRect(127, 0, 2, 256);
  }
}

function paintShelf(c: CanvasRenderingContext2D): void {
  c.fillStyle = '#d9d6cf';
  c.fillRect(0, 0, 256, 256);
  const colors = ['#e63946', '#f4a261', '#2a9d8f', '#264653', '#e9c46a', '#8ecae6', '#ffb703', '#6a4c93'];
  for (let row = 0; row < 5; row++) {
    c.fillStyle = '#9a958c';
    c.fillRect(0, row * 51 + 46, 256, 5);
    let x = 2;
    let i = row * 3;
    while (x < 250) {
      const w = 10 + ((i * 37) % 18);
      c.fillStyle = colors[i % colors.length]!;
      c.fillRect(x, row * 51 + 14 + ((i * 13) % 10), w - 2, 32 - ((i * 13) % 10));
      x += w;
      i++;
    }
  }
}

function paintBooks(c: CanvasRenderingContext2D): void {
  c.fillStyle = '#5b3f2a';
  c.fillRect(0, 0, 256, 256);
  const colors = ['#7f1d1d', '#1e3a8a', '#14532d', '#78350f', '#334155', '#a16207', '#4c1d95'];
  for (let row = 0; row < 6; row++) {
    let x = 0;
    let i = row * 5;
    while (x < 256) {
      const w = 5 + ((i * 29) % 7);
      c.fillStyle = colors[i % colors.length]!;
      c.fillRect(x, row * 42 + 6 + ((i * 7) % 6), w - 1, 34 - ((i * 7) % 6));
      x += w;
      i++;
    }
  }
}

function paintArt(c: CanvasRenderingContext2D, seed: number): void {
  c.fillStyle = '#3b2f24';
  c.fillRect(0, 0, 128, 160);
  c.fillStyle = `hsl(${(seed * 47) % 360}, 35%, 82%)`;
  c.fillRect(8, 8, 112, 144);
  for (let i = 0; i < 6; i++) {
    c.fillStyle = `hsla(${(seed * 47 + i * 61) % 360}, 55%, ${35 + ((i * 17) % 30)}%, 0.85)`;
    const x = 12 + ((seed * 13 + i * 29) % 80);
    const y = 12 + ((seed * 7 + i * 41) % 110);
    if (i % 2) c.fillRect(x, y, 20 + ((i * 11) % 30), 18 + ((i * 7) % 26));
    else {
      c.beginPath();
      c.arc(x + 12, y + 12, 8 + ((i * 5) % 14), 0, Math.PI * 2);
      c.fill();
    }
  }
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return Math.abs(h);
}
