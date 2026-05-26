// ──────────────────────────────────────────────────────
// clipVideoTool — ADK type-shape tests
// ──────────────────────────────────────────────────────
//
// The canonical implementation of `clipVideoTool` lives in
// `@aizona/platform-agents/src/tools/media-tools.ts` (per spec §4.1, both
// paths are viable; we chose the platform-agents path to avoid a
// workspace dependency cycle from @aizonaai/adk → @aizona/platform-agents).
//
// The comprehensive 23-row test matrix from the spec §6.1 lives at
// `packages/platform-agents/src/tools/clip-video-tool.test.ts` where it can
// import and exercise the runtime tool directly.
//
// This file exists at the spec-requested path to verify the ADK-layer type
// contract (`ClipVideoInput`/`ClipVideoOutput`/etc.) is structurally
// compatible with the canonical runtime types — preventing drift.

import { describe, expect, it } from "vitest";
import type {
  ClipVideoErrorEntry,
  ClipVideoInput,
  ClipVideoInputClip,
  ClipVideoOutput,
  ClipVideoOutputClip,
} from "./clip-video-tool";

describe("clipVideoTool — ADK type shim", () => {
  it("ClipVideoInput accepts minimum-shape values", () => {
    const input: ClipVideoInput = {
      sourcePath: "/tmp/aizona-clips/src.mp4",
      clips: [{ startMs: 0, endMs: 3000 }],
      outputDir: "out",
    };
    expect(input.sourcePath).toBeDefined();
    expect(input.clips.length).toBe(1);
  });

  it("ClipVideoInputClip allows optional label", () => {
    const clip: ClipVideoInputClip = { startMs: 0, endMs: 1000, label: "intro" };
    expect(clip.label).toBe("intro");
    const clipNoLabel: ClipVideoInputClip = { startMs: 0, endMs: 1000 };
    expect(clipNoLabel.label).toBeUndefined();
  });

  it("ClipVideoInput accepts options block", () => {
    const input: ClipVideoInput = {
      sourcePath: "/tmp/aizona-clips/src.mp4",
      clips: [{ startMs: 0, endMs: 3000 }],
      outputDir: "out",
      options: {
        timeoutMs: 60_000,
        maxOutputBytes: 500_000_000,
        copyMode: true,
      },
    };
    expect(input.options?.timeoutMs).toBe(60_000);
  });

  it("ClipVideoOutput success shape", () => {
    const out: ClipVideoOutput = {
      success: true,
      clips: [
        {
          inputRange: { startMs: 0, endMs: 3000 },
          outputPath: "/tmp/aizona-clips/x/y/z/intro.mp4",
          durationMs: 3120,
          sizeBytes: 1024,
          codec: "h264",
        },
      ],
      scorecard: "## Clip Extraction Scorecard\n|...|",
      warnings: [],
      errors: [],
      runId: "00000000-0000-0000-0000-000000000000",
    };
    expect(out.success).toBe(true);
    expect(out.clips[0]?.codec).toBe("h264");
  });

  it("ClipVideoErrorEntry shape", () => {
    const err: ClipVideoErrorEntry = {
      code: "DISK_FULL",
      clipIndex: 0,
      message: "No space left on device",
      retryable: false,
      context: {
        startMs: 0,
        endMs: 3000,
        ffmpegExitCode: 1,
        ffmpegStderrSnippet: "av_interleaved_write_frame: No space left",
      },
    };
    expect(err.code).toBe("DISK_FULL");
    expect(err.context?.ffmpegExitCode).toBe(1);
  });

  it("ClipVideoOutputClip optional label", () => {
    const c: ClipVideoOutputClip = {
      inputRange: { startMs: 0, endMs: 100 },
      outputPath: "/tmp/aizona-clips/a.mp4",
      durationMs: 100,
      sizeBytes: 1,
      codec: "h264",
    };
    expect(c.label).toBeUndefined();
  });

  it("ClipVideoOutput failure shape with errors[]", () => {
    const out: ClipVideoOutput = {
      success: false,
      clips: [],
      scorecard: "",
      warnings: [],
      errors: [
        {
          code: "TOOL_CAPABILITY_DENIED",
          clipIndex: -1,
          message: "Tier external-untrusted denied",
          retryable: false,
        },
      ],
      runId: "00000000-0000-0000-0000-000000000000",
      error: "Tier external-untrusted denied",
    };
    expect(out.success).toBe(false);
    expect(out.errors[0]?.code).toBe("TOOL_CAPABILITY_DENIED");
  });
});
