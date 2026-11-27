export type ResourceId = 'crystal' | 'scrap' | 'fiber' | 'relic';

export interface ResourceDefinition {
  id: ResourceId;
  name: string;
  description: string;
  baseValue: number;
  color: string;
}

export const CURRENCY_NAME = 'Créditos';
export const INVENTORY_CAPACITY = 40;

export const MAX_FUEL = 100;
export const MAX_HULL = 100;
export const FUEL_BURN_THRUST_PER_SEC = 0.35;
export const FUEL_BURN_BOOST_PER_SEC = 1.4;
export const RESERVE_THRUST_FACTOR = 0.15;

export const CRYSTAL_FUEL_REFILL = 25;
export const SCRAP_HULL_REPAIR = 15;

export const IMPACT_MIN_SPEED = 12;
export const IMPACT_DAMAGE_SCALE = 1.6;
export const IMPACT_MAX_DAMAGE = 40;
export const HULL_FAILURE_RESTORE = 25;

export const POI_COLLECT_DURATION_SEC = 1.2;
export const FLORA_COLLECT_DURATION_SEC = 0.35;
export const POI_INTERACT_RADIUS = 2.5;
export const FLORA_INTERACT_RADIUS = 1.8;
export const POI_RESPAWN_SECONDS = 600;

export const RESOURCES: Record<ResourceId, ResourceDefinition> = {
  crystal: {
    id: 'crystal',
    name: 'Cristal Etéreo',
    description: 'Mineral energético encontrado em formações cristalinas. Recarrega +25 de combustível.',
    baseValue: 12,
    color: '#22d3ee',
  },
  scrap: {
    id: 'scrap',
    name: 'Sucata Metálica',
    description: 'Ligas aeroespaciais recuperadas de naves caídas e ruínas. Repara +15 do casco.',
    baseValue: 8,
    color: '#fb923c',
  },
  fiber: {
    id: 'fiber',
    name: 'Fibra Vegetal',
    description: 'Biomassa resistente colhida de arbustos e cogumelos planetários.',
    baseValue: 4,
    color: '#4ade80',
  },
  relic: {
    id: 'relic',
    name: 'Relíquia Alienígena',
    description: 'Artefato raro preservado apenas em ruínas antigas.',
    baseValue: 90,
    color: '#c084fc',
  },
};

export const RESOURCE_ORDER: readonly ResourceId[] = [
  'crystal',
  'scrap',
  'fiber',
  'relic',
];

export interface PlayerUpgrades {
  tankLevel: number;
  hullLevel: number;
  cargoLevel: number;
}
