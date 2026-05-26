// ──────────────────────────────────────────────────────
// Publishing Skills — Shared Test Helpers
// mkHost + mkCtx — used by all 6 publishing skill tests
// ──────────────────────────────────────────────────────

import { vi } from "vitest";
import type { HostFns, SkillExecutionContext } from "../types";

export function mkHost(over: Partial<HostFns> = {}): HostFns {
  return {
    llm: { chat: vi.fn() },
    kb: {
      read: vi.fn(),
      write: vi.fn().mockResolvedValue(undefined),
      listKeys: vi.fn().mockResolvedValue([]),
    },
    dataApi: { call: vi.fn() },
    log: vi.fn(),
    ...over,
  } as HostFns;
}

export function mkCtx(agentSlug: string, host?: HostFns): SkillExecutionContext {
  return { workspaceId: "ws", agentSlug, host: host ?? mkHost() };
}
