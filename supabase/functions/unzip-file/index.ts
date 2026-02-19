import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import JSZip from "https://esm.sh/jszip@3.10.1";
import { validateAuth, unauthorizedResponse, forbiddenResponse } from "../_shared/auth.ts";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

interface FileInfo {
  path: string;
  content: string | null;
  size: number;
  isDirectory: boolean;
}

const textExtensions = [
  '.ts', '.tsx', '.js', '.jsx', '.json', '.css', '.scss', '.less',
  '.html', '.htm', '.xml', '.svg', '.md', '.txt', '.yaml', '.yml',
  '.toml', '.env', '.gitignore', '.editorconfig', '.prettierrc',
  '.eslintrc', '.babelrc', 'dockerfile', 'makefile', '.sql'
];

function isTextFile(path: string): boolean {
  const lowPath = path.toLowerCase();
  const fileName = lowPath.split('/').pop() || '';
  return textExtensions.some(ext => 
    lowPath.endsWith(ext) || fileName === ext.replace('.', '')
  );
}

serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;

  const origin = req.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);

  // ==================== AUTH CHECK ====================
  // Require admin role to unzip files (potential for abuse)
  const auth = await validateAuth(req, true); // requireAdmin = true
  
  if (auth.error) {
    if (auth.error === 'Admin access required') {
      return forbiddenResponse(auth.error);
    }
    return unauthorizedResponse(auth.error);
  }
  // ====================================================

  try {
    const { 
      bucketName, 
      filePath, 
      extractContent = true, 
      maxFileSize = 50000,
      filterPath = null,
      listOnly = false
    } = await req.json();

    if (!bucketName || !filePath) {
      return new Response(
        JSON.stringify({ error: 'bucketName and filePath are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log(`[User: ${auth.user?.id}] Downloading ${filePath} from ${bucketName}...`);
    
    const { data: fileData, error: downloadError } = await supabase.storage
      .from(bucketName)
      .download(filePath);

    if (downloadError || !fileData) {
      return new Response(
        JSON.stringify({ error: `Failed to download: ${downloadError?.message}` }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Loading ZIP...');
    const arrayBuffer = await fileData.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);

    const files: FileInfo[] = [];
    const entries = Object.entries(zip.files);
    
    console.log(`Processing ${entries.length} entries...`);

    for (const [relativePath, zipEntry] of entries) {
      const entry = zipEntry as JSZip.JSZipObject;
      
      // Skip if filter is set and path doesn't match
      if (filterPath && !relativePath.startsWith(filterPath)) {
        continue;
      }
      
      if (entry.dir) {
        files.push({ path: relativePath, content: null, size: 0, isDirectory: true });
        continue;
      }

      let content: string | null = null;
      
      if (!listOnly && extractContent && isTextFile(relativePath)) {
        try {
          const fileContent = await entry.async('string');
          if (fileContent.length <= maxFileSize) {
            content = fileContent;
          }
        } catch {
          content = null;
        }
      }

      files.push({
        path: relativePath,
        content,
        size: entry._data?.uncompressedSize || 0,
        isDirectory: false
      });
    }

    files.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.path.localeCompare(b.path);
    });

    console.log(`Returning ${files.length} files`);

    return new Response(
      JSON.stringify({ success: true, totalFiles: files.length, files }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: `Failed: ${error.message}` }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
