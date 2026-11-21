import { Color, type Fog, type Scene, Vector3 } from 'three';
import type { CityWorld } from '../world/CityWorld';
import type { Sky } from '../world/Sky';

interface Key {
  t: number;
  zenith: string;
  horizon: string;
  sun: string;
  cloud: string;
  sunI: number;
  hemiI: number;
}

/** Paleta ao longo do dia (t: 0 = meia-noite, 0.5 = meio-dia). */
const KEYS: Key[] = [
  { t: 0.0, zenith: '#060a18', horizon: '#18203a', sun: '#8fa6d8', cloud: '#2a3045', sunI: 0.18, hemiI: 0.22 },
  { t: 0.21, zenith: '#0e1630', horizon: '#3a3550', sun: '#8fa6d8', cloud: '#3b3a50', sunI: 0.2, hemiI: 0.25 },
  { t: 0.26, zenith: '#3a5a8c', horizon: '#f2a46a', sun: '#ffb070', cloud: '#f6c6a0', sunI: 1.0, hemiI: 0.5 },
  { t: 0.33, zenith: '#3f72b0', horizon: '#c6d8ea', sun: '#fff0d8', cloud: '#ffffff', sunI: 2.0, hemiI: 0.85 },
  { t: 0.5, zenith: '#2f68b0', horizon: '#c2d8ee', sun: '#fff6e8', cloud: '#ffffff', sunI: 2.4, hemiI: 0.95 },
  { t: 0.67, zenith: '#3f72b0', horizon: '#cfdbe6', sun: '#fff0d8', cloud: '#ffffff', sunI: 2.0, hemiI: 0.85 },
  { t: 0.74, zenith: '#34507e', horizon: '#ee9560', sun: '#ff9a5a', cloud: '#f0b088', sunI: 1.0, hemiI: 0.5 },
  { t: 0.79, zenith: '#0e1630', horizon: '#3a3550', sun: '#8fa6d8', cloud: '#3b3a50', sunI: 0.2, hemiI: 0.25 },
  { t: 1.0, zenith: '#060a18', horizon: '#18203a', sun: '#8fa6d8', cloud: '#2a3045', sunI: 0.18, hemiI: 0.22 },
];

const tmpA = new Color();
const tmpB = new Color();

/** Ciclo dia/noite (8 min por dia): sol, céu, neblina, janelas acesas e faróis. */
export class DayNight {
  time = 0.36;
  /** Reduz a luz hemisférica quando o mapa de ambiente do céu já ilumina a cena. */
  ambientScale = 1;
  private readonly dayLen = 480;
  private readonly zenith = new Color();
  private readonly horizon = new Color();
  private readonly sunColor = new Color();
  private readonly cloud = new Color();
  readonly sunDir = new Vector3();
  private elapsed = 0;

  constructor(
    private readonly scene: Scene,
    private readonly sky: Sky,
    private readonly world: CityWorld,
    private readonly fog: Fog | null,
  ) {}

  get isNight(): boolean {
    return this.time < 0.24 || this.time > 0.77;
  }

  /** 0 = dia pleno, 1 = noite. */
  get nightFactor(): number {
    const elev = Math.sin((this.time - 0.25) * Math.PI * 2);
    return Math.min(1, Math.max(0, (0.18 - elev) / 0.3));
  }

  update(dt: number): void {
    this.elapsed += dt;
    this.time = (this.time + dt / this.dayLen) % 1;
    const k = sample(this.time);
    this.zenith.copy(k.zenith);
    this.horizon.copy(k.horizon);
    this.sunColor.copy(k.sun);
    this.cloud.copy(k.cloud);

    // Sol nasce a leste (+x) e se põe a oeste; inclinação para o norte (−z), hemisfério sul.
    const ang = (this.time - 0.25) * Math.PI * 2;
    const elev = Math.sin(ang);
    const night = elev < -0.05;
    // À noite a luz direcional vira "lua": direção fixa alta, intensidade baixa.
    if (night) this.sunDir.set(-0.3, 0.85, -0.4).normalize();
    else this.sunDir.set(Math.cos(ang), Math.max(0.12, elev), -0.35).normalize();

    this.world.setSunDirection(this.sunDir);
    this.world.sun.color.copy(this.sunColor);
    this.world.sun.intensity = k.sunI;
    this.world.hemi.intensity = k.hemiI * this.ambientScale;
    this.world.hemi.color.copy(this.zenith).lerp(tmpA.set('#ffffff'), 0.55);
    this.world.setNight(this.nightFactor);

    const skySun = night ? tmpB.set('#000000') : this.sunColor;
    this.sky.setColors(this.zenith, this.horizon, skySun, this.cloud, this.sunDir);
    this.scene.background = this.horizon;
    if (this.fog) this.fog.color.copy(this.horizon);
  }

  get clock(): string {
    const minutes = Math.floor(this.time * 24 * 60);
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  }
}

function sample(t: number): { zenith: Color; horizon: Color; sun: Color; cloud: Color; sunI: number; hemiI: number } {
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1]!.t <= t) i++;
  const a = KEYS[i]!, b = KEYS[i + 1]!;
  const f = (t - a.t) / Math.max(1e-6, b.t - a.t);
  const mix = (x: string, y: string) => new Color(x).lerp(new Color(y), f);
  return {
    zenith: mix(a.zenith, b.zenith),
    horizon: mix(a.horizon, b.horizon),
    sun: mix(a.sun, b.sun),
    cloud: mix(a.cloud, b.cloud),
    sunI: a.sunI + (b.sunI - a.sunI) * f,
    hemiI: a.hemiI + (b.hemiI - a.hemiI) * f,
  };
}
