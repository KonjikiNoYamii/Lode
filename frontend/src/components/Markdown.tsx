import ReactMarkdown from "react-markdown";
import { memo, useMemo } from "react";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import "katex/dist/katex.min.css";
import "highlight.js/styles/github-dark.min.css";

function cleanGeminiArtifacts(md: string): string {
  return md
    .replace(/<Sequence>([\s\S]*?)<\/Sequence>/gi, (_: string, inner: string) =>
      inner
        .split("\n")
        .map((l) => l.replace(/^\s{2,}/, ""))
        .join("\n")
        .replace(/<Step([^>]*)>/gi, (_: any, attrs: string) => {
          const title = (attrs.match(/(?<!sub)title="([^"]*)"/i)?.[1] ?? "").replace(/^\d+\s*[.)]\s*/, "");
          const subtitle = attrs.match(/subtitle="([^"]*)"/i)?.[1] ?? "";
          return `\n\n1. **${title}**\n${subtitle ? `   _${subtitle}_\n\n` : "\n"}`;
        })
        .replace(/<\/Step>/gi, "\n\n")
    )
    .replace(/<\/?Sequence[^>]*>|<\/?Step[^>]*>/gi, "\n\n");
}

export const Markdown = memo(function Markdown({ children }: { children: string }) {
  const source = useMemo(() => cleanGeminiArtifacts(children), [children]);
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeHighlight, { detect: false, ignoreMissing: true }], rehypeKatex]}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
});