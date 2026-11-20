import { describe, expect, it } from 'vitest';
import { AttemptLimiter } from '../src/auth';
import { isLocalNetworkAddress } from '../src/network';
import { SessionManager } from '../src/sessions';

describe('SessionManager', () => {
  it('cria sessões com código de 4 letras e PIN de 4 dígitos', () => {
    const sessions = new SessionManager(60_000);
    const s = sessions.create();
    expect(s.code).toMatch(/^[A-HJ-NP-Z]{4}$/);
    expect(s.pin).toMatch(/^\d{4}$/);
    expect(s.tvToken.length).toBeGreaterThan(20);
  });

  it('só aceita o controle com o PIN correto', () => {
    const sessions = new SessionManager(60_000);
    const s = sessions.create();
    const wrong = s.pin === '0000' ? '1111' : '0000';
    expect(sessions.verifyPin(s.code, wrong)).toBeUndefined();
    expect(sessions.verifyPin('ZZZZ', s.pin)).toBeUndefined();
    expect(sessions.verifyPin(s.code, s.pin)).toBe(s);
  });

  it('retoma a sessão da TV apenas com o token certo', () => {
    const sessions = new SessionManager(60_000);
    const s = sessions.create();
    expect(sessions.resume(s.code, 'token-errado')).toBeUndefined();
    expect(sessions.resume(s.code, s.tvToken)).toBe(s);
  });

  it('substitui o controle anterior e informa quem saiu', () => {
    const sessions = new SessionManager(60_000);
    const s = sessions.create();
    expect(sessions.attach(s, 'controller', 'phone-1')).toBeNull();
    expect(sessions.attach(s, 'controller', 'phone-2')).toBe('phone-1');
    expect(sessions.bindingOf('phone-1')).toBeUndefined();
    // Desconexão tardia do celular antigo não derruba o novo.
    sessions.detach('phone-1');
    expect(sessions.status(s).controllerConnected).toBe(true);
  });

  it('expira sessões vazias depois do TTL, mas mantém as ativas', () => {
    let now = 0;
    const sessions = new SessionManager(1000, () => now);
    const idle = sessions.create();
    const active = sessions.create();
    sessions.attach(active, 'tv', 'tv-1');

    now = 5000;
    expect(sessions.sweep()).toEqual([idle.code]);
    expect(sessions.get(active.code)).toBe(active);
  });
});

describe('AttemptLimiter', () => {
  it('bloqueia após muitas falhas e libera depois da janela', () => {
    let now = 0;
    const limiter = new AttemptLimiter(3, 1000, () => now);
    for (let i = 0; i < 3; i++) limiter.recordFailure('ip');
    expect(limiter.isBlocked('ip')).toBe(true);
    now = 1500;
    expect(limiter.isBlocked('ip')).toBe(false);
  });
});

describe('isLocalNetworkAddress', () => {
  it.each(['127.0.0.1', '::1', '::ffff:192.168.1.20', '10.0.0.5', '172.20.1.1', 'fe80::1', 'fd00::2'])(
    'aceita %s',
    (ip) => expect(isLocalNetworkAddress(ip)).toBe(true),
  );

  it.each(['8.8.8.8', '172.32.0.1', '::ffff:200.1.2.3', '2001:4860::8888', '', 'abc'])('rejeita %s', (ip) =>
    expect(isLocalNetworkAddress(ip)).toBe(false),
  );
});
