import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { allows } from '../lamp/access';
import type { FleetLamp } from '../store/fleet';
import { describeLamp, guard, result, type ToolContext } from './context';

const SWARM_READ = { perm: 'swarm', minRole: 'user' } as const;

/** Can we read this lamp's swarm membership? (AI keys need the `swarm` permission.) */
export function swarmKnown(l: FleetLamp): boolean {
  return allows(l, SWARM_READ);
}

/**
 * Group lamps by swarm id (key = swarmId, or `solo:<deviceId>` for lamps outside a swarm or whose
 * membership we can't read — those count as their own group).
 */
export function swarmGroups(_ctx: ToolContext, lamps: FleetLamp[]): Map<string, FleetLamp[]> {
  const groups = new Map<string, FleetLamp[]>();
  for (const l of lamps) {
    const key = swarmKnown(l) && l.swarmId ? l.swarmId : `solo:${l.deviceId}`;
    const g = groups.get(key);
    if (g) g.push(l); else groups.set(key, [l]);
  }
  return groups;
}

/** Re-read `GET /api/swarm` on every lamp we may read it from; unreachable lamps keep their stored id. */
export async function refreshSwarms(ctx: ToolContext): Promise<{ lamps: FleetLamp[]; unreachable: string[] }> {
  const unreachable: string[] = [];
  const lamps = await Promise.all(ctx.registry.list().map(async (l) => {
    if (!swarmKnown(l)) return l;
    try {
      const sw = await ctx.registry.call(l.deviceId, (c) => c.get<{ member?: boolean; id?: string }>('/api/swarm'));
      const swarmId = sw.member && sw.id ? sw.id : null;
      const cur = ctx.registry.lookup(l.deviceId);
      if (cur.swarmId !== swarmId) ctx.registry.update({ ...cur, swarmId });
      return { ...cur, swarmId };
    } catch {
      unreachable.push(l.name);
      return l;
    }
  }));
  return { lamps, unreachable };
}

const brief = (l: FleetLamp) => ({ name: l.name, deviceId: l.deviceId });

export function registerSwarmTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool('swarms_list', {
    title: 'List swarms',
    description:
      'Show which lamps are linked in a swarm (lamps in one swarm mirror scene changes and effect tunes to each other). ' +
      'Reads GET /api/swarm on every lamp live. Returns `swarms` (swarm id + members), `solo` (lamps in no swarm) and ' +
      '`unknown` (lamps whose AI key lacks the `swarm` permission, so membership can\'t be read — ask the owner to add ' +
      '`swarm` to the AI key in the app\'s Share tab). Read-only; this server never joins or leaves swarms.',
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => guard(async () => {
    const { lamps, unreachable } = await refreshSwarms(ctx);
    const known = lamps.filter(swarmKnown);
    const swarms = [...swarmGroups(ctx, known)].filter(([k]) => !k.startsWith('solo:'))
      .map(([swarmId, members]) => ({ swarmId, members: members.map(brief) }));
    return result({
      swarms,
      solo: known.filter((l) => !l.swarmId).map(brief),
      unknown: lamps.filter((l) => !swarmKnown(l)).map(brief),
      ...(unreachable.length ? { unreachable, note: 'unreachable lamps are shown with their last known swarm' } : {}),
    });
  }));
}
