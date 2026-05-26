/**
 * IPC protocol — host (platform-agents) ↔ sandbox runner.
 *
 * Newline-delimited JSON over a Unix domain socket. Every message has a
 * stable `requestId`; correlated calls (e.g. hostFnCall ↔ hostFnResult)
 * share an additional `callId`.
 *
 * This protocol is consumed by:
 *  - packages/sandbox-runner/src/index.ts (server)
 *  - packages/platform-agents/src/runtime/sandbox/client.ts (client)
 *
 * Stream B owns both sides.
 */

import { z } from "zod";
import { CAPABILITY_IDS } from "../capabilities/identifiers.js";

const HOST_FN_VALUES = Object.values(CAPABILITY_IDS.HOST_FN) as [string, ...string[]];

export interface IpcExecuteMessage {
  kind: "execute";
  requestId: string;
  workspaceId: string;
  skillRef: string;
  input: unknown;
  caps: { memoryLimitMb: number; cpuLimitMs: number };
}

export interface IpcResultMessage {
  kind: "result";
  requestId: string;
  ok: boolean;
  /** present when ok=true */
  output?: unknown;
  /** present when ok=true */
  durationMs?: number;
  /** present when ok=false */
  errorMessage?: string;
  /** present when ok=false */
  errorKind?: IpcErrorKind;
}

export type IpcErrorKind =
  | "MEMORY_EXCEEDED"
  | "CPU_EXCEEDED"
  | "WALL_CLOCK_EXCEEDED"
  | "SKILL_THREW"
  | "BAD_INPUT"
  | "ENTITLEMENT_DENIED"
  | "HOST_FN_DENIED"
  | "ISOLATE_CRASHED"
  | "RUNNER_INTERNAL";

export interface IpcHostFnCallMessage {
  kind: "hostFnCall";
  requestId: string;
  callId: string;
  hostFn: string;
  args: unknown;
}

export interface IpcHostFnResultMessage {
  kind: "hostFnResult";
  requestId: string;
  callId: string;
  ok: boolean;
  result?: unknown;
  errorMessage?: string;
}

export interface IpcPingMessage {
  kind: "ping";
  requestId: string;
}
export interface IpcPongMessage {
  kind: "pong";
  requestId: string;
  runnerVersion: string;
  gvisorActive: boolean;
}

export type IpcMessage =
  | IpcExecuteMessage
  | IpcResultMessage
  | IpcHostFnCallMessage
  | IpcHostFnResultMessage
  | IpcPingMessage
  | IpcPongMessage;

export const ipcMessageSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("execute"),
    requestId: z.string().min(1),
    workspaceId: z.string().min(1),
    skillRef: z.string().min(1),
    input: z.unknown(),
    caps: z.object({
      memoryLimitMb: z.number().int().min(64).max(2048),
      cpuLimitMs: z.number().int().min(1000).max(60_000),
    }),
  }),
  z.object({
    kind: z.literal("result"),
    requestId: z.string().min(1),
    ok: z.boolean(),
    output: z.unknown().optional(),
    durationMs: z.number().int().nonnegative().optional(),
    errorMessage: z.string().optional(),
    errorKind: z
      .enum([
        "MEMORY_EXCEEDED",
        "CPU_EXCEEDED",
        "WALL_CLOCK_EXCEEDED",
        "SKILL_THREW",
        "BAD_INPUT",
        "ENTITLEMENT_DENIED",
        "HOST_FN_DENIED",
        "ISOLATE_CRASHED",
        "RUNNER_INTERNAL",
      ])
      .optional(),
  }),
  z.object({
    kind: z.literal("hostFnCall"),
    requestId: z.string().min(1),
    callId: z.string().min(1),
    hostFn: z.enum(HOST_FN_VALUES),
    args: z.unknown(),
  }),
  z.object({
    kind: z.literal("hostFnResult"),
    requestId: z.string().min(1),
    callId: z.string().min(1),
    ok: z.boolean(),
    result: z.unknown().optional(),
    errorMessage: z.string().optional(),
  }),
  z.object({ kind: z.literal("ping"), requestId: z.string().min(1) }),
  z.object({
    kind: z.literal("pong"),
    requestId: z.string().min(1),
    runnerVersion: z.string().min(1),
    gvisorActive: z.boolean(),
  }),
]);
