#!/usr/bin/env node

/**
 * poe2-mcp-server — MCP server for Path of Exile 2 public data.
 *
 * Provides tools for:
 *  - Currency exchange rates (poe.ninja)
 *  - Item / unique prices (poe.ninja)
 *  - Wiki search (poe2wiki.net)
 *  - Game database lookup (poe2db.tw)
 *  - Meta build overview (poe.ninja builds)
 *  - Local logs parsing (Client.txt/LatestClient.txt)
 *
 * All data comes from public APIs — no GGG OAuth registration required.
 *
 * Two transports:
 *  - stdio (default) for local clients that spawn the process — Claude Desktop,
 *    Claude Code, Cursor, VS Code.
 *  - Streamable HTTP (`--http`) for remote clients that only take a URL —
 *    ChatGPT developer mode, hosted agents. See README > Remote (HTTP) mode.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { createPoe2Server, type ServerOptions } from './server.js';
import { startHttpServer, normalizePath, DEFAULT_MCP_PATH } from './http.js';

/** Default port for `--http`, overridable via `--port` or the PORT env var. */
const DEFAULT_HTTP_PORT = 3000;

/** Read a named CLI argument value (e.g., `--poe2-path "/path"`). */
function readCliArg(flag: string): string | undefined {
  const args = process.argv.slice(2);
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : undefined;
}

/** Whether a boolean CLI flag is present (e.g., `--http`). */
function hasCliFlag(flag: string): boolean {
  return process.argv.slice(2).includes(flag);
}

/** Resolve the HTTP port from `--port`, then PORT, then the default. */
function readPort(): number {
  const raw = readCliArg('--port') ?? process.env.PORT;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65536 ? parsed : DEFAULT_HTTP_PORT;
}

async function main(): Promise<void> {
  const localPaths: ServerOptions = {
    poe2InstallPath: readCliArg('--poe2-path'),
    pob2BuildsPath: readCliArg('--pob2-path'),
  };

  if (hasCliFlag('--http')) {
    const port = readPort();
    const host = readCliArg('--host') ?? process.env.HOST ?? '127.0.0.1';
    const token = process.env.POE2_MCP_TOKEN?.trim() || undefined;
    const path = readCliArg('--path') ?? process.env.POE2_MCP_PATH;

    // The log and PoB tools read THIS machine's disk, which means nothing to a
    // remote caller and needlessly widens the surface. Serve them only when the
    // operator opts in with --allow-local-tools.
    const serverOptions = hasCliFlag('--allow-local-tools') ? localPaths : {};

    const server = await startHttpServer({ port, host, token, path, serverOptions });
    const endpoint = normalizePath(path ?? DEFAULT_MCP_PATH);

    // Path is logged for the operator; the token never is.
    console.error(
      `poe2-mcp-server listening on http://${host}:${port}${endpoint} (streamable-http)` +
        `${token ? '' : ' — WARNING: no POE2_MCP_TOKEN set, endpoint is unauthenticated'}`,
    );

    const shutdown = (): void => {
      server.close(() => process.exit(0));
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
    return;
  }

  const server = createPoe2Server(localPaths);

  // Use stdio transport for local clients that spawn this process
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log to stderr (stdout is reserved for MCP JSON-RPC)
  console.error('poe2-mcp-server started (stdio transport)');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
