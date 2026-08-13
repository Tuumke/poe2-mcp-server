import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  decodePobCode,
  extractPobbinId,
  extractPoeNinjaId,
  fetchPobbinCode,
  fetchPoeNinjaCode,
  parsePobXml,
  resolvePob2BuildsPath,
  listPob2Builds,
  readPob2Build,
  comparePobBuilds,
  type PobToolOptions,
  type PobBuild,
  type PobItem,
} from '../services/api.js';

/**
 * Format a PobBuild to markdown for LLM consumption.
 */
function formatBuildMarkdown(build: PobBuild, source: string): string {
  const lines: string[] = [];

  // Header
  const { metadata } = build;
  const classDisplay = metadata.ascendancy
    ? `${metadata.ascendancy} (${metadata.className})`
    : metadata.className;
  lines.push(`## ${classDisplay} — Level ${metadata.level}`);
  lines.push(`*Source: ${source}*`);
  lines.push('');

  // Surface validation warnings (e.g. wrong root element for PoB2)
  if (build.warnings.length > 0) {
    for (const warning of build.warnings) {
      lines.push(`> ⚠️ ${warning}`);
    }
    lines.push('');
  }

  // Metadata
  if (metadata.bandit) lines.push(`**Bandit:** ${metadata.bandit}`);
  if (metadata.pantheonMajor || metadata.pantheonMinor) {
    const pantheon = [metadata.pantheonMajor, metadata.pantheonMinor].filter(Boolean).join(', ');
    lines.push(`**Pantheon:** ${pantheon}`);
  }
  lines.push('');

  // Skills
  lines.push('### Skills');
  const activeSkills = build.skills.filter((s) => s.enabled && s.activeGem);
  if (activeSkills.length === 0) {
    lines.push('*No active skills configured*');
  } else {
    for (const skill of activeSkills) {
      const gem = skill.activeGem!;
      const supports = skill.supportGems.map((g) => g.name).join(', ') || 'none';
      const label = skill.label ? ` (${skill.label})` : '';
      lines.push(`- **${gem.name}**${label}: supports: ${supports}`);
    }
  }
  lines.push('');

  // Items
  lines.push('### Equipment');
  const sortedItems = [...build.items].sort((a, b) => {
    const slotOrder = [
      'Helmet',
      'Body Armour',
      'Gloves',
      'Boots',
      'Weapon 1',
      'Weapon 2',
      'Amulet',
      'Ring 1',
      'Ring 2',
      'Belt',
      'Flask 1',
      'Flask 2',
      'Flask 3',
      'Flask 4',
      'Flask 5',
    ];
    return slotOrder.indexOf(a.slot) - slotOrder.indexOf(b.slot);
  });

  if (sortedItems.length === 0) {
    lines.push('*No equipment configured*');
  } else {
    for (const item of sortedItems) {
      const name = item.name ? `${item.name}` : item.base;
      const defences: string[] = [];
      if (item.armour > 0) defences.push(`${item.armour} armour`);
      if (item.evasion > 0) defences.push(`${item.evasion} evasion`);
      if (item.energyShield > 0) defences.push(`${item.energyShield} ES`);
      const defStr = defences.length > 0 ? ` [${defences.join(', ')}]` : '';
      lines.push(`- **${item.slot}:** ${name} (${item.rarity})${defStr}`);
    }
  }
  lines.push('');

  // Passive tree summary
  lines.push('### Passive Tree');
  lines.push(`- **Version:** ${build.tree.version}`);
  lines.push(`- **Allocated nodes:** ${build.tree.allocatedNodes.length}`);
  lines.push(`- **Masteries:** ${build.tree.masteryEffects.length}`);
  lines.push('');

  // Notes
  if (build.notes.trim()) {
    lines.push('### Notes');
    lines.push(build.notes.slice(0, 500)); // Truncate long notes
    if (build.notes.length > 500) lines.push('...');
    lines.push('');
  }

  // PoB2 accuracy disclaimer
  lines.push('---');
  lines.push(
    '*⚠️ PoB2 for PoE2 is still in development and may be inaccurate. ' +
      'Actual in-game resistances are often higher than shown — PoB2 may not account for ' +
      'quest rewards (e.g., "The Slithering Dead" grants +10% Chaos Resistance), ' +
      'and some runes/bonds may not be calculated correctly.*',
  );

  return lines.join('\n');
}

/**
 * Format item comparison for display.
 */
function formatItemDiff(item: PobItem): string {
  const base = item.name ? `${item.name} (${item.base})` : item.base;
  const stats: string[] = [];
  if (item.armour > 0) stats.push(`${item.armour} AR`);
  if (item.evasion > 0) stats.push(`${item.evasion} EV`);
  if (item.energyShield > 0) stats.push(`${item.energyShield} ES`);
  return stats.length > 0 ? `${base} [${stats.join('/')}]` : base;
}

export function registerPobTools(server: McpServer, options?: PobToolOptions): void {
  const pob2BuildsPath = resolvePob2BuildsPath(options?.pob2BuildsPath);

  // ── poe2_pob_decode ─────────────────────────────────────────────────
  server.registerTool(
    'poe2_pob_decode',
    {
      title: 'PoE2 Decode PoB Build',
      description: `Decode a Path of Building 2 (PoB) build and extract structured information.

Accepts:
- pobb.in URL (e.g., "https://pobb.in/abc123" or just "pobb.in/abc123")
- poe.ninja PoB URL (e.g., "https://poe.ninja/poe2/pob/19f0c" or "pob2://poeninja/19f0c")
- Local build filename (e.g., "MyBuild" or "MyBuild.xml")

IMPORTANT: Do NOT paste raw Base64 PoB export codes — they get corrupted in transit (chat silently drops/alters characters in long strings). Instead, ask the user to upload the code to pobb.in or poe.ninja first, or use their local build filename.

Returns: Class, level, skills with supports, equipped items with stats, and passive tree summary.

Examples:
- "What gems are in pobb.in/abc123?" → fetches and parses the paste
- "Decode poe.ninja/poe2/pob/19f0c" → fetches from poe.ninja
- "Show me my Witch build" → reads local build file`,
      inputSchema: {
        code: z
          .string()
          .describe(
            'pobb.in URL, poe.ninja PoB URL, or local build filename (NOT raw base64 — it corrupts in transit)',
          ),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ code }) => {
      try {
        const input = code.trim();
        let build: PobBuild;
        let source: string;

        // Check pobb.in URL
        const pobbinId = extractPobbinId(input);
        if (pobbinId) {
          source = `pobb.in/${pobbinId}`;
          const pobCode = await fetchPobbinCode(pobbinId);
          const xml = decodePobCode(pobCode);
          build = parsePobXml(xml, 'code');
        }
        // Check poe.ninja PoB URL
        else {
          const ninjaId = extractPoeNinjaId(input);
          if (ninjaId) {
            source = `poe.ninja/poe2/pob/${ninjaId}`;
            const pobCode = await fetchPoeNinjaCode(ninjaId);
            const xml = decodePobCode(pobCode);
            build = parsePobXml(xml, 'code');
          }
          // Try as local build filename
          else if (pob2BuildsPath) {
            const localBuild = readPob2Build(pob2BuildsPath, input);
            if (localBuild) {
              source = `local: ${input}`;
              build = localBuild;
            } else {
              return {
                isError: true,
                content: [
                  {
                    type: 'text',
                    text:
                      `No local build matching "${input}" found.\n\n` +
                      `This tool accepts:\n` +
                      `- **pobb.in URL** (e.g., "pobb.in/abc123")\n` +
                      `- **poe.ninja PoB URL** (e.g., "poe.ninja/poe2/pob/19f0c")\n` +
                      `- **Local build filename** (e.g., "MyBuild")\n\n` +
                      `Raw Base64 PoB codes are NOT supported — they get corrupted in chat transit. ` +
                      `Ask the user to upload their build to https://pobb.in or https://poe.ninja/poe2/pob and share the URL instead.`,
                  },
                ],
              };
            }
          } else {
            return {
              isError: true,
              content: [
                {
                  type: 'text',
                  text:
                    `Input "${input.slice(0, 60)}${input.length > 60 ? '...' : ''}" is not a recognized build URL.\n\n` +
                    `This tool accepts:\n` +
                    `- **pobb.in URL** (e.g., "pobb.in/abc123")\n` +
                    `- **poe.ninja PoB URL** (e.g., "poe.ninja/poe2/pob/19f0c")\n` +
                    `- **Local build filename** (requires PoB2 builds directory)\n\n` +
                    `Raw Base64 PoB codes are NOT supported — they get corrupted in chat transit. ` +
                    `Ask the user to upload their build to https://pobb.in or https://poe.ninja/poe2/pob and share the URL instead.`,
                },
              ],
            };
          }
        }

        // Format for display
        const markdown = formatBuildMarkdown(build, source);

        return {
          content: [{ type: 'text', text: markdown }],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Failed to decode PoB build: ${msg}`,
            },
          ],
        };
      }
    },
  );

  // ── poe2_pob_local_builds ───────────────────────────────────────────
  server.registerTool(
    'poe2_pob_local_builds',
    {
      title: 'PoE2 List Local PoB Builds',
      description: `List saved Path of Building (PoE2) builds from the local filesystem.

Searches for .xml build files in the default PoB2 Builds directory:
- Windows: Documents/Path of Building (PoE2)/Builds/ (priority) or %APPDATA%/...
- macOS: ~/Library/Application Support/Path of Building (PoE2)/Builds/
- Linux: ~/.config/Path of Building (PoE2)/Builds/

Returns: List of build files with class, ascendancy, level, and last modified date.

Note: If a custom path was provided via --pob2-path CLI flag, that path is used instead.

Examples:
- "Show my PoB builds" → lists all saved builds
- "What builds do I have saved?" → lists all saved builds`,
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        if (!pob2BuildsPath) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: `PoB2 builds directory not found.

Checked locations:
- Windows: Documents/Path of Building (PoE2)/Builds/ or %APPDATA%/...
- macOS: ~/Library/Application Support/Path of Building (PoE2)/Builds/
- Linux: ~/.config/Path of Building (PoE2)/Builds/

You can specify a custom path with the --pob2-path CLI flag when starting the server.`,
              },
            ],
          };
        }

        const builds = listPob2Builds(pob2BuildsPath);

        if (builds.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: `## Local PoB2 Builds\n\nNo build files found in:\n\`${pob2BuildsPath}\`\n\nSave a build in Path of Building (PoE2) to see it here.`,
              },
            ],
          };
        }

        const lines: string[] = [
          `## Local PoB2 Builds`,
          `*Found ${builds.length} build(s) in ${pob2BuildsPath}*`,
          '',
        ];

        for (const build of builds) {
          const classDisplay = build.ascendancy
            ? `${build.ascendancy} (${build.className})`
            : (build.className ?? 'Unknown');
          const levelDisplay = build.level ? `Lv${build.level}` : '';
          const dateStr = build.lastModified.toISOString().split('T')[0];
          lines.push(`- **${build.filename}**: ${classDisplay} ${levelDisplay} — ${dateStr}`);
        }

        return {
          content: [{ type: 'text', text: lines.join('\n') }],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Failed to list local builds: ${msg}`,
            },
          ],
        };
      }
    },
  );

  // ── poe2_pob_compare ────────────────────────────────────────────────
  server.registerTool(
    'poe2_pob_compare',
    {
      title: 'PoE2 Compare PoB Builds',
      description: `Compare two Path of Building 2 builds to identify differences.

Accepts any combination of:
- pobb.in URL (e.g., "pobb.in/abc123")
- poe.ninja PoB URL (e.g., "poe.ninja/poe2/pob/19f0c")
- Local build name (if local builds are available)

IMPORTANT: Do NOT paste raw Base64 PoB export codes — they get corrupted in transit. Use URLs or local build names instead.

Returns: Item-by-item comparison, passive tree differences, and skill/gem differences.

Examples:
- "Compare my build to pobb.in/abc123" → compare local build to guide
- "Compare MyBuild to poe.ninja/poe2/pob/19f0c" → compare local vs shared build`,
      inputSchema: {
        current: z
          .string()
          .describe('Current build: pobb.in URL, poe.ninja PoB URL, or local build name'),
        reference: z
          .string()
          .describe('Reference build: pobb.in URL, poe.ninja PoB URL, or local build name'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ current, reference }) => {
      try {
        // Helper to resolve build input to PobBuild
        const resolveBuild = async (input: string, label: string): Promise<PobBuild> => {
          const trimmed = input.trim();

          // Check pobb.in URL
          const pobbinId = extractPobbinId(trimmed);
          if (pobbinId) {
            const code = await fetchPobbinCode(pobbinId);
            const xml = decodePobCode(code);
            return parsePobXml(xml, 'code');
          }

          // Check poe.ninja PoB URL
          const ninjaId = extractPoeNinjaId(trimmed);
          if (ninjaId) {
            const code = await fetchPoeNinjaCode(ninjaId);
            const xml = decodePobCode(code);
            return parsePobXml(xml, 'code');
          }

          // Try as local build name
          if (pob2BuildsPath) {
            const local = readPob2Build(pob2BuildsPath, trimmed);
            if (local) return local;
          }

          throw new Error(
            `Could not resolve ${label}: "${trimmed.slice(0, 60)}${trimmed.length > 60 ? '...' : ''}". ` +
              `Not a pobb.in URL, poe.ninja PoB URL, or local build name. ` +
              `Raw Base64 PoB codes are not supported — they get corrupted in chat transit. ` +
              `Ask the user to upload to https://pobb.in or https://poe.ninja/poe2/pob and share the URL.`,
          );
        };

        const currentBuild = await resolveBuild(current, 'current build');
        const referenceBuild = await resolveBuild(reference, 'reference build');

        const diff = comparePobBuilds(currentBuild, referenceBuild);

        // Format comparison
        const lines: string[] = [];

        // Header
        const curClass = currentBuild.metadata.ascendancy ?? currentBuild.metadata.className;
        const refClass = referenceBuild.metadata.ascendancy ?? referenceBuild.metadata.className;
        lines.push(`## Build Comparison`);
        lines.push(`**Current:** ${curClass} Lv${currentBuild.metadata.level}`);
        lines.push(`**Reference:** ${refClass} Lv${referenceBuild.metadata.level}`);
        lines.push('');
        lines.push(`### Summary`);
        lines.push(diff.summary);
        lines.push('');

        // Items
        lines.push('### Item Differences');
        if (diff.items.upgradesNeeded.length === 0 && diff.items.missingInCurrent.length === 0) {
          lines.push('✓ Equipment matches or is better in all slots');
        } else {
          if (diff.items.missingInCurrent.length > 0) {
            lines.push('**Missing equipment:**');
            for (const slot of diff.items.missingInCurrent) {
              lines.push(`- ${slot}`);
            }
            lines.push('');
          }
          if (diff.items.upgradesNeeded.length > 0) {
            lines.push('**Upgrades needed:**');
            for (const item of diff.items.upgradesNeeded) {
              const curDisplay = item.current ? formatItemDiff(item.current) : 'empty';
              const refDisplay = item.reference ? formatItemDiff(item.reference) : 'empty';
              lines.push(`- **${item.slot}**: ${curDisplay} → ${refDisplay}`);
              if (item.delta) {
                lines.push(`  Delta: ${item.delta}`);
              }
            }
          }
        }
        lines.push('');

        // Passive tree
        lines.push('### Passive Tree');
        if (diff.tree.missingNodes.length === 0 && diff.tree.extraNodes.length === 0) {
          lines.push('✓ Passive trees match');
        } else {
          lines.push(`- Missing nodes: ${diff.tree.missingNodes.length}`);
          lines.push(`- Extra nodes: ${diff.tree.extraNodes.length}`);
        }
        lines.push('');

        // Skills
        lines.push('### Skills & Gems');
        if (
          diff.skills.missingGems.length === 0 &&
          diff.skills.extraGems.length === 0 &&
          diff.skills.differentSupports.length === 0
        ) {
          lines.push('✓ Skill setup matches');
        } else {
          if (diff.skills.missingGems.length > 0) {
            lines.push(`**Missing gems:** ${diff.skills.missingGems.join(', ')}`);
          }
          if (diff.skills.extraGems.length > 0) {
            lines.push(`**Extra gems:** ${diff.skills.extraGems.join(', ')}`);
          }
          if (diff.skills.differentSupports.length > 0) {
            lines.push('**Support differences:**');
            for (const sup of diff.skills.differentSupports) {
              lines.push(`- ${sup.skill}: missing ${sup.referenceSupport}`);
            }
          }
        }

        // PoB2 accuracy disclaimer
        lines.push('');
        lines.push('---');
        lines.push(
          '*⚠️ PoB2 for PoE2 is still in development. ' +
            'Actual resistances may differ from shown values — quest rewards and some runes/bonds ' +
            'may not be fully accounted for.*',
        );

        return {
          content: [{ type: 'text', text: lines.join('\n') }],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Failed to compare builds: ${msg}`,
            },
          ],
        };
      }
    },
  );
}
