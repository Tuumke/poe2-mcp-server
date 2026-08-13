import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./http.js', () => {
  class MockRateLimiter {
    async wait(): Promise<void> {}
  }
  return {
    USER_AGENT: 'test-agent',
    RateLimiter: MockRateLimiter,
    fetchJson: vi.fn(),
  };
});

import { fetchJson } from './http.js';
import {
  getPoe2scoutUniques,
  searchPoe2scoutUniques,
  lookupUniquePriceFromScout,
  mapItemClassToScoutCategory,
} from './poe2scout.js';

beforeEach(() => {
  vi.restoreAllMocks();
});

function mockScoutResponse(
  items: Array<{
    name: string;
    text?: string;
    currentPrice: number | null;
    quantity?: number;
    categoryApiId?: string;
    type?: string;
  }>,
) {
  vi.mocked(fetchJson).mockResolvedValue({
    CurrentPage: 1,
    Pages: 1,
    Total: items.length,
    Items: items.map((item, idx) => ({
      UniqueItemId: idx,
      ItemId: idx,
      IconUrl: null,
      Text: item.text ?? item.name,
      Name: item.name,
      CategoryApiId: item.categoryApiId ?? 'armour',
      Type: item.type ?? 'Base',
      IsChanceable: false,
      PriceLogs: [null],
      CurrentPrice: item.currentPrice,
      CurrentQuantity: item.quantity ?? null,
    })),
  });
}

describe('mapItemClassToScoutCategory', () => {
  it.each([
    { itemClass: 'Body Armours', expected: 'armour' },
    { itemClass: 'Helmets', expected: 'armour' },
    { itemClass: 'Gloves', expected: 'armour' },
    { itemClass: 'Boots', expected: 'armour' },
    { itemClass: 'Shields', expected: 'armour' },
    { itemClass: 'Quivers', expected: 'armour' },
    { itemClass: 'Focus', expected: 'armour' },
    { itemClass: 'Wands', expected: 'weapon' },
    { itemClass: 'Two Hand Swords', expected: 'weapon' },
    { itemClass: 'Bows', expected: 'weapon' },
    { itemClass: 'Crossbows', expected: 'weapon' },
    { itemClass: 'Sceptres', expected: 'weapon' },
    { itemClass: 'Staves', expected: 'weapon' },
    { itemClass: 'Daggers', expected: 'weapon' },
    { itemClass: 'Rings', expected: 'accessory' },
    { itemClass: 'Amulets', expected: 'accessory' },
    { itemClass: 'Belts', expected: 'accessory' },
    { itemClass: 'Jewels', expected: 'jewel' },
    { itemClass: 'Flasks', expected: 'flask' },
  ])('maps $itemClass to $expected', ({ itemClass, expected }) => {
    expect(mapItemClassToScoutCategory(itemClass)).toBe(expected);
  });

  it('returns null for unmappable item classes', () => {
    expect(mapItemClassToScoutCategory('Stackable Currency')).toBeNull();
    expect(mapItemClassToScoutCategory('Skill Gems')).toBeNull();
    expect(mapItemClassToScoutCategory('Waystones')).toBeNull();
  });
});

describe('getPoe2scoutUniques', () => {
  it('constructs URL with correct parameters', async () => {
    mockScoutResponse([]);

    await getPoe2scoutUniques('armour', 'Dawn of the Hunt', 'kaom');

    const url = vi.mocked(fetchJson).mock.calls[0]![0] as string;
    expect(url).toContain('/poe2/Leagues/Dawn%20of%20the%20Hunt/Uniques/ByCategory');
    expect(url).toContain('category=armour');
    expect(url).toContain('referenceCurrency=chaos');
    expect(url).not.toContain('search=');
    expect(url).toContain('perPage=250');
  });

  it('returns parsed response with items', async () => {
    mockScoutResponse([{ name: "Kaom's Heart", currentPrice: 500, quantity: 50 }]);

    const result = await getPoe2scoutUniques('armour', 'Dawn of the Hunt');

    expect(result.Total).toBe(1);
    expect(result.Items[0]!.Name).toBe("Kaom's Heart");
    expect(result.Items[0]!.CurrentPrice).toBe(500);
  });

  it('throws on fetchJson error', async () => {
    vi.mocked(fetchJson).mockRejectedValue(new Error('HTTP 500'));

    await expect(getPoe2scoutUniques('armour', 'Standard')).rejects.toThrow('HTTP 500');
  });
});

describe('searchPoe2scoutUniques', () => {
  it('filters and returns items matching query', async () => {
    mockScoutResponse([
      { name: "Kaom's Heart", currentPrice: 500, quantity: 50 },
      { name: 'Tabula Rasa', currentPrice: 10, quantity: 200 },
    ]);

    const results = await searchPoe2scoutUniques('armour', 'kaom', 'Standard');

    expect(results).toHaveLength(1);
    expect(results[0]!.name).toBe("Kaom's Heart");
    expect(results[0]!.chaos).toBe(500);
    expect(results[0]!.volume).toBe(50);
  });

  it('excludes items with null price', async () => {
    mockScoutResponse([{ name: "Kaom's Heart", currentPrice: null }]);

    const results = await searchPoe2scoutUniques('armour', 'kaom', 'Standard');

    expect(results).toHaveLength(0);
  });

  it('matches against text field too', async () => {
    mockScoutResponse([
      { name: 'Temporalis', text: 'Temporalis Silk Robe', currentPrice: 1000, quantity: 5 },
    ]);

    const results = await searchPoe2scoutUniques('armour', 'silk robe', 'Standard');

    expect(results).toHaveLength(1);
    expect(results[0]!.name).toBe('Temporalis');
  });

  it('returns empty array when no matches', async () => {
    mockScoutResponse([{ name: 'Some Other Item', currentPrice: 100 }]);

    const results = await searchPoe2scoutUniques('armour', 'nonexistent', 'Standard');

    expect(results).toHaveLength(0);
  });

  it('prefers CurrentQuantity for volume', async () => {
    mockScoutResponse([{ name: 'Test Item', currentPrice: 100, quantity: 42 }]);

    const results = await searchPoe2scoutUniques('armour', 'test', 'Standard');

    expect(results[0]!.volume).toBe(42);
  });

  it('falls back to latest non-null price log when CurrentQuantity is absent', async () => {
    vi.mocked(fetchJson).mockResolvedValue({
      CurrentPage: 1,
      Pages: 1,
      Total: 1,
      Items: [
        {
          UniqueItemId: 1,
          ItemId: 1,
          IconUrl: null,
          Text: 'Test Item',
          Name: 'Test Item',
          CategoryApiId: 'armour',
          Type: 'Base',
          IsChanceable: false,
          PriceLogs: [null, null, { price: 100, time: '2026-01-01', quantity: 42 }, null],
          CurrentPrice: 100,
          CurrentQuantity: null,
        },
      ],
    });

    const results = await searchPoe2scoutUniques('armour', 'test', 'Standard');

    expect(results[0]!.volume).toBe(42);
  });
});

describe('lookupUniquePriceFromScout', () => {
  it('returns chaos and volume for exact name match', async () => {
    mockScoutResponse([
      { name: "Atziri's Disdain", currentPrice: 75, quantity: 30, categoryApiId: 'accessory' },
    ]);

    const result = await lookupUniquePriceFromScout(
      "Atziri's Disdain",
      'Amulets',
      'Dawn of the Hunt',
    );

    expect(result).toEqual({ chaos: 75, volume: 30 });
  });

  it('returns null for unmappable item class', async () => {
    const result = await lookupUniquePriceFromScout('Some Item', 'Stackable Currency', 'Standard');

    expect(result).toBeNull();
  });

  it('returns null when item not found', async () => {
    mockScoutResponse([]);

    const result = await lookupUniquePriceFromScout('Nonexistent', 'Body Armours', 'Standard');

    expect(result).toBeNull();
  });

  it('returns null on API error', async () => {
    vi.mocked(fetchJson).mockRejectedValue(new Error('Network error'));

    const result = await lookupUniquePriceFromScout("Kaom's Heart", 'Body Armours', 'Standard');

    expect(result).toBeNull();
  });

  it('performs case-insensitive exact name matching', async () => {
    mockScoutResponse([
      { name: 'Waveshaper', currentPrice: 200, quantity: 15, categoryApiId: 'weapon' },
    ]);

    const result = await lookupUniquePriceFromScout('waveshaper', 'Wands', 'Standard');

    expect(result).toEqual({ chaos: 200, volume: 15 });
  });
});
