/** Formato gerado por tools/osm-import/bake.mjs. Arrays `pts`/`ring` são [x0, z0, x1, z1, ...] em metros. */

export interface MapRoad {
  id: number;
  name: string;
  hw: string;
  kind: 'road' | 'pedestrian' | 'path';
  width: number;
  lanes: number;
  oneway: -1 | 0 | 1;
  surface: string | null;
  pts: number[];
}

export interface MapCurb {
  id: number;
  width: number;
  lanes: number;
  oneway: boolean;
  pts: number[];
}

export interface MapArea {
  id: number;
  kind: 'pedestrian' | 'park' | 'square' | 'road';
  name: string;
  ring: number[];
}

export interface MapBuilding {
  id: string;
  kind: string;
  h: number;
  minH?: number;
  lv: number;
  /** 1 quando a altura não existe no OSM e foi estimada no bake. */
  est?: 1;
  ring: number[];
  holes?: number[][];
  name?: string;
  historic?: string;
  color?: string;
  roofColor?: string;
  material?: string;
  amenity?: string;
}

export interface MapPoint {
  kind: 'tree' | 'signal' | 'lamp' | 'bus_stop';
  x: number;
  z: number;
  name?: string;
}

export interface MapLandmark {
  id: string;
  name: string;
  x: number;
  z: number;
  historic: string | null;
  kind?: 'church' | 'townhall' | 'square';
}

export type PoiCategory = 'food' | 'shop' | 'bank' | 'pharmacy' | 'hotel' | 'culture' | 'artwork' | 'service';

/** Estabelecimento/obra do OSM. Com prédio (`b`), x/z é a porta (estimada se `doorEst`). */
export interface MapPoi {
  id: string;
  cat: PoiCategory;
  kind: string;
  name?: string;
  hours?: string;
  cuisine?: string;
  artist?: string;
  x: number;
  z: number;
  b?: string;
  nx?: number;
  nz?: number;
  doorEst?: 1;
}

export interface MapData {
  meta: {
    name: string;
    source: string;
    license: string;
    attribution: string;
    osmTimestamp: string | null;
    poiTimestamp?: string | null;
    bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
    counts: Record<string, number>;
  };
  roads: MapRoad[];
  curbs: MapCurb[];
  crossings: { id: number; pts: number[]; width: number }[];
  areas: MapArea[];
  buildings: MapBuilding[];
  points: MapPoint[];
  landmarks: MapLandmark[];
  pois?: MapPoi[];
}

export type Vec2 = { x: number; z: number };

export function toPoints(flat: number[]): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < flat.length; i += 2) out.push({ x: flat[i]!, z: flat[i + 1]! });
  return out;
}

export async function loadMapData(): Promise<MapData> {
  const res = await fetch(`${import.meta.env.BASE_URL}world/tiradentes.json`);
  if (!res.ok) throw new Error(`Mapa não encontrado (HTTP ${res.status})`);
  return (await res.json()) as MapData;
}
