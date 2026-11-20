/** Destino do Socket.IO. Vazio → same-origin (LAN ou rewrite da Vercel). */
export function socketUrl(): string | undefined {
  const raw = import.meta.env.VITE_SOCKET_URL?.trim();
  return raw ? raw.replace(/\/$/, '') : undefined;
}

/**
 * Opções do cliente Socket.IO.
 * A Vercel NÃO faz upgrade WebSocket em rewrites externos → só HTTP long-polling.
 */
export function socketClientOptions() {
  const url = socketUrl();
  const host = typeof location !== 'undefined' ? location.hostname : '';
  // Só na Vercel: rewrites HTTP funcionam; WSS não.
  const viaVercelRewrite = !url && host.endsWith('.vercel.app');

  return {
    path: '/socket.io',
    // Polling primeiro (e sem upgrade) atrás do rewrite da Vercel.
    transports: viaVercelRewrite ? (['polling'] as const) : (['websocket', 'polling'] as const),
    upgrade: !viaVercelRewrite,
    reconnection: true,
    timeout: 8000,
  };
}
