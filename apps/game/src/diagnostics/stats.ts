import type { WebGLRenderer } from 'three';

export interface StatsSnapshot {
  fps: number;
  frameMs: number;
  worstFrameMs: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  /** MB de heap JS. Só existe em navegadores Chromium. */
  heapUsedMb: number | null;
  heapLimitMb: number | null;
}

interface ChromeMemory {
  usedJSHeapSize: number;
  jsHeapSizeLimit: number;
}

/** Acumula métricas por janela de tempo, sem custo perceptível por quadro. */
export class StatsMonitor {
  private frames = 0;
  private windowStart = performance.now();
  private worst = 0;
  private last: StatsSnapshot | null = null;

  constructor(
    private readonly renderer: WebGLRenderer,
    private readonly windowMs = 500,
  ) {}

  /** Chamar uma vez por quadro, após o render. Retorna um snapshot quando a janela fecha. */
  frame(frameMs: number): StatsSnapshot | null {
    this.frames++;
    if (frameMs > this.worst) this.worst = frameMs;

    const now = performance.now();
    const elapsed = now - this.windowStart;
    if (elapsed < this.windowMs) return null;

    const memory = (performance as Performance & { memory?: ChromeMemory }).memory;
    const { render, memory: gpu } = this.renderer.info;
    this.last = {
      fps: (this.frames * 1000) / elapsed,
      frameMs: elapsed / this.frames,
      worstFrameMs: this.worst,
      drawCalls: render.calls,
      triangles: render.triangles,
      geometries: gpu.geometries,
      textures: gpu.textures,
      heapUsedMb: memory ? memory.usedJSHeapSize / 1048576 : null,
      heapLimitMb: memory ? memory.jsHeapSizeLimit / 1048576 : null,
    };
    this.frames = 0;
    this.worst = 0;
    this.windowStart = now;
    return this.last;
  }

  get latest(): StatsSnapshot | null {
    return this.last;
  }
}
