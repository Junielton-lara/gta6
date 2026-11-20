/** Destino do Socket.IO. Vazio → same-origin (LAN ou rewrite da Vercel). */
export function socketUrl(): string | undefined {
  const raw = import.meta.env.VITE_SOCKET_URL?.trim();
  return raw ? raw.replace(/\/$/, '') : undefined;
}
