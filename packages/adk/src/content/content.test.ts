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
  contentToParts,
  contentToString,
  countMediaParts,
  extractText,
  isAudioPart,
  isImagePart,
  isMultiModalContent,
  isTextPart,
  isUIArtifactPart,
  isVideoPart,
} from "./helpers";

const textPart: ContentPart = { type: "text", text: "Hello world" };
const imagePart: ImagePart = {
  type: "image",
  source: { type: "base64", mediaType: "image/png", data: "iVBOR..." },
  alt: "test image",
};
const imageUrlPart: ImagePart = {
  type: "image",
  source: { type: "url", url: "https://example.com/img.png", detail: "high" },
};
const audioPart: AudioPart = {
  type: "audio",
  source: { type: "base64", mediaType: "audio/mp3", data: "AAAA..." },
  durationSec: 5.2,
  transcript: "Hello",
};
const videoPart: VideoPart = {
  type: "video",
  source: { type: "url", url: "https://example.com/vid.mp4" },
  durationSec: 30,
  posterUrl: "https://example.com/poster.jpg",
};
const artifactPart: UIArtifactPart = {
  type: "ui_artifact",
  artifactId: "art-1",
  version: 1,
  title: "My Chart",
  kind: "html",
  content: "<div>Chart</div>",
  css: "div { color: red; }",
};

describe("Content Type Guards", () => {
  it("isMultiModalContent: string is not multi-modal", () => {
    expect(isMultiModalContent("hello")).toBe(false);
  });

  it("isMultiModalContent: array is multi-modal", () => {
    expect(isMultiModalContent([textPart])).toBe(true);
  });

  it("isMultiModalContent: empty array is multi-modal", () => {
    expect(isMultiModalContent([])).toBe(true);
  });

  it("isTextPart", () => {
    expect(isTextPart(textPart)).toBe(true);
    expect(isTextPart(imagePart)).toBe(false);
  });

  it("isImagePart", () => {
    expect(isImagePart(imagePart)).toBe(true);
    expect(isImagePart(textPart)).toBe(false);
  });

  it("isAudioPart", () => {
    expect(isAudioPart(audioPart)).toBe(true);
    expect(isAudioPart(textPart)).toBe(false);
  });

  it("isVideoPart", () => {
    expect(isVideoPart(videoPart)).toBe(true);
    expect(isVideoPart(textPart)).toBe(false);
  });

  it("isUIArtifactPart", () => {
    expect(isUIArtifactPart(artifactPart)).toBe(true);
    expect(isUIArtifactPart(textPart)).toBe(false);
  });
});

describe("contentToString", () => {
  it("returns string as-is", () => {
    expect(contentToString("hello")).toBe("hello");
  });

  it("returns empty string for empty string", () => {
    expect(contentToString("")).toBe("");
  });

  it("extracts text from TextPart array", () => {
    expect(contentToString([textPart])).toBe("Hello world");
  });

  it("handles mixed content parts", () => {
    const result = contentToString([textPart, imagePart, audioPart, videoPart, artifactPart]);
    expect(result).toBe("Hello world[Image: test image][Audio: Hello][Video][Artifact: My Chart]");
  });

  it("handles image without alt text", () => {
    expect(contentToString([imageUrlPart])).toBe("[Image]");
  });

  it("handles audio without transcript", () => {
    const audio: AudioPart = {
      type: "audio",
      source: { type: "url", url: "https://example.com/audio.mp3" },
    };
    expect(contentToString([audio])).toBe("[Audio]");
  });

  it("handles empty array", () => {
    expect(contentToString([])).toBe("");
  });

  it("concatenates multiple text parts", () => {
    const parts: ContentPart[] = [
      { type: "text", text: "Hello " },
      { type: "text", text: "world" },
    ];
    expect(contentToString(parts)).toBe("Hello world");
  });
});

describe("extractText", () => {
  it("is an alias for contentToString", () => {
    expect(extractText("hello")).toBe(contentToString("hello"));
    expect(extractText([textPart])).toBe(contentToString([textPart]));
  });
});

describe("contentToParts", () => {
  it("wraps non-empty string as TextPart", () => {
    const parts = contentToParts("hello");
    expect(parts).toEqual([{ type: "text", text: "hello" }]);
  });

  it("returns empty array for empty string", () => {
    expect(contentToParts("")).toEqual([]);
  });

  it("returns array as-is", () => {
    const input = [textPart, imagePart];
    expect(contentToParts(input)).toBe(input); // Same reference
  });

  it("preserves empty array", () => {
    expect(contentToParts([])).toEqual([]);
  });
});

describe("countMediaParts", () => {
  it("counts string as single text", () => {
    expect(countMediaParts("hello")).toEqual({
      text: 1,
      image: 0,
      audio: 0,
      video: 0,
      uiArtifact: 0,
    });
  });

  it("counts empty string as zero text", () => {
    expect(countMediaParts("")).toEqual({
      text: 0,
      image: 0,
      audio: 0,
      video: 0,
      uiArtifact: 0,
    });
  });

  it("counts mixed parts", () => {
    const content: Content = [textPart, imagePart, audioPart, videoPart, artifactPart, textPart];
    expect(countMediaParts(content)).toEqual({
      text: 2,
      image: 1,
      audio: 1,
      video: 1,
      uiArtifact: 1,
    });
  });

  it("counts empty array as all zeros", () => {
    expect(countMediaParts([])).toEqual({
      text: 0,
      image: 0,
      audio: 0,
      video: 0,
      uiArtifact: 0,
    });
  });

  it("counts multiple images", () => {
    const content: Content = [imagePart, imageUrlPart, imagePart];
    expect(countMediaParts(content)).toEqual({
      text: 0,
      image: 3,
      audio: 0,
      video: 0,
      uiArtifact: 0,
    });
  });
});
