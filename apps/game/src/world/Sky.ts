import {
  BackSide,
  Color,
  Mesh,
  PMREMGenerator,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  type Texture,
  Vector3,
  type WebGLRenderTarget,
  type WebGLRenderer,
} from 'three';

const RADIUS = 360;

/**
 * Céu leve para TV: degradê zênite/horizonte, disco do sol e nuvens por ruído de valor
 * (desligáveis nos níveis baixos). Segue a câmera; não grava profundidade.
 */
export class Sky {
  readonly mesh: Mesh;
  private readonly material: ShaderMaterial;

  constructor() {
    this.material = new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      fog: false,
      defines: { CLOUDS: 1 },
      uniforms: {
        zenith: { value: new Color('#3d6fa8') },
        horizon: { value: new Color('#bcd2e6') },
        ground: { value: new Color('#8a8f92') },
        sunDir: { value: new Vector3(0.3, 0.8, 0.2).normalize() },
        sunColor: { value: new Color('#fff1d0') },
        cloudColor: { value: new Color('#ffffff') },
        cloudCover: { value: 0.45 },
        time: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
        }
      `,
      fragmentShader: /* glsl */ `
        precision mediump float;
        uniform vec3 zenith;
        uniform vec3 horizon;
        uniform vec3 ground;
        uniform vec3 sunDir;
        uniform vec3 sunColor;
        uniform vec3 cloudColor;
        uniform float cloudCover;
        uniform float time;
        varying vec3 vDir;

        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
                     mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
        }

        void main() {
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 col = h > 0.0 ? mix(horizon, zenith, pow(h, 0.55)) : mix(horizon, ground, min(1.0, -h * 4.0));
          float s = max(dot(d, normalize(sunDir)), 0.0);
          col += sunColor * (pow(s, 900.0) * 6.0 + pow(s, 12.0) * 0.25);
          #if CLOUDS == 1
          if (h > 0.02) {
            vec2 uv = d.xz / (h + 0.12) * 1.6 + vec2(time * 0.006, time * 0.002);
            float n = noise(uv) * 0.55 + noise(uv * 2.3) * 0.3 + noise(uv * 5.1) * 0.15;
            float c = smoothstep(1.0 - cloudCover, 1.0 - cloudCover + 0.28, n) * smoothstep(0.02, 0.25, h);
            vec3 cc = cloudColor * (0.82 + 0.18 * n) + sunColor * pow(s, 6.0) * 0.25;
            col = mix(col, cc, c * 0.9);
          }
          #endif
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }
      `,
    });
    this.mesh = new Mesh(new SphereGeometry(RADIUS, 24, 12), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
    this.mesh.name = 'sky';
  }

  setClouds(on: boolean): void {
    const v = on ? 1 : 0;
    if (this.material.defines.CLOUDS === v) return;
    this.material.defines.CLOUDS = v;
    this.material.needsUpdate = true;
  }

  update(cameraPos: Vector3, time: number): void {
    this.mesh.position.copy(cameraPos);
    this.material.uniforms.time!.value = time;
  }

  /** Mapa de ambiente (reflexo e luz difusa do céu) para materiais PBR. */
  createEnvironment(renderer: WebGLRenderer): SkyEnvironment {
    return new SkyEnvironment(renderer, this.mesh);
  }

  setColors(zenith: Color, horizon: Color, sunColor: Color, cloudColor: Color, sunDir: Vector3): void {
    const u = this.material.uniforms;
    (u.zenith!.value as Color).copy(zenith);
    (u.horizon!.value as Color).copy(horizon);
    (u.ground!.value as Color).copy(horizon).multiplyScalar(0.7);
    (u.sunColor!.value as Color).copy(sunColor);
    (u.cloudColor!.value as Color).copy(cloudColor);
    (u.sunDir!.value as Vector3).copy(sunDir);
  }
}

/** Renderiza o céu num cubemap filtrado (PMREM); caro demais para todo quadro, então é periódico. */
export class SkyEnvironment {
  private readonly pmrem: PMREMGenerator;
  private readonly scene = new Scene();
  private target: WebGLRenderTarget | null = null;

  constructor(renderer: WebGLRenderer, sky: Mesh) {
    this.pmrem = new PMREMGenerator(renderer);
    const copy = new Mesh(sky.geometry, sky.material);
    copy.frustumCulled = false;
    this.scene.add(copy);
  }

  get texture(): Texture | null {
    return this.target?.texture ?? null;
  }

  update(): Texture {
    const next = this.pmrem.fromScene(this.scene, 0, 1, 1000);
    this.target?.dispose();
    this.target = next;
    return next.texture;
  }

  dispose(): void {
    this.target?.dispose();
    this.target = null;
    this.pmrem.dispose();
  }
}
