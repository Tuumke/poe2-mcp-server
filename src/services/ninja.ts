import { RateLimiter, fetchJson } from './http.js';

/** Title-case a poe.ninja slug id for display (e.g. "alch" → "Alch"). */
export function displayNinjaName(id: string, coreNames: Map<string, string>): string {
  return coreNames.get(id) ?? id.charAt(0).toUpperCase() + id.slice(1);
}

// ─── poe.ninja PoE2 Exchange API ──────────────────────────────────────

// poe.ninja tolerates a steady ~1 req/sec; 20/min lets a full item_price
// "search all categories" sweep (13 exchange types) finish in one window
// instead of stalling minutes on the old 10-per-5-min hard cap.
const ninjaLimiter = new RateLimiter(20, 60 * 1000);

interface NinjaExchangeCoreItem {
  id: string;
  name: string;
  image: string;
  category: string;
  detailsId: string;
}

interface NinjaExchangeCore {
  items: NinjaExchangeCoreItem[];
  rates: Record<string, number>;
  primary: string;
  secondary: string;
}

interface NinjaExchangeLine {
  id: string;
  primaryValue: number;
  volumePrimaryValue: number;
  maxVolumeCurrency: string;
  maxVolumeRate: number;
  sparkline: { totalChange: number; data: number[] };
}

export interface NinjaExchangeResponse {
  core: NinjaExchangeCore;
  lines: NinjaExchangeLine[];
}

// ─── poe.ninja Build Index API ────────────────────────────────────────

export interface BuildClassStatistic {
  class: string;
  percentage: number;
  trend: number;
}

export interface BuildLeagueEntry {
  leagueName: string;
  leagueUrl: string;
  total: number;
  status: number;
  statistics: BuildClassStatistic[];
}

export interface BuildIndexStateResponse {
  leagueBuilds: BuildLeagueEntry[];
}

const NINJA_POE2_BASE = 'https://poe.ninja/poe2/api/economy';

/**
 * Fetch PoE2 exchange overview from poe.ninja.
 * @param league — Full league display name, e.g. "Fate of the Vaal"
 * @param type — Exchange category, e.g. "Currency", "Fragments", "Essences"
 */
export async function getNinjaExchangeOverview(
  league: string,
  type: string,
): Promise<NinjaExchangeResponse> {
  const url = `${NINJA_POE2_BASE}/exchange/current/overview?league=${encodeURIComponent(league)}&type=${encodeURIComponent(type)}`;
  return fetchJson<NinjaExchangeResponse>(url, ninjaLimiter);
}

/**
 * Fetch PoE2 build index state from poe.ninja.
 * Returns class distribution statistics for all leagues.
 */
export async function getNinjaBuildIndex(): Promise<BuildIndexStateResponse> {
  const url = 'https://poe.ninja/poe2/api/data/build-index-state';
  return fetchJson<BuildIndexStateResponse>(url, ninjaLimiter);
}

// ─── poe.ninja PoE2 Item Overview API ──────────────────────────────────

/** poe.ninja item overview line (unique equipment, not exchange). */
export interface NinjaItemLine {
  id: number;
  name: string;
  icon: string;
  baseType: string;
  itemClass: number;
  chaosValue: number;
  divineValue: number;
  listingCount: number;
  sparkline: { totalChange: number; data: number[] };
}

/** Response shape for poe.ninja item overview endpoint. */
export interface NinjaItemOverviewResponse {
  lines: NinjaItemLine[];
}

/**
 * Fetch unique equipment prices from poe.ninja.
 * PoE2 uses the Currency Exchange for all tradeable items, including uniques.
 * This function queries the exchange endpoint and maps the response to the
 * item overview format for a consistent interface.
 *
 * @param league - League name, e.g. "Fate of the Vaal"
 * @param type - Item category: "UniqueArmour", "UniqueWeapon", "UniqueAccessory", "UniqueJewel", "UniqueFlask"
 * @throws On HTTP error.
 */
export async function getNinjaItemOverview(
  league: string,
  type: string,
): Promise<NinjaItemOverviewResponse> {
  const url = `${NINJA_POE2_BASE}/exchange/current/overview?league=${encodeURIComponent(league)}&type=${encodeURIComponent(type)}`;
  const raw = await fetchJson<NinjaExchangeResponse>(url, ninjaLimiter);

  const coreNames = new Map<string, NinjaExchangeCoreItem>();
  for (const item of raw.core.items) {
    coreNames.set(item.id, item);
  }

  const chaosRate = raw.core.rates[raw.core.secondary] ?? 1;

  const lines: NinjaItemLine[] = raw.lines.map((line) => {
    const coreItem = coreNames.get(line.id);
    return {
      id: parseInt(line.id, 10) || 0,
      name: coreItem?.name ?? line.id,
      icon: coreItem?.image ?? '',
      baseType: coreItem?.category ?? '',
      itemClass: 0,
      chaosValue: line.primaryValue * chaosRate,
      divineValue: 0,
      listingCount: line.volumePrimaryValue ?? 0,
      sparkline: line.sparkline,
    };
  });

  return { lines };
}
