import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FleetStore, type FleetLamp } from '../src/store/fleet';
import { makeSecrets, keychainArgs, type Runner } from '../src/store/secrets';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
function tmp(): string { const d = mkdtempSync(join(tmpdir(), 'lamp-mcp-')); dirs.push(d); return d; }

const lamp = (o: Partial<FleetLamp> = {}): FleetLamp => ({
  deviceId: 'aabbccddeeff', name: 'Kitchen', host: '192.168.1.5', port: 80, role: 'creator',
  shared: true, lastSeen: '2026-11-10T00:00:00.000Z', ...o,
});

describe('FleetStore', () => {
  it('upserts and gets by deviceId and by name (case-insensitive)', () => {
    const f = new FleetStore(tmp());
    f.upsert(lamp());
    f.upsert(lamp({ deviceId: '112233445566', name: 'Desk' }));
    expect(f.get('aabbccddeeff')?.name).toBe('Kitchen');
    expect(f.get('kitchen')?.deviceId).toBe('aabbccddeeff');
    expect(f.get('Desk')?.deviceId).toBe('112233445566');
    expect(f.get('nope')).toBeUndefined();
    f.upsert(lamp({ name: 'Kitchen 2', port: 8080 }));
    expect(f.list()).toHaveLength(2);
    expect(f.get('aabbccddeeff')?.port).toBe(8080);
  });

  it('persists across instances and removes', () => {
    const d = tmp();
    new FleetStore(d).upsert(lamp());
    const f = new FleetStore(d);
    expect(f.get('Kitchen')?.host).toBe('192.168.1.5');
    f.remove('aabbccddeeff');
    expect(new FleetStore(d).list()).toEqual([]);
  });

  it('never writes key/token fields and leaves valid JSON with no tmp files', () => {
    const d = tmp();
    const f = new FleetStore(d);
    f.upsert({ ...lamp(), key: 'SECRET1', token: 'SECRET2' } as FleetLamp);
    const text = readFileSync(join(d, 'fleet.json'), 'utf8');
    expect(() => JSON.parse(text)).not.toThrow();
    expect(text).not.toContain('SECRET');
    expect(text).not.toMatch(/"(key|token)"/);
    expect(readdirSync(d)).toEqual(['fleet.json']);
  });

  it('starts empty when there is no file', () => {
    expect(new FleetStore(join(tmp(), 'sub')).list()).toEqual([]);
  });
});

describe('Secrets (file backend)', () => {
  it('set/get/delete with mode 0600', async () => {
    const d = tmp();
    const s = makeSecrets(d, 'linux');
    expect(await s.get('aa')).toBeUndefined();
    await s.set('aa', 'k1');
    await s.set('bb', 'k2');
    expect(await s.get('aa')).toBe('k1');
    expect(statSync(join(d, 'secrets.json')).mode & 0o777).toBe(0o600);
    await s.delete('aa');
    expect(await s.get('aa')).toBeUndefined();
    expect(await makeSecrets(d, 'linux').get('bb')).toBe('k2');
    expect(statSync(join(d, 'secrets.json')).mode & 0o777).toBe(0o600);
  });
});

describe('Secrets (macOS Keychain backend)', () => {
  it('builds security commands as argument arrays', () => {
    expect(keychainArgs.set('aa', 'k1')).toEqual(['add-generic-password', '-U', '-s', 'plaiiin-lamp-mcp', '-a', 'aa', '-w', 'k1']);
    expect(keychainArgs.get('aa')).toEqual(['find-generic-password', '-s', 'plaiiin-lamp-mcp', '-a', 'aa', '-w']);
    expect(keychainArgs.delete('aa')).toEqual(['delete-generic-password', '-s', 'plaiiin-lamp-mcp', '-a', 'aa']);
  });

  it('runs /usr/bin/security via the injected runner; not-found maps to undefined; errors hide the secret', async () => {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    let reply = { code: 0, stdout: 'k1\n', stderr: '' };
    const run: Runner = async (cmd, args) => { calls.push({ cmd, args }); return reply; };
    const s = makeSecrets(tmp(), 'darwin', run);
    expect(await s.get('aa')).toBe('k1');
    expect(calls[0]).toEqual({ cmd: '/usr/bin/security', args: keychainArgs.get('aa') });
    reply = { code: 44, stdout: '', stderr: 'The specified item could not be found in the keychain.' };
    expect(await s.get('aa')).toBeUndefined();
    await expect(s.delete('aa')).resolves.toBeUndefined();
    reply = { code: 1, stdout: '', stderr: 'boom TOPSECRET' };
    const err = await s.set('aa', 'TOPSECRET').catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect(String((err as Error).message)).not.toContain('TOPSECRET');
  });
});
