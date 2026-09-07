import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import { startHttpServer, normalizePath } from './http.js';

/** Start a listener on an ephemeral port and return its base URL. */
async function start(token?: string, path?: string): Promise<{ server: Server; url: string }> {
  const server = await startHttpServer({ port: 0, host: '127.0.0.1', token, path });
  const { port } = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${port}` };
}

/** Minimal MCP initialize request body. */
const initializeBody = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'test', version: '1' },
  },
});

const mcpHeaders = {
  'Content-Type': 'application/json',
  Accept: 'application/json, text/event-stream',
};

describe('startHttpServer (authenticated)', () => {
  let server: Server;
  let url: string;

  beforeAll(async () => {
    ({ server, url } = await start('s3cret'));
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('serves a health probe without a token', async () => {
    const res = await fetch(`${url}/health`);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      status: 'ok',
      transport: 'streamable-http',
    });
  });

  it('404s any path other than /mcp', async () => {
    const res = await fetch(`${url}/nope`);

    expect(res.status).toBe(404);
  });

  it('rejects a request with no bearer token', async () => {
    const res = await fetch(`${url}/mcp`, {
      method: 'POST',
      headers: mcpHeaders,
      body: initializeBody,
    });

    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe('Bearer');
  });

  it('rejects a request with the wrong bearer token', async () => {
    const res = await fetch(`${url}/mcp`, {
      method: 'POST',
      headers: { ...mcpHeaders, Authorization: 'Bearer wrong' },
      body: initializeBody,
    });

    expect(res.status).toBe(401);
  });

  it('rejects GET on the MCP endpoint (stateless: POST only)', async () => {
    const res = await fetch(`${url}/mcp`, {
      headers: { Authorization: 'Bearer s3cret' },
    });

    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
  });

  it('completes an initialize handshake with a valid token', async () => {
    const res = await fetch(`${url}/mcp`, {
      method: 'POST',
      headers: { ...mcpHeaders, Authorization: 'Bearer s3cret' },
      body: initializeBody,
    });

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('poe2-mcp-server');
  });

  it('lists tools without a prior initialize, because each request is stateless', async () => {
    const res = await fetch(`${url}/mcp`, {
      method: 'POST',
      headers: { ...mcpHeaders, Authorization: 'Bearer s3cret' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    });

    expect(res.status).toBe(200);
    expect(await res.text()).toContain('poe2_currency_prices');
  });
});

describe('startHttpServer (no token configured)', () => {
  let server: Server;
  let url: string;

  beforeAll(async () => {
    ({ server, url } = await start());
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('accepts unauthenticated MCP requests', async () => {
    const res = await fetch(`${url}/mcp`, {
      method: 'POST',
      headers: mcpHeaders,
      body: initializeBody,
    });

    expect(res.status).toBe(200);
    expect(await res.text()).toContain('poe2-mcp-server');
  });
});

describe('normalizePath', () => {
  it.each([
    { input: '/mcp', expected: '/mcp' },
    { input: 'mcp', expected: '/mcp' },
    { input: '/mcp/', expected: '/mcp' },
    { input: '/mcp///', expected: '/mcp' },
    { input: '/', expected: '/' },
  ])('normalizes $input to $expected', ({ input, expected }) => {
    expect(normalizePath(input)).toBe(expected);
  });
});

describe('startHttpServer (custom path)', () => {
  let server: Server;
  let url: string;

  beforeAll(async () => {
    ({ server, url } = await start(undefined, '/secret-endpoint'));
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('serves MCP on the configured path', async () => {
    const res = await fetch(`${url}/secret-endpoint`, {
      method: 'POST',
      headers: mcpHeaders,
      body: initializeBody,
    });

    expect(res.status).toBe(200);
  });

  it('accepts the same path with a trailing slash', async () => {
    const res = await fetch(`${url}/secret-endpoint/`, {
      method: 'POST',
      headers: mcpHeaders,
      body: initializeBody,
    });

    expect(res.status).toBe(200);
  });

  it('404s the default /mcp path once a custom one is set', async () => {
    const res = await fetch(`${url}/mcp`, {
      method: 'POST',
      headers: mcpHeaders,
      body: initializeBody,
    });

    expect(res.status).toBe(404);
  });
});
