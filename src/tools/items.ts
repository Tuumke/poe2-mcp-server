import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getNinjaExchangeOverview, displayNinjaName } from '../services/api.js';
import { hasScoutUniqueCoverage, searchPoe2scoutUniques } from '../services/poe2scout.js';
import { DEFAULT_LEAGUE, LeagueSchema } from '../constants.js';

const EXCHANGE_TYPES = [
  'Currency',
  'Fragments',
  'Abyss',
  'UncutGems',
  'LineageSupportGems',
  'Essences',
  'SoulCores',
  'Idols',
  'Runes',
  'Ritual',
  'Expedition',
  'Delirium',
  'Breach',
] as const;

const UNIQUE_TYPES = [
  'UniqueArmour',
  'UniqueWeapon',
  'UniqueAccessory',
  'UniqueJewel',
  'UniqueFlask',
] as const;

const ALL_ITEM_TYPES = [...EXCHANGE_TYPES, ...UNIQUE_TYPES] as const;

/** Map unique type enum values to poe2scout category slugs. */
const UNIQUE_TYPE_TO_SCOUT_CATEGORY: Record<string, string> = {
  UniqueArmour: 'armour',
  UniqueWeapon: 'weapon',
  UniqueAccessory: 'accessory',
  UniqueJewel: 'jewel',
  UniqueFlask: 'flask',
};

/** Whether the given type string is a unique item category. */
function isUniqueType(t: string): boolean {
  return t in UNIQUE_TYPE_TO_SCOUT_CATEGORY;
}

/**
 * Search poe2scout for unique items matching a query in the given categories.
 * Returns results in the same shape as exchange results for uniform formatting.
 */
async function searchUniqueTypes(
  query: string,
  uniqueTypes: string[],
  league: string,
): Promise<Array<{ name: string; type: string; chaos: number; volume: number }>> {
  const results: Array<{ name: string; type: string; chaos: number; volume: number }> = [];

  for (const t of uniqueTypes) {
    const scoutCategory = UNIQUE_TYPE_TO_SCOUT_CATEGORY[t];
    if (!scoutCategory) continue;

    try {
      const items = await searchPoe2scoutUniques(scoutCategory, query, league);
      for (const item of items) {
        results.push({
          name: item.name,
          type: t,
          chaos: item.chaos,
          volume: item.volume,
        });
      }
    } catch {
      // poe2scout category unavailable, skip silently
    }
  }

  return results;
}

export function registerItemTools(server: McpServer): void {
  // ── poe2_item_price ───────────────────────────────────────────────
  server.registerTool(
    'poe2_item_price',
    {
      title: 'PoE2 Item Price Lookup',
      description: `Look up the current market price of an item in Path of Exile 2.

Exchange categories (Currency, Fragments, Essences, etc.) use poe.ninja.
Unique item categories (UniqueArmour, UniqueWeapon, etc.) use poe2scout.com.

Args:
  - name (string): Item name or partial name, e.g. "divine", "essence", "rune"
  - type (string): Category to search. If omitted, searches all categories.
  - league (string): League name (default: "${DEFAULT_LEAGUE}")

Returns: Matching items with chaos-equivalent values and trade volumes.

Examples:
  - "How much is a Divine Orb?" → name="divine", type="Currency"
  - "Price of essences" → name="essence", type="Essences"
  - "Find rune prices" → name="rune", type="Runes"
  - "Price of Atziri's Disdain" → name="Atziri's Disdain", type="UniqueAccessory"
  - "How much is Waveshaper?" → name="Waveshaper", type="UniqueArmour"`,
      inputSchema: {
        name: z.string().min(1).describe('Item name or partial match'),
        type: z
          .enum(ALL_ITEM_TYPES)
          .optional()
          .describe('Category to search. If omitted, searches all categories.'),
        league: LeagueSchema,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ name, type, league }) => {
      try {
        const typesToSearch = type ? [type] : [...ALL_ITEM_TYPES];
        const query = name.toLowerCase();
        const results: Array<{
          name: string;
          type: string;
          chaos: number;
          volume: number;
        }> = [];

        // Split into exchange (poe.ninja) and unique (poe2scout) categories
        const exchangeTypes = typesToSearch.filter((t) => !isUniqueType(t));
        const uniqueTypes = typesToSearch.filter((t) => isUniqueType(t));

        // Search poe.ninja for exchange categories
        for (const t of exchangeTypes) {
          try {
            const data = await getNinjaExchangeOverview(league, t);

            const coreNames = new Map<string, string>();
            for (const item of data.core.items) {
              coreNames.set(item.id, item.name);
            }

            const chaosRate = data.core.rates[data.core.secondary] ?? 1;

            for (const line of data.lines) {
              const itemName = coreNames.get(line.id);
              const matchesQuery =
                line.id.toLowerCase().includes(query) ||
                (itemName?.toLowerCase().includes(query) ?? false);

              if (matchesQuery) {
                results.push({
                  name: displayNinjaName(line.id, coreNames),
                  type: t,
                  chaos: line.primaryValue * chaosRate,
                  volume: line.volumePrimaryValue ?? 0,
                });
              }
            }
          } catch {
            // Category unavailable, skip silently
          }
        }

        // Search poe2scout for unique categories
        if (uniqueTypes.length > 0) {
          const uniqueResults = await searchUniqueTypes(query, uniqueTypes, league);
          results.push(...uniqueResults);
        }

        if (results.length === 0) {
          const gap =
            uniqueTypes.length > 0 && !(await hasScoutUniqueCoverage(league))
              ? `\n\nNote: poe2scout has no unique-item listings for "${league}" yet, ` +
                `so unique prices are unavailable in this league. Pass another league ` +
                `to price uniques; currency and exchange categories still work here.`
              : '';
          return {
            content: [
              {
                type: 'text',
                text: `No items found matching "${name}" in ${league}.${gap}\n\nTip: Try a shorter name. Available categories: ${ALL_ITEM_TYPES.join(', ')}`,
              },
            ],
          };
        }

        results.sort((a, b) => b.chaos - a.chaos);
        const top = results.slice(0, 15);

        const lines: string[] = [
          `## Item Prices: "${name}" — ${league}`,
          `Found ${results.length} match(es)`,
          '',
        ];
        for (const r of top) {
          lines.push(`**${r.name}** [${r.type}]`);
          if (r.chaos <= 0 && r.volume <= 0) {
            lines.push('- Not enough trade data');
          } else {
            lines.push(`- Chaos: ${r.chaos.toFixed(1)} | Volume: ${r.volume}`);
          }
          lines.push('');
        }

        if (results.length > 15) {
          lines.push(`... and ${results.length - 15} more results.`);
        }

        return {
          content: [{ type: 'text', text: lines.join('\n') }],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          isError: true,
          content: [{ type: 'text', text: `Error: ${msg}` }],
        };
      }
    },
  );

  // ── poe2_exchange_top ─────────────────────────────────────────────
  server.registerTool(
    'poe2_exchange_top',
    {
      title: 'PoE2 Top Exchange Items',
      description: `Get the most valuable items in a given exchange category in Path of Exile 2.

Args:
  - type (string): Exchange category — Currency, Fragments, Essences, SoulCores, Idols, Runes, etc.
  - limit (number): How many to return (default: 10, max: 30)
  - league (string): League name (default: "${DEFAULT_LEAGUE}")

Returns: Top N most valuable items sorted by chaos-equivalent value.`,
      inputSchema: {
        type: z.enum(EXCHANGE_TYPES).describe('Exchange category'),
        limit: z.number().int().min(1).max(30).default(10).describe('Number of results'),
        league: LeagueSchema,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ type, limit, league }) => {
      try {
        const data = await getNinjaExchangeOverview(league, type);

        const coreNames = new Map<string, string>();
        for (const item of data.core.items) {
          coreNames.set(item.id, item.name);
        }

        const chaosRate = data.core.rates[data.core.secondary] ?? 1;

        const sorted = [...data.lines].sort((a, b) => b.primaryValue - a.primaryValue);
        const top = sorted.slice(0, limit);

        const lines: string[] = [`## Top ${limit} ${type} — ${league}`, ''];
        for (let i = 0; i < top.length; i++) {
          const item = top[i]!;
          const name = displayNinjaName(item.id, coreNames);
          const chaosValue = (item.primaryValue * chaosRate).toFixed(1);
          const volume = item.volumePrimaryValue ?? 0;
          lines.push(`${i + 1}. **${name}** — ${chaosValue} chaos (volume: ${volume})`);
        }

        return {
          content: [{ type: 'text', text: lines.join('\n') }],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          isError: true,
          content: [{ type: 'text', text: `Error: ${msg}` }],
        };
      }
    },
  );
}
