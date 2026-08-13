import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  getNinjaBuildIndex,
  type BuildClassStatistic,
  type BuildLeagueEntry,
} from '../services/api.js';
import { DEFAULT_LEAGUE, LeagueSchema } from '../constants.js';

/** Format a trend indicator for class distribution. */
function trendLabel(trend: number): string {
  if (trend === 1) return ' (trending up)';
  if (trend === -1) return ' (trending down)';
  return '';
}

export function registerBuildTools(server: McpServer): void {
  // ── poe2_meta_builds ──────────────────────────────────────────────
  server.registerTool(
    'poe2_meta_builds',
    {
      title: 'PoE2 Meta Build Overview',
      description: `Get class distribution statistics for Path of Exile 2 from poe.ninja.

Shows the most popular classes with their percentage share and trend direction among indexed ladder characters.

Args:
  - league (string): League name (default: "${DEFAULT_LEAGUE}")
  - class_name (string): Optional — filter by class, e.g. "Witch", "Lich", "Sorceress"

Returns: Class distribution with percentages and trend indicators.

Examples:
  - "What's the current meta?" → call with defaults
  - "Most popular Witch builds?" → class_name="Witch"`,
      inputSchema: {
        league: LeagueSchema,
        class_name: z
          .string()
          .optional()
          .describe('Filter by class name, e.g. Witch, Lich, Warrior, Sorceress'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ league, class_name }) => {
      try {
        const data = await getNinjaBuildIndex();
        const queryLower = league.toLowerCase();

        // Find matching league by name (case-insensitive contains) or URL slug
        const entry: BuildLeagueEntry | undefined = data.leagueBuilds.find(
          (e) =>
            e.leagueName.toLowerCase().includes(queryLower) ||
            e.leagueUrl.toLowerCase() === queryLower,
        );

        if (!entry) {
          const available = data.leagueBuilds.map((e) => `"${e.leagueName}"`).join(', ');
          return {
            content: [
              {
                type: 'text',
                text: `League "${league}" not found. Available leagues: ${available}.`,
              },
            ],
          };
        }

        const { statistics, total } = entry;

        // Filter by class_name if provided
        let filteredStats: BuildClassStatistic[] = statistics;
        if (class_name) {
          const classQuery = class_name.toLowerCase();
          filteredStats = statistics.filter((s) => s.class.toLowerCase().includes(classQuery));
        }

        const lines: string[] = [
          `## Meta Builds Overview — ${entry.leagueName}`,
          '',
          `Total indexed characters: ${total.toLocaleString('en-US')}`,
          '',
          '### Class Distribution',
        ];

        if (filteredStats.length === 0 && class_name) {
          const availableClasses = statistics.map((s) => s.class).join(', ');
          lines.push(`No classes matching "${class_name}". Available classes: ${availableClasses}`);
        } else if (filteredStats.length === 0) {
          lines.push('*No class statistics available for this league.*');
        } else {
          for (const stat of filteredStats) {
            lines.push(
              `- **${stat.class}**: ${stat.percentage.toFixed(1)}%${trendLabel(stat.trend)}`,
            );
          }
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
              text: `Error fetching meta builds: ${msg}\n\nNote: poe.ninja build API may not be available for all leagues.`,
            },
          ],
        };
      }
    },
  );
}
