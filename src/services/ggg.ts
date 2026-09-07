/**
 * GGG session-cookie client for reading YOUR OWN Path of Exile 2 stash.
 *
 * This uses the site's internal `character-window` endpoints authenticated with
 * a POESESSID session cookie — NOT the official OAuth API (new OAuth app
 * registrations were closed by GGG as of 2026-08). It only ever reads the
 * account that owns the cookie.
 *
 * SECURITY: the POESESSID is a credential. It is read at runtime from an
 * environment variable or a local file OUTSIDE this repo. It is never logged,
 * never returned in tool output, and must never be committed.
 *
 * Endpoint/param note: GGG does not document these internal endpoints. The
 * `character-window/get-stash-items` shape below matches the long-standing PoE1
 * form with `realm=poe2`; if GGG changes it, adjust STASH_BASE / params here.
 */

import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { RateLimiter, USER_AGENT } from './http.js';

/** Resolved session credentials (never logged). */
export interface GGGSession {
  poesessid: string;
  accountName: string;
}

/** Local, gitignored session file location. */
export const SESSION_FILE = path.join(os.homedir(), '.poe2-mcp', 'session.json');

/**
 * Load the POESESSID + account name from local config.
 * Priority: environment variables, then `~/.poe2-mcp/session.json`.
 * Returns null when not configured (callers should print setup guidance).
 */
export function loadGGGSession(): GGGSession | null {
  const envSid = process.env.POE2_POESESSID?.trim();
  const envAcct = process.env.POE2_ACCOUNT_NAME?.trim();
  if (envSid && envAcct) {
    return { poesessid: envSid, accountName: envAcct };
  }

  if (existsSync(SESSION_FILE)) {
    try {
      // Strip a UTF-8 BOM — PowerShell's Set-Content can add one, which breaks JSON.parse.
      const text = readFileSync(SESSION_FILE, 'utf-8').replace(/^\uFEFF/, '');
      const raw = JSON.parse(text) as Record<string, unknown>;
      const poesessid = typeof raw.poesessid === 'string' ? raw.poesessid.trim() : '';
      const accountName = typeof raw.accountName === 'string' ? raw.accountName.trim() : '';
      if (poesessid && accountName) {
        return { poesessid, accountName };
      }
    } catch {
      // fall through to null — malformed file is treated as "not configured"
    }
  }

  return null;
}

// GGG asks for a descriptive User-Agent; be gentle on their unofficial endpoints.
const gggLimiter = new RateLimiter(5, 60 * 1000);
const STASH_BASE = 'https://www.pathofexile.com/character-window/get-stash-items';

/** Raised when the session cookie is missing/expired or the request was blocked. */
export class GGGAuthError extends Error {}

async function gggFetch<T>(url: string, poesessid: string): Promise<T> {
  await gggLimiter.wait();
  const res = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/json',
      Cookie: `POESESSID=${poesessid}`,
    },
  });
  if (res.status === 401 || res.status === 403) {
    throw new GGGAuthError(
      `HTTP ${res.status} — your POESESSID is likely expired/invalid, or the request was ` +
        `blocked (Cloudflare). Refresh the cookie and try again.`,
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} from GGG: ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

/** Metadata for one stash tab. */
export interface StashTabMeta {
  index: number;
  id: string;
  name: string;
  type: string;
}

/** A single item, trimmed to the useful fields. */
export interface StashItemLite {
  name: string;
  typeLine: string;
  stackSize: number | null;
  ilvl: number | null;
  identified: boolean;
}

interface RawStashResponse {
  tabs?: Array<{ i?: number; index?: number; id: string; n?: string; name?: string; type: string }>;
  items?: Array<{
    name?: string;
    typeLine?: string;
    baseType?: string;
    stackSize?: number;
    ilvl?: number;
    identified?: boolean;
  }>;
}

function buildUrl(sess: GGGSession, league: string, realm: string, tabIndex: number): string {
  const params = new URLSearchParams({
    accountName: sess.accountName,
    realm,
    league,
    tabs: '1',
    tabIndex: String(tabIndex),
  });
  return `${STASH_BASE}?${params.toString()}`;
}

/** List all stash tabs (metadata only). */
export async function getStashTabs(
  sess: GGGSession,
  league: string,
  realm = 'poe2',
): Promise<StashTabMeta[]> {
  const data = await gggFetch<RawStashResponse>(buildUrl(sess, league, realm, 0), sess.poesessid);
  return (data.tabs ?? []).map((t) => ({
    index: t.i ?? t.index ?? 0,
    id: t.id,
    name: t.n ?? t.name ?? '(unnamed)',
    type: t.type,
  }));
}

/** Read the items in one stash tab by index. */
export async function getStashTabItems(
  sess: GGGSession,
  league: string,
  tabIndex: number,
  realm = 'poe2',
): Promise<StashItemLite[]> {
  const data = await gggFetch<RawStashResponse>(
    buildUrl(sess, league, realm, tabIndex),
    sess.poesessid,
  );
  return (data.items ?? []).map((it) => ({
    name: it.name ?? '',
    typeLine: it.typeLine ?? it.baseType ?? '',
    stackSize: it.stackSize ?? null,
    ilvl: it.ilvl ?? null,
    identified: it.identified ?? true,
  }));
}
