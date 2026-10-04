import { Markdown, type RefMap } from "./Markdown";
import { ProposalCardView } from "@/components/memory/ProposalCardView";
import type { ProposalCard } from "@/services/memory/view";
import { MemoryNotes, type MemoryNote } from "./MemoryNotes";

export interface ChatItem {
  id: string;
  role: "user" | "assistant";
  content: string;
  notes?: MemoryNote[];
  proposals?: ProposalCard[];
  /** Memory items this reply may cite, keyed by handle. */
  refs?: RefMap;
  /** Stored message id, once known; enables the debug trace. */
  messageId?: string;
}

/** Document-style: user turns are a quiet tinted block, assistant turns are plain prose. */
export function Message({
  item,
  pending,
  onOpenRef,
  onOpenTrace,
}: {
  item: ChatItem;
  pending?: boolean;
  onOpenRef?: (itemId: string) => void;
  /** Provided only in debug mode. */
  onOpenTrace?: (messageId: string) => void;
}) {
  if (item.role === "user") {
    return (
      <div className="animate-message-in flex flex-col items-end gap-1.5">
        <p className="max-w-[85%] whitespace-pre-wrap rounded-lg bg-surface-2 px-4 py-2.5 text-[length:var(--fs-chat)] leading-relaxed">
          {item.content}
        </p>
        {item.notes && <MemoryNotes notes={item.notes} />}
        {item.proposals?.map((p) => <ProposalCardView key={p.id} proposal={p} />)}
      </div>
    );
  }
  return (
    <div className="animate-message-in text-[length:var(--fs-chat)]">
      {item.content ? (
        <Markdown refs={item.refs} onOpenRef={onOpenRef}>
          {item.content}
        </Markdown>
      ) : null}
      {pending && !item.content && <span className="text-sm text-muted animate-pulse">Thinking…</span>}
      {item.notes && <MemoryNotes notes={item.notes} />}
      {item.proposals?.map((p) => <ProposalCardView key={p.id} proposal={p} />)}
      {onOpenTrace && item.messageId && !pending && (
        <button
          onClick={() => onOpenTrace(item.messageId!)}
          className="mt-2 text-xs text-muted underline-offset-2 hover:text-fg hover:underline"
        >
          Trace
        </button>
      )}
    </div>
  );
}
