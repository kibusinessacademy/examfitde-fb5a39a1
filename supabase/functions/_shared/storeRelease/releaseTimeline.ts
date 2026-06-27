/**
 * STORE.PUBLISH.ORCHESTRATION.OS.1 — Append-only timeline (pure)
 */
import type { ReleaseTimelineEvent, ReleaseTimelineEventType } from "./contracts";

export function appendEvent(
  timeline: ReadonlyArray<ReleaseTimelineEvent>,
  event: ReleaseTimelineEvent,
): ReleaseTimelineEvent[] {
  // Append-only: never mutate prior entries.
  return [...timeline, event];
}

export function timelineContains(
  timeline: ReadonlyArray<ReleaseTimelineEvent>,
  type: ReleaseTimelineEventType,
): boolean {
  return timeline.some((e) => e.event === type);
}

export function lastEvent(
  timeline: ReadonlyArray<ReleaseTimelineEvent>,
): ReleaseTimelineEvent | null {
  return timeline.length === 0 ? null : timeline[timeline.length - 1];
}

/**
 * Verify append-only invariant against a previous timeline.
 * Returns true iff `next` is `prev` plus exactly one new trailing event,
 * and no earlier entry was mutated.
 */
export function isAppendOnly(
  prev: ReadonlyArray<ReleaseTimelineEvent>,
  next: ReadonlyArray<ReleaseTimelineEvent>,
): boolean {
  if (next.length !== prev.length + 1) return false;
  for (let i = 0; i < prev.length; i++) {
    if (JSON.stringify(prev[i]) !== JSON.stringify(next[i])) return false;
  }
  return true;
}
