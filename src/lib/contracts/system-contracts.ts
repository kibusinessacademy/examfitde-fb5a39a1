import { z } from "zod";

/**
 * SSOT Naming Contract — System Contracts
 *
 * All systemische Feldnamen sind ausschließlich snake_case.
 * Gilt für: DB, RPC, Queue Payloads, Edge Functions, Validators, Audit.
 * camelCase ist nur in isoliertem UI-Code erlaubt.
 */

export const uuidSchema = z.string().uuid();
export const optionalUuidSchema = z.string().uuid().optional();
export const nullableOptionalUuidSchema = z.string().uuid().nullable().optional();

/** Minimale Paket-Identität (package_id + optional curriculum/course) */
export const PackageIdentitySchema = z.object({
  package_id: uuidSchema,
  curriculum_id: optionalUuidSchema,
  course_id: nullableOptionalUuidSchema,
});
export type PackageIdentity = z.infer<typeof PackageIdentitySchema>;

/** Voller Step-Payload für Worker/Validator */
export const PackageStepPayloadSchema = z.object({
  package_id: uuidSchema,
  curriculum_id: optionalUuidSchema,
  course_id: nullableOptionalUuidSchema,
  step_key: z.string().min(1).optional(),
  job_type: z.string().min(1).optional(),
  blueprint_id: optionalUuidSchema,
  competency_id: optionalUuidSchema,
  lesson_id: optionalUuidSchema,
  learning_field_filter: z.string().optional(),
  track: z.string().min(1).optional(),
  program_type: z.string().min(1).optional(),
});
export type PackageStepPayload = z.infer<typeof PackageStepPayloadSchema>;

/** Enqueue-Input (Producer → Queue) */
export const EnqueuePackageJobInputSchema = z.object({
  package_id: uuidSchema,
  curriculum_id: optionalUuidSchema,
  course_id: nullableOptionalUuidSchema,
  job_type: z.string().min(1),
  step_key: z.string().min(1).optional(),
  blueprint_id: optionalUuidSchema,
  competency_id: optionalUuidSchema,
  lesson_id: optionalUuidSchema,
  learning_field_filter: z.string().optional(),
  priority: z.number().int().min(0).max(100).optional(),
  run_after: z.string().datetime().optional(),
  payload_version: z.literal(1).default(1),
});
export type EnqueuePackageJobInput = z.infer<typeof EnqueuePackageJobInputSchema>;

/** Admin Repair Action */
export const AdminRepairActionSchema = z.object({
  package_id: uuidSchema,
  repair_action: z.string().min(1),
  requested_by: optionalUuidSchema,
  reason: z.string().min(1).optional(),
});
export type AdminRepairAction = z.infer<typeof AdminRepairActionSchema>;
