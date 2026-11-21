export interface Obstacle {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** Contorno real do prédio em planta: [x0, z0, x1, z1, ...]. */
  poly: Float32Array;
  index?: number;
}

export interface RoadPath {
  id: number;
  name: string;
  /** Pontos em metros locais (x, z). */
  points: { x: number; z: number }[];
  width: number;
  lanes: number;
  oneway: -1 | 0 | 1;
}

export type MaterialTier = 'pbr' | 'lambert' | 'flat';

export interface WorldBudget {
  maxNpcs: number;
  maxVehicles: number;
  shadows: boolean;
  shadowMapSize: number;
  /** Raio (m) em que blocos do mapa ficam carregados. */
  viewRadius: number;
  /** Raio (m) com fachadas detalhadas e mobiliário; além disso, versão simplificada. */
  detailRadius: number;
  materialTier: MaterialTier;
}
