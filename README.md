# poe2-mcp-server

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server that gives LLMs real-time access to Path of Exile 2 game data: currency exchange rates, item prices, wiki content, datamined game information, and ladder meta-build statistics.

All data is sourced from **public APIs only**. No API keys, no GGG OAuth registration, no accounts required.

Two transports ship in one binary: **stdio** for clients that spawn the process locally (Claude Desktop, Claude Code, Cursor, VS Code) and **Streamable HTTP** (`--http`) for clients that only accept a URL (ChatGPT developer mode, hosted agents). See [Remote (HTTP) mode](#remote-http-mode--chatgpt-and-other-remote-clients).

> **Fork note:** this is a maintained fork of the archived [sergeyklay/poe2-mcp-server](https://github.com/sergeyklay/poe2-mcp-server), updated for the current league.
>
> **Maintained by [Claude](https://claude.com/claude-code)** (Anthropic's Claude Code) on behalf of the repo owner: the league bump, the poe2scout API rewrite, the bug fixes and this README were researched, written, tested and committed by Claude, working from the live APIs and the local Path of Building data files. A human reviews and directs the work; treat the code as AI-authored and read it before you trust it. See [Fork changes](#fork-changes).

## Tools

| Tool                    | Description                                                                      | Source                                                                                              |
| ----------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `poe2_currency_prices`  | Current exchange rates for all currencies                                        | [poe.ninja](https://poe.ninja/poe2)                                                                 |
| `poe2_currency_check`   | Look up a specific currency by name                                              | [poe.ninja](https://poe.ninja/poe2)                                                                 |
| `poe2_item_price`       | Price check items across exchange and unique categories                          | [poe.ninja](https://poe.ninja/poe2) / [poe2scout](https://poe2scout.com/)                           |
| `poe2_exchange_top`     | Most valuable items by exchange category                                         | [poe.ninja](https://poe.ninja/poe2)                                                                 |
| `poe2_wiki_search`      | Search the PoE 2 community wiki                                                  | [poe2wiki.net](https://www.poe2wiki.net/)                                                           |
| `poe2_wiki_page`        | Retrieve full wiki article content                                               | [poe2wiki.net](https://www.poe2wiki.net/)                                                           |
| `poe2_db_lookup`        | Datamined game data: gems, mods, items, translations                             | [poe2db.tw](https://poe2db.tw/)                                                                     |
| `poe2_meta_builds`      | Ladder class distribution with percentages and trends                            | [poe.ninja](https://poe.ninja/poe2)                                                                 |
| `poe2_log_summary`      | Parse local game logs: zones, sessions, player events                            | Local logs                                                                                          |
| `poe2_pob_decode`       | Decode builds from pobb.in, poe.ninja, or local files                            | [pobb.in](https://pobb.in/) / [poe.ninja](https://poe.ninja/poe2/pob) / local                       |
| `poe2_pob_local_builds` | List saved PoB2 builds from local filesystem                                     | Local PoB2                                                                                          |
| `poe2_pob_compare`      | Compare two builds to identify gear/skill differences                            | [pobb.in](https://pobb.in/) / [poe.ninja](https://poe.ninja/poe2/pob) / local                       |
| `poe2_parse_item`       | Parse item clipboard text with enrichment (mod tiers, base stats, unique prices) | Client-side + [RePoE](https://repoe-fork.github.io/poe2/) + [poe2scout](https://api.poe2scout.com/) |

## Requirements

- Node.js ≥ 22
- npm

## Installation

```bash
git clone https://github.com/Tuumke/poe2-mcp-server.git
cd poe2-mcp-server
npm install
npm run build
```

## Configuration

### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "poe2": {
      "command": "node",
      "args": ["/absolute/path/to/poe2-mcp-server/dist/index.js"]
    }
  }
}
```

> **Windows users:** Use double backslashes or forward slashes in the path:
>
> ```json
> "args": ["C:\\absolute\\path\\to\\poe2-mcp-server\\dist\\index.js"]
> ```
>
> To open the config file quickly, press `Win + R` and run:
>
> ```cmd
> notepad %APPDATA%\Claude\claude_desktop_config.json
> ```

Config file locations:

- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

Restart Claude Desktop after editing the config.

#### Custom Game Installation Path

If PoE2 is installed in a non-standard location (e.g., a different drive), add the `--poe2-path` argument:

```json
{
  "mcpServers": {
    "poe2": {
      "command": "node",
      "args": [
        "C:\\path\\to\\poe2-mcp-server\\dist\\index.js",
        "--poe2-path",
        "D:\\Games\\Path of Exile 2"
      ]
    }
  }
}
```

#### Custom Path of Building Directory

To specify a custom PoB2 builds directory (for `poe2_pob_*` tools), add `--pob2-path`:

```json
"args": [
  "C:\\path\\to\\poe2-mcp-server\\dist\\index.js",
  "--pob2-path",
  "D:\\PoB\\Builds"
]
```

#### Custom Default League

Override the default league used by all price/economy tools via `--league`:

```json
"args": [
  "C:\\path\\to\\poe2-mcp-server\\dist\\index.js",
  "--league",
  "Standard"
]
```

When not specified, defaults to the current challenge league (`Forbidden Rites`). The AI agent can still pass any league name per-request — this only changes the fallback.

### Claude Code

```bash
claude mcp add poe2 node /absolute/path/to/poe2-mcp-server/dist/index.js
```

With custom game path:

```bash
claude mcp add poe2 node /path/to/poe2-mcp-server/dist/index.js --poe2-path "/path/to/Path of Exile 2"
```

With custom league:

```bash
claude mcp add poe2 node /path/to/poe2-mcp-server/dist/index.js --league "Standard"
```

### MCP Inspector

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

## Remote (HTTP) mode — ChatGPT and other remote clients

ChatGPT never spawns a local process: it only talks to a **remote** MCP server over HTTPS, so the stdio setup above does not apply to it. Run this server with `--http` and put TLS in front.

### 1. Start it in HTTP mode

```bash
node dist/index.js --http --port 3000 --host 0.0.0.0
```

| Flag / env                   | Default     | Purpose                                                                                  |
| ---------------------------- | ----------- | ---------------------------------------------------------------------------------------- |
| `--http`                     | off         | Serve Streamable HTTP instead of stdio.                                                  |
| `--port N` / `PORT`          | `3000`      | Listen port.                                                                             |
| `--host H` / `HOST`          | `127.0.0.1` | Bind address. Loopback by default; use `0.0.0.0` in a container.                         |
| `--path P` / `POE2_MCP_PATH` | `/mcp`      | Endpoint path. A leading slash is optional and a trailing one is accepted.               |
| `POE2_MCP_TOKEN`             | unset       | Require `Authorization: Bearer <token>`. Env only, so it stays out of the process list.  |
| `--allow-local-tools`        | off         | Also serve `poe2_log_summary` / `poe2_pob_local_builds`, which read the **host's** disk. |

Endpoints: `POST <path>` speaks JSON-RPC, `GET /health` is a liveness probe for hosting platforms.

The server is **stateless** — every request gets a fresh server instance, so there are no sessions to pin a client to one process and it scales behind a load balancer. That is also why `GET <path>` returns 405: there is no long-lived SSE stream to attach to.

### 2. Put HTTPS in front

ChatGPT requires an HTTPS URL. Any of these work:

- **A reverse proxy** you already run (Caddy, Traefik, nginx):

  ```caddyfile
  poe2-mcp.example.com {
    reverse_proxy 127.0.0.1:3000
  }
  ```

- **A platform** — Fly.io, Railway, Render — which terminates TLS for you. Set `--host 0.0.0.0` and let `PORT` come from the platform.
- **A tunnel** — OpenAI's Secure MCP Tunnel, Cloudflare Tunnel, or ngrok — if you want to keep the server on your own machine without opening a port.

### 3. Add it as a ChatGPT connector

1. **Settings → Connectors → Advanced → Developer mode** (needs ChatGPT Pro, Team, Enterprise or Edu).
2. **Create** a connector: give it a name and the full URL, e.g. `https://poe2-mcp.example.com/mcp`.
3. Confirm the trust prompt, then enable the connector per conversation from the **+** menu.

**Authentication caveat.** ChatGPT connectors support OAuth or no authentication — there is no field for a bearer token or a custom header. This server does not implement OAuth, so with ChatGPT you are running an unauthenticated endpoint. Since all upstream rate limits (poe.ninja, poe2scout) are shared per process, anyone who knows the URL can exhaust _your_ budget. Mitigations, roughly in order of effectiveness:

- Keep it behind a tunnel that you start only while you use it.
- Serve it on an unguessable path: `--path poe2-$(openssl rand -hex 12)`. Obscurity, not security — but it keeps crawlers off.
- Restrict by source IP at the proxy, if your client's egress addresses are stable.
- Leave `--allow-local-tools` off (the default) so nothing on your filesystem is reachable.

For clients that _can_ send headers — Claude custom connectors, the OpenAI Agents SDK, curl — set `POE2_MCP_TOKEN` and send `Authorization: Bearer <token>`.

### Verify it by hand

```bash
curl -s -X POST https://poe2-mcp.example.com/mcp -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

A healthy server answers with an SSE `event: message` frame listing the tools.

## Example Prompts

Once connected, try asking:

- _"How much is an Exalted Orb worth right now?"_
- _"What are the top 10 most valuable items in the Currency exchange?"_
- _"Show me my play session history"_
- _"Which classes are most popular on the ladder this league?"_
- _"Look up Essence Drain on poe2db"_
- _"Decode this build: pobb.in/abc123"_
- _"Analyze poe.ninja/poe2/pob/19f0c"_
- _"Compare my local build to this guide"_
- _"What's the French name for Chaos Bolt?"_ → uses `poe2_db_lookup` with `lang="fr"`
- _"Parse this item I just found: [paste Ctrl+C text]"_

### Example Conversation

**User:**

```plaintext
I just found this, is it any good?

Item Class: Body Armours
Rarity: Rare
Empyrean Shelter
Vaal Regalia
--------
Quality: +20% (augmented)
--------
Energy Shield: 286 (augmented)
--------
Requirements:
Level: 68
Int: 194
--------
Sockets: S S
--------
Item Level: 74
--------
+42 to maximum Life (implicit)
--------
78% increased Energy Shield (rune)
--------
+92 to maximum Energy Shield
+38% to Lightning Resistance
+24% to Cold Resistance
14% increased Stun and Block Recovery
```

**Claude:**

```plaintext
This is a strong ES chest for mid-mapping. Here's the breakdown:

- 286 Energy Shield at +20% quality with a rune boosting ES by 78% — that's solid.
- +92 flat ES on top of the base makes this a high-ES piece for its tier.
- Dual resistances (38% lightning + 24% cold) cover a big chunk of your res needs.
- +42 max life implicit gives hybrid survivability.

For a level 68 Vaal Regalia at item level 74, this is a keeper. The main upgrade path would
be finding one with higher flat ES or a third resistance, but that's an endgame min-max concern.

Use it now — it'll carry you through T5+ maps comfortably.
```

---

**User:**

```plaintext
I'm stuck on this quest boss... keeps killing me. Is this normal?
```

**Claude:**

```plaintext
Looking at your logs — you're in the Trial of Chaos (zone level 38) and you've died twice to the
boss already. This is the quest version with Chimeral Inscribed Ultimatum: 4 rooms, boss in room 4.

Yes, this is normal and happens to many players! Here's why:

The boss in room 4 is one of three random encounters: Uxmal (Chimera), Chetza (Bird with blood
attacks), or Bahlak (Three-headed bird with lightning). All of them hit hard, especially against
energy shield builds.

The key thing to know: your quest key doesn't drop on death. It returns to you, so you can retry
as many times as you need.

Tips to get through:

1. ...
2. ...
   ...
```

### Example System Prompt (Claude Projects)

This system prompt can be used with any MCP-compatible agent (Claude Desktop, Claude Projects, etc.) to create a PoE2 coach that automatically uses the MCP tools.

<details>
<summary>Click to expand full system prompt</summary>

```markdown
# Path of Exile 2 Coach

## Role

You are a knowledgeable Path of Exile 2 coach. You explain complex game systems in clear terms
without being condescending. Communicate in the user's language.

## Tool Usage Protocol

You have access to a PoE 2 MCP server with tools for: game logs, wiki, datamined game database
(poe2db), currency prices, item prices, item clipboard parsing with enrichment (mod tiers, base
stats, unique pricing), build decoding/comparison, and meta build stats. These tools are your
PRIMARY data source for everything PoE 2 related.

For EVERY user message about gameplay, follow this sequence BEFORE responding:

1. **Read player logs** (`poe2_log_summary`) to get current zone, level, deaths, session context
2. **Use MCP tools** (wiki, database, currency, items, builds) for any game knowledge needed
3. **Fall back to web search** ONLY if MCP tools didn't have the answer
4. **Respond** to the user with all context already gathered

## Gather Context, Don't Ask

NEVER ask the user for information you can obtain from tools:

- "What level are you?" → read the logs
- "What zone are you in?" → read the logs
- "How many times did you die?" → read the logs
- "What does skill X do?" → use `poe2_wiki_search` or `poe2_db_lookup`
- "How much does Y cost?" → use `poe2_currency_check` or `poe2_item_price`
- "What builds are popular?" → use `poe2_meta_builds`
- "Is this item good?" → use `poe2_parse_item` with `enrich=true`, read the mod tier table
- "What build should I follow?" → use `poe2_pob_decode` to decode a guide build

Only ask the user for things no tool can provide: personal preferences, build goals.

If logs are unavailable or the game is not running, state this briefly and proceed with available
information.

## Item Evaluation (poe2_parse_item)

When a user pastes item text (Ctrl+C from game), ALWAYS call `poe2_parse_item` with `enrich=true`.
The enrichment section contains:

- **Base type stats** — base ES/Armour/Evasion from datamined data (RePoE)
- **Mod tier table** — each explicit mod with Tier (T1/8 = best of 8 tiers), value range,
  prefix/suffix classification, and best tier available at the item's ilvl
- **Open slots** — how many prefix/suffix slots remain for crafting
- **Unique pricing** — chaos value from poe2scout.com (when available)

Use this data to give specific verdicts:

- "Your +50 ES is T1/8 (range 40–55) — that's the best tier, excellent roll"
- "Your 12% cast speed is T2/4 — decent but T1 starts at 13%"
- "You have 2 open prefixes — you can craft flat life or another damage mod"

## Build Comparison (poe2*pob*\*)

When a user shares a pobb.in or poe.ninja/poe2/pob link:

1. Use `poe2_pob_decode` to decode the build
2. If comparing to another build, use `poe2_pob_compare`
3. Use `poe2_pob_local_builds` to list the user's saved builds

## Localization Support

If the player uses a non-English game client:

1. Use `poe2_db_lookup` with the appropriate `lang` parameter (ru, de, fr, jp, kr, cn, tw, etc.)
2. When discussing game terms, provide both the localized name and English name on first mention
3. NEVER guess translations — always verify via the database
4. `poe2_parse_item` auto-detects language and enrichment resolves English base type names

## Examples

### User pastes an item

**User:** "Is this any good? [paste item text]"

**Correct behavior:**

1. Call `poe2_parse_item(text=..., enrich=true)` → get mod tiers, base stats
2. Read the tier table: identify which mods are T1/T2 (great) vs T5+ (mediocre)
3. Check open prefix/suffix slots for crafting potential
4. If unique, note the price from enrichment
5. Give a clear verdict: keep/sell/craft, with specific reasoning from tier data

**Wrong:** Eyeball the numbers without looking up tier data.

### User asks for help without context

**User:** "What should I do next?"

**Correct behavior:**

1. Call `poe2_log_summary` → determine current zone and level
2. Look up relevant game mechanics via `poe2_db_lookup` or `poe2_wiki_search`
3. Respond with specific, actionable steps based on actual player state

**Wrong:** Ask "What zone are you in?" when logs have this information.

### User asks about game mechanics

**User:** "What is Contagion?"

**Correct behavior:**

1. Look up Contagion via `poe2_db_lookup` for exact mechanics
2. If player uses localized client, also fetch the translated name
3. Explain with both names so player can match it in their game

**Wrong:** Guess at mechanics without looking up current data.

### User asks about economy

**User:** "Is this item valuable?"

**Correct behavior:**

1. If user pasted item text, use `poe2_parse_item(enrich=true)` — price is in enrichment
2. Otherwise use `poe2_item_price` to check current market value
3. Use `poe2_currency_check` for currency conversions if needed
4. Give a clear verdict with current prices

**Wrong:** Give outdated price estimates from training data.

## Response Guidelines

- Keep responses focused and actionable
- For item evaluations: lead with the verdict, then cite specific tier data
- For "what do I do?" questions: numbered steps, priority order
- Always end guidance with the single most important next action
```

</details>

## Supported Leagues

Default league: **Forbidden Rites** (event league, launched 0.5.5 on 2026-09-04, ends early December). It runs _concurrently_ with `Runes of Aldur` and has a **separate economy**, so prices from one say nothing about the other. Configurable via `--league` CLI argument or by editing `FALLBACK_LEAGUE` in `src/constants.ts`. The AI agent can override per-request.

| League           | Name (case-sensitive)                                         |
| ---------------- | ------------------------------------------------------------- |
| Softcore Trade   | `Forbidden Rites`                                             |
| Hardcore         | `HC Forbidden Rites`                                          |
| Concurrent 0.5.x | `Runes of Aldur`, `HC Runes of Aldur`                         |
| Previous leagues | `Fate of the Vaal`, `Rise of the Abyssal`, `Dawn of the Hunt` |
| Permanent SC     | `Standard`                                                    |
| Permanent HC     | `Hardcore`                                                    |

**Each new league:** bump `FALLBACK_LEAGUE` in `src/constants.ts`, then verify the name against the live sources — poe.ninja uses the display name (`GET https://poe.ninja/poe2/api/data/build-index-state` lists them) and poe2scout exposes `GET https://api.poe2scout.com/poe2/Leagues` with an `IsCurrent` flag.

## Architecture

```plaintext
poe2-mcp-server/
├── src/
│   ├── index.ts                    # Entry point: CLI flags, transport selection
│   ├── server.ts                   # Server factory: registers every tool group
│   ├── http.ts                     # Streamable HTTP transport, bearer auth, /health
│   ├── constants.ts                # Shared project constants
│   ├── services/
│   │   ├── api.ts                  # Barrel re-export for all service modules
│   │   ├── http.ts                 # HTTP client, RateLimiter, User-Agent
│   │   ├── ninja.ts                # poe.ninja exchange & build APIs
│   │   ├── poe2scout.ts            # api.poe2scout.com unique item pricing API
│   │   ├── poe2db.ts               # poe2db.tw HTML parsing & translation cache
│   │   ├── wiki.ts                 # poe2wiki.net MediaWiki API
│   │   ├── strings.ts              # 11-language keyword mappings for item parsing
│   │   ├── logfile.ts              # Client.txt log parsing
│   │   ├── pob.ts                  # Path of Building decode/compare
│   │   ├── ggg.ts                  # GGG session client — dormant, see Fork changes
│   │   └── repoe.ts                # RePoE datamined JSON — mod tiers, base item stats
│   └── tools/
│       ├── currency.ts             # Currency exchange rate tools
│       ├── items.ts                # Exchange & unique item price tools
│       ├── item.ts                 # Clipboard item parser with enrichment (11 languages)
│       ├── wiki.ts                 # Wiki search & poe2db lookup
│       ├── builds.ts               # Meta build overview
│       ├── logfile.ts              # Local logs parser
│       ├── pob.ts                  # Path of Building integration
│       └── stash.ts                # Stash reader — NOT registered, see Fork changes
├── dist/                           # Compiled output (npm run build)
├── package.json
├── tsconfig.json
└── README.md
```

### Data Sources

| Source                                                       | Auth | Rate Limit         | Update Frequency |
| ------------------------------------------------------------ | ---- | ------------------ | ---------------- |
| [poe.ninja](https://poe.ninja/poe2) PoE2 Exchange API        | None | 20 req / min       | ~1 hour          |
| [poe.ninja](https://poe.ninja/poe2) PoE2 Build Index API     | None | 20 req / min       | ~1 hour          |
| [api.poe2scout.com](https://api.poe2scout.com/) Unique Items | None | ~10 req / min      | ~1 hour          |
| [poe2wiki.net](https://www.poe2wiki.net/) MediaWiki API      | None | Standard MW limits | Community-driven |
| [RePoE](https://repoe-fork.github.io/poe2/) Datamined JSON   | None | ~5 req / min       | Each patch       |
| [poe2db.tw](https://poe2db.tw/)                              | None | ~15 req / min      | Each patch       |
| [pobb.in](https://pobb.in/) PoB paste service                | None | 10 req / min       | On-demand        |
| [poe.ninja](https://poe.ninja/poe2/pob) PoB paste hosting    | None | 10 req / 5 min     | On-demand        |
| Local `Client.txt` / `LatestClient.txt`                      | None | N/A (local file)   | Real-time        |
| Local PoB2 Builds directory                                  | None | N/A (local file)   | Real-time        |

Built-in rate limiters ensure all API limits are respected automatically.

## Development

```bash
npm run dev      # Watch mode: recompiles on file changes
npm run build    # One-time build
npm start        # Run the server (stdio)
```

### Adding a New Tool

1. Create a file in `src/tools/`
2. Export a `register*Tools(server: McpServer)` function
3. Import and call it in `src/index.ts`
4. Rebuild: `npm run build`

## Fork changes

This fork exists because upstream was archived (2026-04-22) and several data sources drifted afterwards. Changes vs upstream:

- **Current league** — default bumped `Dawn of the Hunt` → `Runes of Aldur` → **`Forbidden Rites`** (0.5.5 event league).
- **Streamable HTTP transport added** — upstream was stdio-only, which no remote client can use. `--http` serves the same tools over Streamable HTTP (stateless, optional bearer token, configurable path, `/health` probe) so ChatGPT developer mode and hosted agents can reach them; stdio stays the default and is unchanged.
- **poe2scout coverage gap surfaced** — a brand-new event league is served by poe2scout but stays empty until they ingest its economy, which used to read as "item not found". `poe2_item_price` now checks coverage (`hasScoutUniqueCoverage`) on an empty unique search and says so explicitly; poe.ninja currency/exchange data is unaffected.
- **poe2scout rewritten** — their API moved to a versioned, realm-aware host. Old `poe2scout.com/api/items/unique/{category}` now 404s; the client uses `https://api.poe2scout.com/{realm}/Leagues/{league}/Uniques/ByCategory?category=…` with `realm` as a **path segment** (`poe2`), PascalCase response fields (`Total`/`Items`/`CurrentPrice`/`CurrentQuantity`), and client-side filtering because the server-side `search` param silently returns zero rows.
- **`poe2_item_price` hang fixed** — a no-`type` search fans out over 13 exchange categories, which stalled for minutes against the old 10-req-per-5-min poe.ninja limiter. Raised to a steady 20/min (90s → ~1s).
- **Local PoB builds now found** — `listPob2Builds`/`readPob2Build` only scanned the top-level directory, but PoB2 nests builds as `Builds/<version>/<name>/build.xml`, so a real Builds folder returned nothing. Both now recurse; builds are identified by their path relative to the Builds root.
- **Locale-independent output** — `toLocaleString()` pinned to `en-US` so number formatting doesn't change with the host locale.
- **Stash reading attempted, then shelved (not shipped as a tool).** GGG has closed new OAuth app registrations, so this was tried against the PoE1 session-cookie endpoint instead. The cookie authenticates and reaches the API, but `character-window/get-stash-items` returns `400 Invalid query` for a PoE2 league, and **PoE2 has no web stash page** — so no session endpoint exists to target. `src/services/ggg.ts` and `src/tools/stash.ts` are kept (with tests and credential handling: `POE2_POESESSID`/`POE2_ACCOUNT_NAME` env or `~/.poe2-mcp/session.json`, never committed) but are **deliberately not registered in `src/index.ts`** — shipping a tool that always fails would just pollute every client's tool list. If GGG reopens OAuth, swap the cookie header for a bearer token and register it.

### Maintenance note

The MCP code is stable; **the data sources are what rot**. The test suite runs on fixtures, so green tests do not prove live sources work — after any source change, smoke-test against the real endpoints.

## License

MIT

## Disclaimer

This product isn't affiliated with or endorsed by Grinding Gear Games in any way.

Path of Exile is a registered trademark of Grinding Gear Games. All game content and materials are trademarks and copyrights of their respective owners.
