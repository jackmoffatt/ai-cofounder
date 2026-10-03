import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Renders assistant text. react-markdown never renders raw HTML, so model output can't inject markup. */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="prose-chat">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children: c }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {c}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
