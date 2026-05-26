import { beforeEach, describe, expect, it } from "vitest";
import { createReadNotesTool, createWriteNoteTool } from "../tools/built-in/notes-tool";
import { createProgressTool } from "../tools/built-in/progress-tool";
import { NotesStore } from "./notes-store";
import { ProgressTracker } from "./progress-tracker";

const stubCtx = { runContext: {} as any, toolCallId: "tc1", agentName: "test" };

describe("ProgressTracker", () => {
  let tracker: ProgressTracker;

  beforeEach(() => {
    tracker = new ProgressTracker();
  });

  it("adds and retrieves features", () => {
    tracker.addFeature("f1", "Feature One");
    tracker.addFeature("f2", "Feature Two");
    expect(tracker.getAllFeatures()).toHaveLength(2);
    expect(tracker.getFeature("f1")?.name).toBe("Feature One");
    expect(tracker.getFeature("f1")?.status).toBe("pending");
  });

  it("does not duplicate features", () => {
    tracker.addFeature("f1", "Feature One");
    tracker.addFeature("f1", "Feature One Again");
    expect(tracker.getAllFeatures()).toHaveLength(1);
  });

  it("updates status and sets verifiedAt", () => {
    tracker.addFeature("f1", "Feature One");
    tracker.updateStatus("f1", "passed");
    const f = tracker.getFeature("f1")!;
    expect(f.status).toBe("passed");
    expect(f.verifiedAt).toBeGreaterThan(0);
  });

  it("returns false for unknown feature update", () => {
    expect(tracker.updateStatus("nonexistent", "passed")).toBe(false);
  });

  it("gets next pending feature", () => {
    tracker.addFeature("f1", "Feature One");
    tracker.addFeature("f2", "Feature Two");
    tracker.updateStatus("f1", "passed");
    const next = tracker.getNextPending();
    expect(next?.id).toBe("f2");
  });

  it("returns undefined when no pending features", () => {
    tracker.addFeature("f1", "Feature One");
    tracker.updateStatus("f1", "passed");
    expect(tracker.getNextPending()).toBeUndefined();
  });

  it("computes summary correctly", () => {
    tracker.addFeatures([
      { id: "f1", name: "F1" },
      { id: "f2", name: "F2" },
      { id: "f3", name: "F3" },
      { id: "f4", name: "F4" },
    ]);
    tracker.updateStatus("f1", "passed");
    tracker.updateStatus("f2", "failed");
    tracker.updateStatus("f3", "in_progress");

    const s = tracker.getSummary();
    expect(s.total).toBe(4);
    expect(s.passed).toBe(1);
    expect(s.failed).toBe(1);
    expect(s.inProgress).toBe(1);
    expect(s.pending).toBe(1);
    expect(s.percentComplete).toBe(50);
  });

  it("serializes and deserializes", () => {
    tracker.addFeature("f1", "Feature One");
    tracker.updateStatus("f1", "passed");
    const json = tracker.toJSON();
    const restored = ProgressTracker.fromJSON(json);
    expect(restored.getFeature("f1")?.status).toBe("passed");
  });
});

describe("NotesStore", () => {
  let store: NotesStore;

  beforeEach(() => {
    store = new NotesStore();
  });

  it("adds and retrieves notes", () => {
    store.addNote("findings", "Found a bug");
    store.addNote("decisions", "Will fix tomorrow");
    expect(store.getNotes()).toHaveLength(2);
    expect(store.getNotes("findings")).toHaveLength(1);
    expect(store.getNotes("findings")[0]?.content).toBe("Found a bug");
  });

  it("counts notes per section", () => {
    store.addNote("findings", "A");
    store.addNote("findings", "B");
    store.addNote("todo", "C");
    const counts = store.getCounts();
    expect(counts.findings).toBe(2);
    expect(counts.todo).toBe(1);
    expect(counts.decisions).toBe(0);
  });

  it("clears all notes", () => {
    store.addNote("findings", "A");
    store.addNote("todo", "B");
    store.clear();
    expect(store.getNotes()).toHaveLength(0);
  });

  it("clears notes by section", () => {
    store.addNote("findings", "A");
    store.addNote("todo", "B");
    store.clear("findings");
    expect(store.getNotes()).toHaveLength(1);
    expect(store.getNotes()[0]?.section).toBe("todo");
  });

  it("serializes and deserializes", () => {
    store.addNote("findings", "Important");
    const json = store.toJSON();
    const restored = NotesStore.fromJSON(json);
    expect(restored.getNotes("findings")).toHaveLength(1);
  });
});

describe("Progress Tool", () => {
  it("adds, updates, and summarizes features", async () => {
    const tracker = new ProgressTracker();
    const tool = createProgressTool(tracker);

    await tool.execute({ action: "add", featureId: "f1", featureName: "Auth" }, stubCtx);
    await tool.execute({ action: "add", featureId: "f2", featureName: "API" }, stubCtx);
    await tool.execute({ action: "update", featureId: "f1", status: "passed" }, stubCtx);

    const next = await tool.execute({ action: "get_next" }, stubCtx);
    expect((next as any).id).toBe("f2");

    const summary = await tool.execute({ action: "summary" }, stubCtx);
    expect((summary as any).total).toBe(2);
    expect((summary as any).passed).toBe(1);
  });
});

describe("Notes Tools", () => {
  it("writes and reads notes", async () => {
    const store = new NotesStore();
    const writeTool = createWriteNoteTool(store);
    const readTool = createReadNotesTool(store);

    await writeTool.execute({ section: "findings", content: "Bug found" }, stubCtx);
    await writeTool.execute({ section: "todo", content: "Fix it" }, stubCtx);

    const all = (await readTool.execute({}, stubCtx)) as any;
    expect(all.notes).toHaveLength(2);
    expect(all.counts.findings).toBe(1);

    const filtered = (await readTool.execute({ section: "todo" }, stubCtx)) as any;
    expect(filtered.notes).toHaveLength(1);
  });
});
