"use client";

import { ChatInput } from "@/components/ui/ChatInput";

const suggestions = ["Explore an idea", "Research a market", "Review startup", "Plan next steps"];

export default function NewChatPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 pb-24">
      <div className="w-full max-w-[720px]">
        <p className="text-sm text-muted">AI Co-Founder</p>
        <h1 className="mb-8 mt-1 text-[length:var(--fs-3xl)] font-semibold leading-tight tracking-tight">
          What are we working on?
        </h1>
        {/* Wired to the model in Milestone 1. */}
        <ChatInput autoFocus onSend={() => undefined} />
        <ul className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted">
          {suggestions.map((s) => (
            <li key={s}>
              <button className="transition-colors duration-[var(--dur-fast)] hover:text-fg">{s}</button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
