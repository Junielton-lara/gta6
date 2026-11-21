import { Group } from 'three';
import { describe, expect, it } from 'vitest';
import { Character } from '../src/actors/Character';
import type { HumanPose, HumanRig } from '../src/actors/HumanModel';
import { CollisionWorld } from '../src/world/collision';

const world = new CollisionWorld([], { minX: -1000, maxX: 1000, minZ: -1000, maxZ: 1000 });

function make() {
  const poses: (HumanPose | undefined)[] = [];
  const rig: HumanRig = { root: new Group(), animate: (_dt, _s, _r, pose) => void poses.push(pose) };
  return { ch: new Character(rig), poses };
}

/** Simula `seconds` a 60 FPS empurrando o stick para a frente com a intensidade dada. */
function run(ch: Character, seconds: number, mag: number, sprint = false) {
  for (let t = 0; t < seconds; t += 1 / 60) ch.update(1 / 60, 0, mag, sprint, 0, world);
}

describe('personagem', () => {
  it('stick leve anda, stick cheio trota, ○ corre', () => {
    const { ch } = make();
    run(ch, 2, 0.3);
    expect(ch.gait).toBe('walk');
    expect(ch.speed).toBeLessThan(2);
    run(ch, 2, 1);
    expect(ch.gait).toBe('jog');
    expect(ch.speed).toBeGreaterThan(3);
    expect(ch.speed).toBeLessThan(4);
    run(ch, 2, 1, true);
    expect(ch.gait).toBe('sprint');
    expect(ch.speed).toBeGreaterThan(6);
  });

  it('correr gasta fôlego; sem fôlego volta a trotar até recuperar', () => {
    const { ch } = make();
    let t = 0;
    while (!ch.isExhausted && t < 20) {
      ch.update(1 / 60, 0, 1, true, 0, world);
      t += 1 / 60;
    }
    // ~9 s de corrida contínua
    expect(t).toBeGreaterThan(8);
    expect(t).toBeLessThan(11);
    expect(ch.stamina).toBe(0);
    run(ch, 0.5, 1, true);
    expect(ch.gait).toBe('jog');
    run(ch, 3, 0);
    expect(ch.isExhausted).toBe(false);
    expect(ch.stamina).toBeGreaterThan(0.3);
  });

  it('agachado anda devagar, pulo só levanta e correr levanta', () => {
    const { ch, poses } = make();
    ch.toggleCrouch();
    run(ch, 2, 1);
    expect(ch.gait).toBe('crouch');
    expect(ch.speed).toBeLessThan(1.5);
    expect(poses.at(-1)?.crouch).toBe(true);

    ch.jump();
    expect(ch.crouched).toBe(false);
    expect(ch.airborne).toBe(false);

    ch.toggleCrouch();
    run(ch, 0.2, 1, true);
    expect(ch.crouched).toBe(false);
  });

  it('pulo sai do chão, mantém o embalo e pousa', () => {
    const { ch, poses } = make();
    run(ch, 2, 1);
    const before = ch.speed;
    ch.jump();
    run(ch, 0.2, 0);
    expect(ch.airborne).toBe(true);
    expect(poses.at(-1)?.airborne).toBe(true);
    expect(ch.speed).toBeGreaterThan(before * 0.6);
    run(ch, 1, 0);
    expect(ch.airborne).toBe(false);
  });
});
