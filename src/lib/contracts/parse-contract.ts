import { z, ZodError } from "zod";

/**
 * Contract validation error with structured details.
 * Used at system boundaries for fail-closed validation.
 */
export class ContractValidationError extends Error {
  public readonly details: ReturnType<ZodError["flatten"]>;

  constructor(message: string, error: ZodError) {
    super(message);
    this.name = "ContractValidationError";
    this.details = error.flatten();
  }
}

/**
 * Parse and validate input against a Zod schema.
 * Throws ContractValidationError on failure (fail-closed).
 *
 * Uses z.ZodTypeAny generic for full type inference from schema.
 */
export function parse_contract<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  input: unknown,
  message = "Invalid contract payload",
): z.infer<TSchema> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ContractValidationError(message, result.error);
  }
  return result.data;
}
