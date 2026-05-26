import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Copy, Download, Check } from "lucide-react";
import type { TemplateDoc } from "@/lib/authority/templates";

export function TemplateViewer({ doc }: { doc: TemplateDoc }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(doc.body);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const download = () => {
    const blob = new Blob([doc.body], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${doc.slug}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex items-center justify-between border-b p-3 gap-2">
          <span className="text-xs font-mono text-muted-foreground">{doc.source}</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={copy}>
              {copied ? <Check className="h-4 w-4 mr-1.5" /> : <Copy className="h-4 w-4 mr-1.5" />}
              {copied ? "Kopiert" : "Kopieren"}
            </Button>
            <Button size="sm" variant="outline" onClick={download}>
              <Download className="h-4 w-4 mr-1.5" /> .txt
            </Button>
          </div>
        </div>
        <pre className="text-sm whitespace-pre-wrap p-5 leading-relaxed font-mono bg-muted/20">{doc.body}</pre>
      </CardContent>
    </Card>
  );
}
