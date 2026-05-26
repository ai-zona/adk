import { describe, expect, it } from "vitest";
import type {
  AudioPart,
  Content,
  ContentPart,
  ImagePart,
  UIArtifactPart,
  VideoPart,
} from "../types/content";
import {
  toAnthropicContent,
  toGoogleParts,
  toOllamaContent,
  toOpenAIContent,
} from "./content-adapters";

const textOnly: Content = "Hello world";
const textParts: Content = [
  { type: "text", text: "Hello" },
  { type: "text", text: " world" },
];
const imagePart: ImagePart = {
  type: "image",
  source: { type: "base64", mediaType: "image/png", data: "iVBOR..." },
  alt: "test",
};
const imageUrlPart: ImagePart = {
  type: "image",
  source: { type: "url", url: "https://example.com/img.png", detail: "high" },
};
const audioPart: AudioPart = {
  type: "audio",
  source: { type: "base64", mediaType: "audio/mp3", data: "AAAA..." },
  transcript: "Hello",
};
const audioUrlPart: AudioPart = {
  type: "audio",
  source: { type: "url", url: "https://example.com/audio.mp3" },
};
const videoPart: VideoPart = {
  type: "video",
  source: { type: "url", url: "https://example.com/video.mp4" },
};
const videoBase64Part: VideoPart = {
  type: "video",
  source: { type: "base64", mediaType: "video/mp4", data: "AAAA..." },
};
const artifactPart: UIArtifactPart = {
  type: "ui_artifact",
  artifactId: "art-1",
  version: 1,
  title: "Chart",
  kind: "html",
  content: "<div>Chart</div>",
};

const mixed: Content = [{ type: "text", text: "Look at this:" }, imagePart];

describe("toAnthropicContent", () => {
  it("passes string through", () => {
    expect(toAnthropicContent("hello")).toBe("hello");
  });

  it("converts single text part to string", () => {
    expect(toAnthropicContent([{ type: "text", text: "hello" }])).toBe("hello");
  });

  it("converts base64 image", () => {
    const result = toAnthropicContent([imagePart]) as unknown[];
    expect(result).toHaveLength(1);
    expect((result[0] as { type: string }).type).toBe("image");
    expect((result[0] as { source: { media_type: string } }).source.media_type).toBe("image/png");
  });

  it("converts URL image", () => {
    const result = toAnthropicContent([imageUrlPart]) as unknown[];
    expect(result).toHaveLength(1);
    expect((result[0] as { source: { url: string } }).source.url).toBe(
      "https://example.com/img.png",
    );
  });

  it("converts audio with transcript to text fallback (collapses single text block to string)", () => {
    const result = toAnthropicContent([audioPart]);
    // Single text block is collapsed to a string by the adapter
    expect(typeof result).toBe("string");
    expect(result as string).toContain("Audio transcript");
  });

  it("converts video to text fallback (collapses single text block to string)", () => {
    const result = toAnthropicContent([videoPart]);
    expect(typeof result).toBe("string");
    expect(result as string).toContain("Video content omitted");
  });

  it("converts artifact to text (collapses single text block to string)", () => {
    const result = toAnthropicContent([artifactPart]);
    expect(typeof result).toBe("string");
    expect(result as string).toContain("Artifact: Chart");
  });

  it("handles mixed content", () => {
    const result = toAnthropicContent(mixed) as unknown[];
    expect(result).toHaveLength(2);
  });

  it("handles empty array", () => {
    expect(toAnthropicContent([])).toBe("");
  });
});

describe("toOpenAIContent", () => {
  it("passes string through", () => {
    expect(toOpenAIContent("hello")).toBe("hello");
  });

  it("converts single text part to string", () => {
    expect(toOpenAIContent([{ type: "text", text: "hello" }])).toBe("hello");
  });

  it("converts base64 image to data URL", () => {
    const result = toOpenAIContent([imagePart]) as unknown[];
    expect(result).toHaveLength(1);
    expect((result[0] as { type: string }).type).toBe("image_url");
    const url = (result[0] as { image_url: { url: string } }).image_url.url;
    expect(url).toContain("data:image/png;base64,");
  });

  it("converts URL image with detail", () => {
    const result = toOpenAIContent([imageUrlPart]) as unknown[];
    expect(result).toHaveLength(1);
    const detail = (result[0] as { image_url: { detail: string } }).image_url.detail;
    expect(detail).toBe("high");
  });

  it("converts base64 audio to input_audio", () => {
    const result = toOpenAIContent([audioPart]) as unknown[];
    expect(result).toHaveLength(1);
    expect((result[0] as { type: string }).type).toBe("input_audio");
  });

  it("converts URL audio to text fallback (collapses single text block to string)", () => {
    const result = toOpenAIContent([audioUrlPart]);
    // Single text block is collapsed to a string by the adapter
    expect(typeof result).toBe("string");
    expect(result as string).toContain("Audio content omitted");
  });

  it("handles mixed content", () => {
    const result = toOpenAIContent(mixed) as unknown[];
    expect(result).toHaveLength(2);
  });

  it("handles empty array", () => {
    expect(toOpenAIContent([])).toBe("");
  });
});

describe("toGoogleParts", () => {
  it("wraps string as text part", () => {
    expect(toGoogleParts("hello")).toEqual([{ text: "hello" }]);
  });

  it("converts text parts", () => {
    const result = toGoogleParts(textParts);
    expect(result).toEqual([{ text: "Hello" }, { text: " world" }]);
  });

  it("converts base64 image to inlineData", () => {
    const result = toGoogleParts([imagePart]);
    expect(result).toHaveLength(1);
    expect((result[0] as { inlineData: { mimeType: string } }).inlineData.mimeType).toBe(
      "image/png",
    );
  });

  it("converts URL image to fileData", () => {
    const result = toGoogleParts([imageUrlPart]);
    expect(result).toHaveLength(1);
    expect((result[0] as { fileData: { fileUri: string } }).fileData.fileUri).toBe(
      "https://example.com/img.png",
    );
  });

  it("converts base64 video to inlineData", () => {
    const result = toGoogleParts([videoBase64Part]);
    expect(result).toHaveLength(1);
    expect((result[0] as { inlineData: { mimeType: string } }).inlineData.mimeType).toBe(
      "video/mp4",
    );
  });

  it("converts URL video to fileData", () => {
    const result = toGoogleParts([videoPart]);
    expect(result).toHaveLength(1);
    expect((result[0] as { fileData: { fileUri: string } }).fileData.fileUri).toBe(
      "https://example.com/video.mp4",
    );
  });

  it("handles empty array", () => {
    expect(toGoogleParts([])).toEqual([{ text: "" }]);
  });
});

describe("toOllamaContent", () => {
  it("passes string through", () => {
    expect(toOllamaContent("hello")).toEqual({ content: "hello" });
  });

  it("extracts text and images from mixed content", () => {
    const result = toOllamaContent(mixed);
    expect(result.content).toContain("Look at this:");
    expect(result.images).toHaveLength(1);
    expect(result.images?.[0]).toBe("iVBOR...");
  });

  it("returns no images when none present", () => {
    const result = toOllamaContent(textParts);
    expect(result.content).toBe("Hello world");
    expect(result.images).toBeUndefined();
  });

  it("ignores URL images (only base64)", () => {
    const result = toOllamaContent([imageUrlPart]);
    expect(result.images).toBeUndefined();
  });
});
