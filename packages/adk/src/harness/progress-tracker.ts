// ──────────────────────────────────────────────────────
// Harness Progress Tracker — Feature-level tracking
// ──────────────────────────────────────────────────────

/** Status of a progress feature */
export type FeatureStatus = "pending" | "in_progress" | "passed" | "failed";

/** A tracked feature in the progress list */
export interface ProgressFeature {
  id: string;
  name: string;
  status: FeatureStatus;
  verifiedAt?: number;
}

/**
 * ProgressTracker — tracks feature-level progress for long-running agent sessions.
 * Serializable to/from JSON for cross-session persistence.
 */
export class ProgressTracker {
  private features = new Map<string, ProgressFeature>();

  /** Add a feature to track */
  addFeature(id: string, name: string): void {
    if (!this.features.has(id)) {
      this.features.set(id, { id, name, status: "pending" });
    }
  }

  /** Add multiple features at once */
  addFeatures(features: Array<{ id: string; name: string }>): void {
    for (const f of features) {
      this.addFeature(f.id, f.name);
    }
  }

  /** Update the status of a feature */
  updateStatus(id: string, status: FeatureStatus): boolean {
    const feature = this.features.get(id);
    if (!feature) return false;
    feature.status = status;
    if (status === "passed" || status === "failed") {
      feature.verifiedAt = Date.now();
    }
    return true;
  }

  /** Get the next pending feature */
  getNextPending(): ProgressFeature | undefined {
    for (const feature of this.features.values()) {
      if (feature.status === "pending") return { ...feature };
    }
    return undefined;
  }

  /** Get a feature by ID */
  getFeature(id: string): ProgressFeature | undefined {
    const f = this.features.get(id);
    return f ? { ...f } : undefined;
  }

  /** Get all features */
  getAllFeatures(): ProgressFeature[] {
    return Array.from(this.features.values()).map((f) => ({ ...f }));
  }

  /** Get a summary of progress */
  getSummary(): {
    total: number;
    pending: number;
    inProgress: number;
    passed: number;
    failed: number;
    percentComplete: number;
  } {
    let pending = 0;
    let inProgress = 0;
    let passed = 0;
    let failed = 0;
    for (const f of this.features.values()) {
      switch (f.status) {
        case "pending":
          pending++;
          break;
        case "in_progress":
          inProgress++;
          break;
        case "passed":
          passed++;
          break;
        case "failed":
          failed++;
          break;
      }
    }
    const total = this.features.size;
    const done = passed + failed;
    return {
      total,
      pending,
      inProgress,
      passed,
      failed,
      percentComplete: total > 0 ? Math.round((done / total) * 100) : 0,
    };
  }

  /** Serialize to JSON for persistence */
  toJSON(): ProgressFeature[] {
    return this.getAllFeatures();
  }

  /** Restore from serialized state */
  static fromJSON(data: ProgressFeature[]): ProgressTracker {
    const tracker = new ProgressTracker();
    for (const f of data) {
      tracker.features.set(f.id, { ...f });
    }
    return tracker;
  }
}
