// ──────────────────────────────────────────────────────
// Harness Notes Store — Structured note-taking
// ──────────────────────────────────────────────────────

/** Predefined note sections */
export type NoteSection = "findings" | "decisions" | "todo" | "questions";

/** A single note entry */
export interface NoteEntry {
  section: NoteSection;
  content: string;
  createdAt: number;
}

/**
 * NotesStore — structured note-taking for agents across sessions.
 * Notes are organized by section (Findings, Decisions, TODO, Questions).
 * Serializable to/from JSON for cross-session persistence.
 */
export class NotesStore {
  private notes: NoteEntry[] = [];

  /** Add a note to a section */
  addNote(section: NoteSection, content: string): void {
    this.notes.push({ section, content, createdAt: Date.now() });
  }

  /** Get notes from a specific section or all notes */
  getNotes(section?: NoteSection): NoteEntry[] {
    if (section) {
      return this.notes.filter((n) => n.section === section).map((n) => ({ ...n }));
    }
    return this.notes.map((n) => ({ ...n }));
  }

  /** Get note count per section */
  getCounts(): Record<NoteSection, number> {
    const counts: Record<NoteSection, number> = {
      findings: 0,
      decisions: 0,
      todo: 0,
      questions: 0,
    };
    for (const n of this.notes) {
      counts[n.section]++;
    }
    return counts;
  }

  /** Clear all notes or notes in a specific section */
  clear(section?: NoteSection): void {
    if (section) {
      this.notes = this.notes.filter((n) => n.section !== section);
    } else {
      this.notes = [];
    }
  }

  /** Serialize to JSON for persistence */
  toJSON(): NoteEntry[] {
    return this.getNotes();
  }

  /** Restore from serialized state */
  static fromJSON(data: NoteEntry[]): NotesStore {
    const store = new NotesStore();
    store.notes = data.map((n) => ({ ...n }));
    return store;
  }
}
