import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type FleetRole = 'admin' | 'creator' | 'user' | 'ai';

/** One known lamp. Identity is `deviceId`; host/port are a cache. Never holds a secret. */
export interface FleetLamp {
  deviceId: string; name: string; host: string; port: number;
  role: FleetRole; perms?: string[]; maxBrightness?: number | null; onlyWhenOn?: boolean;
  form?: string; target?: string; grid?: { w: number; h: number }; firmware?: string;
  swarmId?: string | null; shared: boolean; lastSeen: string;
}

const FIELDS: ReadonlyArray<keyof FleetLamp> = [
  'deviceId', 'name', 'host', 'port', 'role', 'perms', 'maxBrightness', 'onlyWhenOn',
  'form', 'target', 'grid', 'firmware', 'swarmId', 'shared', 'lastSeen',
];

/** Only the known fields survive, so a secret passed by mistake is never written. */
function clean(l: FleetLamp): FleetLamp {
  const out: Record<string, unknown> = {};
  for (const k of FIELDS) if (l[k] !== undefined) out[k] = l[k];
  return out as unknown as FleetLamp;
}

/** `<dir>/fleet.json` — `{ "lamps": [...] }`, rewritten atomically (tmp file + rename). */
export class FleetStore {
  private readonly file: string;
  private lamps: FleetLamp[];

  constructor(private readonly dir: string) {
    this.file = join(dir, 'fleet.json');
    this.lamps = this.load();
  }

  list(): FleetLamp[] {
    return this.lamps.map((l) => ({ ...l }));
  }

  /** By exact deviceId, else by name (case-insensitive). */
  get(idOrName: string): FleetLamp | undefined {
    const want = idOrName.trim();
    const l = this.lamps.find((x) => x.deviceId === want)
      ?? this.lamps.find((x) => x.name.toLowerCase() === want.toLowerCase());
    return l ? { ...l } : undefined;
  }

  upsert(l: FleetLamp): void {
    const c = clean(l);
    const i = this.lamps.findIndex((x) => x.deviceId === c.deviceId);
    if (i >= 0) this.lamps[i] = c; else this.lamps.push(c);
    this.save();
  }

  remove(deviceId: string): void {
    const n = this.lamps.length;
    this.lamps = this.lamps.filter((x) => x.deviceId !== deviceId);
    if (this.lamps.length !== n) this.save();
  }

  private load(): FleetLamp[] {
    let text: string;
    try { text = readFileSync(this.file, 'utf8'); } catch { return []; }
    const j = JSON.parse(text) as { lamps?: unknown };
    return Array.isArray(j.lamps) ? (j.lamps as FleetLamp[]).map(clean) : [];
  }

  private save(): void {
    mkdirSync(this.dir, { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ lamps: this.lamps }, null, 2) + '\n');
    renameSync(tmp, this.file);
  }
}
