/**
 * SSOT Audit Thresholds — shared between tests, stuck-scan, and runtime.
 *
 * These constants define the time boundaries for anomaly detection.
 * Tests and runtime MUST read from this file to prevent drift.
 */

/** A queued step without a dispatched job is stale after this many minutes. */
export const STALE_QUEUED_MINUTES = 15;

/** A running step without an active job is orphaned after this many minutes. */
export const ORPHAN_RUNNING_MINUTES = 60;

/** A processing job is considered zombie after this many hours. */
export const ZOMBIE_PROCESSING_HOURS = 2;

/** Maximum tolerated entries in ops_processing_stale before hard fail. */
export const MAX_STALE_PROCESSING_ENTRIES = 5;

/** Maximum tolerated packages with missing downstream steps (known tech debt). */
export const MAX_DOWNSTREAM_MISSING = 10;

/** Expected DAG edge count range [min, max]. */
export const DAG_EDGE_COUNT_MIN = 20;
export const DAG_EDGE_COUNT_MAX = 50;
