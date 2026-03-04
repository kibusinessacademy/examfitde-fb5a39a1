#!/bin/bash
# Fix all esm.sh/@supabase/supabase-js imports to npm: specifier
# This prevents deployment failures caused by esm.sh CDN instability

echo "Fixing esm.sh imports in supabase/functions/..."

# Fix @supabase/supabase-js (all versions)
find supabase/functions -name '*.ts' -exec sed -i \
  's|from "https://esm\.sh/@supabase/supabase-js@[^"]*"|from "npm:@supabase/supabase-js@2.45.4"|g' {} +

find supabase/functions -name '*.ts' -exec sed -i \
  "s|from 'https://esm\.sh/@supabase/supabase-js@[^']*'|from 'npm:@supabase/supabase-js@2.45.4'|g" {} +

# Fix stripe
find supabase/functions -name '*.ts' -exec sed -i \
  's|from "https://esm\.sh/stripe@[^"]*"|from "npm:stripe@14.21.0"|g' {} +

# Fix jszip
find supabase/functions -name '*.ts' -exec sed -i \
  's|from "https://esm\.sh/jszip@[^"]*"|from "npm:jszip@3.10.1"|g' {} +

echo "Done. Checking remaining esm.sh imports..."
REMAINING=$(grep -rn 'esm\.sh' supabase/functions/ --include='*.ts' | grep -v 'deno.land' | wc -l)
echo "Remaining esm.sh imports: $REMAINING"
