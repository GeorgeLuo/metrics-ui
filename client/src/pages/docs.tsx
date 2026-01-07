import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink, Copy, Check } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { useState } from "react";

function MarkdownRenderer({ content }: { content: string }) {
  const [copiedBlock, setCopiedBlock] = useState<number | null>(null);

  const copyToClipboard = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedBlock(index);
    setTimeout(() => setCopiedBlock(null), 2000);
  };

  const lines = content.split('\n');
  const elements: JSX.Element[] = [];
  let i = 0;
  let codeBlockIndex = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      const code = codeLines.join('\n');
      const blockIndex = codeBlockIndex++;
      elements.push(
        <div key={`code-${blockIndex}`} className="relative group my-4">
          {lang && (
            <div className="text-xs text-muted-foreground font-mono px-4 py-1 bg-muted/50 border-b border-border rounded-t-md">
              {lang}
            </div>
          )}
          <pre className={`bg-muted/50 p-4 overflow-x-auto font-mono text-sm ${lang ? 'rounded-b-md' : 'rounded-md'}`}>
            <code>{code}</code>
          </pre>
          <Button
            size="icon"
            variant="ghost"
            className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={() => copyToClipboard(code, blockIndex)}
            data-testid={`button-copy-code-${blockIndex}`}
          >
            {copiedBlock === blockIndex ? (
              <Check className="w-4 h-4 text-green-500" />
            ) : (
              <Copy className="w-4 h-4" />
            )}
          </Button>
        </div>
      );
      i++;
      continue;
    }

    if (line.startsWith('# ')) {
      elements.push(
        <h1 key={i} className="text-3xl font-bold mt-8 mb-4 first:mt-0">
          {line.slice(2)}
        </h1>
      );
    } else if (line.startsWith('## ')) {
      elements.push(
        <h2 key={i} className="text-2xl font-semibold mt-8 mb-3 border-b border-border pb-2">
          {line.slice(3)}
        </h2>
      );
    } else if (line.startsWith('### ')) {
      elements.push(
        <h3 key={i} className="text-xl font-semibold mt-6 mb-2">
          {line.slice(4)}
        </h3>
      );
    } else if (line.startsWith('---')) {
      elements.push(<hr key={i} className="my-8 border-border" />);
    } else if (line.startsWith('| ')) {
      const tableRows: string[] = [line];
      i++;
      while (i < lines.length && lines[i].startsWith('|')) {
        tableRows.push(lines[i]);
        i++;
      }
      i--;

      const headerRow = tableRows[0];
      const dataRows = tableRows.slice(2);

      const headers = headerRow.split('|').filter(c => c.trim()).map(c => c.trim());
      const rows = dataRows.map(row => 
        row.split('|').filter(c => c.trim()).map(c => c.trim())
      );

      elements.push(
        <div key={`table-${i}`} className="my-4 overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-border">
                {headers.map((h, j) => (
                  <th key={j} className="text-left p-2 font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, j) => (
                <tr key={j} className="border-b border-border/50">
                  {row.map((cell, k) => (
                    <td key={k} className="p-2">
                      {cell.startsWith('`') && cell.endsWith('`') ? (
                        <code className="bg-muted px-1.5 py-0.5 rounded text-sm font-mono">
                          {cell.slice(1, -1)}
                        </code>
                      ) : (
                        cell
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      const listItems: string[] = [line.slice(2)];
      i++;
      while (i < lines.length && (lines[i].startsWith('- ') || lines[i].startsWith('* '))) {
        listItems.push(lines[i].slice(2));
        i++;
      }
      i--;
      elements.push(
        <ul key={`list-${i}`} className="list-disc list-inside my-4 space-y-1">
          {listItems.map((item, j) => (
            <li key={j} className="text-muted-foreground">
              <span className="text-foreground">{renderInlineCode(item)}</span>
            </li>
          ))}
        </ul>
      );
    } else if (/^\d+\. /.test(line)) {
      const listItems: string[] = [line.replace(/^\d+\. /, '')];
      i++;
      while (i < lines.length && /^\d+\. /.test(lines[i])) {
        listItems.push(lines[i].replace(/^\d+\. /, ''));
        i++;
      }
      i--;
      elements.push(
        <ol key={`olist-${i}`} className="list-decimal list-inside my-4 space-y-1">
          {listItems.map((item, j) => (
            <li key={j} className="text-muted-foreground">
              <span className="text-foreground">{renderInlineCode(item)}</span>
            </li>
          ))}
        </ol>
      );
    } else if (line.startsWith('**') && line.endsWith('**')) {
      elements.push(
        <p key={i} className="font-semibold my-2">
          {line.slice(2, -2)}
        </p>
      );
    } else if (line.trim() === '') {
      // Skip empty lines
    } else {
      elements.push(
        <p key={i} className="my-2 text-muted-foreground leading-relaxed">
          {renderInlineCode(line)}
        </p>
      );
    }

    i++;
  }

  return <div className="prose prose-invert max-w-none">{elements}</div>;
}

function renderInlineCode(text: string): (string | JSX.Element)[] {
  const parts: (string | JSX.Element)[] = [];
  const regex = /`([^`]+)`/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    parts.push(
      <code key={match.index} className="bg-muted px-1.5 py-0.5 rounded text-sm font-mono">
        {match[1]}
      </code>
    );
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : [text];
}

export default function DocsPage() {
  const { data, isLoading, error } = useQuery<{ content: string }>({
    queryKey: ['/api/docs'],
  });

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 bg-background/95 backdrop-blur border-b border-border">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Link href="/">
              <Button variant="ghost" size="icon" data-testid="button-back-home">
                <ArrowLeft className="w-4 h-4" />
              </Button>
            </Link>
            <h1 className="text-lg font-semibold">Documentation</h1>
          </div>
          <a
            href="/USAGE.md"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            data-testid="link-raw-docs"
          >
            <span>View Raw</span>
            <ExternalLink className="w-4 h-4" />
          </a>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        {isLoading && (
          <div className="space-y-4">
            <div className="h-8 bg-muted animate-pulse rounded w-3/4" />
            <div className="h-4 bg-muted animate-pulse rounded w-full" />
            <div className="h-4 bg-muted animate-pulse rounded w-5/6" />
            <div className="h-4 bg-muted animate-pulse rounded w-4/5" />
          </div>
        )}

        {error && (
          <div className="text-destructive p-4 bg-destructive/10 rounded-md">
            Failed to load documentation
          </div>
        )}

        {data?.content && <MarkdownRenderer content={data.content} />}
      </main>
    </div>
  );
}
