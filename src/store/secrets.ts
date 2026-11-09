import { spawn } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Share keys / tokens per deviceId. Values never appear in errors. */
export interface Secrets {
  get(deviceId: string): Promise<string | undefined>;
  set(deviceId: string, secret: string): Promise<void>;
  delete(deviceId: string): Promise<void>;
}

export type Runner = (cmd: string, args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;

const SERVICE = 'plaiiin-lamp-mcp';
const SECURITY = '/usr/bin/security';
const NOT_FOUND = 44; // errSecItemNotFound exit status of `security`

export const keychainArgs = {
  set: (id: string, secret: string) => ['add-generic-password', '-U', '-s', SERVICE, '-a', id, '-w', secret],
  get: (id: string) => ['find-generic-password', '-s', SERVICE, '-a', id, '-w'],
  delete: (id: string) => ['delete-generic-password', '-s', SERVICE, '-a', id],
};

/** Spawn with an argument array (no shell), collect output. */
const spawnRunner: Runner = (cmd, args) => new Promise((resolve, reject) => {
  const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  p.stdout.on('data', (c: Buffer) => { stdout += c.toString('utf8'); });
  p.stderr.on('data', (c: Buffer) => { stderr += c.toString('utf8'); });
  p.on('error', (e) => reject(new Error(`keychain: cannot run ${cmd}: ${(e as NodeJS.ErrnoException).code ?? 'error'}`)));
  p.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
});

class KeychainSecrets implements Secrets {
  constructor(private readonly run: Runner) {}

  async get(deviceId: string): Promise<string | undefined> {
    const r = await this.run(SECURITY, keychainArgs.get(deviceId));
    if (r.code === NOT_FOUND) return undefined;
    if (r.code !== 0) throw fail('find-generic-password', r.code);
    return r.stdout.replace(/\r?\n$/, '');
  }

  async set(deviceId: string, secret: string): Promise<void> {
    const r = await this.run(SECURITY, keychainArgs.set(deviceId, secret));
    if (r.code !== 0) throw fail('add-generic-password', r.code);
  }

  async delete(deviceId: string): Promise<void> {
    const r = await this.run(SECURITY, keychainArgs.delete(deviceId));
    if (r.code !== 0 && r.code !== NOT_FOUND) throw fail('delete-generic-password', r.code);
  }
}

/** The error names the subcommand and exit code only — never the arguments or stderr (could echo the secret). */
function fail(sub: string, code: number): Error {
  return new Error(`keychain: security ${sub} failed (exit ${code})`);
}

/** `<dir>/secrets.json`, mode 0600, rewritten atomically. */
class FileSecrets implements Secrets {
  private readonly file: string;
  constructor(private readonly dir: string) { this.file = join(dir, 'secrets.json'); }

  async get(deviceId: string): Promise<string | undefined> {
    return this.read()[deviceId];
  }

  async set(deviceId: string, secret: string): Promise<void> {
    const all = this.read();
    all[deviceId] = secret;
    this.write(all);
  }

  async delete(deviceId: string): Promise<void> {
    const all = this.read();
    if (!(deviceId in all)) return;
    delete all[deviceId];
    this.write(all);
  }

  private read(): Record<string, string> {
    let text: string;
    try { text = readFileSync(this.file, 'utf8'); } catch { return {}; }
    try {
      const j = JSON.parse(text) as unknown;
      return j && typeof j === 'object' ? { ...(j as Record<string, string>) } : {};
    } catch {
      throw new Error(`secrets file ${this.file} is not valid JSON`);
    }
  }

  private write(all: Record<string, string>): void {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(all, null, 2) + '\n', { mode: 0o600 });
    chmodSync(tmp, 0o600); // mode is masked by umask on create
    renameSync(tmp, this.file);
  }
}

/** darwin → macOS Keychain via `security` (service plaiiin-lamp-mcp, account = deviceId); else a 0600 file. */
export function makeSecrets(dir: string, platform: NodeJS.Platform = process.platform, run: Runner = spawnRunner): Secrets {
  return platform === 'darwin' ? new KeychainSecrets(run) : new FileSecrets(dir);
}
