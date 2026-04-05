/**
 * SSOT Naming Contract — Boundary Parse Helpers
 *
 * One-call wrappers: canonicalize + validate + fail-closed.
 * Use at system boundaries only (HTTP, queue read, admin action).
 */

import {
  PackageStepPayloadSchema,
  EnqueuePackageJobInputSchema,
  AdminRepairActionSchema,
  PackageIdentitySchema,
  type PackageStepPayload,
  type EnqueuePackageJobInput,
  type AdminRepairAction,
  type PackageIdentity,
} from "./system-contracts";

import {
  canonicalize_package_step_payload,
  canonicalize_enqueue_job_input,
  canonicalize_admin_repair_action,
  canonicalize_package_identity,
} from "./canonicalize";

import { parse_contract } from "./parse-contract";

/** Parse + canonicalize a package identity from any boundary input */
export function parse_package_identity(input: unknown): PackageIdentity {
  return parse_contract(
    PackageIdentitySchema,
    canonicalize_package_identity(input),
    "Invalid package identity",
  );
}

/** Parse + canonicalize a full step payload from queue/worker input */
export function parse_package_step_payload(input: unknown): PackageStepPayload {
  return parse_contract(
    PackageStepPayloadSchema,
    canonicalize_package_step_payload(input),
    "Invalid package step payload",
  );
}

/** Parse + canonicalize an enqueue job input from producer/admin */
export function parse_enqueue_package_job_input(input: unknown): EnqueuePackageJobInput {
  return parse_contract(
    EnqueuePackageJobInputSchema,
    canonicalize_enqueue_job_input(input),
    "Invalid enqueue package job input",
  );
}

/** Parse + canonicalize an admin repair action */
export function parse_admin_repair_action(input: unknown): AdminRepairAction {
  return parse_contract(
    AdminRepairActionSchema,
    canonicalize_admin_repair_action(input),
    "Invalid admin repair action",
  );
}
