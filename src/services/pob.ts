import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inflateRawSync, inflateSync } from 'node:zlib';
import { RateLimiter, USER_AGENT } from './http.js';

// ─── Path of Building 2 (PoB2) Types ──────────────────────────────────

/** Options for PoB2 tool registration. */
export interface PobToolOptions {
  pob2BuildsPath?: string;
}

/** Equipment slot identifiers used in PoB. */
export type PobSlot =
  | 'Helmet'
  | 'Body Armour'
  | 'Gloves'
  | 'Boots'
  | 'Amulet'
  | 'Ring 1'
  | 'Ring 2'
  | 'Belt'
  | 'Weapon 1'
  | 'Weapon 2'
  | 'Weapon 1 Swap'
  | 'Weapon 2 Swap'
  | 'Flask 1'
  | 'Flask 2'
  | 'Flask 3'
  | 'Flask 4'
  | 'Flask 5';

/** Rarity levels in PoE2. */
export type PobRarity = 'Normal' | 'Magic' | 'Rare' | 'Unique' | 'Relic';

/** Decoded build metadata from PoB XML <Build> element. */
export interface PobBuildMetadata {
  className: string;
  ascendancy: string | null;
  level: number;
  bandit: string | null;
  pantheonMajor: string | null;
  pantheonMinor: string | null;
  mainSocketGroup: number | null;
}

/** Parsed item from PoB XML <Item> text block. */
export interface PobItem {
  slot: PobSlot | string;
  rarity: PobRarity;
  name: string | null;
  base: string;
  itemLevel: number;
  levelRequirement: number;
  quality: number;
  armour: number;
  evasion: number;
  energyShield: number;
  sockets: string | null;
  implicits: string[];
  explicits: string[];
  corrupted: boolean;
}

/** Parsed gem from PoB XML <Gem> element. */
export interface PobGem {
  name: string;
  nameSpec: string;
  level: number;
  quality: number;
  enabled: boolean;
  isSupport: boolean;
}

/** Parsed skill group from PoB XML <Skill> element. */
export interface PobSkillGroup {
  label: string | null;
  slot: string | null;
  enabled: boolean;
  gems: PobGem[];
  activeGem: PobGem | null;
  supportGems: PobGem[];
}

/** Parsed passive tree from PoB XML <Tree> element. */
export interface PobPassiveTree {
  version: string;
  activeSpec: number;
  allocatedNodes: number[];
  masteryEffects: Array<{ nodeId: number; effectId: number }>;
}

/** Resolved passive tree with readable names (requires tree data). */
export interface PobResolvedTree {
  version: string;
  allocatedCount: number;
  keystones: string[];
  notables: string[];
  masteries: Array<{ node: string; effect: string }>;
}

/** Configuration flags from PoB XML <Config>. */
export type PobConfig = Record<string, string | boolean | number>;

/** Complete parsed PoB build. */
export interface PobBuild {
  metadata: PobBuildMetadata;
  items: PobItem[];
  skills: PobSkillGroup[];
  tree: PobPassiveTree;
  resolvedTree: PobResolvedTree | null;
  config: PobConfig;
  notes: string;
  xmlSource: 'code' | 'file';
  /** Non-fatal validation warnings (e.g. wrong root element for PoB2). */
  warnings: string[];
}

/** Item comparison diff entry. */
export interface PobItemDiff {
  slot: string;
  current: PobItem | null;
  reference: PobItem | null;
  delta: string | null;
}

/** Tree comparison diff. */
export interface PobTreeDiff {
  missingNodes: string[];
  extraNodes: string[];
  matchingKeystones: string[];
}

/** Skill comparison diff. */
export interface PobSkillDiff {
  missingGems: string[];
  extraGems: string[];
  differentSupports: Array<{
    skill: string;
    currentSupport: string;
    referenceSupport: string;
  }>;
}

/** Complete comparison result. */
export interface PobCompareResult {
  summary: string;
  items: {
    upgradesNeeded: PobItemDiff[];
    matching: string[];
    missingInCurrent: string[];
  };
  tree: PobTreeDiff;
  skills: PobSkillDiff;
}

/** Local build file entry for directory listing. */
export interface PobLocalBuildEntry {
  filename: string;
  className: string | null;
  ascendancy: string | null;
  level: number | null;
  lastModified: Date;
}

// ─── Path of Building 2 (PoB2) Service Functions ─────────────────────

// pobb.in: 10 req / 60 sec (undocumented, conservative limit)
const pobbinLimiter = new RateLimiter(10, 60 * 1000);

// poe.ninja PoB pastes share the same rate limit as poe.ninja API
const poeNinjaLimiter = new RateLimiter(10, 5 * 60 * 1000);

/**
 * Default PoB2 builds directory paths by platform.
 * The official folder name for PoE2 is "Path of Building (PoE2)" per
 * https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2/blob/master/src/Modules/Main.lua
 * Some older installs may use "Path of Building Community (PoE2)".
 * pasteofexile default installs to Documents folder on Windows.
 */
const DEFAULT_POB2_PATHS: Record<string, string[]> = {
  win32: [
    path.join(os.homedir(), 'Documents', 'Path of Building (PoE2)', 'Builds'),
    path.join(os.homedir(), 'Documents', 'Path of Building Community (PoE2)', 'Builds'),
    path.join(os.homedir(), 'AppData', 'Roaming', 'Path of Building (PoE2)', 'Builds'),
    path.join(os.homedir(), 'AppData', 'Roaming', 'Path of Building Community (PoE2)', 'Builds'),
  ],
  darwin: [
    path.join(os.homedir(), 'Library', 'Application Support', 'Path of Building (PoE2)', 'Builds'),
    path.join(
      os.homedir(),
      'Library',
      'Application Support',
      'Path of Building Community (PoE2)',
      'Builds',
    ),
  ],
  linux: [
    path.join(os.homedir(), '.config', 'Path of Building (PoE2)', 'Builds'),
    path.join(os.homedir(), '.config', 'Path of Building Community (PoE2)', 'Builds'),
  ],
};

/**
 * Sanitize a PoB code string that may have been mangled by AI agents or copy-paste.
 * Strips whitespace, normalises Unicode look-alikes, and URL-decodes common encodings.
 */
function sanitizePobCode(code: string): string {
  let s = code;
  // Normalise Unicode look-alikes that AI agents may substitute
  s = s.replace(/\u2013/g, '-'); // en-dash → hyphen
  s = s.replace(/\u2014/g, '-'); // em-dash → hyphen
  s = s.replace(/\u2015/g, '-'); // horizontal bar → hyphen
  s = s.replace(/\u2212/g, '-'); // minus sign → hyphen
  // URL-decode common percent-encoded base64 characters
  s = s.replace(/%2B/gi, '+');
  s = s.replace(/%2F/gi, '/');
  s = s.replace(/%3D/gi, '=');
  // Strip ALL whitespace (AI agents may line-wrap or inject spaces)
  s = s.replace(/\s+/g, '');
  return s;
}

/**
 * Decode a PoB code string to XML.
 * Pipeline: sanitize → URL-safe reversal → Base64 decode → Zlib inflate → UTF-8 string.
 * @param code - PoB code string (base64, URL-safe encoded)
 * @returns Decoded XML string
 * @throws Error if decoding fails
 */
export function decodePobCode(code: string): string {
  const sanitized = sanitizePobCode(code);

  if (sanitized.length === 0) {
    throw new Error('Invalid PoB code: empty input');
  }

  // URL-safe base64 → standard base64
  const base64 = sanitized.replace(/-/g, '+').replace(/_/g, '/');

  const buffer = Buffer.from(base64, 'base64');

  if (buffer.length === 0) {
    throw new Error('Invalid PoB code: empty after base64 decode');
  }

  // Try raw deflate first (PoB2 format), fall back to zlib (PoB1/legacy)
  let decompressed: Buffer;

  try {
    decompressed = inflateRawSync(buffer);
  } catch (rawErr) {
    try {
      decompressed = inflateSync(buffer);
    } catch (zlibErr) {
      // Build diagnostic info for AI agents to reason about the failure
      const header = buffer.subarray(0, 4).toString('hex');
      const hasZlibHeader = buffer[0] === 0x78;
      const rawMsg = rawErr instanceof Error ? rawErr.message : String(rawErr);
      const zlibMsg = zlibErr instanceof Error ? zlibErr.message : String(zlibErr);

      const diag = [
        `Invalid PoB code: decompression failed.`,
        `Input: ${sanitized.length} chars → ${buffer.length} bytes.`,
        `Header bytes: ${header} (${hasZlibHeader ? 'zlib signature detected' : 'no zlib signature'}).`,
        `inflateRaw error: ${rawMsg}.`,
        `inflate error: ${zlibMsg}.`,
        `Likely cause: the PoB code was truncated or corrupted during copy-paste.`,
        `Ensure the COMPLETE base64 string from PoB's "Export" is provided without modification.`,
      ];
      throw new Error(diag.join(' '));
    }
  }

  return decompressed.toString('utf-8');
}

/**
 * Detect if a string is a pobb.in URL and extract the paste ID.
 * @param input - PoB code, pobb.in URL, or local build name
 * @returns Extracted paste ID or null if not a pobb.in URL
 */
export function extractPobbinId(input: string): string | null {
  const trimmed = input.trim();
  // Match: https://pobb.in/id, http://pobb.in/id, pobb.in/id
  const match = /^(?:https?:\/\/)?pobb\.in\/(.+)$/i.exec(trimmed);
  if (match) {
    // Remove trailing /raw if present
    return match[1]!.replace(/\/raw$/, '');
  }
  return null;
}

/**
 * Fetch raw PoB code from pobb.in.
 * @param id - Paste ID (e.g., "abc123" or "u/username/abc123")
 * @returns PoB code string
 * @throws Error on HTTP failure
 */
export async function fetchPobbinCode(id: string): Promise<string> {
  await pobbinLimiter.wait();

  const url = `https://pobb.in/${encodeURIComponent(id)}/raw`;
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
  });

  if (res.status === 404) {
    throw new Error('pobb.in paste not found. Check the URL and ensure the paste still exists.');
  }
  if (res.status === 429) {
    throw new Error('pobb.in rate limit exceeded. Try again in a minute.');
  }
  if (!res.ok) {
    throw new Error(`pobb.in returned HTTP ${res.status}`);
  }

  return res.text();
}

/**
 * Detect if a string is a poe.ninja PoB URL and extract the paste ID.
 * Supports: poe.ninja/poe2/pob/ID, poe2.ninja/pob/ID, pob2://poeninja/ID
 * @param input - User input string
 * @returns Extracted paste ID or null if not a poe.ninja PoB URL
 */
export function extractPoeNinjaId(input: string): string | null {
  const trimmed = input.trim();
  // pob2://poeninja/ID (PoB2 protocol handler)
  const protocolMatch = /^pob2:[\\/]+poeninja[\\/]+(.+)$/i.exec(trimmed);
  if (protocolMatch) return protocolMatch[1]!.replace(/\s+$/, '');
  // https://poe.ninja/poe2/pob/ID, poe.ninja/poe2/pob/ID, poe2.ninja/pob/ID, etc.
  const urlMatch = /^(?:https?:\/\/)?poe2?\.ninja\/(?:poe2\/)?pob\/(.+)$/i.exec(trimmed);
  if (urlMatch) {
    // Strip trailing /raw if present
    return urlMatch[1]!.replace(/\/raw$/, '').replace(/\s+$/, '');
  }
  return null;
}

/**
 * Fetch raw PoB code from poe.ninja.
 * @param id - Paste ID (e.g., "19f0c")
 * @returns PoB code string
 * @throws Error on HTTP failure
 */
export async function fetchPoeNinjaCode(id: string): Promise<string> {
  await poeNinjaLimiter.wait();

  const url = `https://poe.ninja/poe2/pob/raw/${encodeURIComponent(id)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
  });

  if (res.status === 404) {
    throw new Error(
      'poe.ninja PoB paste not found. Check the URL and ensure the paste still exists.',
    );
  }
  if (res.status === 429) {
    throw new Error('poe.ninja rate limit exceeded. Try again in a minute.');
  }
  if (!res.ok) {
    throw new Error(`poe.ninja returned HTTP ${res.status}`);
  }

  return res.text();
}

/**
 * Parse a single item text block from PoB XML.
 * @param itemText - Multi-line item text from PoB XML <Item> element
 * @param slot - Equipment slot identifier
 * @returns Parsed item or null if invalid
 */
export function parseItemText(itemText: string, slot: string): PobItem | null {
  const lines = itemText.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) return null;

  // Parse rarity
  const rarityLine = lines[0];
  const rarityMatch = /^Rarity:\s*(\w+)/i.exec(rarityLine ?? '');
  if (!rarityMatch) return null;

  const rarityStr = rarityMatch[1]!.toUpperCase();
  let rarity: PobRarity;
  switch (rarityStr) {
    case 'NORMAL':
      rarity = 'Normal';
      break;
    case 'MAGIC':
      rarity = 'Magic';
      break;
    case 'RARE':
      rarity = 'Rare';
      break;
    case 'UNIQUE':
      rarity = 'Unique';
      break;
    case 'RELIC':
      rarity = 'Relic';
      break;
    default:
      rarity = 'Normal';
  }

  // Name and base type
  let name: string | null = null;
  let base: string;
  if (rarity === 'Rare' || rarity === 'Unique' || rarity === 'Relic') {
    name = lines[1] ?? null;
    base = lines[2] ?? lines[1] ?? '';
  } else {
    base = lines[1] ?? '';
  }

  // Parse numeric values
  let itemLevel = 0;
  let levelRequirement = 0;
  let quality = 0;
  let armour = 0;
  let evasion = 0;
  let energyShield = 0;
  let sockets: string | null = null;
  let corrupted = false;
  const implicits: string[] = [];
  const explicits: string[] = [];

  let inImplicits = false;
  let implicitCount = 0;
  let implicitsParsed = 0;

  for (let i = 3; i < lines.length; i++) {
    const line = lines[i]!.trim();

    // Skip separators
    if (line === '--------') continue;

    // Parse numeric stats
    const itemLevelMatch = /^Item Level:\s*(\d+)/i.exec(line);
    if (itemLevelMatch) {
      itemLevel = parseInt(itemLevelMatch[1]!, 10);
      continue;
    }

    const levelReqMatch = /^Level:\s*(\d+)/i.exec(line);
    if (levelReqMatch) {
      levelRequirement = parseInt(levelReqMatch[1]!, 10);
      continue;
    }

    const qualityMatch = /^Quality:\s*\+?(\d+)%/i.exec(line);
    if (qualityMatch) {
      quality = parseInt(qualityMatch[1]!, 10);
      continue;
    }

    const armourMatch = /^Armou?r:\s*(\d+)/i.exec(line);
    if (armourMatch) {
      armour = parseInt(armourMatch[1]!, 10);
      continue;
    }

    const evasionMatch = /^Evasion(?:\s*Rating)?:\s*(\d+)/i.exec(line);
    if (evasionMatch) {
      evasion = parseInt(evasionMatch[1]!, 10);
      continue;
    }

    const esMatch = /^Energy Shield:\s*(\d+)/i.exec(line);
    if (esMatch) {
      energyShield = parseInt(esMatch[1]!, 10);
      continue;
    }

    const socketsMatch = /^Sockets:\s*(.+)/i.exec(line);
    if (socketsMatch) {
      sockets = socketsMatch[1]!.trim();
      continue;
    }

    // Check for corrupted
    if (line === 'Corrupted') {
      corrupted = true;
      continue;
    }

    // Implicits header
    const implicitsMatch = /^Implicits:\s*(\d+)/i.exec(line);
    if (implicitsMatch) {
      implicitCount = parseInt(implicitsMatch[1]!, 10);
      inImplicits = true;
      implicitsParsed = 0;
      continue;
    }

    // Skip requirement lines
    if (/^(Str|Dex|Int|Requirements):/.test(line)) continue;

    // Collect mods
    if (inImplicits && implicitsParsed < implicitCount) {
      implicits.push(line);
      implicitsParsed++;
      if (implicitsParsed >= implicitCount) {
        inImplicits = false;
      }
    } else if (!line.startsWith('{') || line.includes('}')) {
      // Skip PoB command lines like {variant:1}
      const modLine = line.replace(/^\{[^}]*\}\s*/, '');
      if (modLine && !modLine.startsWith('{')) {
        explicits.push(modLine);
      }
    }
  }

  return {
    slot: slot as PobSlot | string,
    rarity,
    name,
    base,
    itemLevel,
    levelRequirement,
    quality,
    armour,
    evasion,
    energyShield,
    sockets,
    implicits,
    explicits,
    corrupted,
  };
}

/**
 * Parse tree spec URL to extract allocated node IDs.
 * @param specUrl - Tree URL from PoB XML
 * @returns Array of node hash IDs
 */
function parseTreeSpec(specUrl: string): number[] {
  // PoB tree URL format: https://www.pathofexile.com/passive-skill-tree/AAAABg...
  // or just the encoded portion
  const match = /[?/]([A-Za-z0-9_-]+)$/.exec(specUrl);
  if (!match) return [];

  try {
    const base64 = match[1]!.replace(/-/g, '+').replace(/_/g, '/');
    const buffer = Buffer.from(base64, 'base64');

    // The format is: 4 bytes version, 1 byte class, 1 byte ascendancy, then 2-byte node IDs
    const nodes: number[] = [];
    for (let i = 6; i < buffer.length; i += 2) {
      if (i + 1 < buffer.length) {
        nodes.push(buffer.readUInt16BE(i));
      }
    }
    return nodes;
  } catch {
    return [];
  }
}

/**
 * The root element PoB2 (v0.23.1+) requires. PoB1 used `<PathOfBuilding>`;
 * PoB2 renamed it and hard-rejects anything else with
 * "'PathOfBuilding2' root element missing".
 */
export const POB2_ROOT_ELEMENT = 'PathOfBuilding2';

/**
 * Detect the root element name of a PoB XML document.
 * Skips any XML declaration / leading comments.
 * @param xml - Decoded PoB XML string
 * @returns Root tag name (e.g. "PathOfBuilding2") or null if none found
 */
export function detectPobRootElement(xml: string): string | null {
  // Strip XML declaration and comments before locating the first real tag.
  const stripped = xml.replace(/<\?[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  const match = /<([A-Za-z_][\w.-]*)[\s>/]/.exec(stripped);
  return match?.[1] ?? null;
}

/**
 * Parse PoB XML into structured PobBuild object.
 * @param xml - Decoded PoB XML string
 * @param source - Source type ('code' or 'file')
 * @returns Parsed build data
 */
export function parsePobXml(xml: string, source: 'code' | 'file'): PobBuild {
  const warnings: string[] = [];

  // Validate root element: PoB2 requires <PathOfBuilding2>. Accepting anything
  // else (e.g. PoB1's <PathOfBuilding>) lets a build decode here that PoB2 will
  // reject on import with "'PathOfBuilding2' root element missing".
  const rootElement = detectPobRootElement(xml);
  if (rootElement !== POB2_ROOT_ELEMENT) {
    warnings.push(
      `Root element is ${rootElement ? `<${rootElement}>` : 'missing'}, but PoB2 requires ` +
        `<${POB2_ROOT_ELEMENT}>. PoB2 will reject this build on import with ` +
        `"'${POB2_ROOT_ELEMENT}' root element missing".`,
    );
  }

  // Extract <Build> attributes
  const buildMatch = /<Build\s([^>]+)>/i.exec(xml);
  const buildAttrs = buildMatch?.[1] ?? '';

  const getAttr = (name: string): string | null => {
    const match = new RegExp(`${name}="([^"]*)"`, 'i').exec(buildAttrs);
    return match?.[1] ?? null;
  };

  const metadata: PobBuildMetadata = {
    className: getAttr('className') ?? 'Unknown',
    ascendancy: getAttr('ascendClassName') || null,
    level: parseInt(getAttr('level') ?? '1', 10),
    bandit: getAttr('bandit') || null,
    pantheonMajor: getAttr('pantheonMajorGod') || null,
    pantheonMinor: getAttr('pantheonMinorGod') || null,
    mainSocketGroup: getAttr('mainSocketGroup') ? parseInt(getAttr('mainSocketGroup')!, 10) : null,
  };

  // Parse items (handle attributes on Items tag in PoB2 local files)
  const items: PobItem[] = [];
  const itemsMatch = /<Items[^>]*>([\s\S]*?)<\/Items>/i.exec(xml);
  if (itemsMatch) {
    const itemsBlock = itemsMatch[1]!;

    // Extract slot assignments (handle attributes in any order)
    const slotAssignments = new Map<number, string>();
    const slotRegex = /<Slot\s+([^>]+)\/?>/gi;
    let slotMatch;
    while ((slotMatch = slotRegex.exec(itemsBlock)) !== null) {
      const attrs = slotMatch[1]!;
      const nameMatch = /name="([^"]+)"/.exec(attrs);
      const itemIdMatch = /itemId="(\d+)"/.exec(attrs);
      if (nameMatch && itemIdMatch) {
        const itemId = parseInt(itemIdMatch[1]!, 10);
        if (itemId > 0) {
          slotAssignments.set(itemId, nameMatch[1]!);
        }
      }
    }

    // Extract item blocks
    const itemRegex = /<Item\s+id="(\d+)"[^>]*>([\s\S]*?)<\/Item>/gi;
    let itemMatch;
    while ((itemMatch = itemRegex.exec(itemsBlock)) !== null) {
      const itemId = parseInt(itemMatch[1]!, 10);
      const itemText = itemMatch[2]!
        .replace(/<!?\[CDATA\[/g, '')
        .replace(/\]\]>/g, '')
        .replace(/<ModRange[^>]*\/>/gi, '') // Strip PoB2 ModRange elements
        .replace(/<[^>]+>/g, '') // Strip any remaining XML tags
        .trim();
      const slot = slotAssignments.get(itemId) ?? `Item ${itemId}`;
      const parsed = parseItemText(itemText, slot);
      if (parsed) {
        items.push(parsed);
      }
    }
  }

  // Parse skills (handle SkillSet wrapping in PoB2 local files)
  const skills: PobSkillGroup[] = [];
  const skillsMatch = /<Skills[^>]*>([\s\S]*?)<\/Skills>/i.exec(xml);
  if (skillsMatch) {
    // Search entire skills block including inside SkillSet elements
    const skillsBlock = skillsMatch[1]!;
    const skillRegex = /<Skill\s+([^>]*)>([\s\S]*?)<\/Skill>|<Skill\s+([^>]*)\s*\/>/gi;
    let skillMatch;
    while ((skillMatch = skillRegex.exec(skillsBlock)) !== null) {
      const attrs = skillMatch[1] || skillMatch[3] || '';
      const content = skillMatch[2] || '';

      const getLabelAttr = (name: string): string | null => {
        const match = new RegExp(`${name}="([^"]*)"`, 'i').exec(attrs);
        return match?.[1] ?? null;
      };

      const enabled = getLabelAttr('enabled') !== 'false';
      const label = getLabelAttr('label') || null;
      const slot = getLabelAttr('slot') || null;

      const gems: PobGem[] = [];
      const gemRegex = /<Gem\s+([^>]+)\s*\/?>/gi;
      let gemMatch;
      while ((gemMatch = gemRegex.exec(content)) !== null) {
        const gemAttrs = gemMatch[1]!;
        const getGemAttr = (name: string): string | null => {
          const match = new RegExp(`${name}="([^"]*)"`, 'i').exec(gemAttrs);
          return match?.[1] ?? null;
        };

        // Prefer nameSpec for friendly name, fall back to gemId (metadata path)
        const nameSpec = getGemAttr('nameSpec');
        const gemId = getGemAttr('gemId') ?? '';
        const displayName = nameSpec ?? getGemAttr('skillId') ?? gemId ?? 'Unknown';
        const isSupport =
          displayName.toLowerCase().includes('support') || gemId.toLowerCase().includes('support');

        gems.push({
          name: displayName,
          nameSpec: nameSpec ?? displayName,
          level: parseInt(getGemAttr('level') ?? '1', 10),
          quality: parseInt(getGemAttr('quality') ?? '0', 10),
          enabled: getGemAttr('enabled') !== 'false',
          isSupport,
        });
      }

      const activeGem = gems.find((g) => !g.isSupport && g.enabled) ?? null;
      const supportGems = gems.filter((g) => g.isSupport && g.enabled);

      skills.push({
        label,
        slot,
        enabled,
        gems,
        activeGem,
        supportGems,
      });
    }
  }

  // Parse tree
  const treeMatch = /<Tree\s+([^>]*)>([\s\S]*?)<\/Tree>/i.exec(xml);
  const treeAttrs = treeMatch?.[1] ?? '';
  const treeContent = treeMatch?.[2] ?? '';

  const activeSpec = parseInt(
    new RegExp('activeSpec="(\\d+)"', 'i').exec(treeAttrs)?.[1] ?? '1',
    10,
  );

  // Find the active Spec element
  let allocatedNodes: number[] = [];
  let treeVersion = '0.4';
  const specRegex = /<Spec\s+([^>]*)>([\s\S]*?)<\/Spec>/gi;
  let specIndex = 1;
  let specMatch;
  while ((specMatch = specRegex.exec(treeContent)) !== null) {
    if (specIndex === activeSpec) {
      const specAttrs = specMatch[1] ?? '';
      const specContent = specMatch[2] ?? '';

      const versionMatch = /treeVersion="([^"]+)"/i.exec(specAttrs);
      if (versionMatch) treeVersion = versionMatch[1]!;

      // Extract URL with encoded nodes
      const urlMatch = /<URL>([\s\S]*?)<\/URL>/i.exec(specContent);
      if (urlMatch) {
        allocatedNodes = parseTreeSpec(urlMatch[1]!.trim());
      }
      break;
    }
    specIndex++;
  }

  // Parse masteries
  const masteryEffects: Array<{ nodeId: number; effectId: number }> = [];
  const masteryRegex = /<MasteryEffect\s+([^>]+)\s*\/?>/gi;
  let masteryMatch;
  while ((masteryMatch = masteryRegex.exec(treeContent)) !== null) {
    const attrs = masteryMatch[1]!;
    const nodeId = parseInt(new RegExp('nodeId="(\\d+)"', 'i').exec(attrs)?.[1] ?? '0', 10);
    const effectId = parseInt(new RegExp('effect="(\\d+)"', 'i').exec(attrs)?.[1] ?? '0', 10);
    if (nodeId && effectId) {
      masteryEffects.push({ nodeId, effectId });
    }
  }

  const tree: PobPassiveTree = {
    version: treeVersion,
    activeSpec,
    allocatedNodes,
    masteryEffects,
  };

  // Parse config
  const config: PobConfig = {};
  const configMatch = /<Config>([\s\S]*?)<\/Config>/i.exec(xml);
  if (configMatch) {
    const configRegex = /<Input\s+([^>]+)\s*\/?>/gi;
    let configEntry;
    while ((configEntry = configRegex.exec(configMatch[1]!)) !== null) {
      const attrs = configEntry[1]!;
      const name = new RegExp('name="([^"]*)"', 'i').exec(attrs)?.[1];
      let value: string | boolean | number | null = null;

      const boolMatch = /boolean="(\w+)"/i.exec(attrs);
      const numMatch = /number="([\d.]+)"/i.exec(attrs);
      const strMatch = /string="([^"]*)"/i.exec(attrs);

      if (boolMatch) value = boolMatch[1] === 'true';
      else if (numMatch) value = parseFloat(numMatch[1]!);
      else if (strMatch) value = strMatch[1]!;

      if (name && value !== null) {
        config[name] = value;
      }
    }
  }

  // Parse notes
  const notesMatch = /<Notes>([\s\S]*?)<\/Notes>/i.exec(xml);
  const notes =
    notesMatch?.[1]
      ?.replace(/<!?\[CDATA\[/g, '')
      .replace(/\]\]>/g, '')
      .trim() ?? '';

  return {
    metadata,
    items,
    skills,
    tree,
    resolvedTree: null, // Tree resolution requires external tree data
    config,
    notes,
    xmlSource: source,
    warnings,
  };
}

/**
 * Resolve the PoB2 builds directory path.
 * @param overridePath - Optional CLI-provided path
 * @returns Resolved path or null if not found
 */
export function resolvePob2BuildsPath(overridePath?: string): string | null {
  if (overridePath && existsSync(overridePath)) {
    try {
      const stat = statSync(overridePath);
      if (stat.isDirectory()) return overridePath;
    } catch {
      // ignore
    }
  }

  const candidates = DEFAULT_POB2_PATHS[process.platform] ?? [];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      try {
        const stat = statSync(candidate);
        if (stat.isDirectory()) return candidate;
      } catch {
        // ignore
      }
    }
  }

  return null;
}

/**
 * List saved PoB2 build files with basic metadata.
 * @param buildsPath - Path to PoB2 Builds directory
 * @returns Array of build entries sorted by lastModified descending
 */
/**
 * Recursively collect all .xml build files under a directory. PoB2 organizes
 * saved builds in nested folders (e.g. `Builds/0.5/My Build/build.xml`), so a
 * flat scan misses everything — we walk subdirectories (depth-limited).
 */
function collectBuildFiles(root: string, dir: string = root, depth: number = 0): string[] {
  if (depth > 6) return [];
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }

  const found: string[] = [];
  for (const name of names) {
    const full = path.join(dir, name);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      found.push(...collectBuildFiles(root, full, depth + 1));
    } else if (stat.isFile() && name.toLowerCase().endsWith('.xml')) {
      found.push(full);
    }
  }
  return found;
}

/** Build's identifying name relative to the Builds root, with forward slashes. */
function buildRelName(root: string, filePath: string): string {
  return path
    .relative(root, filePath)
    .replace(/\.xml$/i, '')
    .replace(/\\/g, '/');
}

export function listPob2Builds(buildsPath: string): PobLocalBuildEntry[] {
  const entries: PobLocalBuildEntry[] = [];

  for (const filePath of collectBuildFiles(buildsPath)) {
    try {
      const stat = statSync(filePath);
      if (!stat.isFile()) continue;

      // Read first ~1KB to extract Build attributes without full parsing
      const content = readFileSync(filePath, { encoding: 'utf-8' }).slice(0, 1024);

      let className: string | null = null;
      let ascendancy: string | null = null;
      let level: number | null = null;

      const classMatch = /className="([^"]+)"/i.exec(content);
      if (classMatch) className = classMatch[1]!;

      const ascMatch = /ascendClassName="([^"]+)"/i.exec(content);
      if (ascMatch) ascendancy = ascMatch[1]!;

      const levelMatch = /level="(\d+)"/i.exec(content);
      if (levelMatch) level = parseInt(levelMatch[1]!, 10);

      entries.push({
        filename: buildRelName(buildsPath, filePath),
        className,
        ascendancy,
        level,
        lastModified: stat.mtime,
      });
    } catch {
      // Skip corrupted files
    }
  }

  return entries.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
}

/**
 * Read a specific PoB2 build file by name or substring match.
 * @param buildsPath - Path to PoB2 Builds directory
 * @param buildName - Filename (without .xml) or substring to match
 * @returns Parsed PobBuild or null if not found
 */
export function readPob2Build(buildsPath: string, buildName: string): PobBuild | null {
  const files = collectBuildFiles(buildsPath);
  if (files.length === 0) return null;

  const lowerName = buildName.toLowerCase().replace(/\.xml$/i, '').replace(/\\/g, '/');
  const rel = (f: string) => buildRelName(buildsPath, f).toLowerCase();
  const base = (f: string) => path.basename(f, '.xml').toLowerCase();

  // Exact match on relative name or bare filename first
  let matchedFile = files.find((f) => rel(f) === lowerName || base(f) === lowerName);

  // Substring match (relative path, so "amazon" or "0.5/amazon" both work)
  if (!matchedFile) {
    matchedFile = files.find((f) => rel(f).includes(lowerName));
  }

  if (!matchedFile) return null;

  try {
    const content = readFileSync(matchedFile, 'utf-8');
    return parsePobXml(content, 'file');
  } catch {
    throw new Error(
      `Failed to parse build file "${buildRelName(buildsPath, matchedFile)}": file may be corrupted`,
    );
  }
}

/**
 * Compare two PoB builds and return structured diff.
 * @param current - Current/player build
 * @param reference - Reference/guide build
 * @returns Comparison result
 */
export function comparePobBuilds(current: PobBuild, reference: PobBuild): PobCompareResult {
  // Build slot → item maps
  const currentItems = new Map(current.items.map((i) => [i.slot, i]));
  const referenceItems = new Map(reference.items.map((i) => [i.slot, i]));

  const upgradesNeeded: PobItemDiff[] = [];
  const matching: string[] = [];
  const missingInCurrent: string[] = [];

  for (const [slot, refItem] of referenceItems) {
    const curItem = currentItems.get(slot);

    if (!curItem) {
      missingInCurrent.push(slot);
      continue;
    }

    // Compare by base type
    if (curItem.base === refItem.base && curItem.rarity === refItem.rarity) {
      matching.push(slot);
    } else {
      // Compute delta
      const deltas: string[] = [];
      const esDiff = refItem.energyShield - curItem.energyShield;
      const armDiff = refItem.armour - curItem.armour;
      const evaDiff = refItem.evasion - curItem.evasion;

      if (esDiff !== 0) deltas.push(`${esDiff > 0 ? '+' : ''}${esDiff} ES`);
      if (armDiff !== 0) deltas.push(`${armDiff > 0 ? '+' : ''}${armDiff} Armour`);
      if (evaDiff !== 0) deltas.push(`${evaDiff > 0 ? '+' : ''}${evaDiff} Evasion`);

      upgradesNeeded.push({
        slot,
        current: curItem,
        reference: refItem,
        delta: deltas.length > 0 ? deltas.join(', ') : null,
      });
    }
  }

  // Tree comparison (using raw node IDs since we don't have tree data)
  const currentNodes = new Set(current.tree.allocatedNodes);
  const referenceNodes = new Set(reference.tree.allocatedNodes);

  const missingNodes = [...referenceNodes]
    .filter((n) => !currentNodes.has(n))
    .map((n) => n.toString());
  const extraNodes = [...currentNodes]
    .filter((n) => !referenceNodes.has(n))
    .map((n) => n.toString());

  // Skills comparison
  const currentGems = new Set(
    current.skills.flatMap((s) => s.gems.filter((g) => g.enabled).map((g) => g.name)),
  );
  const referenceGems = new Set(
    reference.skills.flatMap((s) => s.gems.filter((g) => g.enabled).map((g) => g.name)),
  );

  const missingGems = [...referenceGems].filter((g) => !currentGems.has(g));
  const extraGems = [...currentGems].filter((g) => !referenceGems.has(g));

  // Different supports comparison
  const differentSupports: PobSkillDiff['differentSupports'] = [];
  for (const refSkill of reference.skills) {
    if (!refSkill.activeGem) continue;
    const curSkill = current.skills.find((s) => s.activeGem?.name === refSkill.activeGem?.name);
    if (curSkill) {
      const refSupports = new Set(refSkill.supportGems.map((g) => g.name));
      const curSupports = new Set(curSkill.supportGems.map((g) => g.name));

      for (const ref of refSupports) {
        if (!curSupports.has(ref)) {
          const curSupportList = [...curSupports].join(', ') || 'none';
          differentSupports.push({
            skill: refSkill.activeGem.name,
            currentSupport: curSupportList,
            referenceSupport: ref,
          });
          break; // One diff per skill is enough
        }
      }
    }
  }

  // Generate summary
  const parts: string[] = [];
  if (upgradesNeeded.length > 0) {
    parts.push(`${upgradesNeeded.length} item upgrade(s) needed`);
  }
  if (missingInCurrent.length > 0) {
    parts.push(`${missingInCurrent.length} slot(s) empty`);
  }
  if (missingNodes.length > 0) {
    parts.push(`${missingNodes.length} passive node(s) missing`);
  }
  if (missingGems.length > 0) {
    parts.push(`${missingGems.length} gem(s) missing`);
  }
  const summary = parts.length > 0 ? parts.join(', ') : 'Builds match closely';

  return {
    summary,
    items: {
      upgradesNeeded,
      matching,
      missingInCurrent,
    },
    tree: {
      missingNodes,
      extraNodes,
      matchingKeystones: [], // Requires tree data for keystone identification
    },
    skills: {
      missingGems,
      extraGems,
      differentSupports,
    },
  };
}
