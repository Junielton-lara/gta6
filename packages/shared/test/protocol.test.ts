import { describe, expect, it } from 'vitest';
import { Button, isValidEvent, isValidInput, normalizeCode, normalizePin } from '../src';

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

  it('valida eventos de botão', () => {
    expect(isValidEvent({ type: 'action', pressed: true })).toBe(true);
    expect(isValidEvent({ type: 'button', button: 'Left', pressed: false })).toBe(true);
    expect(isValidEvent({ type: 'button', button: 'toString', pressed: false })).toBe(false);
    expect(isValidEvent({ type: 'action' })).toBe(false);
  });
});
