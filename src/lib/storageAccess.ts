import { supabase } from "@/integrations/supabase/client";

/**
 * Get a short-lived signed URL for protected storage content.
 * Requires the user to have a valid entitlement for the curriculum.
 */
export async function getProtectedAssetUrl(params: {
  bucket: "h5p-content" | "course-media";
  path: string;
  curriculumId?: string;
  expiresIn?: number;
}): Promise<string> {
  const { data, error } = await supabase.functions.invoke("storage-signed-url", {
    body: {
      bucket: params.bucket,
      path: params.path,
      curriculumId: params.curriculumId,
      expiresIn: params.expiresIn ?? 120,
    },
  });

  if (error) throw error;
  if (!data?.signedUrl) throw new Error("No signed URL returned");
  return data.signedUrl as string;
}
