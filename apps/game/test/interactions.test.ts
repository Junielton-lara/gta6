import { describe, expect, it } from 'vitest';
import { InteractionSystem, type Interactable } from '../src/systems/Interactions';

const item = (id: string, x: number, z: number, radius = 3): Interactable => ({
  id,
  x,
  z,
  radius,
  verb: 'Entrar',
  title: id,
  run: () => {},
});

describe('interações', () => {
  it('ignora pontos fora do raio', () => {
    const s = new InteractionSystem();
    s.add(item('longe', 10, 0));
    expect(s.nearest(0, 0, 0)).toBeNull();
  });

  it('prefere o ponto à frente do personagem', () => {
    const s = new InteractionSystem();
    // yaw 0 olha para −Z
    s.add(item('frente', 0, -2));
    s.add(item('atras', 0, 1.6));
    expect(s.nearest(0, 0, 0)?.id).toBe('frente');
    expect(s.nearest(0, 0, Math.PI)?.id).toBe('atras');
  });

  it('acha pontos em células vizinhas da grade', () => {
    const s = new InteractionSystem();
    s.add(item('vizinho', 20.5, 0));
    expect(s.nearest(19.5, 0, -Math.PI / 2)?.id).toBe('vizinho');
  });

  it('dentro de interior considera só os pontos temporários', () => {
    const s = new InteractionSystem();
    s.add(item('rua', 0, -1));
    s.addTemporary(item('saida', 0, 1));
    expect(s.nearest(0, 0, 0, true)?.id).toBe('saida');
    s.clearTemporary();
    expect(s.nearest(0, 0, 0, true)).toBeNull();
  });
});
