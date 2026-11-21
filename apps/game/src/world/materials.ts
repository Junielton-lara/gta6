import {
  CanvasTexture,
  Color,
  type Material,
  MeshLambertMaterial,
  MeshStandardMaterial,
  NoColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
  TextureLoader,
} from 'three';
import type { MaterialTier } from './types';

export type MatKey =
  | 'ground'
  | 'asphalt'
  | 'petit'
  | 'grass'
  | 'brick'
  | 'curb'
  | 'markWhite'
  | 'markYellow'
  | 'facade'
  | 'facadeTall'
  | 'storefront'
  | 'roof'
  | 'trim'
  | 'flatBuilding';

interface MatDef {
  color: string;
  /** metros cobertos por uma repetição da textura (u, v) */
  size?: [number, number];
  offsetV?: number;
  map?: () => Texture;
  normal?: () => Texture;
  emissive?: () => Texture;
  roughness?: number;
  vertexColors?: boolean;
  polygonOffset?: number;
  /** Variação de tom em escala de dezenas de metros: esconde a repetição da textura no chão. */
  macro?: boolean;
  /** Multiplicador linear (r, g, b) sobre a textura: corrige o tom de uma textura CC0 genérica. */
  tint?: [number, number, number];
}

const BASE = `${import.meta.env.BASE_URL}textures/`;
const loader = new TextureLoader();
const imageCache = new Map<string, Texture>();

function file(name: string, srgb = true): () => Texture {
  return () => {
    let t = imageCache.get(name);
    if (!t) {
      t = loader.load(BASE + name);
      t.wrapS = t.wrapT = RepeatWrapping;
      if (srgb) t.colorSpace = SRGBColorSpace;
      imageCache.set(name, t);
    }
    return t;
  };
}

/** Uma imagem carregada para compor texturas em canvas (fachadas sobre reboco CC0). */
function image(name: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = BASE + name;
  });
}

function canvasTexture(w: number, h: number, paint: (ctx: CanvasRenderingContext2D, base: HTMLImageElement | null) => void, baseImage?: string): Texture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  paint(ctx, null);
  const tex = new CanvasTexture(c);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.colorSpace = SRGBColorSpace;
  if (baseImage) {
    void image(baseImage).then((img) => {
      if (!img) return;
      paint(ctx, img);
      tex.needsUpdate = true;
    });
  }
  return tex;
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function tile(ctx: CanvasRenderingContext2D, img: HTMLImageElement, w: number, h: number, cell: number): void {
  for (let y = 0; y < h; y += cell) for (let x = 0; x < w; x += cell) ctx.drawImage(img, x, y, cell, cell);
}

// ---------- fachadas procedurais (representativas, não réplicas de prédios reais) ----------

/** 512×512 = 4 vãos × 4 andares (12 m × 12.8 m). */
const FACADE_PX_M = 512 / 12;
const FLOOR_PX = 512 / 4;

function paintFacade(ctx: CanvasRenderingContext2D, base: HTMLImageElement | null, tall: boolean): void {
  const W = 512;
  ctx.fillStyle = tall ? '#c9c6c0' : '#e6e0d6';
  ctx.fillRect(0, 0, W, W);
  if (base) {
    ctx.globalAlpha = 0.9;
    tile(ctx, base, W, W, tall ? 256 : 171);
    ctx.globalAlpha = 1;
  }
  const r = rng(tall ? 7 : 3);
  const bay = W / 4;
  for (let fy = 0; fy < 4; fy++) {
    const top = fy * FLOOR_PX;
    // friso entre andares
    ctx.fillStyle = 'rgba(0,0,0,0.10)';
    ctx.fillRect(0, top + FLOOR_PX - 4, W, 4);
    for (let bx = 0; bx < 4; bx++) {
      const ww = (tall ? 2.4 : 1.3) * FACADE_PX_M;
      const wh = (tall ? 1.7 : 1.8) * FACADE_PX_M;
      const x = bx * bay + (bay - ww) / 2;
      const y = top + (tall ? 0.7 : 0.6) * FACADE_PX_M;
      // moldura
      ctx.fillStyle = tall ? '#8e9296' : '#f4f0e8';
      ctx.fillRect(x - 5, y - 5, ww + 10, wh + 10);
      // vidro
      const g = ctx.createLinearGradient(x, y, x + ww, y + wh);
      const curtain = r() < 0.35;
      g.addColorStop(0, curtain ? '#7d7466' : '#3b4f63');
      g.addColorStop(0.55, curtain ? '#9a8f7e' : '#24323f');
      g.addColorStop(1, curtain ? '#6a6256' : '#47637a');
      ctx.fillStyle = g;
      ctx.fillRect(x, y, ww, wh);
      // caixilho
      ctx.fillStyle = tall ? '#5d6166' : '#e8e2d6';
      ctx.fillRect(x + ww / 2 - 2, y, 4, wh);
      if (!tall) ctx.fillRect(x, y + wh * 0.35, ww, 3);
      // peitoril
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillRect(x - 8, y + wh + 5, ww + 16, 5);
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(x - 8, y + wh + 10, ww + 16, 3);
    }
  }
}

function paintFacadeLights(ctx: CanvasRenderingContext2D, tall: boolean, seed: number): void {
  const W = 512;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, W);
  const r = rng(seed);
  const bay = W / 4;
  for (let fy = 0; fy < 4; fy++) {
    for (let bx = 0; bx < 4; bx++) {
      if (r() > (tall ? 0.38 : 0.3)) continue;
      const ww = (tall ? 2.4 : 1.3) * FACADE_PX_M;
      const wh = (tall ? 1.7 : 1.8) * FACADE_PX_M;
      const x = bx * bay + (bay - ww) / 2;
      const y = fy * FLOOR_PX + (tall ? 0.7 : 0.6) * FACADE_PX_M;
      ctx.fillStyle = r() < 0.5 ? '#ffcf8a' : '#ffe6c0';
      ctx.fillRect(x, y, ww, wh);
    }
  }
}

/** 512×128 = 4 lojas de 4 m × 4 m (térreo comercial). */
function paintStorefront(ctx: CanvasRenderingContext2D, lights: boolean): void {
  const W = 512, H = 128, PX = W / 16;
  const signs = ['#b23a48', '#2f6690', '#3a7d44', '#d9a441'];
  ctx.fillStyle = lights ? '#000' : '#3a3632';
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 4; i++) {
    const x0 = i * 4 * PX;
    if (!lights) {
      ctx.fillStyle = '#d8d2c6';
      ctx.fillRect(x0, 0, 0.3 * PX, H);
      ctx.fillRect(x0 + 3.7 * PX, 0, 0.3 * PX, H);
      ctx.fillStyle = signs[i]!;
      ctx.fillRect(x0 + 0.3 * PX, H - 3.6 * PX, 3.4 * PX, 0.55 * PX);
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillRect(x0 + 0.9 * PX, H - 3.42 * PX, 2.2 * PX, 0.18 * PX);
    }
    const gx = x0 + 0.45 * PX, gy = H - 2.9 * PX, gw = 3.1 * PX, gh = 2.6 * PX;
    if (lights) {
      ctx.fillStyle = '#ffd59a';
      ctx.fillRect(gx, gy, gw, gh);
      ctx.fillStyle = signs[i]!;
      ctx.fillRect(x0 + 0.3 * PX, H - 3.6 * PX, 3.4 * PX, 0.55 * PX);
    } else {
      const g = ctx.createLinearGradient(gx, gy, gx + gw, gy + gh);
      g.addColorStop(0, '#2c3a44');
      g.addColorStop(0.5, '#4d6370');
      g.addColorStop(1, '#253039');
      ctx.fillStyle = g;
      ctx.fillRect(gx, gy, gw, gh);
      ctx.fillStyle = '#1d1b19';
      ctx.fillRect(gx + gw / 2 - 2, gy, 4, gh);
    }
  }
}

/** Pedras irregulares do petit-pavé: chama `stone` para cada pedra (x, y, tamanho, escura?). */
function eachPetitStone(stone: (x: number, y: number, cell: number, dark: boolean, r: () => number) => void): void {
  const W = 512;
  const r = rng(11);
  const cell = 8;
  for (let y = 0; y < W; y += cell) {
    const shift = (y / cell) % 2 ? cell / 2 : 0;
    for (let x = -cell; x < W; x += cell) {
      // sem desenho: o padrão real de cada calçadão não está no OSM
      stone(x + shift, y, cell, r() < 0.06, r);
    }
  }
}

/** Petit-pavé claro com desenho geométrico escuro — representação do calçamento da Rua XV. */
function paintPetitPave(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = '#77736b';
  ctx.fillRect(0, 0, 512, 512);
  eachPetitStone((x, y, cell, dark, r) => {
    const base = dark ? 70 + r() * 25 : 150 + r() * 50;
    const warm = dark ? 0 : r() * 10;
    ctx.fillStyle = `rgb(${(base + warm) | 0},${(base + warm * 0.6 - 2) | 0},${(base - 7) | 0})`;
    stonePath(ctx, x, y, cell, r);
    ctx.fill();
  });
}

/** Relevo das pedras (abauladas, juntas fundas) convertido em normal map. */
function paintPetitNormal(ctx: CanvasRenderingContext2D): void {
  const W = 512;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, W);
  eachPetitStone((x, y, cell, _dark, r) => {
    const g = ctx.createRadialGradient(x + cell / 2, y + cell / 2, 0.5, x + cell / 2, y + cell / 2, cell * 0.62);
    const top = 190 + r() * 60;
    g.addColorStop(0, `rgb(${top | 0},${top | 0},${top | 0})`);
    g.addColorStop(1, 'rgb(70,70,70)');
    ctx.fillStyle = g;
    stonePath(ctx, x, y, cell, r);
    ctx.fill();
  });
  heightToNormal(ctx, W, W, 2.2);
}

function stonePath(ctx: CanvasRenderingContext2D, x: number, y: number, cell: number, r: () => number): void {
  const j = () => (r() - 0.5) * 1.6;
  ctx.beginPath();
  ctx.moveTo(x + 0.6 + j(), y + 0.6 + j());
  ctx.lineTo(x + cell - 0.6 + j(), y + 0.6 + j());
  ctx.lineTo(x + cell - 0.6 + j(), y + cell - 0.6 + j());
  ctx.lineTo(x + 0.6 + j(), y + cell - 0.6 + j());
  ctx.closePath();
}

function heightToNormal(ctx: CanvasRenderingContext2D, w: number, h: number, strength: number): void {
  const src = ctx.getImageData(0, 0, w, h);
  const out = ctx.createImageData(w, h);
  const H = (x: number, y: number) => src.data[(((y + h) % h) * w + ((x + w) % w)) * 4]! / 255;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
      const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
      const l = Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      out.data[i] = ((-dx / l) * 0.5 + 0.5) * 255;
      out.data[i + 1] = ((dy / l) * 0.5 + 0.5) * 255;
      out.data[i + 2] = ((1 / l) * 0.5 + 0.5) * 255;
      out.data[i + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
}

/** Ruído suave (value noise com oitavas) que se repete sem emenda. */
function paintMacroNoise(ctx: CanvasRenderingContext2D): void {
  const W = 256;
  const img = ctx.createImageData(W, W);
  const r = rng(5);
  const layers = [4, 8, 16, 32].map((n) => ({ n, v: Array.from({ length: n * n }, () => r()) }));
  const smooth = (t: number) => t * t * (3 - 2 * t);
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      let acc = 0, amp = 0.5, tot = 0;
      for (const { n, v } of layers) {
        const fx = (x / W) * n, fy = (y / W) * n;
        const ix = Math.floor(fx), iy = Math.floor(fy);
        const tx = smooth(fx - ix), ty = smooth(fy - iy);
        const at = (a: number, b: number) => v[((b % n) * n + (a % n))]!;
        const top = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * tx;
        const bot = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * tx;
        acc += (top + (bot - top) * ty) * amp;
        tot += amp;
        amp *= 0.55;
      }
      const g = (acc / tot) * 255;
      const i = (y * W + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = g;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

let macroTexture: Texture | null = null;
function macroNoise(): Texture {
  if (!macroTexture) {
    macroTexture = canvasTexture(256, 256, (c) => paintMacroNoise(c));
    macroTexture.colorSpace = NoColorSpace;
  }
  return macroTexture;
}

/** Metros por repetição do ruído de variação. */
const MACRO_METERS = 46;

function addMacroVariation(m: Material, size: [number, number]): void {
  const repeat = size[0] / MACRO_METERS;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.macroMap = { value: macroNoise() };
    shader.uniforms.macroRepeat = { value: repeat };
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'uniform sampler2D macroMap;\nuniform float macroRepeat;\nvoid main() {')
      .replace(
        '#include <map_fragment>',
        /* glsl */ `#include <map_fragment>
        #ifdef USE_MAP
        {
          vec2 mu = vMapUv * macroRepeat;
          float n = texture2D(macroMap, mu).r * 0.7 + texture2D(macroMap, mu * 3.3 + 0.37).r * 0.3;
          vec3 alt = texture2D(map, mat2(0.8, -0.6, 0.6, 0.8) * vMapUv * 0.47 + 0.21).rgb;
          diffuseColor.rgb = mix(diffuseColor.rgb, alt * diffuse, smoothstep(0.42, 0.62, n) * 0.55);
          diffuseColor.rgb *= mix(0.74, 1.16, n);
        }
        #endif`,
      );
  };
  m.customProgramCacheKey = () => `macro${repeat.toFixed(4)}`;
}

function canvasMap(w: number, h: number, paint: (ctx: CanvasRenderingContext2D, base: HTMLImageElement | null) => void, baseImage?: string, srgb = true): () => Texture {
  let t: Texture | null = null;
  return () => {
    if (!t) {
      t = canvasTexture(w, h, paint, baseImage);
      if (!srgb) t.colorSpace = NoColorSpace;
    }
    return t;
  };
}

const DEFS: Record<MatKey, MatDef> = {
  ground: { color: '#a29c92', tint: [1.75, 2.0, 2.3], size: [2, 2], map: file('sidewalk_diff.jpg'), normal: file('sidewalk_nor.jpg', false), roughness: 0.95, macro: true },
  asphalt: { color: '#3b3d40', size: [5, 5], map: file('asphalt_diff.jpg'), normal: file('asphalt_nor.jpg', false), roughness: 0.82, polygonOffset: -2, macro: true },
  petit: {
    color: '#c9c4ba',
    size: [3, 3],
    map: canvasMap(512, 512, (c) => paintPetitPave(c)),
    normal: canvasMap(512, 512, (c) => paintPetitNormal(c), undefined, false),
    roughness: 0.78,
    polygonOffset: -1,
    macro: true,
  },
  grass: { color: '#5d7a3a', size: [4, 4], map: file('grass_diff.jpg'), normal: file('grass_nor.jpg', false), roughness: 1, polygonOffset: -1, macro: true },
  brick: { color: '#9a6a52', size: [2, 2], map: file('brick_diff.jpg'), normal: file('brick_nor.jpg', false), roughness: 0.9, polygonOffset: -1, macro: true },
  curb: { color: '#bdb8ae', tint: [1.9, 2.15, 2.45], size: [2, 2], map: file('sidewalk_diff.jpg'), normal: file('sidewalk_nor.jpg', false), roughness: 0.9 },
  markWhite: { color: '#e8e6dc', roughness: 0.7, polygonOffset: -4 },
  markYellow: { color: '#e0b630', roughness: 0.7, polygonOffset: -4 },
  facade: {
    color: '#ffffff',
    size: [12, 12.8],
    offsetV: -4,
    map: canvasMap(512, 512, (c, img) => paintFacade(c, img, false), 'plaster_diff.jpg'),
    normal: file('plaster_nor.jpg', false),
    emissive: canvasMap(512, 512, (c) => paintFacadeLights(c, false, 21)),
    roughness: 0.92,
    vertexColors: true,
  },
  facadeTall: {
    color: '#ffffff',
    size: [12, 12.8],
    offsetV: -4,
    map: canvasMap(512, 512, (c, img) => paintFacade(c, img, true), 'facade_tiles_diff.jpg'),
    normal: file('facade_tiles_nor.jpg', false),
    emissive: canvasMap(512, 512, (c) => paintFacadeLights(c, true, 33)),
    roughness: 0.6,
    vertexColors: true,
  },
  storefront: {
    color: '#ffffff',
    size: [16, 4],
    map: canvasMap(512, 128, (c) => paintStorefront(c, false)),
    emissive: canvasMap(512, 128, (c) => paintStorefront(c, true)),
    roughness: 0.5,
  },
  roof: { color: '#ffffff', size: [4, 4], map: file('sidewalk_diff.jpg'), roughness: 1, vertexColors: true },
  trim: { color: '#ffffff', roughness: 0.8, vertexColors: true },
  flatBuilding: { color: '#ffffff', roughness: 1, vertexColors: true },
};

const NIGHT_COLOR = new Color('#ffd9a0');

/** Materiais compartilhados por todos os blocos; trocam de nível conforme a qualidade. */
export class MaterialLibrary {
  private cache = new Map<MatKey, Material>();
  private night = 0;

  constructor(
    private tier_: MaterialTier,
    private readonly anisotropy = 1,
  ) {}

  get tier(): MaterialTier {
    return this.tier_;
  }

  setTier(tier: MaterialTier): boolean {
    if (tier === this.tier_) return false;
    this.tier_ = tier;
    for (const m of this.cache.values()) m.dispose();
    this.cache.clear();
    for (const e of this.scaledCache.values()) {
      e.tex.anisotropy = tier === 'pbr' ? this.anisotropy : 1;
      e.tex.needsUpdate = true;
    }
    return true;
  }

  get(key: MatKey): Material {
    let m = this.cache.get(key);
    if (!m) {
      m = this.create(DEFS[key]);
      this.cache.set(key, m);
      this.applyNight(m);
    }
    return m;
  }

  /** 0 = dia, 1 = noite: acende janelas e vitrines. */
  setNight(f: number): void {
    if (Math.abs(f - this.night) < 0.01) return;
    this.night = f;
    for (const m of this.cache.values()) this.applyNight(m);
  }

  private applyNight(m: Material): void {
    const e = m as MeshStandardMaterial;
    if (e.emissiveMap) e.emissiveIntensity = this.night * 1.1;
  }

  private create(def: MatDef): Material {
    const tier = this.tier_;
    const useMaps = tier !== 'flat';
    const map = useMaps && def.map ? this.scaled(def.map(), def) : null;
    const emissiveMap = useMaps && def.emissive ? this.scaled(def.emissive(), def) : null;
    const common = {
      color: map ? (def.tint ? new Color().setRGB(...def.tint) : new Color('#ffffff')) : new Color(def.color),
      vertexColors: !!def.vertexColors,
      polygonOffset: def.polygonOffset !== undefined,
      polygonOffsetFactor: def.polygonOffset ?? 0,
      polygonOffsetUnits: def.polygonOffset ?? 0,
    };
    let m: Material;
    if (tier === 'pbr') {
      const normalMap = def.normal ? this.scaled(def.normal(), def) : null;
      m = new MeshStandardMaterial({
        ...common,
        map,
        normalMap,
        roughness: def.roughness ?? 0.9,
        metalness: 0,
        emissive: emissiveMap ? NIGHT_COLOR : new Color(0),
        emissiveMap,
        emissiveIntensity: 0,
      });
    } else {
      m = new MeshLambertMaterial({
        ...common,
        map,
        emissive: emissiveMap ? NIGHT_COLOR : new Color(0),
        emissiveMap,
        emissiveIntensity: 0,
      });
    }
    if (def.macro && map) addMacroVariation(m, def.size ?? [1, 1]);
    return m;
  }

  private readonly scaledCache = new Map<string, { src: Texture; tex: Texture; version: number }>();

  /** Clona a textura com a repetição em metros do material (UVs da geometria estão em metros). */
  private scaled(src: Texture, def: MatDef): Texture {
    const size = def.size ?? [1, 1];
    const k = `${src.uuid}:${size[0]}:${size[1]}:${def.offsetV ?? 0}`;
    let entry = this.scaledCache.get(k);
    if (!entry) {
      const tex = src.clone();
      tex.repeat.set(1 / size[0], 1 / size[1]);
      tex.offset.set(0, (def.offsetV ?? 0) / size[1]);
      tex.anisotropy = this.tier_ === 'pbr' ? this.anisotropy : 1;
      entry = { src, tex, version: -1 };
      this.scaledCache.set(k, entry);
    }
    return entry.tex;
  }

  /**
   * O clone compartilha a imagem, mas não a versão: quando o original termina de carregar
   * (ou o canvas é repintado), o clone precisa ser reenviado à GPU.
   */
  sync(): void {
    for (const e of this.scaledCache.values()) {
      if (e.src.version === e.version) continue;
      const img = e.src.image as { width?: number } | undefined;
      if (!img || !img.width) continue;
      e.version = e.src.version;
      e.tex.needsUpdate = true;
    }
  }
}
