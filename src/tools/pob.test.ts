import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { deflateRawSync, deflateSync } from 'zlib';

vi.mock('../services/api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/api.js')>();
  return {
    ...actual,
    fetchPobbinCode: vi.fn(),
    fetchPoeNinjaCode: vi.fn(),
    resolvePob2BuildsPath: vi.fn(),
    listPob2Builds: vi.fn(),
    readPob2Build: vi.fn(),
  };
});

import {
  fetchPobbinCode,
  fetchPoeNinjaCode,
  resolvePob2BuildsPath,
  listPob2Builds,
  readPob2Build,
  type PobBuild,
} from '../services/api.js';
import { registerPobTools } from './pob.js';

type ToolHandler = (args: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}>;

function createMockServer() {
  const handlers = new Map<string, ToolHandler>();
  const mockServer = {
    registerTool: vi.fn((name: string, _opts: unknown, handler: ToolHandler) => {
      handlers.set(name, handler);
    }),
  } as unknown as McpServer;

  return { mockServer, handlers };
}

function createMinimalPobCode(
  format: 'raw' | 'zlib' = 'raw',
  root: string = 'PathOfBuilding2',
): string {
  const xml = `
<${root}>
  <Build className="Witch" ascendClassName="Necromancer" level="90"></Build>
  <Items></Items>
  <Skills></Skills>
  <Tree activeSpec="1"><Spec treeVersion="0.4"><URL></URL></Spec></Tree>
  <Config></Config>
  <Notes></Notes>
</${root}>`;
  const compressed =
    format === 'raw'
      ? deflateRawSync(Buffer.from(xml, 'utf-8'))
      : deflateSync(Buffer.from(xml, 'utf-8'));
  return compressed.toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
}

function createMockBuild(overrides: Partial<PobBuild> = {}): PobBuild {
  return {
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
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('poe2_pob_decode', () => {
  it('fetches and decodes pobb.in URL', async () => {
    vi.mocked(resolvePob2BuildsPath).mockReturnValue(null);
    const pobCode = createMinimalPobCode('raw');
    vi.mocked(fetchPobbinCode).mockResolvedValue(pobCode);

    const { mockServer, handlers } = createMockServer();
    registerPobTools(mockServer);
    const handler = handlers.get('poe2_pob_decode')!;

    const result = await handler({ code: 'https://pobb.in/test123' });

    expect(fetchPobbinCode).toHaveBeenCalledWith('test123');
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain('pobb.in/test123');
    expect(result.content[0]?.text).toContain('Necromancer');
    expect(result.content[0]?.text).toContain('Level 90');
  });

  it('surfaces a warning when the decoded build uses the PoB1 root element', async () => {
    vi.mocked(resolvePob2BuildsPath).mockReturnValue(null);
    const pobCode = createMinimalPobCode('raw', 'PathOfBuilding');
    vi.mocked(fetchPobbinCode).mockResolvedValue(pobCode);

    const { mockServer, handlers } = createMockServer();
    registerPobTools(mockServer);
    const handler = handlers.get('poe2_pob_decode')!;

    const result = await handler({ code: 'https://pobb.in/test123' });

    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain('⚠️');
    expect(result.content[0]?.text).toContain("'PathOfBuilding2' root element missing");
  });

  it('fetches and decodes poe.ninja PoB URL', async () => {
    vi.mocked(resolvePob2BuildsPath).mockReturnValue(null);
    const pobCode = createMinimalPobCode('raw');
    vi.mocked(fetchPoeNinjaCode).mockResolvedValue(pobCode);

    const { mockServer, handlers } = createMockServer();
    registerPobTools(mockServer);
    const handler = handlers.get('poe2_pob_decode')!;

    const result = await handler({ code: 'https://poe.ninja/poe2/pob/19f0c' });

    expect(fetchPoeNinjaCode).toHaveBeenCalledWith('19f0c');
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain('poe.ninja/poe2/pob/19f0c');
    expect(result.content[0]?.text).toContain('Necromancer');
    expect(result.content[0]?.text).toContain('Level 90');
  });

  it('fetches and decodes pob2://poeninja/ protocol URL', async () => {
    vi.mocked(resolvePob2BuildsPath).mockReturnValue(null);
    const pobCode = createMinimalPobCode('raw');
    vi.mocked(fetchPoeNinjaCode).mockResolvedValue(pobCode);

    const { mockServer, handlers } = createMockServer();
    registerPobTools(mockServer);
    const handler = handlers.get('poe2_pob_decode')!;

    const result = await handler({ code: 'pob2://poeninja/19f0c' });

    expect(fetchPoeNinjaCode).toHaveBeenCalledWith('19f0c');
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain('Necromancer');
  });

  it('reads local build by filename', async () => {
    vi.mocked(resolvePob2BuildsPath).mockReturnValue('/path/to/builds');
    vi.mocked(readPob2Build).mockReturnValue(createMockBuild());

    const { mockServer, handlers } = createMockServer();
    registerPobTools(mockServer);
    const handler = handlers.get('poe2_pob_decode')!;

    const result = await handler({ code: 'MyNecromancer' });

    expect(readPob2Build).toHaveBeenCalledWith('/path/to/builds', 'MyNecromancer');
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain('local: MyNecromancer');
    expect(result.content[0]?.text).toContain('Necromancer');
  });

  it('rejects raw base64 codes with helpful guidance (no builds dir)', async () => {
    vi.mocked(resolvePob2BuildsPath).mockReturnValue(null);
    const { mockServer, handlers } = createMockServer();
    registerPobTools(mockServer);
    const handler = handlers.get('poe2_pob_decode')!;

    const result = await handler({ code: 'eNrtVV1v2jAUfebXNotValid...' });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('not a recognized build URL');
    expect(result.content[0]?.text).toContain('pobb.in');
    expect(result.content[0]?.text).toContain('poe.ninja');
  });

  it('rejects raw base64 codes with helpful guidance (with builds dir)', async () => {
    vi.mocked(resolvePob2BuildsPath).mockReturnValue('/path/to/builds');
    vi.mocked(readPob2Build).mockReturnValue(null);

    const { mockServer, handlers } = createMockServer();
    registerPobTools(mockServer);
    const handler = handlers.get('poe2_pob_decode')!;

    const pobCode = createMinimalPobCode('raw');
    const result = await handler({ code: pobCode });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('No local build matching');
    expect(result.content[0]?.text).toContain('pobb.in');
    expect(result.content[0]?.text).toContain('corrupted in chat transit');
  });

  it('returns isError when pobb.in fetch fails', async () => {
    vi.mocked(resolvePob2BuildsPath).mockReturnValue(null);
    vi.mocked(fetchPobbinCode).mockRejectedValue(new Error('paste not found'));

    const { mockServer, handlers } = createMockServer();
    registerPobTools(mockServer);
    const handler = handlers.get('poe2_pob_decode')!;

    const result = await handler({ code: 'pobb.in/invalid' });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('paste not found');
  });

  it('returns isError when local build not found and no match', async () => {
    vi.mocked(resolvePob2BuildsPath).mockReturnValue('/path/to/builds');
    vi.mocked(readPob2Build).mockReturnValue(null);

    const { mockServer, handlers } = createMockServer();
    registerPobTools(mockServer);
    const handler = handlers.get('poe2_pob_decode')!;

    const result = await handler({ code: 'NonexistentBuild' });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('No local build matching');
  });
});

describe('poe2_pob_local_builds', () => {
  it('returns isError when builds directory not found', async () => {
    vi.mocked(resolvePob2BuildsPath).mockReturnValue(null);

    const { mockServer, handlers } = createMockServer();
    registerPobTools(mockServer);
    const handler = handlers.get('poe2_pob_local_builds')!;

    const result = await handler({});

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('not found');
  });

  it('returns empty message when no builds exist', async () => {
    vi.mocked(resolvePob2BuildsPath).mockReturnValue('/path/to/builds');
    vi.mocked(listPob2Builds).mockReturnValue([]);

    const { mockServer, handlers } = createMockServer();
    registerPobTools(mockServer);
    const handler = handlers.get('poe2_pob_local_builds')!;

    const result = await handler({});

    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain('No build files found');
  });

  it('returns formatted list of builds', async () => {
    vi.mocked(resolvePob2BuildsPath).mockReturnValue('/path/to/builds');
    vi.mocked(listPob2Builds).mockReturnValue([
      {
        filename: 'Necromancer_Build',
        className: 'Witch',
        ascendancy: 'Necromancer',
        level: 95,
        lastModified: new Date('2026-02-20'),
      },
      {
        filename: 'Ranger_Build',
        className: 'Ranger',
        ascendancy: 'Deadeye',
        level: 85,
        lastModified: new Date('2026-02-15'),
      },
    ]);

    const { mockServer, handlers } = createMockServer();
    registerPobTools(mockServer);
    const handler = handlers.get('poe2_pob_local_builds')!;

    const result = await handler({});

    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain('Found 2 build(s)');
    expect(result.content[0]?.text).toContain('Necromancer_Build');
    expect(result.content[0]?.text).toContain('Necromancer (Witch)');
    expect(result.content[0]?.text).toContain('Lv95');
    expect(result.content[0]?.text).toContain('2026-02-20');
  });

  it('handles builds without ascendancy', async () => {
    vi.mocked(resolvePob2BuildsPath).mockReturnValue('/path/to/builds');
    vi.mocked(listPob2Builds).mockReturnValue([
      {
        filename: 'Basic_Build',
        className: 'Marauder',
        ascendancy: null,
        level: 50,
        lastModified: new Date('2026-02-10'),
      },
    ]);

    const { mockServer, handlers } = createMockServer();
    registerPobTools(mockServer);
    const handler = handlers.get('poe2_pob_local_builds')!;

    const result = await handler({});

    expect(result.content[0]?.text).toContain('Marauder');
    expect(result.content[0]?.text).not.toContain('null');
  });
});

describe('poe2_pob_compare', () => {
  it('compares two pobb.in URLs', async () => {
    vi.mocked(resolvePob2BuildsPath).mockReturnValue(null);
    const pobCode = createMinimalPobCode();
    vi.mocked(fetchPobbinCode).mockResolvedValue(pobCode);

    const { mockServer, handlers } = createMockServer();
    registerPobTools(mockServer);
    const handler = handlers.get('poe2_pob_compare')!;

    const result = await handler({
      current: 'https://pobb.in/build1',
      reference: 'https://pobb.in/build2',
    });

    expect(fetchPobbinCode).toHaveBeenCalledWith('build1');
    expect(fetchPobbinCode).toHaveBeenCalledWith('build2');
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain('Build Comparison');
    expect(result.content[0]?.text).toContain('Current:');
    expect(result.content[0]?.text).toContain('Reference:');
  });

  it('compares local build with pobb.in URL', async () => {
    vi.mocked(resolvePob2BuildsPath).mockReturnValue('/path/to/builds');
    const mockBuild = createMockBuild();
    vi.mocked(readPob2Build).mockReturnValue(mockBuild);
    const pobCode = createMinimalPobCode();
    vi.mocked(fetchPobbinCode).mockResolvedValue(pobCode);

    const { mockServer, handlers } = createMockServer();
    registerPobTools(mockServer);
    const handler = handlers.get('poe2_pob_compare')!;

    const result = await handler({
      current: 'MyLocalBuild',
      reference: 'https://pobb.in/guide123',
    });

    expect(readPob2Build).toHaveBeenCalledWith('/path/to/builds', 'MyLocalBuild');
    expect(fetchPobbinCode).toHaveBeenCalledWith('guide123');
    expect(result.isError).toBeUndefined();
  });

  it('compares two local builds', async () => {
    vi.mocked(resolvePob2BuildsPath).mockReturnValue('/path/to/builds');
    const mockBuild = createMockBuild();
    vi.mocked(readPob2Build).mockReturnValue(mockBuild);

    const { mockServer, handlers } = createMockServer();
    registerPobTools(mockServer);
    const handler = handlers.get('poe2_pob_compare')!;

    const result = await handler({
      current: 'Build1',
      reference: 'Build2',
    });

    expect(readPob2Build).toHaveBeenCalledWith('/path/to/builds', 'Build1');
    expect(readPob2Build).toHaveBeenCalledWith('/path/to/builds', 'Build2');
    expect(result.isError).toBeUndefined();
  });

  it('returns isError when current build cannot be resolved', async () => {
    vi.mocked(resolvePob2BuildsPath).mockReturnValue(null);

    const { mockServer, handlers } = createMockServer();
    registerPobTools(mockServer);
    const handler = handlers.get('poe2_pob_compare')!;

    const result = await handler({
      current: 'invalid-code',
      reference: 'pobb.in/guide123',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Could not resolve current build');
  });

  it('returns isError when reference build cannot be resolved', async () => {
    vi.mocked(resolvePob2BuildsPath).mockReturnValue('/path/to/builds');
    const mockBuild = createMockBuild();
    vi.mocked(readPob2Build)
      .mockReturnValueOnce(mockBuild) // current resolves
      .mockReturnValueOnce(null); // reference fails

    const { mockServer, handlers } = createMockServer();
    registerPobTools(mockServer);
    const handler = handlers.get('poe2_pob_compare')!;

    const result = await handler({
      current: 'ValidBuild',
      reference: 'NonexistentBuild',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Could not resolve reference build');
  });

  it('shows item differences in comparison output', async () => {
    vi.mocked(resolvePob2BuildsPath).mockReturnValue('/path/to/builds');
    const currentBuild = createMockBuild({
      items: [
        {
          slot: 'Helmet',
          rarity: 'Rare',
          name: 'Old Helm',
          base: 'Iron Hat',
          itemLevel: 50,
          levelRequirement: 0,
          quality: 0,
          armour: 50,
          evasion: 0,
          energyShield: 0,
          sockets: null,
          implicits: [],
          explicits: ['+10 to Life'],
          corrupted: false,
        },
      ],
    });
    const referenceBuild = createMockBuild({
      items: [
        {
          slot: 'Helmet',
          rarity: 'Rare',
          name: 'New Helm',
          base: 'Steel Helm',
          itemLevel: 80,
          levelRequirement: 0,
          quality: 0,
          armour: 150,
          evasion: 0,
          energyShield: 0,
          sockets: null,
          implicits: [],
          explicits: ['+50 to Life'],
          corrupted: false,
        },
      ],
    });

    vi.mocked(readPob2Build).mockReturnValueOnce(currentBuild).mockReturnValueOnce(referenceBuild);

    const { mockServer, handlers } = createMockServer();
    registerPobTools(mockServer);
    const handler = handlers.get('poe2_pob_compare')!;

    const result = await handler({ current: 'CurrentBuild', reference: 'ReferenceBuild' });

    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain('Item Differences');
    expect(result.content[0]?.text).toContain('Upgrades needed');
    expect(result.content[0]?.text).toContain('Helmet');
  });
});
