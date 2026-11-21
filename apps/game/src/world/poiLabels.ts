import type { MapPoi, PoiCategory } from './mapData';

/** Tradução das tags do OSM para o jogador (shop=*, amenity=*, tourism=*, office=*). */
const KIND_PT: Record<string, string> = {
  restaurant: 'Restaurante',
  cafe: 'Café',
  fast_food: 'Lanchonete',
  bar: 'Bar',
  pub: 'Bar',
  ice_cream: 'Sorveteria',
  food_court: 'Praça de alimentação',
  bakery: 'Padaria',
  confectionery: 'Confeitaria',
  bank: 'Banco',
  atm: 'Caixa eletrônico',
  pharmacy: 'Farmácia',
  hotel: 'Hotel',
  museum: 'Museu',
  gallery: 'Galeria',
  library: 'Biblioteca',
  theatre: 'Teatro',
  arts_centre: 'Centro cultural',
  cinema: 'Cinema',
  artwork: 'Obra de arte',
  clothes: 'Loja de roupas',
  shoes: 'Loja de calçados',
  books: 'Livraria',
  newsagent: 'Banca de jornal',
  kiosk: 'Quiosque',
  florist: 'Floricultura',
  department_store: 'Loja de departamentos',
  mall: 'Galeria comercial',
  supermarket: 'Supermercado',
  convenience: 'Conveniência',
  optician: 'Ótica',
  electronics: 'Eletrônicos',
  mobile_phone: 'Celulares',
  perfumery: 'Perfumaria',
  jewelry: 'Joalheria',
  music: 'Loja de música',
  variety_store: 'Variedades',
  greengrocer: 'Hortifrúti',
  garden_centre: 'Jardinagem',
  marketplace: 'Mercado',
  post_office: 'Correios',
  clinic: 'Clínica',
  police: 'Polícia',
  townhall: 'Prefeitura',
  government: 'Órgão público',
  notary: 'Cartório',
  political_party: 'Partido político',
  research: 'Instituto de pesquisa',
};

export const CATEGORY_PT: Record<PoiCategory, string> = {
  food: 'Comida e bebida',
  shop: 'Loja',
  bank: 'Banco',
  pharmacy: 'Farmácia',
  hotel: 'Hotel',
  culture: 'Cultura',
  artwork: 'Obra de arte',
  service: 'Serviço',
};

export const CATEGORY_COLOR: Record<PoiCategory, string> = {
  food: '#ff9f43',
  shop: '#4dd2ff',
  bank: '#7bed9f',
  pharmacy: '#2ed573',
  hotel: '#a29bfe',
  culture: '#ffd166',
  artwork: '#ff6b81',
  service: '#c8d6e5',
};

export function kindLabel(poi: MapPoi): string {
  return KIND_PT[poi.kind] ?? CATEGORY_PT[poi.cat];
}

/** Nome do OSM ou, sem nome, o tipo ("Restaurante"). */
export function poiTitle(poi: MapPoi): string {
  return poi.name ?? kindLabel(poi);
}
