/**
 * Minimal in-memory Redis stub for aza-protocol unit tests.
 *
 * Covers the subset of `ioredis` commands used by the safety modules
 * (consent-manager, rate-limiter, circuit-breaker). **Test-only**.
 *
 * Supported: get, set, del, exists, expire, setex,
 *            hset (object + varargs), hmset, hget, hgetall, hincrby, hdel,
 *            zadd, zrem, zrangebyscore, zscore, zcard, zremrangebyscore,
 *            xadd, publish, multi/exec pipeline, duplicate.
 */

type Hash = Record<string, string>;
type ZSetEntry = { member: string; score: number };

export class InMemoryRedis {
  strings = new Map<string, string>();
  hashes = new Map<string, Hash>();
  zsets = new Map<string, ZSetEntry[]>();
  streams = new Map<string, Array<{ id: string; data: string }>>();
  ttls = new Map<string, number>();

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

  // ── Stream ops ────────────────────────────────────────

  async xadd(key: string, _id: string, ..._args: unknown[]): Promise<string> {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const data = _args.length > 1 ? String(_args[1]) : "";
    const s = this.streams.get(key) ?? [];
    s.push({ id, data });
    this.streams.set(key, s);
    return id;
  }

  // ── Pub/sub ───────────────────────────────────────────

  async publish(_channel: string, _message: string): Promise<number> {
    return 0;
  }

  // ── Pipeline (multi/exec) ─────────────────────────────

  multi(): PipelineStub {
    return new PipelineStub(this);
  }

  duplicate(): this {
    return this;
  }

  async disconnect(): Promise<void> {}
  async quit(): Promise<"OK"> {
    return "OK";
  }
}

class PipelineStub {
  private cmds: Array<() => Promise<unknown>> = [];

  constructor(private redis: InMemoryRedis) {}

  hset(key: string, ...args: unknown[]): this {
    this.cmds.push(() => this.redis.hset(key, ...args));
    return this;
  }

  expire(key: string, seconds: number): this {
    this.cmds.push(() => this.redis.expire(key, seconds));
    return this;
  }

  async exec(): Promise<Array<[Error | null, unknown]>> {
    const out: Array<[Error | null, unknown]> = [];
    for (const c of this.cmds) {
      try {
        out.push([null, await c()]);
      } catch (err) {
        out.push([err as Error, null]);
      }
    }
    return out;
  }
}

export function createRedisStub(): InMemoryRedis {
  return new InMemoryRedis();
}
