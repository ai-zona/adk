// ──────────────────────────────────────────────────────
// ADK Provider Content Adapters
// ──────────────────────────────────────────────────────
// Centralized conversion from ADK Content to provider-specific formats.
// Each provider API has its own multi-modal format:
// - Anthropic: content blocks with type/text/source
// - OpenAI: content array with text/image_url
// - Google: parts with text/inlineData
// - Ollama: text content + separate images field (for vision models)
// ──────────────────────────────────────────────────────

import { extractText, isMultiModalContent } from "../content/helpers";
import type { Content, ContentPart } from "../types/content";

// ── Anthropic ──

/**
 * Convert Content to Anthropic API format.
 * String → passthrough. ContentPart[] → Anthropic content blocks.
 */
export function toAnthropicContent(content: Content): unknown {
  if (!isMultiModalContent(content)) return content;

  const blocks: unknown[] = [];
  for (const part of content) {
    switch (part.type) {
      case "text":
        blocks.push({ type: "text", text: part.text });
        break;
      case "image":
        if (part.source.type === "base64") {
          blocks.push({
            type: "image",
            source: {
              type: "base64",
              media_type: part.source.mediaType,
              data: part.source.data,
            },
          });
        } else {
          blocks.push({
            type: "image",
            source: {
              type: "url",
              url: part.source.url,
            },
          });
        }
        break;
      case "audio":
        // Anthropic doesn't natively support audio in messages — degrade gracefully
        if (part.transcript) {
          blocks.push({ type: "text", text: `[Audio transcript: ${part.transcript}]` });
        } else {
          blocks.push({ type: "text", text: "[Audio content omitted]" });
        }
        break;
      case "video":
        blocks.push({ type: "text", text: "[Video content omitted]" });
        break;
      case "ui_artifact":
        blocks.push({ type: "text", text: `[Artifact: ${part.title}]\n${part.content}` });
        break;
    }
  }

  // Return string if only text blocks
  if (blocks.length === 1 && (blocks[0] as { type: string }).type === "text") {
    return (blocks[0] as { text: string }).text;
  }

  return blocks.length > 0 ? blocks : "";
}

// ── OpenAI ──

/**
 * Convert Content to OpenAI API format.
 * String → passthrough. ContentPart[] → OpenAI content array.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: content type mapping requires branching
export function toOpenAIContent(content: Content): unknown {
  if (!isMultiModalContent(content)) return content;

  const parts: unknown[] = [];
  for (const part of content) {
    switch (part.type) {
      case "text":
        parts.push({ type: "text", text: part.text });
        break;
      case "image":
        if (part.source.type === "base64") {
          parts.push({
            type: "image_url",
            image_url: {
              url: `data:${part.source.mediaType};base64,${part.source.data}`,
              detail: "auto",
            },
          });
        } else {
          parts.push({
            type: "image_url",
            image_url: {
              url: part.source.url,
              detail: part.source.detail ?? "auto",
            },
          });
        }
        break;
      case "audio":
        if (part.source.type === "base64") {
          parts.push({
            type: "input_audio",
            input_audio: {
              data: part.source.data,
              format: part.source.mediaType === "audio/wav" ? "wav" : "mp3",
            },
          });
        } else if (part.transcript) {
          parts.push({ type: "text", text: `[Audio transcript: ${part.transcript}]` });
        } else {
          parts.push({ type: "text", text: "[Audio content omitted]" });
        }
        break;
      case "video":
        parts.push({ type: "text", text: "[Video content omitted]" });
        break;
      case "ui_artifact":
        parts.push({ type: "text", text: `[Artifact: ${part.title}]\n${part.content}` });
        break;
    }
  }

  // Return string if only text parts
  if (parts.length === 1 && (parts[0] as { type: string }).type === "text") {
    return (parts[0] as { text: string }).text;
  }

  return parts.length > 0 ? parts : "";
}

// ── Google ──

/**
 * Convert Content to Google Gemini API format (parts array).
 * String → [{ text }]. ContentPart[] → mixed parts.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: content type mapping requires branching
export function toGoogleParts(content: Content): unknown[] {
  if (!isMultiModalContent(content)) {
    return [{ text: content }];
  }

  const parts: unknown[] = [];
  for (const part of content) {
    switch (part.type) {
      case "text":
        parts.push({ text: part.text });
        break;
      case "image":
        if (part.source.type === "base64") {
          parts.push({
            inlineData: {
              mimeType: part.source.mediaType,
              data: part.source.data,
            },
          });
        } else {
          parts.push({
            fileData: {
              mimeType: "image/png",
              fileUri: part.source.url,
            },
          });
        }
        break;
      case "audio":
        if (part.source.type === "base64") {
          parts.push({
            inlineData: {
              mimeType: part.source.mediaType,
              data: part.source.data,
            },
          });
        } else if (part.transcript) {
          parts.push({ text: `[Audio transcript: ${part.transcript}]` });
        } else {
          parts.push({ text: "[Audio content omitted]" });
        }
        break;
      case "video":
        if (part.source.type === "base64") {
          parts.push({
            inlineData: {
              mimeType: part.source.mediaType,
              data: part.source.data,
            },
          });
        } else {
          parts.push({
            fileData: {
              mimeType: "video/mp4",
              fileUri: part.source.url,
            },
          });
        }
        break;
      case "ui_artifact":
        parts.push({ text: `[Artifact: ${part.title}]\n${part.content}` });
        break;
    }
  }

  return parts.length > 0 ? parts : [{ text: "" }];
}

// ── Ollama ──

/**
 * Extract content for Ollama.
 * Returns { content, images } where images is an optional base64 array for vision models.
 */
export function toOllamaContent(content: Content): { content: string; images?: string[] } {
  if (!isMultiModalContent(content)) return { content };

  const text = extractText(content);
  const images: string[] = [];

  for (const part of content) {
    if (part.type === "image" && part.source.type === "base64") {
      images.push(part.source.data);
    }
  }

  return { content: text, images: images.length > 0 ? images : undefined };
}
