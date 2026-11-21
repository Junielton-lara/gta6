/**
 * Baixa vias/edifícios OSM (Overpass) para o bbox Centro–Batel e grava JSON bruto.
 * Uso: node tools/osm-import/fetch.mjs
 * Requer rede. Se Overpass falhar, o bake em apps/game/src/data/ continua válido.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const bbox = '-25.4365,-49.2805,-25.4305,-49.2725';
const query = `
[out:json][timeout:90];
(
  way["highway"~"^(primary|secondary|tertiary|residential|unclassified|service)$"](${bbox});
  way["building"](${bbox});
);
out body geom;
`;

const outDir = dirname(fileURLToPath(import.meta.url));
const endpoints = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

let lastErr = '';
for (const url of endpoints) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'CuritibaOpenWorld/0.1 (local-dev)',
      },
      body: `data=${encodeURIComponent(query)}`,
    });
    if (!res.ok) {
      lastErr = `${url} → HTTP ${res.status}`;
      continue;
    }
    const text = await res.text();
    const path = join(outDir, 'osm-centro-batel.raw.json');
    writeFileSync(path, text);
    console.log(`OK ${path} (${text.length} bytes)`);
    process.exit(0);
  } catch (e) {
    lastErr = String(e);
  }
}
console.error('Overpass indisponível:', lastErr);
console.error('Mantendo bake TypeScript em apps/game/src/data/curitiba_centro_batel.ts');
process.exit(1);
