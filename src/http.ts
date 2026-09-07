/**
 * Streamable HTTP transport — lets remote MCP clients (ChatGPT developer mode,
 * hosted agents) reach the same tools that stdio serves locally.
 *
 * Runs stateless: every POST gets its own McpServer + transport pair, so there
 * is no session state to pin a client to one process. Only POST /mcp carries
 * JSON-RPC; GET /health is a plain liveness probe for hosting platforms.
 *
 * SECURITY: an exposed endpoint shares this process's rate-limit budget for
 * poe.ninja and poe2scout, so set POE2_MCP_TOKEN (bearer auth) on anything
 * reachable from the internet. TLS is expected to come from a reverse proxy.
 */

import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import type { Server as HttpServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { createPoe2Server, type ServerOptions } from './server.js';

/** Default path that speaks MCP. Anything else is 404 (except /health). */
export const DEFAULT_MCP_PATH = '/mcp';

/**
 * Normalize an endpoint path: force a leading slash, drop a trailing one.
 * Clients differ on whether they append a trailing slash, so both must match.
 */
export function normalizePath(path: string): string {
  const withLeading = path.startsWith('/') ? path : `/${path}`;
  return withLeading.length > 1 ? withLeading.replace(/\/+$/, '') : withLeading;
}

export interface HttpServerOptions {
  /** TCP port to listen on. */
  port: number;
  /** Interface to bind. Defaults to loopback so an accidental start is not public. */
  host: string;
  /** Bearer token required on every MCP request. Unauthenticated when omitted. */
  token?: string;
  /**
   * Path that serves MCP. Defaults to `/mcp`. Clients that cannot send an
   * Authorization header (ChatGPT connectors take OAuth or nothing) can at
   * least be given an unguessable path instead of a bare public endpoint.
   */
  path?: string;
  /** Options handed to each per-request MCP server instance. */
  serverOptions?: ServerOptions;
}

/** Constant-time bearer token comparison; length mismatch fails without leaking it. */
function tokenMatches(expected: string, provided: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Extract the bearer value from an Authorization header, if it is well-formed. */
function readBearer(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const match = /^Bearer (.+)$/i.exec(header.trim());
  return match?.[1];
}

/** Write a JSON body with the given status. */
function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

/** JSON-RPC shaped error, so MCP clients surface something readable. */
function sendRpcError(res: ServerResponse, status: number, code: number, message: string): void {
  sendJson(res, status, { jsonrpc: '2.0', error: { code, message }, id: null });
}

/**
 * Handle one MCP request with a throwaway server + transport pair.
 * Stateless mode means nothing survives the response, so a restart or a second
 * replica cannot strand a client mid-session.
 */
async function handleMcpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  serverOptions: ServerOptions,
): Promise<void> {
  const server = createPoe2Server(serverOptions);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  res.on('close', () => {
    void transport.close();
    void server.close();
  });

  await server.connect(transport);
  await transport.handleRequest(req, res);
}

/**
 * Start the HTTP listener. Resolves once the socket is bound.
 *
 * @param options - Port, bind host, optional bearer token, tool options.
 */
export function startHttpServer(options: HttpServerOptions): Promise<HttpServer> {
  const { port, host, token, serverOptions = {} } = options;
  const mcpPath = normalizePath(options.path ?? DEFAULT_MCP_PATH);

  const httpServer = createHttpServer((req, res) => {
    const path = normalizePath(
      new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`).pathname,
    );

    if (path === '/health') {
      sendJson(res, 200, { status: 'ok', name: 'poe2-mcp-server', transport: 'streamable-http' });
      return;
    }

    if (path !== mcpPath) {
      sendJson(res, 404, { error: 'Not found.' });
      return;
    }

    if (token && !tokenMatches(token, readBearer(req.headers.authorization) ?? '')) {
      res.setHeader('WWW-Authenticate', 'Bearer');
      sendRpcError(res, 401, -32001, 'Unauthorized: missing or invalid bearer token.');
      return;
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      sendRpcError(
        res,
        405,
        -32000,
        'Method not allowed. This server is stateless: send JSON-RPC over POST.',
      );
      return;
    }

    handleMcpRequest(req, res, serverOptions).catch((error: unknown) => {
      console.error('MCP request failed:', error instanceof Error ? error.message : error);
      if (!res.headersSent) {
        sendRpcError(res, 500, -32603, 'Internal server error.');
      } else {
        res.end();
      }
    });
  });

  return new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, host, () => {
      httpServer.removeListener('error', reject);
      resolve(httpServer);
    });
  });
}
