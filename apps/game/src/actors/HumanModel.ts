import {
  AnimationMixer,
  type AnimationAction,
  type AnimationClip,
  BoxGeometry,
  CapsuleGeometry,
  Group,
  Mesh,
  MeshLambertMaterial,
  type Object3D,
  SphereGeometry,
} from 'three';

export interface HumanPose {
  crouch: boolean;
  airborne: boolean;
  verticalV: number;
}

/** Interface comum entre o modelo glTF (Mixamo) e o boneco procedural de reserva. */
export interface HumanRig {
  root: Object3D;
  /** speed em m/s; run = correndo; pose = agachado/no ar (só o jogador usa) */
  animate(dt: number, speed: number, run: boolean, pose?: HumanPose): void;
}

export interface Palette {
  skin: string;
  shirt: string;
  pants: string;
  hair: string;
  shoes?: string;
}

// ---------------- boneco procedural articulado ----------------

interface Limb {
  pivot: Group;
  lower: Group;
}

const geoCache = new Map<string, BoxGeometry | CapsuleGeometry | SphereGeometry>();
function capsule(r: number, len: number): CapsuleGeometry {
  const k = `c${r}:${len}`;
  let g = geoCache.get(k) as CapsuleGeometry | undefined;
  if (!g) {
    g = new CapsuleGeometry(r, len, 3, 8);
    g.translate(0, -len / 2 - r, 0);
    geoCache.set(k, g);
  }
  return g;
}
function box(x: number, y: number, z: number): BoxGeometry {
  const k = `b${x}:${y}:${z}`;
  let g = geoCache.get(k) as BoxGeometry | undefined;
  if (!g) geoCache.set(k, (g = new BoxGeometry(x, y, z)));
  return g;
}
function sphere(r: number): SphereGeometry {
  const k = `s${r}`;
  let g = geoCache.get(k) as SphereGeometry | undefined;
  if (!g) geoCache.set(k, (g = new SphereGeometry(r, 12, 9)));
  return g;
}

const matCache = new Map<string, MeshLambertMaterial>();
function mat(color: string): MeshLambertMaterial {
  let m = matCache.get(color);
  if (!m) matCache.set(color, (m = new MeshLambertMaterial({ color })));
  return m;
}

/** Humanoide com quadril, joelhos, cotovelos e cabeça; animação de parado, andar e correr. */
export class ProceduralHuman implements HumanRig {
  readonly root = new Group();
  private readonly body = new Group();
  private readonly torso = new Group();
  private readonly head: Mesh;
  private readonly legs: [Limb, Limb];
  private readonly arms: [Limb, Limb];
  private phase = Math.random() * Math.PI * 2;
  private idleT = Math.random() * 10;
  private blendRun = 0;
  private blendMove = 0;
  private blendCrouch = 0;
  private blendAir = 0;

  constructor(p: Palette, scale = 1, castShadow = true) {
    const skin = mat(p.skin), shirt = mat(p.shirt), pants = mat(p.pants), hair = mat(p.hair), shoes = mat(p.shoes ?? '#222222');

    this.body.position.y = 0.98;
    this.root.add(this.body);

    const hips = new Mesh(box(0.34, 0.16, 0.2), pants);
    this.body.add(hips);

    this.torso.position.y = 0.08;
    this.body.add(this.torso);
    const chest = new Mesh(capsule(0.17, 0.3), shirt);
    chest.position.y = 0.55;
    chest.scale.set(1.05, 1, 0.68);
    this.torso.add(chest);
    const neck = new Mesh(capsule(0.05, 0.05), skin);
    neck.position.y = 0.66;
    this.torso.add(neck);
    this.head = new Mesh(sphere(0.115), skin);
    this.head.scale.set(0.9, 1.08, 1);
    this.head.position.y = 0.72;
    this.torso.add(this.head);
    const hairM = new Mesh(sphere(0.12), hair);
    hairM.scale.set(0.95, 0.8, 1.02);
    hairM.position.set(0, 0.04, 0.012);
    this.head.add(hairM);

    const mkLeg = (side: number): Limb => {
      const pivot = new Group();
      pivot.position.set(0.1 * side, -0.05, 0);
      const thigh = new Mesh(capsule(0.075, 0.3), pants);
      pivot.add(thigh);
      const lower = new Group();
      lower.position.y = -0.45;
      pivot.add(lower);
      const shin = new Mesh(capsule(0.06, 0.32), pants);
      lower.add(shin);
      const foot = new Mesh(box(0.1, 0.07, 0.24), shoes);
      foot.position.set(0, -0.47, -0.05);
      lower.add(foot);
      this.body.add(pivot);
      return { pivot, lower };
    };
    const mkArm = (side: number): Limb => {
      const pivot = new Group();
      pivot.position.set(0.21 * side, 0.58, 0);
      const upper = new Mesh(capsule(0.05, 0.22), shirt);
      pivot.add(upper);
      const lower = new Group();
      lower.position.y = -0.32;
      pivot.add(lower);
      const fore = new Mesh(capsule(0.042, 0.2), skin);
      lower.add(fore);
      this.torso.add(pivot);
      return { pivot, lower };
    };
    this.legs = [mkLeg(-1), mkLeg(1)];
    this.arms = [mkArm(-1), mkArm(1)];

    this.root.traverse((o) => {
      if ((o as Mesh).isMesh) o.castShadow = castShadow;
    });
    this.root.scale.setScalar(scale);
  }

  /**
   * Convenção dos eixos: frente = −Z, então rotação +X leva coxa/braço para a frente.
   * Joelho dobra com rotação −X (canela para trás) e cotovelo com +X (antebraço para a frente).
   */
  animate(dt: number, speed: number, run: boolean, pose?: HumanPose): void {
    const moving = speed > 0.25;
    const k = (rate: number) => Math.min(1, dt * rate);
    this.blendMove += ((moving ? 1 : 0) - this.blendMove) * k(8);
    // corrida proporcional à velocidade: trote fica no meio do caminho entre andar e correr
    const runTarget = moving ? Math.max(run ? 1 : 0, Math.min(1, Math.max(0, (speed - 2.2) / 4.2))) : 0;
    this.blendRun += (runTarget - this.blendRun) * k(6);
    this.blendCrouch += ((pose?.crouch ? 1 : 0) - this.blendCrouch) * k(9);
    this.blendAir += ((pose?.airborne ? 1 : 0) - this.blendAir) * k(12);
    const stride = 1.35 + this.blendRun * 0.9 - this.blendCrouch * 0.5;
    this.phase += (dt * speed * Math.PI) / stride;
    this.idleT += dt;

    const m = this.blendMove * (1 - this.blendAir), r = this.blendRun, c = this.blendCrouch, a = this.blendAir;
    const s = Math.sin(this.phase);
    const swing = (0.55 + r * 0.35 - c * 0.2) * m;
    for (let i = 0; i < 2; i++) {
      const sign = i === 0 ? 1 : -1;
      const legS = s * sign;
      const leg = this.legs[i]!, arm = this.arms[i]!;
      // joelho dobra na fase de recuperação (perna voltando para a frente)
      const recover = Math.max(0, Math.cos(this.phase + (i === 0 ? 0 : Math.PI)));
      leg.pivot.rotation.x = legS * swing + c * 1.15 + a * (0.9 - sign * 0.25);
      leg.lower.rotation.x = -(recover * (0.55 + r * 1.0) * m + c * 1.9 + a * (1.3 + sign * 0.3) + 0.05);
      arm.pivot.rotation.x = -legS * swing * (0.9 - c * 0.4) + c * 0.35 + a * 0.5;
      arm.pivot.rotation.z = sign * (0.08 + r * 0.05 + a * 0.5);
      arm.lower.rotation.x = (0.15 + r * 1.05) * m + 0.1 + c * 0.6 + a * 0.4;
    }
    const breathe = Math.sin(this.idleT * 1.7) * 0.012 * (1 - m);
    const bob = Math.abs(Math.cos(this.phase)) * 0.05 * m * (1 + r) - r * 0.05 * m;
    // agachado: coxa a 66° (0,45 m → 0,18 m na vertical) e canela a −43° (0,47 m → 0,34 m)
    this.body.position.y = 0.98 + bob * (1 - c * 0.6) - c * 0.4 - a * 0.08;
    this.torso.rotation.x = -(0.04 + r * 0.22) * m - c * 0.45 - a * 0.1;
    this.torso.scale.y = 1 + breathe;
    this.torso.rotation.y = s * 0.08 * m;
    this.head.rotation.x = c * 0.35;
    this.head.rotation.y = Math.sin(this.idleT * 0.4) * 0.25 * (1 - m);
  }
}

// ---------------- modelos glTF (Mixamo) opcionais ----------------

interface Manifest {
  player?: string;
  npcs?: string[];
  /** escala aplicada ao modelo (Mixamo costuma exportar em cm → 0.01) */
  scale?: number;
  /** nomes (ou trechos) dos clipes de animação dentro do GLB */
  clips?: Partial<Record<ClipKey, string>>;
}

type ClipKey = 'idle' | 'walk' | 'run' | 'crouchIdle' | 'crouchWalk' | 'jump';
const CLIP_FALLBACK_NAMES: Record<ClipKey, string> = {
  idle: 'idle',
  walk: 'walk',
  run: 'run',
  crouchIdle: 'crouch idle',
  crouchWalk: 'crouch walk',
  jump: 'jump',
};

interface LoadedModel {
  scene: Object3D;
  clips: AnimationClip[];
}

class GltfHuman implements HumanRig {
  readonly root: Object3D;
  private readonly mixer: AnimationMixer;
  private readonly actions: Partial<Record<ClipKey, AnimationAction>> = {};
  private current: AnimationAction | null = null;

  constructor(model: LoadedModel, clone: (o: Object3D) => Object3D, scale: number, names: Manifest['clips']) {
    const wrapper = new Group();
    const inner = clone(model.scene);
    inner.scale.setScalar(scale);
    inner.rotation.y = Math.PI; // Mixamo olha para +Z; o jogo usa −Z como frente
    inner.traverse((o) => {
      if ((o as Mesh).isMesh) {
        o.castShadow = true;
        o.frustumCulled = false;
      }
    });
    wrapper.add(inner);
    this.root = wrapper;
    this.mixer = new AnimationMixer(inner);
    const find = (want: string | undefined, fallback: string) => {
      const key = (want ?? fallback).toLowerCase();
      return model.clips.find((c) => c.name.toLowerCase().includes(key));
    };
    for (const k of Object.keys(CLIP_FALLBACK_NAMES) as ClipKey[]) {
      const clip = find(names?.[k], CLIP_FALLBACK_NAMES[k]);
      if (clip) this.actions[k] = this.mixer.clipAction(clip);
    }
    this.play(this.actions.idle ?? this.actions.walk);
  }

  private play(a: AnimationAction | undefined): void {
    if (!a || a === this.current) return;
    a.reset().fadeIn(0.25).play();
    this.current?.fadeOut(0.25);
    this.current = a;
  }

  /** Sem clipe de agachar/pular no GLB, usa o de parado/andar (o pacote define o que existe). */
  animate(dt: number, speed: number, run: boolean, pose?: HumanPose): void {
    const a = this.actions;
    if (pose?.airborne && a.jump) this.play(a.jump);
    else if (pose?.crouch && (a.crouchIdle || a.crouchWalk)) {
      if (speed < 0.25 || !a.crouchWalk) this.play(a.crouchIdle ?? a.crouchWalk);
      else {
        this.play(a.crouchWalk);
        a.crouchWalk.timeScale = Math.max(0.5, speed / 1.2);
      }
    } else if (speed < 0.25) this.play(this.actions.idle);
    else if ((run || speed > 3) && this.actions.run) {
      this.play(this.actions.run);
      this.actions.run.timeScale = Math.max(0.6, speed / 6);
    } else if (this.actions.walk) {
      this.play(this.actions.walk);
      this.actions.walk.timeScale = Math.max(0.5, speed / 1.6);
    }
    this.mixer.update(dt);
  }
}

const PALETTES: Palette[] = [
  { skin: '#e0b090', shirt: '#b5543a', pants: '#2b3a4a', hair: '#1a1a1a', shoes: '#3a2a20' },
  { skin: '#c68642', shirt: '#2a7d6f', pants: '#1d2f57', hair: '#2b1d10' },
  { skin: '#f1c27d', shirt: '#d8c9a8', pants: '#4a4a48', hair: '#5c4033', shoes: '#f0f0f0' },
  { skin: '#8d5524', shirt: '#7d93a8', pants: '#1b2b23', hair: '#0d0d0d' },
  { skin: '#ffdbac', shirt: '#2d2d2d', pants: '#6b5b45', hair: '#a0522d' },
  { skin: '#a8714a', shirt: '#9c2f4a', pants: '#262a33', hair: '#141414', shoes: '#ffffff' },
  { skin: '#e8b98f', shirt: '#3e5f8a', pants: '#c9bfa8', hair: '#3b2a1a' },
  { skin: '#6f4628', shirt: '#e3a33d', pants: '#22252b', hair: '#0a0a0a' },
];

/**
 * Cria personagens. Se existir `assets/characters/manifest.json` com GLBs (ex.: exportados do Mixamo),
 * usa os modelos com animação esquelética; senão, o boneco procedural.
 */
export class HumanFactory {
  private player: LoadedModel | null = null;
  private npcs: LoadedModel[] = [];
  private manifest: Manifest = {};
  private clone: ((o: Object3D) => Object3D) | null = null;

  get usingGltf(): boolean {
    return !!this.player || this.npcs.length > 0;
  }

  async init(): Promise<void> {
    const base = `${import.meta.env.BASE_URL}assets/characters/`;
    let manifest: Manifest;
    try {
      const res = await fetch(base + 'manifest.json');
      if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return;
      manifest = (await res.json()) as Manifest;
    } catch {
      return;
    }
    try {
      const [{ GLTFLoader }, SkeletonUtils] = await Promise.all([
        import('three/examples/jsm/loaders/GLTFLoader.js'),
        import('three/examples/jsm/utils/SkeletonUtils.js'),
      ]);
      const loader = new GLTFLoader();
      const load = async (file: string): Promise<LoadedModel | null> => {
        try {
          const g = await loader.loadAsync(base + file);
          return { scene: g.scene, clips: g.animations };
        } catch (err) {
          console.warn('[cow] falha ao carregar personagem', file, err);
          return null;
        }
      };
      this.manifest = manifest;
      this.clone = (o) => SkeletonUtils.clone(o);
      if (manifest.player) this.player = await load(manifest.player);
      for (const f of manifest.npcs ?? []) {
        const m = await load(f);
        if (m) this.npcs.push(m);
      }
      console.info('[cow] personagens glTF:', { player: !!this.player, npcs: this.npcs.length });
    } catch (err) {
      console.warn('[cow] loader glTF indisponível', err);
    }
  }

  createPlayer(): HumanRig {
    if (this.player && this.clone) return new GltfHuman(this.player, this.clone, this.manifest.scale ?? 1, this.manifest.clips);
    return new ProceduralHuman({ skin: '#d9a77c', shirt: '#2a6f97', pants: '#2c3e50', hair: '#3b2a1a', shoes: '#f2f2f2' });
  }

  createNpc(seed: number): HumanRig {
    if (this.npcs.length && this.clone) {
      const m = this.npcs[seed % this.npcs.length]!;
      return new GltfHuman(m, this.clone, this.manifest.scale ?? 1, this.manifest.clips);
    }
    const p = PALETTES[seed % PALETTES.length]!;
    // NPCs sem sombra projetada: cada peça custaria mais um draw call no passe de sombra
    return new ProceduralHuman(p, 0.94 + ((seed * 37) % 13) / 100, false);
  }
}
