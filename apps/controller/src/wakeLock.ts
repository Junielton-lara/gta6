interface WakeLockSentinelLike {
  released: boolean;
  release(): Promise<void>;
  addEventListener(type: 'release', cb: () => void): void;
}

let sentinel: WakeLockSentinelLike | null = null;
let wanted = false;

/**
 * Mantém a tela do celular acesa enquanto o controle está em uso (Screen Wake Lock API).
 * O navegador solta o bloqueio quando a aba fica oculta; reaplicamos ao voltar.
 */
export function keepScreenOn(on: boolean): void {
  wanted = on;
  if (on) void acquire();
  else {
    void sentinel?.release().catch(() => {});
    sentinel = null;
  }
}

async function acquire(): Promise<void> {
  const wl = (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<WakeLockSentinelLike> } })
    .wakeLock;
  if (!wl || document.hidden || (sentinel && !sentinel.released)) return;
  try {
    sentinel = await wl.request('screen');
    sentinel.addEventListener('release', () => {
      sentinel = null;
    });
  } catch {
    /* sem suporte, sem HTTPS ou economia de bateria: segue sem bloqueio */
  }
}

document.addEventListener('visibilitychange', () => {
  if (wanted && !document.hidden) void acquire();
});
