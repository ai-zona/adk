import { randomUUID } from "node:crypto";
import { db } from "@aizona/db";
import { sha256 } from "@noble/hashes/sha2.js";
import { AZAError, AZAErrorCode } from "../types/errors";

// ──────────────────────────────────────────────────────
// Artifact Manager
// ──────────────────────────────────────────────────────
// CRUD operations for AZATaskArtifact records with
// SHA-256 checksum computation and integrity verification.
//
// Artifacts store the outputs, logs, reports, and media
// produced during task execution.
// ──────────────────────────────────────────────────────

/** Input for creating a new artifact. */
export interface ArtifactInput {
  artifactType: "result" | "log" | "report" | "media" | "data";
  mimeType: string;
  data: unknown;
}

/** The Prisma AZATaskArtifact record type. */
export type ArtifactRecord = Awaited<ReturnType<typeof db.aZATaskArtifact.findUniqueOrThrow>>;

export class ArtifactManager {
  // ────────────────────────────────────────────────────
  // Create
  // ────────────────────────────────────────────────────

  /**
   * Create a new artifact for a task.
   * Computes a SHA-256 checksum over the serialized data
   * and estimates the byte size.
   */
  async createArtifact(taskId: string, input: ArtifactInput): Promise<ArtifactRecord> {
    // Verify the task exists
    const task = await db.aZATask.findUnique({ where: { id: taskId } });
    if (!task) {
      throw new AZAError(
        AZAErrorCode.TASK_NOT_FOUND,
        `Cannot create artifact: task ${taskId} not found`,
        { details: { taskId } },
      );
    }

    const checksum = this.computeChecksum(input.data);
    const size = this.estimateSize(input.data);

    const artifact = await db.aZATaskArtifact.create({
      data: {
        id: randomUUID(),
        taskId,
        artifactType: input.artifactType,
        mimeType: input.mimeType,
        data: input.data as any,
        size,
        checksum,
      },
    });

    return artifact;
  }

  // ────────────────────────────────────────────────────
  // Read
  // ────────────────────────────────────────────────────

  /**
   * Get a single artifact by ID.
   */
  async getArtifact(id: string): Promise<ArtifactRecord | null> {
    return db.aZATaskArtifact.findUnique({ where: { id } });
  }

  /**
   * Get all artifacts for a task, optionally filtered by type.
   */
  async getArtifactsByTask(taskId: string, type?: string): Promise<ArtifactRecord[]> {
    const where: Record<string, unknown> = { taskId };
    if (type) {
      where.artifactType = type;
    }

    return db.aZATaskArtifact.findMany({
      where: where as any,
      orderBy: { createdAt: "asc" },
    });
  }

  // ────────────────────────────────────────────────────
  // Integrity Verification
  // ────────────────────────────────────────────────────

  /**
   * Verify the integrity of an artifact by recomputing
   * its SHA-256 checksum and comparing against the stored value.
   *
   * Returns true if the checksums match, false if they differ,
   * and throws if the artifact is not found.
   */
  async verifyIntegrity(id: string): Promise<boolean> {
    const artifact = await db.aZATaskArtifact.findUnique({ where: { id } });
    if (!artifact) {
      throw new AZAError(AZAErrorCode.TASK_ARTIFACT_NOT_FOUND, `Artifact ${id} not found`, {
        details: { artifactId: id },
      });
    }

    if (!artifact.checksum) {
      // No checksum stored — cannot verify
      return false;
    }

    const recomputed = this.computeChecksum(artifact.data);
    return recomputed === artifact.checksum;
  }

  // ────────────────────────────────────────────────────
  // Delete
  // ────────────────────────────────────────────────────

  /**
   * Delete an artifact by ID.
   */
  async deleteArtifact(id: string): Promise<void> {
    const artifact = await db.aZATaskArtifact.findUnique({ where: { id } });
    if (!artifact) {
      throw new AZAError(
        AZAErrorCode.TASK_ARTIFACT_NOT_FOUND,
        `Cannot delete artifact ${id}: not found`,
        { details: { artifactId: id } },
      );
    }

    await db.aZATaskArtifact.delete({ where: { id } });
  }

  // ────────────────────────────────────────────────────
  // Internal Helpers
  // ────────────────────────────────────────────────────

  /**
   * Compute the SHA-256 checksum of a value by first serializing
   * it to JSON, then hashing the resulting bytes.
   */
  private computeChecksum(data: unknown): string {
    const serialized = JSON.stringify(data);
    const bytes = new TextEncoder().encode(serialized);
    const hash = sha256(bytes);
    return Buffer.from(hash).toString("hex");
  }

  /**
   * Estimate the byte size of a value by measuring its
   * JSON serialization in UTF-8.
   */
  private estimateSize(data: unknown): number {
    const serialized = JSON.stringify(data);
    return new TextEncoder().encode(serialized).byteLength;
  }
}
