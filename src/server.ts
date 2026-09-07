/**
 * Server factory — builds a fully-registered MCP server instance.
 *
 * Kept separate from transport wiring so the same tool set can be served over
 * stdio (one long-lived instance) or Streamable HTTP (a fresh instance per
 * request, since the HTTP transport runs stateless).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerCurrencyTools } from './tools/currency.js';
import { registerItemTools } from './tools/items.js';
import { registerWikiTools } from './tools/wiki.js';
import { registerBuildTools } from './tools/builds.js';
import { registerLogfileTools } from './tools/logfile.js';
import { registerPobTools } from './tools/pob.js';
import { registerItemParserTools } from './tools/item.js';

/** Paths to the local game install and PoB2 builds folder, if configured. */
export interface ServerOptions {
  poe2InstallPath?: string;
  pob2BuildsPath?: string;
}

/**
 * Create an MCP server with every tool group registered.
 *
 * @param options - Local filesystem paths for the log and PoB tools.
 */
export function createPoe2Server(options: ServerOptions = {}): McpServer {
  const server = new McpServer({
    name: 'poe2-mcp-server',
    version: '1.0.0',
  });

  registerCurrencyTools(server);
  registerItemTools(server);
  registerWikiTools(server);
  registerBuildTools(server);
  registerLogfileTools(server, { poe2InstallPath: options.poe2InstallPath });
  registerPobTools(server, { pob2BuildsPath: options.pob2BuildsPath });
  registerItemParserTools(server);
  // NOTE: registerStashTools (src/tools/stash.ts) is intentionally NOT registered.
  // PoE2 exposes no session-cookie stash endpoint and GGG has closed new OAuth
  // app registrations, so the tool can never succeed — registering it would only
  // add a guaranteed-failing tool to every client's tool list. The code and its
  // credential handling are kept for if/when OAuth reopens. See README > Fork changes.

  return server;
}
