/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL da API Socket.IO. Vazio = same-origin (dev local ou rewrite Vercel). */
  readonly VITE_SOCKET_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
