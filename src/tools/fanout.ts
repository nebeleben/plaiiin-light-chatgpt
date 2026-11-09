import { refusal, type Need } from '../lamp/access';
import type { LampClient } from '../lamp/client';
import type { FleetLamp } from '../store/fleet';
import { explain, type ToolContext } from './context';

export type LampOk<T> = { lamp: string; deviceId: string; ok: true; viaSwarm?: string } & T;
export type LampFail = { lamp: string; deviceId: string; ok: false; skipped?: true; reason: string };
export type LampResult<T> = LampOk<T> | LampFail;

/**
 * Run `fn` on every target in parallel (each lamp's own client queues its requests and times out on its
 * own, so one wedged lamp can't hold the others). Lamps whose access doesn't allow `need` are skipped
 * without a request. Unknown / ambiguous names throw before anything is sent.
 */
export async function fanout<T extends object>(
  ctx: ToolContext, lamps: string[] | 'all', need: Need,
  fn: (c: LampClient, l: FleetLamp) => Promise<T>,
): Promise<LampResult<T>[]> {
  const targets = ctx.registry.resolveTargets(lamps);
  return Promise.all(targets.map(async (l): Promise<LampResult<T>> => {
    const base = { lamp: l.name, deviceId: l.deviceId };
    const refused = refusal(l, need);
    if (refused) return { ...base, ok: false, skipped: true, reason: refused };
    try {
      const r = await ctx.registry.call(l.deviceId, fn);
      return { ...r, ...base, ok: true } as LampOk<T>;
    } catch (e) {
      return { ...base, ok: false, reason: explain(e, l, need) };
    }
  }));
}
