import {
  CRYSTAL_FUEL_REFILL,
  FUEL_BURN_BOOST_PER_SEC,
  FUEL_BURN_THRUST_PER_SEC,
  HULL_FAILURE_RESTORE,
  INVENTORY_CAPACITY,
  MAX_FUEL,
  MAX_HULL,
  PlayerUpgrades,
  RESOURCE_ORDER,
  RESOURCES,
  ResourceId,
  SCRAP_HULL_REPAIR,
} from './economy';

const PLAYER_STORAGE_KEY = 'aetheris.player.v1';
const SAVE_SCHEMA_VERSION = 1;

export interface PlayerStateSnapshot {
  credits: number;
  inventory: Record<ResourceId, number>;
  inventoryCount: number;
  inventoryCapacity: number;
  fuel: number;
  maxFuel: number;
  hull: number;
  maxHull: number;
  reserveMode: boolean;
  upgrades: PlayerUpgrades;
}

interface StoredPlayerPayload {
  version: number;
  credits: number;
  inventory: Record<ResourceId, number>;
  fuel: number;
  hull: number;
  upgrades: PlayerUpgrades;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clampNonNegInt(value: unknown, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(max, Math.floor(value)));
}

function clampFinite(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function createEmptyInventory(): Record<ResourceId, number> {
  return {
    crystal: 0,
    scrap: 0,
    fiber: 0,
    relic: 0,
  };
}

function createDefaultUpgrades(): PlayerUpgrades {
  return {
    tankLevel: 0,
    hullLevel: 0,
    cargoLevel: 0,
  };
}

export class PlayerState {
  public credits = 0;
  public readonly inventory: Record<ResourceId, number> = createEmptyInventory();
  public fuel = MAX_FUEL;
  public hull = MAX_HULL;
  public upgrades: PlayerUpgrades = createDefaultUpgrades();
  public dirty = false;

  constructor() {
    this.load();
  }

  public getInventoryCount(): number {
    return (
      this.inventory.crystal +
      this.inventory.scrap +
      this.inventory.fiber +
      this.inventory.relic
    );
  }

  public getCapacity(): number {
    return INVENTORY_CAPACITY;
  }

  public isReserveMode(): boolean {
    return this.fuel <= 0.001;
  }

  public addResource(
    id: ResourceId,
    amount: number,
  ): { added: number; overflow: number; isFull: boolean } {
    const qty = Math.max(0, Math.floor(amount));
    const cap = this.getCapacity();
    const used = this.getInventoryCount();
    const space = Math.max(0, cap - used);
    if (space <= 0 || qty <= 0) {
      return { added: 0, overflow: qty, isFull: used >= cap };
    }
    const added = Math.min(qty, space);
    this.inventory[id] += added;
    const overflow = qty - added;
    this.dirty = true;
    this.save();
    return { added, overflow, isFull: used + added >= cap };
  }

  public sellResource(
    id: ResourceId,
    amount?: number,
  ): { sold: number; earned: number } {
    const available = this.inventory[id];
    if (available <= 0) return { sold: 0, earned: 0 };
    const req = amount === undefined ? available : Math.max(0, Math.floor(amount));
    const sold = Math.min(available, req);
    if (sold <= 0) return { sold: 0, earned: 0 };
    const earned = sold * RESOURCES[id].baseValue;
    this.inventory[id] -= sold;
    this.credits += earned;
    this.dirty = true;
    this.save();
    return { sold, earned };
  }

  public sellAllResources(): { soldTotal: number; earned: number } {
    let soldTotal = 0;
    let earned = 0;
    for (let i = 0; i < RESOURCE_ORDER.length; i++) {
      const id = RESOURCE_ORDER[i];
      const count = this.inventory[id];
      if (count > 0) {
        soldTotal += count;
        earned += count * RESOURCES[id].baseValue;
        this.inventory[id] = 0;
      }
    }
    if (soldTotal > 0) {
      this.credits += earned;
      this.dirty = true;
      this.save();
    }
    return { soldTotal, earned };
  }

  public useCrystalForFuel(): { ok: boolean; gained: number } {
    if (this.inventory.crystal <= 0 || this.fuel >= MAX_FUEL - 0.01) {
      return { ok: false, gained: 0 };
    }
    const prev = this.fuel;
    this.inventory.crystal -= 1;
    this.fuel = Math.min(MAX_FUEL, this.fuel + CRYSTAL_FUEL_REFILL);
    this.dirty = true;
    this.save();
    return { ok: true, gained: Math.round(this.fuel - prev) };
  }

  public repairHullWithScrap(): { ok: boolean; repaired: number } {
    if (this.inventory.scrap <= 0 || this.hull >= MAX_HULL - 0.01) {
      return { ok: false, repaired: 0 };
    }
    const prev = this.hull;
    this.inventory.scrap -= 1;
    this.hull = Math.min(MAX_HULL, this.hull + SCRAP_HULL_REPAIR);
    this.dirty = true;
    this.save();
    return { ok: true, repaired: Math.round(this.hull - prev) };
  }

  public consumeFuel(dt: number, isThrusting: boolean, isBoosting: boolean): void {
    if (!isThrusting && !isBoosting) return;
    if (this.fuel <= 0) return;
    const rate = isBoosting ? FUEL_BURN_BOOST_PER_SEC : FUEL_BURN_THRUST_PER_SEC;
    this.fuel = Math.max(0, this.fuel - rate * dt);
    this.dirty = true;
  }

  public applyHullDamage(amount: number): { hull: number; failed: boolean } {
    if (amount <= 0) {
      return { hull: this.hull, failed: this.hull <= 0 };
    }
    this.hull = Math.max(0, this.hull - amount);
    this.dirty = true;
    const failed = this.hull <= 0.001;
    if (!failed) {
      this.save();
    }
    return { hull: this.hull, failed };
  }

  public handleHullFailure(): { lostCredits: number; hullRestored: number } {
    const prevCredits = this.credits;
    this.credits = Math.floor(this.credits * 0.5);
    const lostCredits = prevCredits - this.credits;
    this.hull = HULL_FAILURE_RESTORE;
    this.dirty = true;
    this.save();
    return { lostCredits, hullRestored: this.hull };
  }

  public addCredits(amount: number): void {
    const delta = Math.max(0, Math.floor(amount));
    if (delta <= 0) return;
    this.credits += delta;
    this.dirty = true;
    this.save();
  }

  public fillInventoryDebug(): number {
    let space = Math.max(0, this.getCapacity() - this.getInventoryCount());
    if (space <= 0) return 0;
    const initialSpace = space;
    // Distribute across all resources so user can test selling, fuel refill, and hull repair
    const weights: readonly { id: ResourceId; batch: number }[] = [
      { id: 'crystal', batch: 4 },
      { id: 'scrap', batch: 4 },
      { id: 'fiber', batch: 3 },
      { id: 'relic', batch: 1 },
    ];
    let guard = 0;
    while (space > 0 && guard < 60) {
      guard++;
      for (let i = 0; i < weights.length && space > 0; i++) {
        const give = Math.min(space, weights[i].batch);
        this.inventory[weights[i].id] += give;
        space -= give;
      }
    }
    this.dirty = true;
    this.save();
    return initialSpace - space;
  }

  public resetNewGame(): void {
    this.credits = 0;
    this.inventory.crystal = 0;
    this.inventory.scrap = 0;
    this.inventory.fiber = 0;
    this.inventory.relic = 0;
    this.fuel = MAX_FUEL;
    this.hull = MAX_HULL;
    this.upgrades = createDefaultUpgrades();
    this.dirty = true;
    this.save();
  }

  public createSnapshot(): PlayerStateSnapshot {
    return {
      credits: this.credits,
      inventory: {
        crystal: this.inventory.crystal,
        scrap: this.inventory.scrap,
        fiber: this.inventory.fiber,
        relic: this.inventory.relic,
      },
      inventoryCount: this.getInventoryCount(),
      inventoryCapacity: this.getCapacity(),
      fuel: this.fuel,
      maxFuel: MAX_FUEL,
      hull: this.hull,
      maxHull: MAX_HULL,
      reserveMode: this.isReserveMode(),
      upgrades: { ...this.upgrades },
    };
  }

  public save(): void {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return;
      const payload: StoredPlayerPayload = {
        version: SAVE_SCHEMA_VERSION,
        credits: Math.floor(this.credits),
        inventory: {
          crystal: this.inventory.crystal,
          scrap: this.inventory.scrap,
          fiber: this.inventory.fiber,
          relic: this.inventory.relic,
        },
        fuel: Number(this.fuel.toFixed(2)),
        hull: Number(this.hull.toFixed(2)),
        upgrades: { ...this.upgrades },
      };
      window.localStorage.setItem(PLAYER_STORAGE_KEY, JSON.stringify(payload));
      this.dirty = false;
    } catch {
      // Ignore storage quota or private browsing errors
    }
  }

  public load(): void {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return;
      const raw = window.localStorage.getItem(PLAYER_STORAGE_KEY);
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (!isRecord(parsed) || parsed.version !== SAVE_SCHEMA_VERSION) return;

      this.credits = clampNonNegInt(parsed.credits, 99_999_999);
      this.fuel = clampFinite(parsed.fuel, 0, MAX_FUEL, MAX_FUEL);
      this.hull = clampFinite(parsed.hull, 1, MAX_HULL, MAX_HULL);

      if (isRecord(parsed.inventory)) {
        let remaining = INVENTORY_CAPACITY;
        for (let i = 0; i < RESOURCE_ORDER.length; i++) {
          const id = RESOURCE_ORDER[i];
          const val = clampNonNegInt(parsed.inventory[id], remaining);
          this.inventory[id] = val;
          remaining -= val;
        }
      }

      if (isRecord(parsed.upgrades)) {
        this.upgrades = {
          tankLevel: clampNonNegInt(parsed.upgrades.tankLevel, 10),
          hullLevel: clampNonNegInt(parsed.upgrades.hullLevel, 10),
          cargoLevel: clampNonNegInt(parsed.upgrades.cargoLevel, 10),
        };
      }
      this.dirty = false;
    } catch {
      // Ignore corrupted localStorage payloads
    }
  }
}
