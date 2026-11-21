import { Color, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, RingGeometry } from 'three';

/**
 * Anéis discretos no chão nas portas/obras (um único draw call) e um anel maior
 * pulsando no ponto que o □ vai acionar.
 */
export class PoiMarkers {
  readonly root = new Group();
  private readonly highlight: Mesh;
  private t = 0;

  constructor(points: { x: number; z: number; color: string }[]) {
    const geo = new RingGeometry(0.32, 0.42, 20);
    geo.rotateX(-Math.PI / 2);
    const mat = new MeshBasicMaterial({ transparent: true, opacity: 0.75, depthWrite: false });
    const inst = new InstancedMesh(geo, mat, Math.max(1, points.length));
    const m = new Matrix4();
    const c = new Color();
    points.forEach((p, i) => {
      m.makeTranslation(p.x, 0.08, p.z);
      inst.setMatrixAt(i, m);
      inst.setColorAt(i, c.set(p.color));
    });
    inst.count = points.length;
    inst.frustumCulled = false;
    this.root.add(inst);

    const hg = new RingGeometry(0.55, 0.75, 32);
    hg.rotateX(-Math.PI / 2);
    this.highlight = new Mesh(hg, new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, depthWrite: false }));
    this.highlight.visible = false;
    this.root.add(this.highlight);
  }

  update(dt: number, target: { x: number; z: number; color?: string } | null): void {
    this.t += dt;
    this.highlight.visible = !!target;
    if (!target) return;
    this.highlight.position.set(target.x, 0.09, target.z);
    const s = 1 + Math.sin(this.t * 5) * 0.12;
    this.highlight.scale.set(s, 1, s);
    (this.highlight.material as MeshBasicMaterial).color.set(target.color ?? '#ffffff');
  }
}
