// ──────────────────────────────────────────────────────
// Built-in write_note / read_notes tools
// ──────────────────────────────────────────────────────

import type { NoteSection, NotesStore } from "../../harness/notes-store";
import type { ToolContext, ToolDef } from "../../types/tool";

interface WriteNoteInput {
  section: NoteSection;
  content: string;
}

interface ReadNotesInput {
  section?: NoteSection;
}

export function createWriteNoteTool(store: NotesStore): ToolDef<WriteNoteInput> {
  return {
    name: "write_note",
    description:
      "Write a structured note. Sections: 'findings' for discoveries, 'decisions' for choices made, 'todo' for pending items, 'questions' for open questions.",
    inputSchema: {
      type: "object",
      properties: {
        section: {
          type: "string",
          enum: ["findings", "decisions", "todo", "questions"],
          description: "Note section",
        },
        content: { type: "string", description: "Note content" },
      },
      required: ["section", "content"],
    },
    execute: async (input: WriteNoteInput, _ctx: ToolContext) => {
      store.addNote(input.section, input.content);
      return { written: true, section: input.section };
    },
  };
}

export function createReadNotesTool(store: NotesStore): ToolDef<ReadNotesInput> {
  return {
    name: "read_notes",
    description:
      "Read structured notes. Optionally filter by section: findings, decisions, todo, questions.",
    inputSchema: {
      type: "object",
      properties: {
        section: {
          type: "string",
          enum: ["findings", "decisions", "todo", "questions"],
          description: "Filter by section (optional)",
        },
      },
    },
    execute: async (input: ReadNotesInput, _ctx: ToolContext) => {
      const notes = store.getNotes(input.section);
      const counts = store.getCounts();
      return { notes, counts };
    },
  };
}
