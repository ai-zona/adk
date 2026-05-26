// ──────────────────────────────────────────────────────
// ADK Content Helpers — Type guards and utilities
// ──────────────────────────────────────────────────────

import type {
  AudioPart,
  Content,
  ContentPart,
  ImagePart,
  TextPart,
  UIArtifactPart,
  VideoPart,
} from "../types/content";

// ── Type Guards ──

/** Check if content is multi-modal (ContentPart[]) */
export function isMultiModalContent(content: Content): content is ContentPart[] {
  return Array.isArray(content);
}

/** Check if a content part is a TextPart */
export function isTextPart(part: ContentPart): part is TextPart {
  return part.type === "text";
}

/** Check if a content part is an ImagePart */
export function isImagePart(part: ContentPart): part is ImagePart {
  return part.type === "image";
}

/** Check if a content part is an AudioPart */
export function isAudioPart(part: ContentPart): part is AudioPart {
  return part.type === "audio";
}

/** Check if a content part is a VideoPart */
export function isVideoPart(part: ContentPart): part is VideoPart {
  return part.type === "video";
}

/** Check if a content part is a UIArtifactPart */
export function isUIArtifactPart(part: ContentPart): part is UIArtifactPart {
  return part.type === "ui_artifact";
}

// ── Conversion Utilities ──

/**
 * Extract text from Content. For strings, returns as-is.
 * For ContentPart[], concatenates all TextPart.text values.
 * Non-text parts are represented as markers.
 */
export function contentToString(content: Content): string {
  if (typeof content === "string") return content;

  const parts: string[] = [];
  for (const part of content) {
    switch (part.type) {
      case "text":
        parts.push(part.text);
        break;
      case "image":
        parts.push(`[Image${part.alt ? `: ${part.alt}` : ""}]`);
        break;
      case "audio":
        parts.push(`[Audio${part.transcript ? `: ${part.transcript}` : ""}]`);
        break;
      case "video":
        parts.push("[Video]");
        break;
      case "ui_artifact":
        parts.push(`[Artifact: ${part.title}]`);
        break;
    }
  }
  return parts.join("");
}

/** Alias for contentToString — backward compat with plan naming */
export const extractText = contentToString;

/**
 * Normalize content to ContentPart[].
 * Strings become a single TextPart.
 */
export function contentToParts(content: Content): ContentPart[] {
  if (typeof content === "string") {
    return content ? [{ type: "text", text: content }] : [];
  }
  return content;
}

/**
 * Count media parts by type.
 */
export function countMediaParts(content: Content): {
  text: number;
  image: number;
  audio: number;
  video: number;
  uiArtifact: number;
} {
  const counts = { text: 0, image: 0, audio: 0, video: 0, uiArtifact: 0 };

  if (typeof content === "string") {
    counts.text = content.length > 0 ? 1 : 0;
    return counts;
  }

  for (const part of content) {
    switch (part.type) {
      case "text":
        counts.text++;
        break;
      case "image":
        counts.image++;
        break;
      case "audio":
        counts.audio++;
        break;
      case "video":
        counts.video++;
        break;
      case "ui_artifact":
        counts.uiArtifact++;
        break;
    }
  }

  return counts;
}
