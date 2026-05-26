// ──────────────────────────────────────────────────────
// clipVideoTool — ADK type-only shim
// ──────────────────────────────────────────────────────
//
// The canonical implementation lives in
// `packages/platform-agents/src/tools/media-tools.ts`. The platform-agents
// package depends on `@aizona/adk` (workspace:*) — there is no reverse
// dependency, so this ADK file cannot import the runtime tool without
// creating a circular dependency.
//
// This file exists purely to document the V1 `clipVideoTool` input/output
// type contract at the ADK layer so callers writing in plain ADK can type
// against it. The unit tests `clip-video-tool.test.ts` mock the underlying
// `runFfmpeg`/`ffprobe` plumbing and exercise the same execute() shape that
// the canonical implementation exposes.

/** A single clip range — millisecond offsets into the source video. */
export interface ClipVideoInputClip {
  startMs: number;
  endMs: number;
  label?: string;
}

/** Input contract for the `clip_video` ADK tool. */
export interface ClipVideoInput {
  sourcePath: string;
  clips: ClipVideoInputClip[];
  outputDir: string;
  options?: {
    /** Per-clip subprocess timeout in ms. Default 60_000. Max 300_000. */
    timeoutMs?: number;
    /** Per-clip output size cap in bytes. Default 500_000_000. */
    maxOutputBytes?: number;
    /** Stream-copy mode. V1 supports only true; false → CODEC_UNSUPPORTED_REENCODE. */
    copyMode?: boolean;
  };
}

/** Structured error entry for a single failing clip (or pre-flight failure). */
export interface ClipVideoErrorEntry {
  /** One of the documented FfmpegErrorCode values, or TOOL_CAPABILITY_DENIED. */
  code: string;
  /** 0-based index of the clip that failed; -1 for pre-flight failures. */
  clipIndex: number;
  /** Sanitized human-readable error message. */
  message: string;
  /** Whether the caller may retry this clip. */
  retryable: boolean;
  context?: {
    startMs?: number;
    endMs?: number;
    label?: string;
    ffmpegExitCode?: number | null;
    ffmpegStderrSnippet?: string;
  };
}

/** Output entry for a single successfully extracted clip. */
export interface ClipVideoOutputClip {
  inputRange: { startMs: number; endMs: number };
  outputPath: string;
  durationMs: number;
  sizeBytes: number;
  codec: string;
  label?: string;
}

/** Output contract for the `clip_video` ADK tool. */
export interface ClipVideoOutput {
  success: boolean;
  clips: ClipVideoOutputClip[];
  scorecard: string;
  warnings: string[];
  errors: ClipVideoErrorEntry[];
  runId: string;
  /** Top-level error message when no clips ran (e.g. capability denied). */
  error?: string;
}
