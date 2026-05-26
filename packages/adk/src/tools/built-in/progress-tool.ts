// ──────────────────────────────────────────────────────
// Built-in update_progress tool
// ──────────────────────────────────────────────────────

import type { FeatureStatus, ProgressTracker } from "../../harness/progress-tracker";
import type { ToolContext, ToolDef } from "../../types/tool";

interface ProgressInput {
  action: "add" | "update" | "get_next" | "summary";
  featureId?: string;
  featureName?: string;
  status?: FeatureStatus;
}

export function createProgressTool(tracker: ProgressTracker): ToolDef<ProgressInput> {
  return {
    name: "update_progress",
    description:
      "Track progress on features. Actions: 'add' a new feature, 'update' status (pending/in_progress/passed/failed), 'get_next' pending feature, 'summary' of all progress.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["add", "update", "get_next", "summary"],
          description: "Action to perform",
        },
        featureId: { type: "string", description: "Feature ID (for add/update)" },
        featureName: { type: "string", description: "Feature name (for add)" },
        status: {
          type: "string",
          enum: ["pending", "in_progress", "passed", "failed"],
          description: "New status (for update)",
        },
      },
      required: ["action"],
    },
    execute: async (input: ProgressInput, _ctx: ToolContext) => {
      switch (input.action) {
        case "add": {
          if (!input.featureId || !input.featureName) {
            return { error: "featureId and featureName required for add" };
          }
          tracker.addFeature(input.featureId, input.featureName);
          return { added: input.featureId };
        }
        case "update": {
          if (!input.featureId || !input.status) {
            return { error: "featureId and status required for update" };
          }
          const updated = tracker.updateStatus(input.featureId, input.status);
          return { updated, featureId: input.featureId, status: input.status };
        }
        case "get_next": {
          const next = tracker.getNextPending();
          return next ?? { message: "No pending features" };
        }
        case "summary": {
          return tracker.getSummary();
        }
        default:
          return { error: `Unknown action: ${input.action}` };
      }
    },
  };
}
