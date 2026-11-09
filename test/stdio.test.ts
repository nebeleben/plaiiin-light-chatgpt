import { beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = resolve(__dirname, '..');
const dist = join(root, 'plugin/dist/index.js');

describe('built server over stdio', () => {
  beforeAll(() => { execFileSync(process.execPath, ['esbuild.mjs'], { cwd: root }); }, 60_000);

  it('starts and answers tools/list', async () => {
    expect(existsSync(dist)).toBe(true);
    const dir = mkdtempSync(join(tmpdir(), 'lamp-mcp-stdio-'));
    const transport = new StdioClientTransport({
      command: process.execPath, args: [dist],
      env: { ...process.env, PLAIIIN_LAMPS_DIR: dir } as Record<string, string>,
      stderr: 'ignore',
    });
    const client = new Client({ name: 'stdio-test', version: '0.0.0' });
    try {
      await client.connect(transport);
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toContain('lamps_list');
      const r = await client.callTool({ name: 'lamps_list', arguments: {} });
      expect(JSON.parse((r.content as Array<{ text: string }>)[0]!.text)).toEqual({ lamps: [] });
    } finally {
      await client.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
