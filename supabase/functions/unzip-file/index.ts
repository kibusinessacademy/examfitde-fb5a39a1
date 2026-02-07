import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import JSZip from "https://esm.sh/jszip@3.10.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface FileInfo {
  path: string;
  content: string | null;
  size: number;
  isDirectory: boolean;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { bucketName, filePath, extractContent = true, maxFileSize = 500000 } = await req.json();

    if (!bucketName || !filePath) {
      return new Response(
        JSON.stringify({ error: 'bucketName and filePath are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create Supabase client with service role for storage access
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Download the ZIP file from storage
    const { data: fileData, error: downloadError } = await supabase.storage
      .from(bucketName)
      .download(filePath);

    if (downloadError || !fileData) {
      return new Response(
        JSON.stringify({ error: `Failed to download file: ${downloadError?.message}` }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Read ZIP file
    const arrayBuffer = await fileData.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);

    const files: FileInfo[] = [];
    const textExtensions = [
      '.ts', '.tsx', '.js', '.jsx', '.json', '.css', '.scss', '.less',
      '.html', '.htm', '.xml', '.svg', '.md', '.txt', '.yaml', '.yml',
      '.toml', '.env', '.gitignore', '.editorconfig', '.prettierrc',
      '.eslintrc', '.babelrc', 'Dockerfile', 'Makefile', '.sql'
    ];

    // Extract file information
    for (const [relativePath, zipEntry] of Object.entries(zip.files)) {
      const entry = zipEntry as JSZip.JSZipObject;
      
      if (entry.dir) {
        files.push({
          path: relativePath,
          content: null,
          size: 0,
          isDirectory: true
        });
        continue;
      }

      // Check if it's a text file we should extract content from
      const isTextFile = textExtensions.some(ext => 
        relativePath.toLowerCase().endsWith(ext) || 
        relativePath.split('/').pop()?.toLowerCase() === ext.replace('.', '')
      );

      let content: string | null = null;
      
      if (extractContent && isTextFile) {
        try {
          const fileContent = await entry.async('string');
          // Only include content if it's under the max size
          if (fileContent.length <= maxFileSize) {
            content = fileContent;
          }
        } catch (e) {
          // Binary file or encoding issue, skip content
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

    // Sort files: directories first, then by path
    files.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.path.localeCompare(b.path);
    });

    return new Response(
      JSON.stringify({ 
        success: true, 
        totalFiles: files.length,
        files 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error processing ZIP:', error);
    return new Response(
      JSON.stringify({ error: `Failed to process ZIP: ${error.message}` }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
