// ──────────────────────────────────────────────────────
// ADK Content Types — Multi-modal content support
// ──────────────────────────────────────────────────────

/** Supported media types for multi-modal content */
export type MediaType =
  | "image/png"
  | "image/jpeg"
  | "image/gif"
  | "image/webp"
  | "image/svg+xml"
  | "audio/mp3"
  | "audio/wav"
  | "audio/ogg"
  | "audio/webm"
  | "audio/mpeg"
  | "video/mp4"
  | "video/webm"
  | "video/ogg"
  | "text/html"
  | "text/css"
  | "text/javascript"
  | "application/json"
  | "application/pdf";

/** Text content part */
export interface TextPart {
  type: "text";
  text: string;
}

/** Image content part — base64 or URL */
export interface ImagePart {
  type: "image";
  source:
    | { type: "base64"; mediaType: MediaType; data: string }
    | { type: "url"; url: string; detail?: "auto" | "low" | "high" };
  alt?: string;
}

/** Audio content part — base64 or URL */
export interface AudioPart {
  type: "audio";
  source: { type: "base64"; mediaType: MediaType; data: string } | { type: "url"; url: string };
  durationSec?: number;
  transcript?: string;
}

/** Video content part — base64 or URL */
export interface VideoPart {
  type: "video";
  source: { type: "base64"; mediaType: MediaType; data: string } | { type: "url"; url: string };
  durationSec?: number;
  posterUrl?: string;
}

/** UI Artifact content part — rendered in sandboxed iframe */
export interface UIArtifactPart {
  type: "ui_artifact";
  artifactId: string;
  version: number;
  title: string;
  kind: "html" | "react" | "svg" | "markdown" | "code";
  content: string;
  language?: string;
  css?: string;
}

/** Union of all content part types */
export type ContentPart = TextPart | ImagePart | AudioPart | VideoPart | UIArtifactPart;

/** Content can be a simple string or an array of content parts */
export type Content = string | ContentPart[];
