import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

vi.mock('../services/api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/api.js')>();
  return { ...actual, getNinjaExchangeOverview: vi.fn() };
});

vi.mock('../services/poe2scout.js', () => ({
  searchPoe2scoutUniques: vi.fn(),
  hasScoutUniqueCoverage: vi.fn(),
}));

import { getNinjaExchangeOverview } from '../services/api.js';
import { hasScoutUniqueCoverage, searchPoe2scoutUniques } from '../services/poe2scout.js';
import { registerItemTools } from './items.js';

type ToolHandler = (args: Record<string, unknown>) => Promise<{
  isError?: boolean;
  content: Array<{ type: string; text: string }>;
}>;

function extractHandlers() {
  const handlers = new Map<string, ToolHandler>();
  const mockServer = {
    registerTool: vi.fn((name: string, _opts: unknown, fn: ToolHandler) => {
      handlers.set(name, fn);
    }),
  } as unknown as McpServer;
  registerItemTools(mockServer);
  return handlers;
}

function mockExchangeResponse(
  lines: Array<{
    id: string;
    primaryValue: number;
    volumePrimaryValue?: number;
  }>,
) {
  return {
    core: {
      items: [
        {
          id: 'divine',
          name: 'Divine Orb',
          image: '',
          category: 'Currency',
          detailsId: 'divine-orb',
        },
      ],
      rates: { chaos: 27 },
      primary: 'divine',
      secondary: 'chaos',
    },
    lines: lines.map((l) => ({
      id: l.id,
      primaryValue: l.primaryValue,
      volumePrimaryValue: l.volumePrimaryValue ?? 0,
      maxVolumeCurrency: 'chaos',
      maxVolumeRate: 27,
      sparkline: { totalChange: 0, data: [] },
    })),
  };
}

describe('poe2_item_price', () => {
  let handler: ToolHandler;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(hasScoutUniqueCoverage).mockResolvedValue(true);
    handler = extractHandlers().get('poe2_item_price')!;
  });

  it('notes the coverage gap when poe2scout has no uniques for the league', async () => {
    vi.mocked(getNinjaExchangeOverview).mockResolvedValue(mockExchangeResponse([]));
    vi.mocked(searchPoe2scoutUniques).mockResolvedValue([]);
    vi.mocked(hasScoutUniqueCoverage).mockResolvedValue(false);

    const res = await handler({ name: 'kaom', league: 'Forbidden Rites' });

    expect(res.content[0]!.text).toContain('no unique-item listings for "Forbidden Rites"');
  });

  it('omits the coverage note when poe2scout covers the league', async () => {
    vi.mocked(getNinjaExchangeOverview).mockResolvedValue(mockExchangeResponse([]));
    vi.mocked(searchPoe2scoutUniques).mockResolvedValue([]);

    const res = await handler({ name: 'kaom', league: 'Runes of Aldur' });

    expect(res.content[0]!.text).not.toContain('no unique-item listings');
  });

  it('finds items by partial id match and formats markdown', async () => {
    vi.mocked(getNinjaExchangeOverview).mockResolvedValue(
      mockExchangeResponse([
        { id: 'divine', primaryValue: 1, volumePrimaryValue: 80 },
        { id: 'exalted', primaryValue: 0.1, volumePrimaryValue: 200 },
      ]),
    );

    const result = await handler({
      name: 'divine',
      type: 'Currency',
      league: 'Standard',
    });

    expect(result.content[0]!.text).toContain('Divine Orb');
    expect(result.content[0]!.text).not.toContain('Exalted');
  });

  it('returns no-match message for unknown items', async () => {
    vi.mocked(getNinjaExchangeOverview).mockResolvedValue(mockExchangeResponse([]));

    const result = await handler({
      name: 'nonexistent',
      type: 'Currency',
      league: 'Standard',
    });

    expect(result.content[0]!.text).toContain('No items found');
  });

  it('returns no-match when API fails for a specific type (error is swallowed)', async () => {
    vi.mocked(getNinjaExchangeOverview).mockRejectedValue(new Error('HTTP 503'));

    const result = await handler({
      name: 'test',
      type: 'Currency',
      league: 'Standard',
    });

    expect(result.content[0]!.text).toContain('No items found');
  });

  it('finds unique items via poe2scout by partial name match', async () => {
    vi.mocked(searchPoe2scoutUniques).mockResolvedValue([
      {
        name: "Kaom's Heart",
        baseType: 'Glorious Plate',
        chaos: 500,
        volume: 80,
        iconUrl: null,
        category: 'armour',
      },
    ]);

    const result = await handler({
      name: 'kaom',
      type: 'UniqueArmour',
      league: 'Standard',
    });

    expect(result.content[0]!.text).toContain("Kaom's Heart");
    expect(result.content[0]!.text).not.toContain('No items found');
    expect(searchPoe2scoutUniques).toHaveBeenCalledWith('armour', 'kaom', 'Standard');
  });

  it('searches exchange types via poe.ninja and unique types via poe2scout when type is omitted', async () => {
    vi.mocked(getNinjaExchangeOverview).mockResolvedValue(mockExchangeResponse([]));
    vi.mocked(searchPoe2scoutUniques).mockResolvedValue([]);

    await handler({ name: 'test', league: 'Standard' });

    const ninjaCalledTypes = vi.mocked(getNinjaExchangeOverview).mock.calls.map((c) => c[1]);
    expect(ninjaCalledTypes).toContain('Currency');
    expect(ninjaCalledTypes).not.toContain('UniqueArmour');

    const scoutCalledCategories = vi.mocked(searchPoe2scoutUniques).mock.calls.map((c) => c[0]);
    expect(scoutCalledCategories).toContain('armour');
    expect(scoutCalledCategories).toContain('weapon');
    expect(scoutCalledCategories).toContain('accessory');
    expect(scoutCalledCategories).toContain('jewel');
    expect(scoutCalledCategories).toContain('flask');
  });

  it('returns unique item with chaos value in results via poe2scout', async () => {
    vi.mocked(searchPoe2scoutUniques).mockResolvedValue([
      {
        name: "Atziri's Disdain",
        baseType: 'Onyx Amulet',
        chaos: 54,
        volume: 50,
        iconUrl: null,
        category: 'accessory',
      },
    ]);

    const result = await handler({
      name: "Atziri's Disdain",
      type: 'UniqueAccessory',
      league: 'Standard',
    });

    expect(result.content[0]!.text).toContain("Atziri's Disdain");
    expect(result.content[0]!.text).toContain('[UniqueAccessory]');
    expect(result.content[0]!.text).toContain('54.0');
  });

  it('includes all item types in no-results message', async () => {
    vi.mocked(searchPoe2scoutUniques).mockResolvedValue([]);

    const result = await handler({
      name: 'nonexistent_xyz',
      type: 'UniqueArmour',
      league: 'Standard',
    });

    expect(result.content[0]!.text).toContain('UniqueArmour');
    expect(result.content[0]!.text).toContain('UniqueFlask');
  });

  it('silently skips poe2scout errors for unique types', async () => {
    vi.mocked(searchPoe2scoutUniques).mockRejectedValue(new Error('Network error'));

    const result = await handler({
      name: 'test',
      type: 'UniqueWeapon',
      league: 'Standard',
    });

    expect(result.content[0]!.text).toContain('No items found');
    expect(result.isError).toBeUndefined();
  });
});

describe('poe2_exchange_top', () => {
  let handler: ToolHandler;

  beforeEach(() => {
    vi.restoreAllMocks();
    handler = extractHandlers().get('poe2_exchange_top')!;
  });

  it('returns top N items sorted by primaryValue', async () => {
    vi.mocked(getNinjaExchangeOverview).mockResolvedValue(
      mockExchangeResponse([
        { id: 'cheap', primaryValue: 0.001 },
        { id: 'expensive', primaryValue: 5 },
        { id: 'mid', primaryValue: 0.5 },
      ]),
    );

    const result = await handler({
      type: 'Currency',
      limit: 2,
      league: 'Standard',
    });

    expect(result.content[0]!.text).toContain('1. **Expensive**');
    expect(result.content[0]!.text).toContain('2. **Mid**');
    expect(result.content[0]!.text).not.toContain('Cheap');
  });

  it('returns isError on failure', async () => {
    vi.mocked(getNinjaExchangeOverview).mockRejectedValue(new Error('network'));

    const result = await handler({
      type: 'Currency',
      limit: 10,
      league: 'Standard',
    });

    expect(result.isError).toBe(true);
  });
});
