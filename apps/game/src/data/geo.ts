/**
 * Conversão WGS84 → metros locais. Precisa bater com tools/osm-import/bake.mjs:
 * origem no centro do recorte Praça Tiradentes / Rua XV / Paço da Liberdade.
 */

export const ORIGIN_LAT = (-25.4325 + -25.428) / 2;
export const ORIGIN_LON = (-49.276 + -49.269) / 2;
const METERS_PER_DEG_LAT = 110_540;
const METERS_PER_DEG_LON = 110_540 * Math.cos((ORIGIN_LAT * Math.PI) / 180);

/** x = leste, z = sul (−z = norte). */
export function lonLatToLocal(lon: number, lat: number): { x: number; z: number } {
  return {
    x: (lon - ORIGIN_LON) * METERS_PER_DEG_LON,
    z: -(lat - ORIGIN_LAT) * METERS_PER_DEG_LAT,
  };
}

export function localToLonLat(x: number, z: number): { lon: number; lat: number } {
  return {
    lon: ORIGIN_LON + x / METERS_PER_DEG_LON,
    lat: ORIGIN_LAT - z / METERS_PER_DEG_LAT,
  };
}
