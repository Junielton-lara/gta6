/**
 * Monta dist-web/ para a Vercel:
 *   /           → landing
 *   /tv/        → apps/game/dist
 *   /controller/→ apps/controller/dist
 */
import { cpSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist-web');
const gameDist = join(root, 'apps/game/dist');
const controllerDist = join(root, 'apps/controller/dist');

for (const dist of [gameDist, controllerDist]) {
  if (!existsSync(dist)) {
    console.error(`Build ausente: ${dist}. Rode "npm run build" antes.`);
    process.exit(1);
  }
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(gameDist, join(out, 'tv'), { recursive: true });
cpSync(controllerDist, join(out, 'controller'), { recursive: true });

writeFileSync(
  join(out, 'index.html'),
  `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#0b0614">
<title>Vice City Online</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center;
    font-family: system-ui, sans-serif; background: #0b0614; color: #f4ecff; }
  main { text-align: center; padding: 24px; }
  h1 { font-size: clamp(28px, 6vw, 56px); margin: 0 0 8px;
    background: linear-gradient(90deg, #ff4fa3, #ffb36b, #3de0ff);
    -webkit-background-clip: text; background-clip: text; color: transparent; }
  p { opacity: .7; margin: 0 0 32px; }
  nav { display: flex; gap: 16px; justify-content: center; flex-wrap: wrap; }
  a { display: block; padding: 20px 36px; border-radius: 16px; font-size: 22px; font-weight: 700;
    color: #fff; text-decoration: none; background: #1c1230; border: 2px solid #3a2560; }
  a:focus, a:hover { outline: none; border-color: #ff4fa3; box-shadow: 0 0 0 4px #ff4fa355; }
</style>
</head>
<body>
<main>
  <h1>Vice City Online</h1>
  <p>Escolha o aparelho</p>
  <nav>
    <a href="/tv/" autofocus>Abrir na TV</a>
    <a href="/controller/">Abrir controle</a>
  </nav>
</main>
</body>
</html>
`,
);

console.log('dist-web pronto para a Vercel.');
