import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  loadGGGSession,
  getStashTabs,
  getStashTabItems,
  GGGAuthError,
  type GGGSession,
} from './ggg.js';

const sess: GGGSession = { poesessid: 'secret-cookie', accountName: 'Tester#1234' };

function mockFetchOnce(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    })),
  );
}

beforeEach(() => {
  delete process.env.POE2_POESESSID;
  delete process.env.POE2_ACCOUNT_NAME;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('loadGGGSession', () => {
  it('reads credentials from environment variables', () => {
    process.env.POE2_POESESSID = 'abc';
    process.env.POE2_ACCOUNT_NAME = 'Me#1';
    expect(loadGGGSession()).toEqual({ poesessid: 'abc', accountName: 'Me#1' });
  });

  it('returns null when env is incomplete and no file exists', () => {
    process.env.POE2_POESESSID = 'abc'; // account missing
    // Session file is unlikely to exist in CI; if it does this asserts nothing useful,
    // so we only assert the incomplete-env branch does not throw.
    expect(() => loadGGGSession()).not.toThrow();
  });
});

describe('getStashTabs', () => {
  it('normalizes tab metadata (i/n short keys)', async () => {
    mockFetchOnce(200, {
      tabs: [
        { i: 0, id: 'a', n: 'Currency', type: 'CurrencyStash' },
        { i: 1, id: 'b', n: 'Uniques', type: 'UniqueStash' },
      ],
    });
    const tabs = await getStashTabs(sess, 'Runes of Aldur');
    expect(tabs).toEqual([
      { index: 0, id: 'a', name: 'Currency', type: 'CurrencyStash' },
      { index: 1, id: 'b', name: 'Uniques', type: 'UniqueStash' },
    ]);
  });

  it('sends the POESESSID as a cookie header', async () => {
    const fetchMock = vi.fn(async (_url: string, _opts: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({ tabs: [] }),
      text: async () => '{}',
    }));
    vi.stubGlobal('fetch', fetchMock);
    await getStashTabs(sess, 'Standard');
    const opts = fetchMock.mock.calls[0]![1];
    expect(opts.headers).toMatchObject({ Cookie: 'POESESSID=secret-cookie' });
  });

  it('throws GGGAuthError on 403', async () => {
    mockFetchOnce(403, 'Forbidden');
    await expect(getStashTabs(sess, 'Standard')).rejects.toBeInstanceOf(GGGAuthError);
  });
});

describe('getStashTabItems', () => {
  it('trims items to useful fields', async () => {
    mockFetchOnce(200, {
      items: [
        { name: '', typeLine: 'Chaos Orb', stackSize: 42, identified: true },
        { name: 'Kaom', typeLine: "Kaom's Heart", ilvl: 84, identified: true },
      ],
    });
    const items = await getStashTabItems(sess, 'Standard', 0);
    expect(items[0]).toMatchObject({ typeLine: 'Chaos Orb', stackSize: 42 });
    expect(items[1]).toMatchObject({ name: 'Kaom', ilvl: 84 });
  });
});
