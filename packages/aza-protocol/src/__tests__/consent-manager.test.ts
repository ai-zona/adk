import type Redis from "ioredis";
import { beforeEach, describe, expect, it } from "vitest";
import { ConsentManager, type ConsentRequest, ConsentTier } from "../safety/consent-manager";
import { type InMemoryRedis, createRedisStub } from "./helpers/in-memory-redis";

// ──────────────────────────────────────────────────────
// Consent Manager — scope intersection + expiry (Rank 21)
// ──────────────────────────────────────────────────────

const baseRequest: ConsentRequest = {
  taskId: "task-001",
  requesterDid: "did:aza:testnet:requester",
  targetDid: "did:aza:testnet:target",
  action: "read",
  scope: "data",
  tier: ConsentTier.NOTIFY,
};

describe("ConsentManager", () => {
  let redis: InMemoryRedis;
  let manager: ConsentManager;

  beforeEach(() => {
    redis = createRedisStub();
    manager = new ConsentManager(redis as unknown as Redis);
  });

  // ── Test 1: existing cached consent short-circuits new requests ──

  it("intersects with an existing cached consent decision and reuses it", async () => {
    // Seed the cache with a previously granted consent for (requester, target, read)
    const first = await manager.requestConsent({ ...baseRequest });
    expect(first.approved).toBe(true);
    expect(first.tier).toBe(ConsentTier.NOTIFY);
    const firstDecidedAt = first.decidedAt;

    // Second call for the SAME (requester, target, action) triple should
    // return the cached decision rather than issuing a new one.
    await new Promise((r) => setTimeout(r, 2)); // ensure decidedAt would differ if re-decided
    const second = await manager.requestConsent({
      ...baseRequest,
      taskId: "task-002", // different task id, same triple
    });

    // The decision is the SAME cached object — decidedAt must match exactly.
    expect(second.decidedAt).toBe(firstDecidedAt);
    expect(second.approved).toBe(true);

    // A DIFFERENT action on the same pair must NOT intersect with the cache.
    const thirdAction = await manager.requestConsent({
      ...baseRequest,
      taskId: "task-003",
      action: "query", // still NOTIFY tier, but different action namespace
    });
    expect(thirdAction.decidedAt).not.toBe(firstDecidedAt);

    // checkConsent confirms the cache is scoped per-action
    const hitRead = await manager.checkConsent(
      baseRequest.requesterDid,
      baseRequest.targetDid,
      "read",
    );
    const hitQuery = await manager.checkConsent(
      baseRequest.requesterDid,
      baseRequest.targetDid,
      "query",
    );
    const missWrite = await manager.checkConsent(
      baseRequest.requesterDid,
      baseRequest.targetDid,
      "write",
    );
    expect(hitRead).not.toBeNull();
    expect(hitQuery).not.toBeNull();
    expect(missWrite).toBeNull();
  });

  // ── Test 2: expired consent refresh behavior ────────

  it("evicts an expired cached consent and allows a fresh decision on next request", async () => {
    // Manually inject an expired cache entry
    const expiredKey = `aza:consent:${baseRequest.requesterDid}:${baseRequest.targetDid}:${baseRequest.action}`;
    const expiredDecision = {
      approved: true,
      tier: ConsentTier.NOTIFY,
      approvedBy: "system",
      // Already past its expiration
      expiresAt: Date.now() - 1000,
      decidedAt: Date.now() - 60_000,
    };
    redis.strings.set(expiredKey, JSON.stringify(expiredDecision));

    // checkConsent must return null (expired) AND evict the key
    const stale = await manager.checkConsent(
      baseRequest.requesterDid,
      baseRequest.targetDid,
      baseRequest.action,
    );
    expect(stale).toBeNull();
    expect(await redis.get(expiredKey)).toBeNull();

    // A fresh requestConsent on the same triple must now issue a new decision
    // (rather than returning the expired one).
    const refreshed = await manager.requestConsent({ ...baseRequest });
    expect(refreshed.approved).toBe(true);
    // Must be a brand-new decision timestamp, not the stale one
    expect(refreshed.decidedAt).toBeGreaterThan(expiredDecision.decidedAt);
  });
});
