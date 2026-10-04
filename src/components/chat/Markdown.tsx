import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";

export type RefMap = Record<string, { id: string; kind: string; title: string }>;

const REF = /\s?\[m:([0-9a-f]{6,8})\]/g;

/** Turns [m:handle] citations into links the renderer swaps for chips; unknown handles are dropped. */
function linkRefs(text: string, refs: RefMap): string {
  return text.replace(REF, (_m, h: string) => (refs[h] ? ` [${refs[h].title.replace(/[[\]]/g, "")}](memref:${h})` : ""));
}

const short = (s: string, n = 32) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/**
 * Renders assistant text. react-markdown never renders raw HTML, so model output can't inject markup.
 * Citations of recorded items become small chips that open the item (progressive disclosure).
 */
export function Markdown({
  children,
  refs = {},
  onOpenRef,
}: {
  children: string;
  refs?: RefMap;
  onOpenRef?: (itemId: string) => void;
}) {
  return (
    <div className="prose-chat">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url) => (url.startsWith("memref:") ? url : defaultUrlTransform(url))}
        components={{
          a: ({ href, children: c }) => {
            if (href?.startsWith("memref:")) {
              const ref = refs[href.slice(7)];
              return ref ? (
                <button
                  type="button"
                  onClick={() => onOpenRef?.(ref.id)}
                  title={`${ref.kind}: ${ref.title}`}
                  className="mx-0.5 inline-flex max-w-[16rem] items-center truncate rounded-sm bg-surface-2 px-1.5 py-px align-baseline text-[0.8em] leading-snug text-muted no-underline transition-colors duration-[var(--dur-fast)] hover:text-fg"
                >
                  {short(ref.title)}
                </button>
              ) : null;
            }
            return (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {c}
              </a>
            );
          },
        }}
      >
        {linkRefs(children, refs)}
      </ReactMarkdown>
    </div>
  );
}
