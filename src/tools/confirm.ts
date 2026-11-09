import { createHash, randomInt } from 'node:crypto';

const TTL_MS = 120_000;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

export interface ConfirmationRequest { needsConfirmation: true; summary: string; confirm: string }

/** Key-sorted JSON with `undefined` dropped, so `{a,b}` and `{b,a}` hash the same. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? 'null' : stable(x))).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

/** Hash of tool name + arguments without `confirm`. */
function bind(tool: string, args: object): string {
  const { confirm: _ignored, ...rest } = args as Record<string, unknown>;
  return createHash('sha256').update(tool).update('\0').update(stable(rest)).digest('hex');
}

/**
 * Server-side two-step confirmation for destructive tools (Claude Code may run in bypass mode, where
 * `destructiveHint` prompts nobody). A token is 8 random chars, valid 120 s, bound to the tool name and
 * its exact arguments (minus `confirm`), and works once.
 */
export class Confirmations {
  private readonly pending = new Map<string, { hash: string; expires: number }>();

  request(tool: string, args: object, summary: string): ConfirmationRequest {
    this.sweep();
    let token: string;
    do {
      token = Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
    } while (this.pending.has(token));
    this.pending.set(token, { hash: bind(tool, args), expires: Date.now() + TTL_MS });
    return { needsConfirmation: true, summary, confirm: token };
  }

  /** True once for a live token issued for this tool and these arguments. */
  consume(tool: string, args: object, token: string): boolean {
    this.sweep();
    const p = this.pending.get(token);
    if (!p || p.hash !== bind(tool, args)) return false;
    this.pending.delete(token);
    return true;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [t, p] of this.pending) if (p.expires <= now) this.pending.delete(t);
  }
}

export const CONFIRM_REFUSED =
  'confirmation token is invalid, expired (120 s) or was issued for different arguments — call again without confirm to get a new one, and show its summary to the user';
