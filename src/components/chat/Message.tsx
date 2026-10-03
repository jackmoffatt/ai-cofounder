import { Markdown } from "./Markdown";
import { MemoryNotes, type MemoryNote } from "./MemoryNotes";

export interface ChatItem {
  id: string;
  role: "user" | "assistant";
  content: string;
  notes?: MemoryNote[];
}

/** Document-style: user turns are a quiet tinted block, assistant turns are plain prose. */
export function Message({ item, pending }: { item: ChatItem; pending?: boolean }) {
  if (item.role === "user") {
    return (
      <div className="animate-message-in flex flex-col items-end gap-1.5">
        <p className="max-w-[85%] whitespace-pre-wrap rounded-lg bg-surface-2 px-4 py-2.5 text-[length:var(--fs-chat)] leading-relaxed">
          {item.content}
        </p>
        {item.notes && <MemoryNotes notes={item.notes} />}
      </div>
    );
  }
  return (
    <div className="animate-message-in text-[length:var(--fs-chat)]">
      {item.content ? <Markdown>{item.content}</Markdown> : null}
      {pending && !item.content && <span className="text-sm text-muted animate-pulse">Thinking…</span>}
      {item.notes && <MemoryNotes notes={item.notes} />}
    </div>
  );
}
