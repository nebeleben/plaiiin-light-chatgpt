import { LampClient } from './client';
import { LampHttpError, LampUnreachable } from './errors';
import { allows } from './access';
import { resolveDevice, type Discovered } from './discovery';
import type { ShareLink } from './shareLink';
import type { FleetLamp, FleetRole, FleetStore } from '../store/fleet';
import type { Secrets } from '../store/secrets';

interface Whoami { role?: string; paired?: boolean; perms?: unknown; maxBrightness?: unknown; onlyWhenOn?: unknown }
interface ApiInfo { deviceId?: string; nodeName?: string; firmwareVersion?: string; lampForm?: string; logicalW?: number; logicalH?: number }
interface OtaInfo { form?: string; target?: string }
interface Swarm { member?: boolean; id?: string }

const ROLES: readonly FleetRole[] = ['admin', 'creator', 'user', 'ai'];

/** Access fields from `GET /api/whoami`. `perms` etc. only for AI keys; old firmware omits them (→ ladder). */
function accessFrom(w: Whoami): Pick<FleetLamp, 'role' | 'perms' | 'maxBrightness' | 'onlyWhenOn'> {
  const role = ROLES.includes(w.role as FleetRole) ? (w.role as FleetRole) : 'user';
  if (role !== 'ai') return { role, perms: undefined, maxBrightness: undefined, onlyWhenOn: undefined };
  return {
    role,
    perms: Array.isArray(w.perms) ? w.perms.filter((p): p is string => typeof p === 'string') : undefined,
    maxBrightness: typeof w.maxBrightness === 'number' ? w.maxBrightness : null,
    onlyWhenOn: w.onlyWhenOn === true,
  };
}

const now = () => new Date().toISOString();

/** Fleet + secrets + clients: the only way tools reach a lamp. One LampClient per deviceId. */
export class Registry {
  private readonly clients = new Map<string, { client: LampClient; token?: string }>();

  constructor(
    private readonly fleet: FleetStore,
    private readonly secrets: Secrets,
    private readonly resolve: (deviceId: string) => Promise<Discovered | undefined> = (id) => resolveDevice(id),
  ) {}

  async client(idOrName: string): Promise<{ lamp: FleetLamp; client: LampClient }> {
    const lamp = this.fleet.get(idOrName);
    if (!lamp) throw new Error(`unknown lamp: ${idOrName}`);
    const token = await this.secrets.get(lamp.deviceId);
    let entry = this.clients.get(lamp.deviceId);
    if (entry && entry.token !== token) { entry.client.destroy(); entry = undefined; }
    if (!entry) {
      entry = { client: new LampClient({ host: lamp.host, port: lamp.port, token }), token };
      this.clients.set(lamp.deviceId, entry);
    } else {
      entry.client.updateEndpoint(lamp.host, lamp.port);
    }
    return { lamp, client: entry.client };
  }

  /** Run `fn` against a lamp. If it is unreachable, re-resolve it by deviceId once; if it moved, save and retry. */
  async call<T>(idOrName: string, fn: (c: LampClient, l: FleetLamp) => Promise<T>): Promise<T> {
    const { lamp, client } = await this.client(idOrName);
    try {
      return await fn(client, lamp);
    } catch (e) {
      if (!(e instanceof LampUnreachable)) throw e;
      const d = await this.resolve(lamp.deviceId).catch(() => undefined);
      if (!d || (d.host === lamp.host && d.port === lamp.port)) throw e;
      const moved: FleetLamp = { ...lamp, host: d.host, port: d.port, lastSeen: now() };
      this.fleet.upsert(moved);
      client.updateEndpoint(d.host, d.port);
      return await fn(client, moved);
    }
  }

  /** Add (or re-add) a lamp from a share link: whoami + /api (+ /api/swarm when readable) → fleet + secret. */
  async addShared(link: ShareLink): Promise<FleetLamp> {
    const c = new LampClient({ host: link.host, port: link.port, token: link.key });
    try {
      const who = await c.get<Whoami>('/api/whoami');
      const lamp = await this.describe(c, link.host, link.port, accessFrom(who), true);
      await this.secrets.set(lamp.deviceId, link.key);
      this.fleet.upsert(lamp);
      return lamp;
    } finally {
      c.destroy();
    }
  }

  /** Add an unpaired lamp found on the LAN: it answers as admin without a token, so no secret is stored. */
  async addUnpaired(d: Discovered): Promise<FleetLamp> {
    const c = new LampClient({ host: d.host, port: d.port });
    try {
      let who: Whoami;
      try {
        who = await c.get<Whoami>('/api/whoami');
      } catch (e) {
        if (e instanceof LampHttpError && (e.status === 401 || e.status === 403)) throw new Error(`${d.name} is paired; add it with a share link or QR code from its owner`);
        throw e;
      }
      if (who.role !== 'admin') throw new Error(`${d.name} is paired; add it with a share link or QR code from its owner`);
      const lamp = await this.describe(c, d.host, d.port, { role: 'admin' }, false);
      await this.secrets.delete(lamp.deviceId);
      this.fleet.upsert(lamp);
      return lamp;
    } finally {
      c.destroy();
    }
  }

  /** Re-read whoami for every lamp (server start). Unreachable or refusing lamps keep their stored access. */
  async refreshAccess(): Promise<void> {
    await Promise.all(this.fleet.list().map(async (l) => {
      try {
        const who = await this.call(l.deviceId, (c) => c.get<Whoami>('/api/whoami'));
        const cur = this.fleet.get(l.deviceId) ?? l;
        this.fleet.upsert({ ...cur, ...accessFrom(who), lastSeen: now() });
      } catch { /* keep what we had; the tool call will report the lamp's state */ }
    }));
  }

  /** Names or deviceIds (or "all") → fleet entries, in order, deduped. Unknown names throw. */
  resolveTargets(lamps: string[] | 'all'): FleetLamp[] {
    if (lamps === 'all') return this.fleet.list();
    const out: FleetLamp[] = [];
    for (const n of lamps) {
      const l = this.fleet.get(n);
      if (!l) throw new Error(`unknown lamp: ${n}`);
      if (!out.some((x) => x.deviceId === l.deviceId)) out.push(l);
    }
    return out;
  }

  close(): void {
    for (const e of this.clients.values()) e.client.destroy();
    this.clients.clear();
  }

  private async describe(c: LampClient, host: string, port: number, access: Pick<FleetLamp, 'role' | 'perms' | 'maxBrightness' | 'onlyWhenOn'>, shared: boolean): Promise<FleetLamp> {
    const info = await c.get<ApiInfo>('/api');
    if (!info.deviceId) throw new Error(`the lamp at ${host}:${port} reports no deviceId (firmware before 2.2.0); update it first`);
    const ota = await c.get<OtaInfo>('/api/ota/info').catch(() => ({}) as OtaInfo);
    const lamp: FleetLamp = {
      deviceId: info.deviceId, name: info.nodeName ?? info.deviceId, host, port,
      ...access,
      form: ota.form ?? info.lampForm, target: ota.target,
      grid: typeof info.logicalW === 'number' && typeof info.logicalH === 'number' ? { w: info.logicalW, h: info.logicalH } : undefined,
      firmware: info.firmwareVersion, swarmId: null, shared, lastSeen: now(),
    };
    if (allows(lamp, { perm: 'swarm', minRole: 'user' })) {
      const sw = await c.get<Swarm>('/api/swarm').catch(() => undefined);
      lamp.swarmId = sw?.member && sw.id ? sw.id : null;
    }
    return lamp;
  }
}
