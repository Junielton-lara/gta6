/**
 * Converte o recorte OSM (osm-tiradentes.raw.json) em dados compactos para o jogo:
 *   apps/game/public/world/tiradentes.json
 *
 * Coordenadas em metros locais: x = leste, z = sul (−z = norte), origem no centro do bbox.
 * Dados © OpenStreetMap contributors, ODbL 1.0 — ver apps/game/public/ATTRIBUTION.txt.
 *
 * Uso: node tools/osm-import/bake.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');
const RAW = join(here, 'osm-tiradentes.raw.json');
const OUT = join(root, 'apps/game/public/world/tiradentes.json');

export const BBOX = { s: -25.4325, w: -49.276, n: -25.428, e: -49.269 };
export const ORIGIN = { lat: (BBOX.s + BBOX.n) / 2, lon: (BBOX.w + BBOX.e) / 2 };
const M_LAT = 110_540;
const M_LON = 110_540 * Math.cos((ORIGIN.lat * Math.PI) / 180);

const r1 = (v) => Math.round(v * 10) / 10;
const toLocal = (lon, lat) => [(lon - ORIGIN.lon) * M_LON, -(lat - ORIGIN.lat) * M_LAT];
const [X0, Z1] = toLocal(BBOX.w, BBOX.s);
const [X1, Z0] = toLocal(BBOX.e, BBOX.n);
const RECT = { x0: X0, x1: X1, z0: Z0, z1: Z1 };

const DRIVABLE = new Set([
  'primary', 'secondary', 'tertiary', 'tertiary_link', 'secondary_link',
  'residential', 'unclassified', 'service', 'living_street',
]);
const WALKABLE = new Set(['pedestrian', 'footway', 'path', 'steps']);

const DEFAULT_WIDTH = {
  primary: 12, secondary: 11, secondary_link: 6, tertiary: 9, tertiary_link: 6,
  residential: 7, unclassified: 7, living_street: 6, service: 4.5,
  pedestrian: 10, footway: 2.5, path: 2, steps: 3,
};

const raw = JSON.parse(readFileSync(RAW, 'utf8'));
const elements = raw.elements;

// ---------- helpers ----------

function parseMeters(v) {
  if (v == null) return null;
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function hash(n) {
  let x = n | 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967295;
}

function signedArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, z1] = ring[i];
    const [x2, z2] = ring[(i + 1) % ring.length];
    a += x1 * z2 - x2 * z1;
  }
  return a / 2;
}

function centroid(ring) {
  let x = 0, z = 0;
  for (const p of ring) { x += p[0]; z += p[1]; }
  return [x / ring.length, z / ring.length];
}

function inRect([x, z], pad = 0) {
  return x >= RECT.x0 - pad && x <= RECT.x1 + pad && z >= RECT.z0 - pad && z <= RECT.z1 + pad;
}

/** Remove fechamento duplicado e pontos colineares/duplicados; orienta (−dz, dx) para fora. */
function cleanRing(pts, outer = true) {
  const ring = [];
  for (const p of pts) {
    const last = ring[ring.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 0.05) ring.push(p);
  }
  if (ring.length > 1) {
    const a = ring[0], b = ring[ring.length - 1];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.05) ring.pop();
  }
  if (ring.length < 3) return null;
  const area = signedArea(ring);
  if (Math.abs(area) < 4) return null;
  if ((outer && area > 0) || (!outer && area < 0)) ring.reverse();
  return ring;
}

function flat(pts) {
  const out = [];
  for (const [x, z] of pts) out.push(r1(x), r1(z));
  return out;
}

/** Junta segmentos de membros de multipolígono em anéis fechados. */
function joinRings(ways) {
  const pool = ways.filter((w) => w.length >= 2).map((w) => w.slice());
  const rings = [];
  const same = (a, b) => Math.abs(a[0] - b[0]) < 1e-7 && Math.abs(a[1] - b[1]) < 1e-7;
  while (pool.length) {
    let cur = pool.shift();
    let guard = 0;
    while (!same(cur[0], cur[cur.length - 1]) && guard++ < 500) {
      const end = cur[cur.length - 1];
      const idx = pool.findIndex((w) => same(w[0], end) || same(w[w.length - 1], end));
      if (idx < 0) break;
      const next = pool.splice(idx, 1)[0];
      cur = cur.concat(same(next[0], end) ? next.slice(1) : next.reverse().slice(1));
    }
    if (same(cur[0], cur[cur.length - 1])) rings.push(cur);
  }
  return rings;
}

/** Liang–Barsky: recorta uma polilinha no retângulo, devolvendo os trechos internos. */
function clipPolyline(pts) {
  const parts = [];
  let cur = [];
  const flush = () => { if (cur.length >= 2) parts.push(cur); cur = []; };
  for (let i = 0; i < pts.length - 1; i++) {
    const seg = clipSegment(pts[i], pts[i + 1]);
    if (!seg) { flush(); continue; }
    const [a, b, aIn, bIn] = seg;
    if (!cur.length || !aIn) { flush(); cur.push(a); }
    cur.push(b);
    if (!bIn) flush();
  }
  flush();
  return parts;
}

function clipSegment(a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  let t0 = 0, t1 = 1;
  const p = [-dx, dx, -dz, dz];
  const q = [a[0] - RECT.x0, RECT.x1 - a[0], a[1] - RECT.z0, RECT.z1 - a[1]];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) { if (q[i] < 0) return null; continue; }
    const t = q[i] / p[i];
    if (p[i] < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return null;
  }
  return [
    [a[0] + dx * t0, a[1] + dz * t0],
    [a[0] + dx * t1, a[1] + dz * t1],
    t0 === 0,
    t1 === 1,
  ];
}

/** Sub-polilinha entre distâncias [d0, d1] ao longo do traçado. */
function subPolyline(pts, cum, d0, d1) {
  const out = [];
  const at = (d) => {
    for (let i = 0; i < pts.length - 1; i++) {
      if (d <= cum[i + 1] || i === pts.length - 2) {
        const t = (d - cum[i]) / Math.max(1e-6, cum[i + 1] - cum[i]);
        return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t];
      }
    }
    return pts[pts.length - 1];
  };
  out.push(at(d0));
  for (let i = 1; i < pts.length - 1; i++) if (cum[i] > d0 && cum[i] < d1) out.push(pts[i]);
  out.push(at(d1));
  return out;
}

function cumulative(pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  }
  return cum;
}

function roadWidth(t) {
  const w = parseMeters(t.width) ?? parseMeters(t['width:carriageway']);
  if (w) return Math.min(w, 24);
  const lanes = parseInt(t.lanes, 10);
  if (lanes > 0 && DRIVABLE.has(t.highway)) return Math.min(lanes * 3.2, 20);
  return DEFAULT_WIDTH[t.highway] ?? 6;
}

// ---------- vias ----------

const ways = elements.filter((e) => e.type === 'way' && e.geometry);

const nodeUse = new Map();
const nodeWidth = new Map();
for (const w of ways) {
  const hw = w.tags?.highway;
  if (!hw || !(DRIVABLE.has(hw) || hw === 'pedestrian')) continue;
  if (w.tags.area === 'yes') continue;
  const width = roadWidth(w.tags);
  for (const id of new Set(w.nodes)) {
    nodeUse.set(id, (nodeUse.get(id) ?? 0) + 1);
    nodeWidth.set(id, Math.max(nodeWidth.get(id) ?? 0, width));
  }
}

const roads = [];
const curbs = [];
const crossings = [];
const areas = [];

for (const w of ways) {
  const t = w.tags ?? {};
  const hw = t.highway;
  if (!hw) continue;
  if (t.area === 'yes' || t.indoor === 'yes' || hw === 'corridor' || hw === 'platform') continue;
  if (t.layer && parseInt(t.layer, 10) < 0) continue;
  if (!DRIVABLE.has(hw) && !WALKABLE.has(hw)) continue;
  if (hw === 'footway' && t.footway === 'sidewalk') continue;

  const pts = w.geometry.map((g) => toLocal(g.lon, g.lat));
  const width = roadWidth(t);

  if (hw === 'footway' && t.footway === 'crossing') {
    for (const part of clipPolyline(pts)) crossings.push({ id: w.id, pts: flat(part), width: 3 });
    continue;
  }

  const kind = DRIVABLE.has(hw) ? 'road' : hw === 'pedestrian' ? 'pedestrian' : 'path';
  for (const part of clipPolyline(pts)) {
    roads.push({
      id: w.id,
      name: t.name ?? '',
      hw,
      kind,
      width: r1(width),
      lanes: parseInt(t.lanes, 10) || (kind === 'road' ? (hw === 'service' ? 1 : 2) : 0),
      oneway: t.oneway === 'yes' || t.oneway === '-1' ? (t.oneway === '-1' ? -1 : 1) : 0,
      surface: t.surface ?? null,
      pts: flat(part),
    });
  }

  if (kind !== 'road') continue;

  // Meio-fio: trechos da via longe dos cruzamentos.
  const cum = cumulative(pts);
  const cuts = [];
  w.nodes.forEach((id, i) => {
    if ((nodeUse.get(id) ?? 0) >= 2) {
      const r = (nodeWidth.get(id) ?? width) / 2 + 1.5;
      cuts.push([cum[i] - r, cum[i] + r]);
    }
  });
  cuts.sort((a, b) => a[0] - b[0]);
  let start = 0;
  const spans = [];
  for (const [a, b] of cuts) {
    if (a > start) spans.push([start, a]);
    start = Math.max(start, b);
  }
  const total = cum[cum.length - 1];
  if (start < total) spans.push([start, total]);
  for (const [a, b] of spans) {
    if (b - a < 3) continue;
    for (const part of clipPolyline(subPolyline(pts, cum, a, b))) {
      curbs.push({ id: w.id, width: r1(width), lanes: parseInt(t.lanes, 10) || 2, oneway: !!t.oneway && t.oneway !== 'no', pts: flat(part) });
    }
  }
}

// ---------- áreas (praças, calçadões, parques) ----------

function areaKind(t) {
  if (t.highway === 'pedestrian' && t.area === 'yes') return 'pedestrian';
  if (t['area:highway']) return t['area:highway'] === 'pedestrian' || t['area:highway'] === 'footway' ? 'pedestrian' : 'road';
  if (t.leisure === 'park' || t.leisure === 'garden') return 'park';
  if (t.place === 'square') return 'square';
  return null;
}

for (const w of ways) {
  const t = w.tags ?? {};
  const kind = areaKind(t);
  if (!kind || t.building) continue;
  const ring = cleanRing(w.geometry.map((g) => toLocal(g.lon, g.lat)));
  if (!ring || !inRect(centroid(ring), 30)) continue;
  areas.push({ id: w.id, kind, name: t.name ?? '', ring: flat(ring) });
}
const AREA_ORDER = { square: 0, park: 1, pedestrian: 2, road: 3 };
areas.sort((a, b) => AREA_ORDER[a.kind] - AREA_ORDER[b.kind]);

// ---------- prédios ----------

const buildings = [];
let estimated = 0;

function buildingHeight(t, id) {
  const h = parseMeters(t.height) ?? parseMeters(t['building:height']);
  const minH = parseMeters(t.min_height) ?? 0;
  if (h) return { h, minH, est: false, levels: parseInt(t['building:levels'], 10) || Math.round(h / 3.2) };
  const levels = parseFloat(t['building:levels']);
  if (levels > 0) {
    const roofLv = parseFloat(t['roof:levels']) || 0;
    return { h: levels * 3.2 + roofLv * 2.4 + 0.8, minH, est: false, levels: Math.round(levels) };
  }
  // Sem dado no OSM: estimativa conservadora e determinística, marcada como estimada.
  estimated++;
  const b = t.building;
  if (b === 'roof') return { h: 4, minH: 0, est: true, levels: 1 };
  if (b === 'church' || b === 'cathedral') return { h: 16, minH: 0, est: true, levels: 1 };
  if (b === 'house') return { h: 7, minH: 0, est: true, levels: 2 };
  const lv = 2 + Math.floor(hash(id) * 4);
  return { h: lv * 3.2 + 0.8, minH: 0, est: true, levels: lv };
}

function pushBuilding(id, type, t, outerRings, innerRings) {
  if (t.building === 'no' || t.location === 'underground') return;
  if (t.layer && parseInt(t.layer, 10) < 0) return;
  for (const outer of outerRings) {
    const ring = cleanRing(outer.map((g) => toLocal(g.lon, g.lat)), true);
    if (!ring || !inRect(centroid(ring))) continue;
    const holes = innerRings
      .map((r) => cleanRing(r.map((g) => toLocal(g.lon, g.lat)), false))
      .filter(Boolean)
      .map(flat);
    const hh = buildingHeight(t, id);
    const entry = {
      id: `${type[0]}${id}`,
      kind: t.building,
      h: r1(hh.h),
      lv: hh.levels,
      ring: flat(ring),
    };
    if (hh.minH) entry.minH = r1(hh.minH);
    if (hh.est) entry.est = 1;
    if (holes.length) entry.holes = holes;
    if (t.name) entry.name = t.name;
    if (t.historic) entry.historic = t.historic;
    if (t['building:colour']) entry.color = t['building:colour'];
    if (t['roof:colour']) entry.roofColor = t['roof:colour'];
    if (t['building:material']) entry.material = t['building:material'];
    if (t.amenity) entry.amenity = t.amenity;
    buildings.push(entry);
  }
}

for (const w of ways) {
  const t = w.tags ?? {};
  if (!t.building) continue;
  pushBuilding(w.id, 'way', t, [w.geometry], []);
}
for (const rel of elements.filter((e) => e.type === 'relation' && e.tags?.building)) {
  const outers = joinRings(rel.members.filter((m) => m.role === 'outer' && m.geometry).map((m) => m.geometry.map((g) => [g.lon, g.lat])));
  const inners = joinRings(rel.members.filter((m) => m.role === 'inner' && m.geometry).map((m) => m.geometry.map((g) => [g.lon, g.lat])));
  const asGeo = (r) => r.map(([lon, lat]) => ({ lon, lat }));
  pushBuilding(rel.id, 'relation', rel.tags, outers.map(asGeo), inners.map(asGeo));
}

// ---------- pontos (árvores, semáforos, pontos de ônibus, marcos) ----------

const points = [];
const landmarks = [];
for (const e of elements) {
  const t = e.tags ?? {};
  if (e.type === 'node') {
    const p = toLocal(e.lon, e.lat);
    if (!inRect(p)) continue;
    let kind = null;
    if (t.natural === 'tree') kind = 'tree';
    else if (t.highway === 'traffic_signals') kind = 'signal';
    else if (t.highway === 'street_lamp') kind = 'lamp';
    else if (t.highway === 'bus_stop') kind = 'bus_stop';
    if (kind) points.push({ kind, x: r1(p[0]), z: r1(p[1]), ...(t.name ? { name: t.name } : {}) });
  }
  if (t.historic || t.name === 'Paço da Liberdade' || /^Catedral/.test(t.name ?? '') || t.place === 'square' || (t.highway === 'pedestrian' && t.area === 'yes' && t.name)) {
    let p = null;
    if (e.type === 'node') p = toLocal(e.lon, e.lat);
    else if (e.geometry) p = centroid(e.geometry.map((g) => toLocal(g.lon, g.lat)));
    else if (e.members) {
      const g = e.members.flatMap((m) => m.geometry ?? []);
      if (g.length) p = centroid(g.map((q) => toLocal(q.lon, q.lat)));
    }
    if (!p || !inRect(p) || !t.name) continue;
    const kind =
      t.building === 'church' || t.building === 'cathedral' || t.amenity === 'place_of_worship' ? 'church'
      : t.amenity === 'townhall' ? 'townhall'
      : t.place === 'square' || t.highway === 'pedestrian' ? 'square'
      : null;
    landmarks.push({ id: `${e.type[0]}${e.id}`, name: t.name, x: r1(p[0]), z: r1(p[1]), historic: t.historic ?? null, ...(kind ? { kind } : {}) });
  }
}

// ---------- estabelecimentos (POIs) ----------
// Consulta separada (query-tiradentes-pois.overpassql). Opcional: sem o arquivo, o mapa sai sem POIs.

const POI_RAW = join(here, 'osm-tiradentes-pois.raw.json');
let poiRaw = null;
try {
  poiRaw = JSON.parse(readFileSync(POI_RAW, 'utf8'));
} catch {
  console.warn('sem', POI_RAW, '— POIs ignorados');
}

function poiCategory(t) {
  const a = t.amenity, s = t.shop, tr = t.tourism;
  if (['restaurant', 'cafe', 'fast_food', 'bar', 'pub', 'ice_cream', 'food_court'].includes(a)) return 'food';
  if (s === 'bakery' || s === 'confectionery') return 'food';
  if (a === 'bank' || a === 'atm') return 'bank';
  if (a === 'pharmacy' || s === 'chemist') return 'pharmacy';
  if (tr === 'hotel') return 'hotel';
  if (['museum', 'gallery'].includes(tr) || ['library', 'theatre', 'arts_centre', 'cinema'].includes(a)) return 'culture';
  if (tr === 'artwork') return 'artwork';
  if (s) return 'shop';
  if (a === 'marketplace') return 'shop';
  if (t.office || ['post_office', 'clinic', 'police', 'townhall'].includes(a)) return 'service';
  return null;
}

/** Ponto mais próximo de (px, pz) no contorno; devolve também a normal para fora. */
function nearestOnRing(ring, px, pz) {
  let best = { d: Infinity, x: 0, z: 0, nx: 0, nz: 0 };
  for (let i = 0; i < ring.length; i++) {
    const [ax, az] = ring[i];
    const [bx, bz] = ring[(i + 1) % ring.length];
    const dx = bx - ax, dz = bz - az;
    const len2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2));
    const x = ax + dx * t, z = az + dz * t;
    const d = Math.hypot(px - x, pz - z);
    if (d < best.d) {
      const len = Math.sqrt(len2);
      // anel externo com área ≤ 0 (cleanRing): normal para fora = (−dz, dx)
      best = { d, x, z, nx: -dz / len, nz: dx / len };
    }
  }
  return best;
}

function insideRing(ring, x, z) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

const unflat = (f) => {
  const r = [];
  for (let i = 0; i < f.length; i += 2) r.push([f[i], f[i + 1]]);
  return r;
};
const buildingRings = buildings.map((b) => ({ id: b.id, ring: unflat(b.ring) }));
const walkPolylines = roads.map((r) => unflat(r.pts));

function nearestRoadPoint(px, pz) {
  let best = { d: Infinity, x: px, z: pz };
  for (const pl of walkPolylines) {
    for (let i = 0; i + 1 < pl.length; i++) {
      const [ax, az] = pl[i];
      const [bx, bz] = pl[i + 1];
      const dx = bx - ax, dz = bz - az;
      const len2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2));
      const x = ax + dx * t, z = az + dz * t;
      const d = Math.hypot(px - x, pz - z);
      if (d < best.d) best = { d, x, z };
    }
  }
  return best;
}

const pois = [];
if (poiRaw) {
  const pos = (e) => (e.type === 'node' ? toLocal(e.lon, e.lat) : e.center ? toLocal(e.center.lon, e.center.lat) : null);
  const entrances = poiRaw.elements
    .filter((e) => e.type === 'node' && e.tags?.entrance && !poiCategory(e.tags))
    .map((e) => toLocal(e.lon, e.lat));
  const seen = new Set();
  for (const e of poiRaw.elements) {
    const t = e.tags ?? {};
    const cat = poiCategory(t);
    if (!cat) continue;
    const p = pos(e);
    if (!p || !inRect(p)) continue;
    const key = `${t.name ?? ''}|${Math.round(p[0])}|${Math.round(p[1])}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const entry = {
      id: `${e.type[0]}${e.id}`,
      cat,
      kind: t.shop ?? t.amenity ?? t.tourism ?? t.office ?? 'yes',
      ...(t.name ? { name: t.name } : {}),
      ...(t.opening_hours ? { hours: t.opening_hours } : {}),
      ...(t.cuisine ? { cuisine: t.cuisine } : {}),
      ...(t.artist_name ? { artist: t.artist_name } : {}),
      x: r1(p[0]),
      z: r1(p[1]),
    };

    // Prédio que contém o ponto (ou o mais próximo a até 12 m) define a porta.
    let host = buildingRings.find((b) => insideRing(b.ring, p[0], p[1]));
    if (!host && cat !== 'artwork') {
      let bestD = 12;
      for (const b of buildingRings) {
        const n = nearestOnRing(b.ring, p[0], p[1]);
        if (n.d < bestD) (bestD = n.d), (host = b);
      }
    }
    if (host && cat !== 'artwork') {
      entry.b = host.id;
      const mapped = entrances.find((q) => nearestOnRing(host.ring, q[0], q[1]).d < 1.5 && Math.hypot(q[0] - p[0], q[1] - p[1]) < 40);
      let door;
      if (mapped) door = nearestOnRing(host.ring, mapped[0], mapped[1]);
      else {
        // Sem entrada mapeada: fachada mais próxima da rua (estimativa marcada).
        const road = nearestRoadPoint(p[0], p[1]);
        door = nearestOnRing(host.ring, road.x, road.z);
        entry.doorEst = 1;
      }
      entry.x = r1(door.x);
      entry.z = r1(door.z);
      entry.nx = Math.round(door.nx * 100) / 100;
      entry.nz = Math.round(door.nz * 100) / 100;
    }
    pois.push(entry);
  }
}

// ---------- saída ----------

const out = {
  meta: {
    name: 'Praça Tiradentes · Rua XV · Paço da Liberdade (Curitiba)',
    source: 'OpenStreetMap via Overpass API',
    license: 'ODbL 1.0',
    attribution: '© OpenStreetMap contributors',
    osmTimestamp: raw.osm3s?.timestamp_osm_base ?? null,
    poiTimestamp: poiRaw?.osm3s?.timestamp_osm_base ?? null,
    bbox: BBOX,
    origin: ORIGIN,
    bounds: { minX: r1(RECT.x0), maxX: r1(RECT.x1), minZ: r1(RECT.z0), maxZ: r1(RECT.z1) },
    counts: {
      roads: roads.length,
      curbs: curbs.length,
      crossings: crossings.length,
      areas: areas.length,
      buildings: buildings.length,
      buildingsHeightEstimated: estimated,
      points: points.length,
      landmarks: landmarks.length,
      pois: pois.length,
      poisDoorEstimated: pois.filter((p) => p.doorEst).length,
    },
  },
  roads,
  curbs,
  crossings,
  areas,
  buildings,
  points,
  landmarks,
  pois,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out));
console.log(`OK -> ${OUT}`);
console.log(out.meta.counts);
console.log(`${(JSON.stringify(out).length / 1024).toFixed(0)} KB`);
console.log('landmarks:', landmarks.map((l) => `${l.name} (${l.x}, ${l.z})`).join(' | '));
