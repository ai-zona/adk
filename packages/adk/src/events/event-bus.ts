// ──────────────────────────────────────────────────────
// ADK EventBus — Portable, instantiable (no globalThis)
// ──────────────────────────────────────────────────────
// Extracted from @aizona/platform-agents/observability/event-bus.ts
// Key difference: NOT a singleton. Each Runner/Session gets its own.
// ──────────────────────────────────────────────────────

import type { ADKEventListener, ADKEventMap, ADKEventName } from "../types/events";

export class ADKEventBus {
  private listeners = new Map<ADKEventName, Set<ADKEventListener<ADKEventName>>>();

  /** Subscribe to an event. Returns unsubscribe function. */
  on<K extends ADKEventName>(event: K, listener: ADKEventListener<K>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    const set = this.listeners.get(event)!;
    set.add(listener as ADKEventListener<ADKEventName>);

    return () => {
      set.delete(listener as ADKEventListener<ADKEventName>);
      if (set.size === 0) {
        this.listeners.delete(event);
      }
    };
  }

  /** Subscribe to an event once. Auto-unsubscribes after first emit. */
  once<K extends ADKEventName>(event: K, listener: ADKEventListener<K>): () => void {
    const wrappedListener = ((data: ADKEventMap[K]) => {
      unsubscribe();
      listener(data);
    }) as ADKEventListener<K>;

    const unsubscribe = this.on(event, wrappedListener);
    return unsubscribe;
  }

  /** Unsubscribe a specific listener. */
  off<K extends ADKEventName>(event: K, listener: ADKEventListener<K>): void {
    const set = this.listeners.get(event);
    if (set) {
      set.delete(listener as ADKEventListener<ADKEventName>);
      if (set.size === 0) {
        this.listeners.delete(event);
      }
    }
  }

  /** Emit an event to all listeners. */
  emit<K extends ADKEventName>(event: K, data: ADKEventMap[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const listener of set) {
      try {
        listener(data);
      } catch {
        // Non-critical — don't let listener errors break the emitter
      }
    }
  }

  /** Get the number of listeners for an event. */
  listenerCount(event: ADKEventName): number {
    return this.listeners.get(event)?.size ?? 0;
  }

  /** Get all events with active listeners. */
  activeEvents(): ADKEventName[] {
    return Array.from(this.listeners.keys());
  }

  /** Remove all listeners for all events. */
  removeAllListeners(): void {
    this.listeners.clear();
  }
}
