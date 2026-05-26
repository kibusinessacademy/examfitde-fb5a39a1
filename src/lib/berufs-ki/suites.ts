import { supabase } from "@/integrations/supabase/client";

export interface ProductSuite {
  id: string;
  slug: string;
  name: string;
  audience: string;
  tagline: string;
  description: string;
  route: string;
  modules: string[];
  sort_order: number;
}

export async function listProductSuites(): Promise<ProductSuite[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("berufs_ki_product_suites")
    .select("id, slug, name, audience, tagline, description, route, modules, sort_order")
    .eq("active", true)
    .order("sort_order", { ascending: true });
  if (error) throw new Error(error.message);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((r: any) => ({ ...r, modules: Array.isArray(r.modules) ? r.modules : [] }));
}
