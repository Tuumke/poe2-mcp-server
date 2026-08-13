import { describe, it, expect, vi, beforeEach } from 'vitest';
import { deflateRawSync, deflateSync } from 'zlib';
import {
  decodePobCode,
  extractPobbinId,
  extractPoeNinjaId,
  fetchPobbinCode,
  fetchPoeNinjaCode,
  parseItemText,
  parsePobXml,
  detectPobRootElement,
  comparePobBuilds,
  type PobBuild,
  type PobItem,
} from './pob.js';

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('decodePobCode', () => {
  it('decodes raw deflate format (PoB2 default)', () => {
    const xml = '<Build className="Witch" level="1"></Build>';
    const compressed = deflateRawSync(Buffer.from(xml, 'utf-8'));
    const base64 = compressed.toString('base64').replace(/\+/g, '-').replace(/\//g, '_');

    const result = decodePobCode(base64);

    expect(result).toBe(xml);
  });

  it('decodes zlib format (PoB1/legacy)', () => {
    const xml = '<Build className="Witch" level="1"></Build>';
    const compressed = deflateSync(Buffer.from(xml, 'utf-8'));
    const base64 = compressed.toString('base64').replace(/\+/g, '-').replace(/\//g, '_');

    const result = decodePobCode(base64);

    expect(result).toBe(xml);
  });

  it('handles codes with leading/trailing whitespace', () => {
    const xml = '<Build />';
    const compressed = deflateSync(Buffer.from(xml, 'utf-8'));
    const base64 = compressed.toString('base64').replace(/\+/g, '-').replace(/\//g, '_');

    const result = decodePobCode(`  ${base64}  \n`);

    expect(result).toBe(xml);
  });

  it('handles internal whitespace and line breaks (AI agent line-wrapping)', () => {
    const xml = '<Build className="Witch" level="1"></Build>';
    const compressed = deflateRawSync(Buffer.from(xml, 'utf-8'));
    const base64 = compressed.toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
    const wrapped = base64.match(/.{1,20}/g)!.join('\n');

    const result = decodePobCode(wrapped);

    expect(result).toBe(xml);
  });

  it('handles Unicode dash look-alikes from AI agents', () => {
    const xml = '<Build className="Witch" level="1"></Build>';
    const compressed = deflateRawSync(Buffer.from(xml, 'utf-8'));
    const base64 = compressed.toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
    const mangled = base64.replace(/-/g, '\u2013');

    const result = decodePobCode(mangled);

    expect(result).toBe(xml);
  });

  it('handles URL-encoded characters (%2B, %2F, %3D)', () => {
    const xml = '<Build className="Witch" level="1"></Build>';
    const compressed = deflateSync(Buffer.from(xml, 'utf-8'));
    const base64 = compressed.toString('base64');
    const urlEncoded = base64.replace(/\+/g, '%2B').replace(/\//g, '%2F').replace(/=/g, '%3D');

    const result = decodePobCode(urlEncoded);

    expect(result).toBe(xml);
  });

  it('throws on empty string', () => {
    expect(() => decodePobCode('')).toThrow('empty input');
  });

  it('throws on whitespace-only string', () => {
    expect(() => decodePobCode('  \n\t  ')).toThrow('empty input');
  });

  it('throws on invalid zlib data with diagnostic info', () => {
    const invalidData = Buffer.from('not-zlib-data').toString('base64');

    expect(() => decodePobCode(invalidData)).toThrow('decompression failed');
    expect(() => decodePobCode(invalidData)).toThrow('Header bytes:');
    expect(() => decodePobCode(invalidData)).toThrow('inflateRaw error:');
    expect(() => decodePobCode(invalidData)).toThrow('inflate error:');
    expect(() => decodePobCode(invalidData)).toThrow('truncated or corrupted');
  });
});

describe('extractPobbinId', () => {
  it.each([
    { input: 'https://pobb.in/abc123', expected: 'abc123' },
    { input: 'http://pobb.in/abc123', expected: 'abc123' },
    { input: 'pobb.in/abc123', expected: 'abc123' },
    { input: 'POBB.IN/abc123', expected: 'abc123' },
    { input: 'https://pobb.in/u/username/abc123', expected: 'u/username/abc123' },
  ])('extracts "$expected" from "$input"', ({ input, expected }) => {
    expect(extractPobbinId(input)).toBe(expected);
  });

  it('strips trailing /raw from paste ID', () => {
    expect(extractPobbinId('https://pobb.in/abc123/raw')).toBe('abc123');
  });

  it('handles whitespace around URL', () => {
    expect(extractPobbinId('  pobb.in/test123  ')).toBe('test123');
  });

  it.each([
    { input: 'eNrtVV1v2jAU...', reason: 'PoB code' },
    { input: 'https://pastebin.com/abc', reason: 'different domain' },
    { input: 'not a url', reason: 'plain text' },
    { input: '', reason: 'empty string' },
  ])('returns null for "$input" ($reason)', ({ input }) => {
    expect(extractPobbinId(input)).toBeNull();
  });
});

describe('fetchPobbinCode', () => {
  it('fetches raw paste content with encoded ID', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('eNrtVV1v...'),
      }),
    );

    const result = await fetchPobbinCode('abc123');

    expect(fetch).toHaveBeenCalledWith('https://pobb.in/abc123/raw', expect.any(Object));
    expect(result).toBe('eNrtVV1v...');
  });

  it('throws specific error on 404', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));

    await expect(fetchPobbinCode('invalid')).rejects.toThrow('paste not found');
  });

  it('throws rate limit error on 429', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429 }));

    await expect(fetchPobbinCode('test')).rejects.toThrow('rate limit exceeded');
  });

  it('throws generic error on other HTTP errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    await expect(fetchPobbinCode('test')).rejects.toThrow('HTTP 500');
  });
});

describe('extractPoeNinjaId', () => {
  it.each([
    { input: 'https://poe.ninja/poe2/pob/19f0c', expected: '19f0c' },
    { input: 'http://poe.ninja/poe2/pob/19f0c', expected: '19f0c' },
    { input: 'poe.ninja/poe2/pob/19f0c', expected: '19f0c' },
    { input: 'POE.NINJA/poe2/pob/19f0c', expected: '19f0c' },
    { input: 'poe2.ninja/pob/19f0c', expected: '19f0c' },
    { input: 'https://poe2.ninja/pob/19f0c', expected: '19f0c' },
    { input: 'poe2.ninja/poe2/pob/19f0c', expected: '19f0c' },
    { input: 'pob2://poeninja/19f0c', expected: '19f0c' },
    { input: 'pob2:\\\\poeninja\\19f0c', expected: '19f0c' },
  ])('extracts "$expected" from "$input"', ({ input, expected }) => {
    expect(extractPoeNinjaId(input)).toBe(expected);
  });

  it('strips trailing /raw from paste ID', () => {
    expect(extractPoeNinjaId('https://poe.ninja/poe2/pob/19f0c/raw')).toBe('19f0c');
  });

  it('handles whitespace around URL', () => {
    expect(extractPoeNinjaId('  poe.ninja/poe2/pob/19f0c  ')).toBe('19f0c');
  });

  it.each([
    { input: 'pobb.in/abc123', reason: 'pobb.in URL' },
    { input: 'eNrtVV1v2jAU...', reason: 'PoB code' },
    { input: 'poe.ninja/poe2/builds', reason: 'builds page, not pob' },
    { input: '', reason: 'empty string' },
  ])('returns null for "$input" ($reason)', ({ input }) => {
    expect(extractPoeNinjaId(input)).toBeNull();
  });
});

describe('fetchPoeNinjaCode', () => {
  it('fetches raw paste content with encoded ID', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('eNrtVV1v...'),
      }),
    );

    const result = await fetchPoeNinjaCode('19f0c');

    expect(fetch).toHaveBeenCalledWith('https://poe.ninja/poe2/pob/raw/19f0c', expect.any(Object));
    expect(result).toBe('eNrtVV1v...');
  });

  it('throws specific error on 404', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));

    await expect(fetchPoeNinjaCode('invalid')).rejects.toThrow('paste not found');
  });

  it('throws rate limit error on 429', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429 }));

    await expect(fetchPoeNinjaCode('test')).rejects.toThrow('rate limit exceeded');
  });

  it('throws generic error on other HTTP errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    await expect(fetchPoeNinjaCode('test')).rejects.toThrow('HTTP 500');
  });
});

describe('parseItemText', () => {
  it('parses rare item with name and base', () => {
    const itemText = `Rarity: Rare
Doom Veil
Carved Visage
Item Level: 75
Armour: 150
Implicits: 0
+50 to Maximum Life`;

    const result = parseItemText(itemText, 'Helmet');

    expect(result).toMatchObject({
      slot: 'Helmet',
      rarity: 'Rare',
      name: 'Doom Veil',
      base: 'Carved Visage',
      itemLevel: 75,
      armour: 150,
    });
    expect(result?.explicits).toContain('+50 to Maximum Life');
  });

  it('parses unique item', () => {
    const itemText = `Rarity: Unique
Goldrim
Carved Visage
Item Level: 1
Evasion: 100
Energy Shield: 50
Implicits: 1
+1 to Level of Socketed Gems
+35 to All Attributes`;

    const result = parseItemText(itemText, 'Helmet');

    expect(result).toMatchObject({
      rarity: 'Unique',
      name: 'Goldrim',
      base: 'Carved Visage',
      evasion: 100,
      energyShield: 50,
    });
    expect(result?.implicits).toContain('+1 to Level of Socketed Gems');
    expect(result?.explicits).toContain('+35 to All Attributes');
  });

  it('parses magic item without separate name', () => {
    const itemText = `Rarity: Magic
Sturdy Iron Ring of Life
Item Level: 10
Implicits: 0
+10 to Maximum Life`;

    const result = parseItemText(itemText, 'Ring 1');

    expect(result).toMatchObject({
      rarity: 'Magic',
      name: null,
      base: 'Sturdy Iron Ring of Life',
    });
  });

  it('parses corrupted flag', () => {
    const itemText = `Rarity: Rare
Test Item
Base Item
Item Level: 80
Implicits: 0
+10 to Strength
Corrupted`;

    const result = parseItemText(itemText, 'Amulet');

    expect(result?.corrupted).toBe(true);
  });

  it('parses quality', () => {
    const itemText = `Rarity: Rare
Test Chest
Vaal Regalia
Quality: +20%
Item Level: 84
Energy Shield: 500
Implicits: 0
+100 to Maximum Life`;

    const result = parseItemText(itemText, 'Body Armour');

    expect(result?.quality).toBe(20);
  });

  it('returns null for insufficient lines', () => {
    expect(parseItemText('Rarity: Rare', 'Helmet')).toBeNull();
    expect(parseItemText('', 'Helmet')).toBeNull();
  });

  it('returns null for missing rarity header', () => {
    const itemText = `Name Only
Base Item Only`;

    expect(parseItemText(itemText, 'Helmet')).toBeNull();
  });
});

describe('parsePobXml', () => {
  const minimalXml = `
<PathOfBuilding2>
  <Build className="Witch" ascendClassName="Necromancer" level="95" bandit="None">
  </Build>
  <Items></Items>
  <Skills></Skills>
  <Tree activeSpec="1">
    <Spec treeVersion="0.4">
      <URL></URL>
    </Spec>
  </Tree>
  <Config></Config>
  <Notes>Test notes</Notes>
</PathOfBuilding2>`;

  it('extracts build metadata', () => {
    const result = parsePobXml(minimalXml, 'code');

    expect(result.metadata).toMatchObject({
      className: 'Witch',
      ascendancy: 'Necromancer',
      level: 95,
      bandit: 'None',
    });
    expect(result.xmlSource).toBe('code');
    expect(result.warnings).toEqual([]);
  });

  it('extracts notes', () => {
    const result = parsePobXml(minimalXml, 'file');

    expect(result.notes).toBe('Test notes');
    expect(result.xmlSource).toBe('file');
  });

  it('parses items from Items block', () => {
    const xml = `
<PathOfBuilding2>
  <Build className="Witch" level="1"></Build>
  <Items>
    <Slot name="Helmet" itemId="1"/>
    <Item id="1">
Rarity: Rare
Test Helm
Iron Hat
Item Level: 50
Armour: 100
Implicits: 0
+30 to Maximum Life
    </Item>
  </Items>
  <Skills></Skills>
  <Tree activeSpec="1"><Spec treeVersion="0.4"><URL></URL></Spec></Tree>
  <Config></Config>
  <Notes></Notes>
</PathOfBuilding2>`;

    const result = parsePobXml(xml, 'code');

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      slot: 'Helmet',
      rarity: 'Rare',
      name: 'Test Helm',
      base: 'Iron Hat',
      armour: 100,
    });
  });

  it('parses skills and gems', () => {
    const xml = `
<PathOfBuilding2>
  <Build className="Witch" level="1"></Build>
  <Items></Items>
  <Skills>
    <Skill enabled="true" label="Main Setup">
      <Gem nameSpec="Fireball" level="20" quality="20" enabled="true"/>
      <Gem nameSpec="Greater Multiple Projectiles Support" level="20" quality="0" enabled="true"/>
    </Skill>
  </Skills>
  <Tree activeSpec="1"><Spec treeVersion="0.4"><URL></URL></Spec></Tree>
  <Config></Config>
  <Notes></Notes>
</PathOfBuilding2>`;

    const result = parsePobXml(xml, 'code');

    expect(result.skills).toHaveLength(1);
    expect(result.skills[0]?.label).toBe('Main Setup');
    expect(result.skills[0]?.gems).toHaveLength(2);
    expect(result.skills[0]?.activeGem?.name).toBe('Fireball');
    expect(result.skills[0]?.supportGems).toHaveLength(1);
    expect(result.skills[0]?.supportGems[0]?.name).toBe('Greater Multiple Projectiles Support');
  });

  it('parses config values', () => {
    const xml = `
<PathOfBuilding2>
  <Build className="Witch" level="1"></Build>
  <Items></Items>
  <Skills></Skills>
  <Tree activeSpec="1"><Spec treeVersion="0.4"><URL></URL></Spec></Tree>
  <Config>
    <Input name="enemyIsBoss" boolean="true"/>
    <Input name="enemyLevel" number="83"/>
    <Input name="customMod" string="test value"/>
  </Config>
  <Notes></Notes>
</PathOfBuilding2>`;

    const result = parsePobXml(xml, 'code');

    expect(result.config).toEqual({
      enemyIsBoss: true,
      enemyLevel: 83,
      customMod: 'test value',
    });
  });

  it('handles missing optional sections gracefully', () => {
    const xml = '<PathOfBuilding2><Build className="Ranger" level="1"></Build></PathOfBuilding2>';

    const result = parsePobXml(xml, 'code');

    expect(result.metadata.className).toBe('Ranger');
    expect(result.items).toEqual([]);
    expect(result.skills).toEqual([]);
    expect(result.notes).toBe('');
  });

  it('warns when root element is PoB1 <PathOfBuilding> instead of <PathOfBuilding2>', () => {
    const xml = '<PathOfBuilding><Build className="Ranger" level="1"></Build></PathOfBuilding>';

    const result = parsePobXml(xml, 'code');

    // Still parses (lenient), but flags the mismatch PoB2 would reject on import.
    expect(result.metadata.className).toBe('Ranger');
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('<PathOfBuilding>');
    expect(result.warnings[0]).toContain("'PathOfBuilding2' root element missing");
  });

  it('warns when root element is missing entirely', () => {
    const xml = '<Build className="Ranger" level="1"></Build>';

    const result = parsePobXml(xml, 'code');

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('PathOfBuilding2');
  });

  it('handles an XML declaration before the root element', () => {
    const xml =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<PathOfBuilding2><Build className="Ranger" level="1"></Build></PathOfBuilding2>';

    const result = parsePobXml(xml, 'code');

    expect(result.warnings).toEqual([]);
  });
});

describe('detectPobRootElement', () => {
  it('detects PathOfBuilding2 root', () => {
    expect(detectPobRootElement('<PathOfBuilding2><Build/></PathOfBuilding2>')).toBe(
      'PathOfBuilding2',
    );
  });

  it('detects root with attributes', () => {
    expect(detectPobRootElement('<PathOfBuilding2 version="2">')).toBe('PathOfBuilding2');
  });

  it('skips XML declaration', () => {
    expect(detectPobRootElement('<?xml version="1.0"?><PathOfBuilding2>')).toBe('PathOfBuilding2');
  });

  it('returns null when no tag present', () => {
    expect(detectPobRootElement('not xml at all')).toBeNull();
  });
});

describe('comparePobBuilds', () => {
  const createMockBuild = (overrides: Partial<PobBuild> = {}): PobBuild => ({
    metadata: {
      className: 'Witch',
      ascendancy: 'Necromancer',
      level: 90,
      bandit: null,
      pantheonMajor: null,
      pantheonMinor: null,
      mainSocketGroup: null,
    },
    items: [],
    skills: [],
    tree: { version: '0.4', activeSpec: 1, allocatedNodes: [], masteryEffects: [] },
    resolvedTree: null,
    config: {},
    notes: '',
    xmlSource: 'code',
    warnings: [],
    ...overrides,
  });

  const createMockItem = (overrides: Partial<PobItem> = {}): PobItem => ({
    slot: 'Helmet',
    rarity: 'Rare',
    name: 'Test Item',
    base: 'Iron Hat',
    itemLevel: 80,
    levelRequirement: 60,
    quality: 0,
    armour: 0,
    evasion: 0,
    energyShield: 0,
    sockets: null,
    implicits: [],
    explicits: [],
    corrupted: false,
    ...overrides,
  });

  it('identifies matching items by slot, base, and rarity', () => {
    const helmet = createMockItem({ slot: 'Helmet', base: 'Iron Hat', rarity: 'Rare' });
    const current = createMockBuild({ items: [helmet] });
    const reference = createMockBuild({ items: [{ ...helmet }] });

    const result = comparePobBuilds(current, reference);

    expect(result.items.matching).toContain('Helmet');
    expect(result.items.upgradesNeeded).toHaveLength(0);
    expect(result.items.missingInCurrent).toHaveLength(0);
  });

  it('identifies missing items in current build', () => {
    const refHelmet = createMockItem({ slot: 'Helmet' });
    const current = createMockBuild({ items: [] });
    const reference = createMockBuild({ items: [refHelmet] });

    const result = comparePobBuilds(current, reference);

    expect(result.items.missingInCurrent).toContain('Helmet');
  });

  it('identifies upgrades needed with delta stats', () => {
    const curHelmet = createMockItem({ slot: 'Helmet', base: 'Iron Hat', armour: 100 });
    const refHelmet = createMockItem({ slot: 'Helmet', base: 'Steel Helm', armour: 200 });
    const current = createMockBuild({ items: [curHelmet] });
    const reference = createMockBuild({ items: [refHelmet] });

    const result = comparePobBuilds(current, reference);

    expect(result.items.upgradesNeeded).toHaveLength(1);
    expect(result.items.upgradesNeeded[0]?.slot).toBe('Helmet');
    expect(result.items.upgradesNeeded[0]?.delta).toContain('+100 Armour');
  });

  it('compares passive tree nodes', () => {
    const current = createMockBuild({
      tree: { version: '0.4', activeSpec: 1, allocatedNodes: [1, 2, 3], masteryEffects: [] },
    });
    const reference = createMockBuild({
      tree: { version: '0.4', activeSpec: 1, allocatedNodes: [2, 3, 4, 5], masteryEffects: [] },
    });

    const result = comparePobBuilds(current, reference);

    expect(result.tree.missingNodes).toEqual(['4', '5']);
    expect(result.tree.extraNodes).toEqual(['1']);
  });

  it('compares skill gems', () => {
    const current = createMockBuild({
      skills: [
        {
          label: 'Main',
          slot: null,
          enabled: true,
          gems: [
            {
              name: 'Fireball',
              nameSpec: 'Fireball',
              level: 20,
              quality: 0,
              enabled: true,
              isSupport: false,
            },
          ],
          activeGem: {
            name: 'Fireball',
            nameSpec: 'Fireball',
            level: 20,
            quality: 0,
            enabled: true,
            isSupport: false,
          },
          supportGems: [],
        },
      ],
    });
    const reference = createMockBuild({
      skills: [
        {
          label: 'Main',
          slot: null,
          enabled: true,
          gems: [
            {
              name: 'Fireball',
              nameSpec: 'Fireball',
              level: 20,
              quality: 0,
              enabled: true,
              isSupport: false,
            },
            {
              name: 'GMP Support',
              nameSpec: 'GMP Support',
              level: 20,
              quality: 0,
              enabled: true,
              isSupport: true,
            },
          ],
          activeGem: {
            name: 'Fireball',
            nameSpec: 'Fireball',
            level: 20,
            quality: 0,
            enabled: true,
            isSupport: false,
          },
          supportGems: [
            {
              name: 'GMP Support',
              nameSpec: 'GMP Support',
              level: 20,
              quality: 0,
              enabled: true,
              isSupport: true,
            },
          ],
        },
      ],
    });

    const result = comparePobBuilds(current, reference);

    expect(result.skills.missingGems).toContain('GMP Support');
  });

  it('generates summary with all differences', () => {
    const curItem = createMockItem({ slot: 'Helmet', base: 'Iron Hat' });
    const refItem = createMockItem({ slot: 'Helmet', base: 'Steel Helm' });
    const current = createMockBuild({
      items: [curItem],
      tree: { version: '0.4', activeSpec: 1, allocatedNodes: [1], masteryEffects: [] },
    });
    const reference = createMockBuild({
      items: [refItem],
      tree: { version: '0.4', activeSpec: 1, allocatedNodes: [1, 2], masteryEffects: [] },
    });

    const result = comparePobBuilds(current, reference);

    expect(result.summary).toContain('item upgrade');
    expect(result.summary).toContain('passive node');
  });

  it('returns matching summary when builds are identical', () => {
    const item = createMockItem({ slot: 'Helmet' });
    const build = createMockBuild({
      items: [item],
      tree: { version: '0.4', activeSpec: 1, allocatedNodes: [1, 2, 3], masteryEffects: [] },
    });

    const result = comparePobBuilds(build, build);

    expect(result.summary).toContain('match closely');
  });
});
