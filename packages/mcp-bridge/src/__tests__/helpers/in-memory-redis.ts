/**
 * Minimal in-memory Redis stub for use in unit tests.
 *
 * Covers the subset of `ioredis` commands used by the mcp-bridge
 * safety / grant / audit modules. **Test-only** — do not import into
 * production code.
 *
 * Supported: hset (hash map + object arg), hmset, hget, hgetall,
 *            hincrby, hdel, del, expire, get, set, eval (token-bucket),
 *            zadd, zrangebyscore, zrem, exists, publish, duplicate.
 */

type Hash = Record<string, string>;
type ZSetEntry = { member: string; score: number };

export class InMemoryRedis {
  strings = new Map<string, string>();
  hashes = new Map<string, Hash>();
  zsets = new Map<string, ZSetEntry[]>();
  ttls = new Map<string, number>();
  subscribers = new Map<string, Array<(channel: string, message: string) => void>>();

  // Replace token bucket math when needed for tests
  public evalScriptOverride: ((script: string, args: string[]) => [number, number, number]) | null =
    null;

  // ── String ops ────────────────────────────────────────

  async get(key: string): Promise<string | null> {
    return this.strings.get(key) ?? null;
  }

  async set(key: string, value: string, ..._args: unknown[]): Promise<"OK"> {
    this.strings.set(key, value);
    return "OK";
  }

  async setex(key: string, _seconds: number, value: string): Promise<"OK"> {
    this.strings.set(key, value);
    return "OK";
  }

  async del(...keys: string[]): Promise<number> {
    let count = 0;
    for (const k of keys) {
      if (this.strings.delete(k) || this.hashes.delete(k) || this.zsets.delete(k)) {
        count++;
      }
      this.ttls.delete(k);
    }
    return count;
  }

  async exists(key: string): Promise<number> {
    return this.strings.has(key) || this.hashes.has(key) || this.zsets.has(key) ? 1 : 0;
  }

  async expire(key: string, seconds: number): Promise<number> {
    this.ttls.set(key, seconds);
    return 1;
  }

  // ── Hash ops ──────────────────────────────────────────

  async hset(key: string, ...args: unknown[]): Promise<number> {
    const h = this.hashes.get(key) ?? {};
    // Supports:
    //   hset(key, { f1: v1, f2: v2 })
    //   hset(key, field, value, field, value, ...)
    if (args.length === 1 && typeof args[0] === "object" && args[0] !== null) {
      for (const [f, v] of Object.entries(args[0] as Record<string, string>)) {
        h[f] = String(v);
      }
    } else {
      for (let i = 0; i < args.length; i += 2) {
        const f = String(args[i]);
        const v = String(args[i + 1]);
        h[f] = v;
      }
    }
    this.hashes.set(key, h);
    return 0;
  }

  async hmset(key: string, obj: Record<string, string>): Promise<"OK"> {
    const h = this.hashes.get(key) ?? {};
    for (const [f, v] of Object.entries(obj)) {
      h[f] = String(v);
    }
    this.hashes.set(key, h);
    return "OK";
  }

  async hget(key: string, field: string): Promise<string | null> {
    return this.hashes.get(key)?.[field] ?? null;
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    return { ...(this.hashes.get(key) ?? {}) };
  }

  async hincrby(key: string, field: string, inc: number): Promise<number> {
    const h = this.hashes.get(key) ?? {};
    const next = Number(h[field] ?? "0") + inc;
    h[field] = String(next);
    this.hashes.set(key, h);
    return next;
  }

  async hdel(key: string, ...fields: string[]): Promise<number> {
    const h = this.hashes.get(key);
    if (!h) return 0;
    let count = 0;
    for (const f of fields) {
      if (f in h) {
        delete h[f];
        count++;
      }
    }
    return count;
  }

  // ── Sorted-set ops ────────────────────────────────────

  async zadd(key: string, score: number, member: string): Promise<number> {
    const z = this.zsets.get(key) ?? [];
    const existing = z.find((e) => e.member === member);
    if (existing) {
      existing.score = score;
      return 0;
    }
    z.push({ member, score });
    z.sort((a, b) => a.score - b.score);
    this.zsets.set(key, z);
    return 1;
  }

  async zrem(key: string, ...members: string[]): Promise<number> {
    const z = this.zsets.get(key);
    if (!z) return 0;
    let removed = 0;
    for (const m of members) {
      const i = z.findIndex((e) => e.member === m);
      if (i >= 0) {
        z.splice(i, 1);
        removed++;
      }
    }
    return removed;
  }

  async zrangebyscore(
    key: string,
    min: number | string,
    max: number | string,
    ..._args: unknown[]
  ): Promise<string[]> {
    const z = this.zsets.get(key) ?? [];
    const lo =
      typeof min === "string" ? (min === "-inf" ? Number.NEGATIVE_INFINITY : Number(min)) : min;
    const hi =
      typeof max === "string" ? (max === "+inf" ? Number.POSITIVE_INFINITY : Number(max)) : max;
    return z.filter((e) => e.score >= lo && e.score <= hi).map((e) => e.member);
  }

  // ── Pub/Sub ───────────────────────────────────────────

  async publish(channel: string, message: string): Promise<number> {
    const subs = this.subscribers.get(channel) ?? [];
    for (const fn of subs) fn(channel, message);
    return subs.length;
  }

  // ── Scripting (token bucket) ──────────────────────────

  async eval(
    script: string,
    _numkeys: number,
    _key: string,
    ..._args: unknown[]
  ): Promise<unknown> {
    if (this.evalScriptOverride) {
      return this.evalScriptOverride(script, _args.map(String));
    }
    // Default: always allow the request (max tokens, 0 retry)
    return [1, 59, 0];
  }

  // ── Duplicate (for pub/sub) ───────────────────────────

  duplicate(): this {
    return this;
  }

  async disconnect(): Promise<void> {
    // no-op
  }

  async quit(): Promise<"OK"> {
    return "OK";
  }
}

/**
 * Factory for Redis-shaped stubs. Returning `unknown as Redis` lets
 * tests pass the stub into code expecting `ioredis`' Redis type.
 */
export function createRedisStub(): InMemoryRedis {
  return new InMemoryRedis();
}
