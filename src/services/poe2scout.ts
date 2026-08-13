/**
 * poe2scout.com API client for unique item pricing in PoE2.
 * Provides unique item prices that poe.ninja does not currently cover for PoE2.
 *
 * @see https://poe2scout.com/api/swagger
 */

import { RateLimiter, fetchJson } from './http.js';

// poe2scout.com: conservative limit (no documented rate limit)
const poe2scoutLimiter = new RateLimiter(10, 60 * 1000);

// API moved to a dedicated host + versioned, realm-aware routes (2026 .NET rewrite).
// Realm is a path segment, not a query param. See https://api.poe2scout.com/swagger
const POE2SCOUT_BASE = 'https://api.poe2scout.com';
const POE2SCOUT_REALM = 'poe2';

/** Price log entry from poe2scout. */
interface Poe2scoutPriceLog {
  price: number;
  time: string;
  quantity: number;
}

/** Unique item returned by poe2scout (PascalCase since the .NET rewrite). */
interface Poe2scoutUniqueItem {
  UniqueItemId: number;
  ItemId: number;
  IconUrl: string | null;
  Text: string;
  Name: string;
  CategoryApiId: string;
  Type: string;
  IsChanceable: boolean;
  PriceLogs: Array<Poe2scoutPriceLog | null>;
  CurrentPrice: number | null;
  CurrentQuantity: number | null;
}

/** Paginated response for unique items. */
interface Poe2scoutUniqueResponse {
  CurrentPage: number;
  Pages: number;
  Total: number;
  Items: Poe2scoutUniqueItem[];
}

/** Normalized unique item price result. */
export interface UniqueItemPrice {
  name: string;
  baseType: string;
  chaos: number;
  volume: number;
  iconUrl: string | null;
  category: string;
}

/** Valid poe2scout unique categories. */
export type Poe2scoutUniqueCategory = 'armour' | 'weapon' | 'accessory' | 'jewel' | 'flask';

/** Map item class string to poe2scout unique category. */
export function mapItemClassToScoutCategory(itemClass: string): Poe2scoutUniqueCategory | null {
  if (/body armour|helmet|glove|boot|shield|quiver|focus/i.test(itemClass)) {
    return 'armour';
  }
  if (
    /bow|stave|staff|wand|sceptre|mace|sword|axe|claw|dagger|flail|spear|crossbow/i.test(itemClass)
  ) {
    return 'weapon';
  }
  if (/ring|amulet|belt/i.test(itemClass)) return 'accessory';
  if (/jewel/i.test(itemClass)) return 'jewel';
  if (/flask/i.test(itemClass)) return 'flask';
  return null;
}

/**
 * Fetch unique item prices from poe2scout for a given category.
 *
 * @param category - poe2scout category slug (armour, weapon, accessory, jewel, flask)
 * @param league - League name (e.g., "Dawn of the Hunt")
 * @param search - Optional search filter
 * @param perPage - Results per page (max 250)
 */
export async function getPoe2scoutUniques(
  category: string,
  league: string,
  search: string = '',
  perPage: number = 250,
): Promise<Poe2scoutUniqueResponse> {
  // NOTE: the rewritten API has no working server-side text filter (the old
  // `search` param now returns zero rows). We fetch the whole category — a
  // single page of <=250 covers every category — and callers filter locally.
  void search;
  const params = new URLSearchParams({
    category,
    referenceCurrency: 'chaos',
    page: '1',
    perPage: String(perPage),
  });
  const url =
    `${POE2SCOUT_BASE}/${POE2SCOUT_REALM}/Leagues/` +
    `${encodeURIComponent(league)}/Uniques/ByCategory?${params}`;
  return fetchJson<Poe2scoutUniqueResponse>(url, poe2scoutLimiter);
}

/**
 * Search poe2scout for unique items matching a query in a specific category.
 * Returns normalized results with chaos prices and volume.
 *
 * @param category - poe2scout category (armour, weapon, accessory, jewel, flask)
 * @param query - Partial name match (case-insensitive)
 * @param league - League name
 */
export async function searchPoe2scoutUniques(
  category: string,
  query: string,
  league: string,
): Promise<UniqueItemPrice[]> {
  const response = await getPoe2scoutUniques(category, league, query);
  const lowerQuery = query.toLowerCase();

  return response.Items.filter((item) => {
    if (!item.CurrentPrice) return false;
    return (
      item.Name.toLowerCase().includes(lowerQuery) || item.Text.toLowerCase().includes(lowerQuery)
    );
  }).map((item) => ({
    name: item.Name,
    baseType: item.Type,
    chaos: item.CurrentPrice!,
    volume: extractVolume(item),
    iconUrl: item.IconUrl,
    category: item.CategoryApiId,
  }));
}

/**
 * Look up a single unique item price by exact name.
 * Used by enrichment pipeline. Returns null if not found.
 *
 * @param name - Exact unique item name (e.g., "Atziri's Disdain")
 * @param itemClass - Item class for category mapping (e.g., "Body Armours")
 * @param league - League name
 */
export async function lookupUniquePriceFromScout(
  name: string,
  itemClass: string,
  league: string,
): Promise<{ chaos: number; volume: number } | null> {
  const category = mapItemClassToScoutCategory(itemClass);
  if (!category) return null;

  try {
    const response = await getPoe2scoutUniques(category, league, name);
    const lowerName = name.toLowerCase();

    const match = response.Items.find(
      (item) => item.Name.toLowerCase() === lowerName && item.CurrentPrice !== null,
    );

    if (!match?.CurrentPrice) return null;

    return {
      chaos: match.CurrentPrice,
      volume: extractVolume(match),
    };
  } catch (err) {
    console.error(
      `poe2scout: failed to lookup "${name}":`,
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

/**
 * Extract trade volume for a unique. The rewritten API exposes CurrentQuantity
 * directly; fall back to the most recent non-null price log entry.
 */
function extractVolume(item: Poe2scoutUniqueItem): number {
  if (item.CurrentQuantity) return item.CurrentQuantity;
  for (let i = item.PriceLogs.length - 1; i >= 0; i--) {
    const log = item.PriceLogs[i];
    if (log?.quantity) return log.quantity;
  }
  return 0;
}
