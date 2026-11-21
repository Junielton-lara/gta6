import type { MinimapData } from '../world/CityWorld';

interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** Mapa inteiro da região carregada (ruas do OSM), norte para cima. */
export class FullMap {
  private readonly el: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  isOpen = false;

  constructor(parent: HTMLElement, private readonly map: MinimapData, private readonly bounds: Bounds) {
    this.el = document.createElement('div');
    this.el.className = 'fullmap hidden';
    this.el.innerHTML = `
      <div class="fullmap-card">
        <header><strong>Mapa — Centro de Curitiba</strong><small>Touchpad ou M fecha · © OpenStreetMap contributors</small></header>
        <canvas width="1280" height="900"></canvas>
      </div>`;
    this.canvas = this.el.querySelector('canvas')!;
    this.ctx = this.canvas.getContext('2d')!;
    parent.appendChild(this.el);
  }

  private pois: { x: number; z: number; color: string }[] = [];

  setPois(pois: { x: number; z: number; color: string }[]): void {
    this.pois = pois;
  }

  toggle(): void {
    this.isOpen = !this.isOpen;
    this.el.classList.toggle('hidden', !this.isOpen);
  }

  close(): void {
    this.isOpen = false;
    this.el.classList.add('hidden');
  }

  draw(playerX: number, playerZ: number, yaw: number): void {
    if (!this.isOpen) return;
    const { ctx, canvas, bounds: b } = this;
    const pad = 40;
    const scale = Math.min((canvas.width - pad * 2) / (b.maxX - b.minX), (canvas.height - pad * 2) / (b.maxZ - b.minZ));
    const ox = (canvas.width - (b.maxX - b.minX) * scale) / 2;
    const oz = (canvas.height - (b.maxZ - b.minZ) * scale) / 2;
    const tx = (x: number) => ox + (x - b.minX) * scale;
    const tz = (z: number) => oz + (z - b.minZ) * scale;

    ctx.fillStyle = '#0d1418';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const pass of ['pedestrian', 'road'] as const) {
      for (const road of this.map.roads) {
        const isRoad = road.kind === 'road';
        if ((pass === 'road') !== isRoad || road.pts.length < 2) continue;
        ctx.strokeStyle = isRoad ? '#a9b6c1' : '#6d6a5c';
        ctx.lineWidth = Math.max(1.5, road.width * scale * (isRoad ? 0.8 : 0.5));
        ctx.beginPath();
        road.pts.forEach((p, i) => (i === 0 ? ctx.moveTo(tx(p.x), tz(p.z)) : ctx.lineTo(tx(p.x), tz(p.z))));
        ctx.stroke();
      }
    }

    for (const p of this.pois) {
      ctx.fillStyle = p.color;
      ctx.fillRect(tx(p.x) - 3, tz(p.z) - 3, 6, 6);
    }

    ctx.font = '600 15px system-ui, sans-serif';
    ctx.textAlign = 'left';
    for (const l of this.map.landmarks) {
      const x = tx(l.x);
      const y = tz(l.z);
      ctx.fillStyle = '#ffc24d';
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255, 240, 210, 0.92)';
      ctx.fillText(l.name, x + 8, y + 5);
    }

    ctx.save();
    ctx.translate(tx(playerX), tz(playerZ));
    ctx.rotate(-yaw);
    ctx.fillStyle = '#3de0ff';
    ctx.strokeStyle = '#04141a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -14);
    ctx.lineTo(10, 11);
    ctx.lineTo(-10, 11);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = '#ff5a6e';
    ctx.font = 'bold 20px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('N ↑', canvas.width - 50, 40);
  }
}
