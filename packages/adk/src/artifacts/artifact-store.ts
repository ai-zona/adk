// ──────────────────────────────────────────────────────
// ADK Artifact Store — Persistence for A2UI artifacts
// ──────────────────────────────────────────────────────

import type { UIArtifactPart } from "../types/content";

/** Stored artifact with metadata */
export interface Artifact {
  id: string;
  title: string;
  kind: "html" | "react" | "svg" | "markdown" | "code";
  content: string;
  css?: string;
  language?: string;
  version: number;
  createdAt: number;
  updatedAt: number;
  agentName: string;
  runId: string;
}

/**
 * In-memory artifact store. Persists artifacts created by agents
 * during runs. Supports versioning (upsert bumps version).
 */
export class ArtifactStore {
  private artifacts = new Map<string, Artifact>();

  /** Create or update an artifact from a UIArtifactPart */
  upsert(part: UIArtifactPart, agentName: string, runId: string): Artifact {
    const existing = this.artifacts.get(part.artifactId);
    const now = Date.now();

    const artifact: Artifact = {
      id: part.artifactId,
      title: part.title,
      kind: part.kind,
      content: part.content,
      css: part.css,
      language: part.language,
      version: existing ? existing.version + 1 : part.version,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      agentName,
      runId,
    };

    this.artifacts.set(part.artifactId, artifact);
    return artifact;
  }

  /** Get a specific artifact by ID */
  get(artifactId: string): Artifact | undefined {
    return this.artifacts.get(artifactId);
  }

  /** Get all artifacts for a specific run */
  getByRun(runId: string): Artifact[] {
    return Array.from(this.artifacts.values()).filter((a) => a.runId === runId);
  }

  /** Get all stored artifacts */
  getAll(): Artifact[] {
    return Array.from(this.artifacts.values());
  }

  /** Clear all artifacts */
  clear(): void {
    this.artifacts.clear();
  }

  /** Get the number of stored artifacts */
  get size(): number {
    return this.artifacts.size;
  }
}
