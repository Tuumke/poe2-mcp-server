import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { DEFAULT_LEAGUE, LeagueSchema } from '../constants.js';
import {
  loadGGGSession,
  getStashTabs,
  getStashTabItems,
  GGGAuthError,
  SESSION_FILE,
} from '../services/ggg.js';

const SETUP_HELP = `## Stash access not configured

This reads **your own** PoE2 stash using your session cookie (read-only). It is not
the official OAuth API (GGG closed new OAuth registrations). Set your session
**locally — never commit it**, one of:

- Environment variables:
  - \`POE2_POESESSID\` = your POESESSID cookie value
  - \`POE2_ACCOUNT_NAME\` = your account name (e.g. \`YourName#1234\`)
- or a JSON file at \`${SESSION_FILE}\`:
  \`{ "poesessid": "…", "accountName": "YourName#1234" }\`

Get POESESSID: log in at pathofexile.com → browser DevTools → Application →
Cookies → copy the \`POESESSID\` value. Treat it like a password; it expires
periodically (refresh when you get a 403).`;

export function registerStashTools(server: McpServer): void {
  server.registerTool(
    'poe2_stash',
    {
      title: 'PoE2 Stash (your account)',
      description: `Read YOUR OWN Path of Exile 2 stash (read-only) via a local POESESSID session cookie.

Requires local session config (env or ${SESSION_FILE}); if missing, returns setup steps.
Uses the site's internal endpoints, not the official OAuth API.

Args:
  - tab (string, optional): tab index (e.g. "3") or exact tab name. Omit to LIST all tabs.
  - league (string): League name (default: "${DEFAULT_LEAGUE}").
  - realm (string): Realm segment (default: "poe2").
  - search (string, optional): case-insensitive filter on item name/base within a tab.

Examples:
  - "What stash tabs do I have?" → call with no tab
  - "Show tab 2" → tab="2"
  - "Find Chaos Orbs in my Currency tab" → tab="Currency", search="chaos"`,
      inputSchema: {
        tab: z.string().optional().describe('Tab index or exact name. Omit to list all tabs.'),
        league: LeagueSchema,
        realm: z.string().default('poe2').describe('Realm segment (default "poe2").'),
        search: z.string().optional().describe('Case-insensitive item name/base filter.'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ tab, league, realm, search }) => {
      const sess = loadGGGSession();
      if (!sess) {
        return { content: [{ type: 'text', text: SETUP_HELP }] };
      }

      try {
        const tabs = await getStashTabs(sess, league, realm);

        // No tab specified → list tabs.
        if (tab === undefined || tab.trim() === '') {
          if (tabs.length === 0) {
            return {
              content: [{ type: 'text', text: `No stash tabs found for ${league} (realm ${realm}).` }],
            };
          }
          const lines = [`## Stash tabs — ${league}`, ''];
          for (const t of tabs) lines.push(`- [${t.index}] **${t.name}** _(${t.type})_`);
          lines.push('', `Read a tab with tab="<index or name>".`);
          return { content: [{ type: 'text', text: lines.join('\n') }] };
        }

        // Resolve tab by index or exact (case-insensitive) name.
        const byIndex = /^\d+$/.test(tab.trim()) ? Number(tab.trim()) : null;
        const match =
          byIndex !== null
            ? tabs.find((t) => t.index === byIndex)
            : tabs.find((t) => t.name.toLowerCase() === tab.trim().toLowerCase());

        if (!match) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: `Tab "${tab}" not found. Available: ${tabs.map((t) => `[${t.index}] ${t.name}`).join(', ')}`,
              },
            ],
          };
        }

        let items = await getStashTabItems(sess, league, match.index, realm);
        if (search && search.trim() !== '') {
          const q = search.trim().toLowerCase();
          items = items.filter(
            (it) => it.name.toLowerCase().includes(q) || it.typeLine.toLowerCase().includes(q),
          );
        }

        const lines = [`## ${match.name} _(${match.type})_ — ${league}`, `${items.length} item(s)`, ''];
        for (const it of items) {
          const label = [it.name, it.typeLine].filter(Boolean).join(' ') || '(unknown item)';
          const extra: string[] = [];
          if (it.stackSize) extra.push(`x${it.stackSize}`);
          if (it.ilvl) extra.push(`ilvl ${it.ilvl}`);
          lines.push(`- ${label}${extra.length ? ` — ${extra.join(', ')}` : ''}`);
        }
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (error) {
        if (error instanceof GGGAuthError) {
          return { isError: true, content: [{ type: 'text', text: `${error.message}\n\n${SETUP_HELP}` }] };
        }
        const msg = error instanceof Error ? error.message : String(error);
        return { isError: true, content: [{ type: 'text', text: `Error reading stash: ${msg}` }] };
      }
    },
  );
}
