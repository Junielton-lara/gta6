import { describe, expect, it } from 'vitest';
import { CollisionWorld, pointInPoly } from '../src/world/collision';
import type { Obstacle } from '../src/world/types';

// Prédio girado 45° (losango) — uma caixa alinhada aos eixos bloquearia a rua ao lado.
const diamond: Obstacle = {
  minX: -10,
  maxX: 10,
  minZ: -10,
  maxZ: 10,
  poly: new Float32Array([0, -10, 10, 0, 0, 10, -10, 0]),
};
const bounds = { minX: -100, maxX: 100, minZ: -100, maxZ: 100 };

describe('colisão por polígono', () => {
  it('detecta ponto dentro do contorno real', () => {
    expect(pointInPoly(diamond.poly, 0, 0)).toBe(true);
    expect(pointInPoly(diamond.poly, 8, 8)).toBe(false);
  });

  it('não bloqueia o canto livre do AABB', () => {
    const world = new CollisionWorld([diamond], bounds);
    const p = { x: 8, z: 8 };
    expect(world.resolveCircle(p, 0.4)).toBe(false);
    expect(p).toEqual({ x: 8, z: 8 });
  });

  it('empurra para fora quando o círculo entra no prédio', () => {
    const world = new CollisionWorld([diamond], bounds);
    const p = { x: 4, z: 4 };
    expect(world.resolveCircle(p, 0.4)).toBe(true);
    expect(pointInPoly(diamond.poly, p.x, p.z)).toBe(false);
    expect(p.x + p.z).toBeGreaterThan(10);
  });

  it('raycast para no primeiro prédio (câmera)', () => {
    const world = new CollisionWorld([diamond], bounds);
    expect(world.raycast(-30, 0, 30, 0)).toBeCloseTo(20 / 60, 3);
    expect(world.raycast(-30, 50, 30, 50)).toBe(1);
  });

  it('mantém dentro dos limites do recorte', () => {
    const world = new CollisionWorld([], bounds);
    const p = { x: 150, z: 0 };
    world.resolveCircle(p, 0.5);
    expect(p.x).toBeCloseTo(99.5);
  });
});
