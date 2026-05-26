import { describe, expect, it } from "vitest";
import { wsEventSchema } from "../zod";
const cases: Array<[string, Record<string, unknown>]> = [
  [
    "architect.turn",
    {
      type: "architect.turn",
      workspaceId: "ws_abc12345abcdef123456",
      turnIdx: 0,
      role: "assistant",
      content: "hi",
      at: new Date().toISOString(),
    },
  ],
  [
    "architect.streaming",
    {
      type: "architect.streaming",
      workspaceId: "ws_abc12345abcdef123456",
      token: "x",
      at: new Date().toISOString(),
    },
  ],
  [
    "manifest.changed",
    {
      type: "manifest.changed",
      workspaceId: "ws_abc12345abcdef123456",
      snapshotId: "snap_1",
      changeSummary: "added agent",
      at: new Date().toISOString(),
    },
  ],
  [
    "snapshot.created",
    {
      type: "snapshot.created",
      workspaceId: "ws_abc12345abcdef123456",
      snapshotId: "snap_2",
      snapshotIdx: 1,
      triggerType: "INCREMENTAL",
      at: new Date().toISOString(),
    },
  ],
  [
    "entitlement.unlock.triggered",
    {
      type: "entitlement.unlock.triggered",
      workspaceId: "ws_abc12345abcdef123456",
      refType: "SKILL",
      refId: "publisher-database-search",
      suggestedAmount: 25,
      at: new Date().toISOString(),
    },
  ],
  [
    "test.execution",
    {
      type: "test.execution",
      scope: "AGENT",
      targetId: "companion-author",
      result: "PASS",
      at: new Date().toISOString(),
    },
  ],
  [
    "voice.provider.health",
    { type: "voice.provider.health", kind: "WHISPER", healthy: true, at: new Date().toISOString() },
  ],
];
describe("Wave 2 WS events", () => {
  for (const [name, payload] of cases) {
    it(`accepts ${name}`, () => {
      const r = wsEventSchema.safeParse(payload);
      expect(r.success).toBe(true);
    });
  }
});
