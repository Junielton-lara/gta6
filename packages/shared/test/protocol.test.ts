import { describe, expect, it } from 'vitest';
import { Button, isValidEvent, isValidHints, isValidInput, isValidRumble, normalizeCode, normalizePin } from '../src';

describe('protocolo', () => {
  it('normaliza código e PIN digitados', () => {
    expect(normalizeCode(' ab-c d9z ')).toBe('ABCD');
    expect(normalizePin('12a3 45')).toBe('1234');
  });

  it('aceita input dentro dos limites', () => {
    expect(isValidInput({ x: 0.5, y: -1, buttons: Button.Up | Button.Action, seq: 3 })).toBe(true);
  });

  it('rejeita input malformado ou fora dos limites', () => {
    expect(isValidInput({ x: 2, y: 0, buttons: 0, seq: 0 })).toBe(false);
    expect(isValidInput({ x: Number.NaN, y: 0, buttons: 0, seq: 0 })).toBe(false);
    expect(isValidInput({ x: 0, y: 0, buttons: 1.5, seq: 0 })).toBe(false);
    expect(isValidInput({ x: 0, y: 0, buttons: 0 })).toBe(false);
    expect(isValidInput(null)).toBe(false);
  });

  it('aceita eixos de câmera opcionais e rejeita fora dos limites', () => {
    expect(isValidInput({ x: 0, y: 0, buttons: 0, seq: 1, cx: -0.4, cy: 1 })).toBe(true);
    expect(isValidInput({ x: 0, y: 0, buttons: 0, seq: 1, cx: 1.5 })).toBe(false);
    expect(isValidInput({ x: 0, y: 0, buttons: 0, seq: 1, cy: 'a' })).toBe(false);
  });

  it('aceita botões do layout moderno e valida dicas/vibração', () => {
    expect(isValidInput({ x: 0, y: 0, buttons: Button.R2 | Button.TouchPad, seq: 2 })).toBe(true);
    expect(isValidInput({ x: 0, y: 0, buttons: 1 << 24, seq: 2 })).toBe(false);
    expect(isValidEvent({ type: 'button', button: 'Triangle', pressed: true })).toBe(true);
    expect(isValidHints({ Cross: 'Pular', Triangle: 'Entrar' })).toBe(true);
    expect(isValidHints({ Cross: 'x'.repeat(40) })).toBe(false);
    expect(isValidHints({ Foo: 'a' })).toBe(false);
    expect(isValidHints(['Cross'])).toBe(false);
    expect(isValidRumble(80)).toBe(true);
    expect(isValidRumble(5000)).toBe(false);
  });

  it('valida eventos de botão', () => {
    expect(isValidEvent({ type: 'action', pressed: true })).toBe(true);
    expect(isValidEvent({ type: 'button', button: 'Left', pressed: false })).toBe(true);
    expect(isValidEvent({ type: 'button', button: 'toString', pressed: false })).toBe(false);
    expect(isValidEvent({ type: 'action' })).toBe(false);
  });
});
