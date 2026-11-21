/**
 * Buzina sintetizada (WebAudio, sem arquivo de som): duas ondas quadradas desafinadas
 * passando por um filtro, como buzinas elétricas de carro popular.
 *
 * Navegadores só liberam áudio depois de um gesto na própria página da TV; o input
 * remoto do celular não conta. `blocked` avisa quando o som ainda está travado.
 */
export class Horn {
  private ctx: AudioContext | null = null;
  private voice: { oscs: OscillatorNode[]; gain: GainNode } | null = null;

  constructor() {
    const unlock = () => void this.context()?.resume().catch(() => {});
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  get blocked(): boolean {
    const ctx = this.context();
    return !ctx || ctx.state !== 'running';
  }

  set(on: boolean): void {
    if (on === !!this.voice) return;
    const ctx = this.context();
    if (!ctx) return;
    if (on) {
      void ctx.resume().catch(() => {});
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.16, ctx.currentTime + 0.02);
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 1800;
      filter.connect(gain).connect(ctx.destination);
      const oscs = [392, 494].map((f) => {
        const o = ctx.createOscillator();
        o.type = 'square';
        o.frequency.value = f;
        o.connect(filter);
        o.start();
        return o;
      });
      this.voice = { oscs, gain };
    } else {
      const { oscs, gain } = this.voice!;
      this.voice = null;
      const t = ctx.currentTime;
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(gain.gain.value, t);
      gain.gain.linearRampToValueAtTime(0, t + 0.06);
      for (const o of oscs) o.stop(t + 0.08);
    }
  }

  private context(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    try {
      this.ctx = new Ctor();
    } catch {
      return null;
    }
    return this.ctx;
  }
}
