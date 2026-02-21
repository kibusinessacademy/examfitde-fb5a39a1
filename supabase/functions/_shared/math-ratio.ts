/**
 * SSOT math_ratio loader from certification_catalog.
 * Used by pool-rework and package-generate-exam-pool.
 */

const DEFAULT_MATH_RATIO = 0.20;

export async function loadMathRatio(
  sb: any,
  professionName: string,
): Promise<number> {
  try {
    const searchName = String(professionName ?? "").split("/")[0].trim();
    if (!searchName) return DEFAULT_MATH_RATIO;

    const { data } = await sb
      .from("certification_catalog")
      .select("math_ratio, title")
      .ilike("title", `%${searchName}%`)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const r = data?.math_ratio;
    if (typeof r === "number" && r > 0 && r <= 0.5) return r;
    return DEFAULT_MATH_RATIO;
  } catch {
    return DEFAULT_MATH_RATIO;
  }
}
