export interface Interactable {
  id: string;
  x: number;
  z: number;
  /** distância máxima para aparecer o aviso (m) */
  radius: number;
  /** rótulo curto do botão no celular (até 16 letras) */
  verb: string;
  /** texto completo na TV, ex.: "Café do Paço" */
  title: string;
  /** cor do marcador no chão */
  color?: string;
  run(): void;
}

/**
 * Escolhe o ponto de interação mais relevante: perto e à frente do personagem.
 * Grade espacial simples porque são centenas de pontos e a consulta roda todo quadro.
 */
export class InteractionSystem {
  private readonly cells = new Map<string, Interactable[]>();
  private readonly extra: Interactable[] = [];
  private static readonly CELL = 20;

  add(item: Interactable): void {
    const key = this.key(item.x, item.z);
    let list = this.cells.get(key);
    if (!list) this.cells.set(key, (list = []));
    list.push(item);
  }

  /** Pontos temporários (ex.: porta de saída de um interior); limpos com clearTemporary(). */
  addTemporary(item: Interactable): void {
    this.extra.push(item);
  }

  clearTemporary(): void {
    this.extra.length = 0;
  }

  nearest(x: number, z: number, yaw: number, onlyTemporary = false): Interactable | null {
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    let best: Interactable | null = null;
    let bestScore = Infinity;
    const consider = (it: Interactable) => {
      const dx = it.x - x;
      const dz = it.z - z;
      const d = Math.hypot(dx, dz);
      if (d > it.radius) return;
      const facing = d > 0.01 ? (dx * fx + dz * fz) / d : 1;
      const score = d - facing * 0.9;
      if (score < bestScore) (bestScore = score), (best = it);
    };
    for (const it of this.extra) consider(it);
    if (!onlyTemporary) {
      const C = InteractionSystem.CELL;
      const cx = Math.floor(x / C);
      const cz = Math.floor(z / C);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) this.cells.get(`${cx + i},${cz + j}`)?.forEach(consider);
    }
    return best;
  }

  private key(x: number, z: number): string {
    const C = InteractionSystem.CELL;
    return `${Math.floor(x / C)},${Math.floor(z / C)}`;
  }
}
