# AI Co-Founder — Architecture & Product Plan (v0.1, for review)

Status: **planning only. No code, no dependencies installed.** Sections A–O follow the spec's request.
Items marked **[DECISION]** are the ones I need you to confirm or override (collected in section N).

---

## A. Product Understanding

**What we're building.** A private, single-user startup operating system whose only real interface is a conversation. You open it, talk, and the agent already knows who you are, what the company believes, what evidence backs those beliefs, what was decided and why, and what's unfinished. Everything else (memory, tasks, research, decisions) is *supporting structure that makes the next answer better* and is inspectable on demand.

**How it differs from a generic chatbot.**

| Generic chatbot | This |
|---|---|
| Context = the current thread | Context = curated, per-message assembly from a structured knowledge base |
| Memory = flat, opaque, or none | Memory = typed, sourced, editable, with epistemic status |
| Treats what you say as true | Treats what you say as *claims* until evidence attaches |
| Answers | Answers **and** converts objectives into tasks/experiments/decisions |
| Agreeable by default | Challenging by design, accountable to the founder's decisions |
| Forgets why | Can reconstruct "why did we decide X" months later |

**Principles that should govern every trade-off.**
1. **Chat is the product.** Any UI/feature that doesn't make talking to the agent better gets cut.
2. **Epistemic honesty.** Idea ≠ assumption ≠ evidence ≠ validated knowledge ≠ decision. Enforced in *code*, not just in prompts.
3. **Transparent memory.** Every stored belief has provenance and can be viewed, edited, deleted.
4. **Founder decides.** The agent proposes; strategic changes require confirmation; external actions require approval.
5. **Retrieval, not dumping.** Small brief + recent turns + targeted retrieval. Never "send everything".
6. **Boring infrastructure.** One process, one SQLite file, one agent.

---

## B. V1 Recommendation

Your V1 list is good and unusually disciplined. Adjustments:

**Add (small, high leverage)**
- **Memory audit log + "proposals inbox."** Needed for transparency (#14, #41, #42) and undo. Cheap if designed in from day one, painful to retrofit.
- **Agent trace / debug view in V1 (not "eventually").** You can't tune memory quality or context selection blind. It's one table and one dev-only panel.
- **JSON export of all data.** Trivial with SQLite; enforces the data-ownership principle.
- **Tiny eval set (~20 scripted prompts)** checking: user claims become assumptions not facts; agent pushes back on a weak idea; brief never states an untested assumption as fact. This is our regression test for the hardest product risk.
- **Rolling conversation summary** (per conversation) so long chats stay within budget.

**Simplify**
- **Collapse entity sprawl.** Ideas, Questions, Customer Insights, Decisions, Assumptions become *kinds of one `memory_items` table* (shared lifecycle, provenance, status, search) rather than 6 tables. Tasks, Experiments, Competitors, Sources stay separate because they have real distinct structure/queries. (Detail in D.)
- **Agent modes are internal only** — a field in the trace that selects a prompt fragment and retrieval recipe. No mode picker in the UI.
- **Competitors** ship as a lightweight table filled by research; no competitor "workspace" UI in V1.
- **Research UI** = a filtered list of research items + sources. No separate research app.

**Delay**
- Attachments / document reading (keep the tool slot; ship after research).
- Command palette, advanced shortcuts (ship `⌘N`, `⌘K` search, `⌘\` sidebar only, at the end).
- Right context panel: ship a minimal version (M4), full variety later.
- Embeddings/vector search. SQLite FTS5 + structured queries first; schema leaves a hook.
- Multi-startup UI (schema supports it via `startup_id`).
- Accent-color configurability (tokens make it a later 10-minute change).

**Remove/avoid**: nothing in your V1 list needs removing; the "Do not build yet" list is right.

---

## C. System Architecture

Single Next.js app (App Router, TypeScript), single Node process, single SQLite file. Local-first.

```
Browser (React + Tailwind)
   │  fetch / SSE stream
Next.js route handlers (thin: validate → call service → return)
   │
src/agent/     ← orchestrates a turn (the "co-founder")
   │   ├─ intent      classify mode + retrieval needs
   │   ├─ contextBuilder  assemble prompt from brief + recents + retrieved items
   │   ├─ systemPrompt    persona + epistemic rules + mode fragments
   │   ├─ loop        model ↔ tools loop (own, ~100 lines)
   │   ├─ extraction  post-turn memory candidates
   │   └─ policy      what auto-applies vs needs confirmation/approval
   │
src/tools/     ← registry + tool implementations
src/services/  ← ai/ (provider abstraction), research/, memory/, brief/, tasks/
src/db/        ← schema, migrations, queries (only place that touches SQL)
```

- **Frontend:** Next.js + React + Tailwind. Server Components for static shells; chat is a client component consuming an SSE stream. Headless accessible primitives (Radix or React Aria) for dialog/popover/tooltip/menus instead of hand-rolling focus management. `cmdk` later for command menu.
- **Backend:** Next.js route handlers on the Node runtime (not Edge — SQLite needs Node). Routes stay thin; logic lives in `src/services` and `src/agent` so it's testable without HTTP.
- **Agent layer:** one agent. A turn = classify → build context → model/tool loop (streamed) → persist → extraction (async) → state update. Own small loop rather than an agent framework: the flow is simple, and frameworks obscure the behavior we need to debug.
- **AI provider layer:** `AIProvider` interface + `AnthropicProvider`. A `models` config maps roles (chat, classify, extract, summarize, research) to provider+model. (G)
- **Memory layer:** `services/memory` owns CRUD, provenance, audit events, proposals, FTS indexing, retrieval recipes. All writes go through it — the agent never writes SQL.
- **Database:** SQLite via `better-sqlite3` + **Drizzle ORM** (typed schema, migrations, still close to SQL; raw SQL escape hatch for FTS5). WAL mode.
- **Tool system:** typed registry with risk levels and an approval gate (H).
- **Research layer:** a service behind a tool: search backend → fetch → store sources → findings that must cite stored sources (I).
- **Context builder:** deterministic code, not an LLM. Per-mode retrieval recipes + FTS keyword search + budgets (F).

**Proposed layout** (deviations from your sketch: `agent/`, `tools/`, `services/`, `db/` live under `src/`; `tools/` is pulled out of `agent/` because tools are consumed by the agent but implemented independently; `components/` is organized by feature):

```
src/
  app/                  routes + API handlers (chat, conversations, memory, settings)
  agent/                agent, systemPrompt, contextBuilder, intent, loop, extraction, policy
  tools/                registry.ts, types.ts, searchMemory.ts, taskManager.ts, webResearch.ts
  services/
    ai/                 types.ts, anthropic.ts, models.ts
    research/           search backend, fetcher, citation validator
    memory/             items, proposals, events, retrieval, brief
  db/                   schema.ts, client.ts, migrations/, queries/
  components/           chat/ sidebar/ context/ memory/ ui/
  styles/               tokens.css
tests/                  unit + evals/
```

---

## D. Database Schema

**Design rule:** a separate table only when a concept has distinct fields/queries/lifecycle. Everything carries `startup_id` (nullable for founder-level/pre-startup items) and `owner_id` (constant in V1) so multi-startup and auth aren't blocked later. IDs are ULIDs/UUIDs; timestamps ISO strings.

### Core
```
founder            id, owner_id, name, profile JSON*, updated_at
startups           id, owner_id, name, status(exploring|active|archived),
                   stage(discovery|problem|market|validation|product_def|development|gtm|learning),
                   current_objective_id, profile JSON*, created_at, updated_at
settings           key, value JSON            (theme, models map, debug flag)
```
\* Profile fields (skills, constraints, ICP, pricing hypothesis, …) live in JSON, not 25 columns: they change shape often and are read as a blob. Field-level history is captured in `memory_events`. Stage/name/objective are real columns because they're queried and gated.

Note: a startup can exist in `exploring` status with no serious idea yet (spec #36/#37); ideas live as `memory_items` with `startup_id = NULL` until one is promoted.

### Conversations
```
conversations      id, owner_id, startup_id?, title, summary (rolling), summary_upto_msg,
                   created_at, updated_at, archived
messages           id, conversation_id, role(user|assistant|tool), content,
                   metadata JSON (trace_id, refs used, tool call summaries), created_at
```
Transcripts are immutable history. Memory items point *at* messages; they never replace them.

### Memory items (one table, many kinds)
```
memory_items
  id, owner_id, startup_id?
  kind         decision | assumption | question | idea | insight | research | note
  title        short statement ("College students struggle with X")
  body         longer text / reasoning
  status       kind-specific lifecycle (see below)
  confidence   low | medium | high        (assumptions, insights, research)
  importance   1–5
  data         JSON, kind-specific fields (below)
  origin       conversation | research | manual | import
  origin_ref   conversation_id/message_id | source_id | null
  created_by   user | agent
  supersedes_id?   (decisions replaced, assumptions restated)
  created_at, updated_at, deleted_at?   (soft delete → undo; hard delete on request)
```
Status vocab by kind (validated in code):
- assumption: `untested | testing | supported | validated | weakened | rejected`
- decision: `proposed | active | superseded | reversed`
- question: `open | answered | dropped`
- idea: `raw | exploring | promoted | discarded`
- insight / research / note: `active | archived`

`data` JSON per kind: decision → `{reasoning, alternatives[], decided_at}`; assumption → `{category}`; question → `{reason, method}`; idea → `{problem, customer, solution}`; insight → `{segment, observation_count}`; research → `{implication, researched_at}`.

### Evidence & links
```
evidence           id, item_id → memory_items (assumption/experiment target),
                   stance(supports|weakens|neutral), strength(anecdotal|moderate|strong),
                   excerpt, origin(conversation|source|manual), origin_ref, created_at
links              from_type, from_id, to_type, to_id, relation(based_on|blocks|belongs_to|derived_from)
```
`evidence` is its own table (not a link) because it carries stance/strength/excerpt — the core of fact-vs-assumption. `links` is a generic cheap edge table (decision *based_on* assumption, task *belongs_to* objective).

**Code-enforced rule:** an assumption can only move to `supported`/`validated` if it has linked evidence rows meeting a threshold; the model may *propose* the transition, not perform it.

### Work
```
objectives         id, startup_id, title, description, success_criteria, status, created_at
tasks              id, startup_id, objective_id?, title, description, category, priority,
                   status(todo|doing|blocked|done|dropped), due_date?, created_by, origin_ref
task_deps          task_id, depends_on_task_id
experiments        id, startup_id, hypothesis_item_id (assumption), method, status,
                   start_date, result, conclusion, next_action, created_at
```
Experiment "evidence" = rows in `evidence` targeting the experiment's assumption.

### Research
```
sources            id, url, title, publisher, fetched_at, content_hash, excerpt/text (capped), 
                   ok(bool)
research_sources   item_id → memory_items(kind=research), source_id, quote     (many-to-many)
competitors        id, startup_id, company, product, target_customer, value_prop, pricing,
                   business_model, strengths, weaknesses, differentiation,
                   source_ids JSON, last_researched
```
Competitors are a table (not items) because you'll compare them across fixed columns. Each factual field should be backed by a source id.

### Brief, proposals, audit, trace
```
startup_briefs     id, startup_id, version, content_md, source_item_ids JSON, generated_at
proposals          id, target_type, target_id?, change JSON, rationale, kind(strategic|routine),
                   status(pending|accepted|rejected), origin_ref, created_at, decided_at
memory_events      id, entity_type, entity_id, action(create|update|delete|restore), before JSON,
                   after JSON, actor(user|agent), reason, origin_ref, at
agent_traces       id, conversation_id, message_id, mode, context_items JSON, tools JSON,
                   proposals JSON, tokens_in, tokens_out, latency_ms, model, at
approvals          id, tool, args JSON, status, requested_at, decided_at        (external actions)
```
Search: FTS5 virtual tables over `messages`, `memory_items(title, body)`, `sources`, kept in sync by triggers.

**Deliberately not tables:** `Memory` (that's `memory_items` + `memory_events`), `Founder facts` (JSON profile), `ResearchSource` split beyond `sources`, separate `Idea/Question/CustomerInsight/Decision/Assumption` tables.

---

## E. Memory Architecture

- **Conversation storage.** Full transcripts in `messages`, immutable. FTS-searchable. Never bulk-injected; used for rolling summaries and "where were we" retrieval.
- **Extraction.** After each assistant turn, an async pass with a cheaper model reads *the last exchange + the items retrieved that turn* and returns zod-validated **candidates**: `create | update | add_evidence | link | status_change`, each with kind, text, rationale, and quoted source span. Runs off the response path; UI shows "Updating memory…" subtly and the result as a small reference chip.
- **Structured memory.** Candidates go through `policy`:
  - **Auto-apply (low-risk):** new ideas, open questions, `untested` low-confidence assumptions, new insights (attributed as claim/observation), tasks (internal), research notes with sources, contextual profile details (skills, preferences), evidence added to existing items.
  - **Needs confirmation (`proposals`, strategic):** change of stage, target customer/ICP, core problem, business model, current objective; validating/rejecting a *major* assumption (importance ≥4); superseding an active decision; anything that alters the brief's headline fields; deletes of important items.
  - Conflicts (candidate contradicts an existing item) are surfaced as a proposal that shows both.
- **Startup brief.** Generated document (≤ ~1,500 words) from structured state, not from chat. Regenerated when strategic fields change or after N material memory changes (debounced), versioned. Generation prompt is constrained: assumptions appear under "Assumed (untested)" with confidence; only `validated`/evidence-backed items appear as findings; each line carries item ids for traceability. Facts and assumptions are visually distinct in the text (e.g. "Assumed: …" vs "Evidence shows: …").
- **Retrieval.** Recipes + FTS5 + recency/importance ranking (F). Semantic hook: `retrieve(query, opts)` returns ranked items behind an interface so an embeddings backend can slot in later.
- **Editing.** Memory UI lets you edit any item's text/status/confidence; edits write a `memory_events` row with `actor=user`. User edits win over agent edits and are marked so extraction doesn't "correct" them back.
- **Deletion.** Soft-delete by default (restorable, hidden from retrieval); "Delete permanently" hard-deletes and scrubs FTS + events. Deleting an item referenced by decisions warns you. Agent can only *propose* deletes.
- **Provenance.** Every item: `origin`, `origin_ref` (conversation+message id or source id), `created_by`, plus the event history. UI shows "Saved from *MVP Discussion* on Mar 3 — why: …". Clicking jumps to the source message/URL.
- **Confidence.** Coarse (low/med/high) on purpose. Confidence is derived-ish: agent proposes, code caps it by evidence (no evidence ⇒ can't exceed low; validated requires threshold).
- **Fact vs assumption.** The extraction schema has no way to emit "fact from user statement." User claims map to `assumption` (or `insight` if they report a specific customer observation, with the source noted as founder-reported). Only `evidence` rows tied to interview notes, research sources, or measured results can raise status. The system prompt reinforces this, but the schema and status-transition rules are what actually guarantee it.
- **Strategic-change confirmation.** Proposals appear as a quiet inline card in chat ("Update target customer to X? Because… [Accept] [Edit] [Reject]") and in a Memory inbox. Nothing strategic changes until accepted.

---

## F. Context Architecture — what happens when you send a message

1. **Receive** (`POST /api/chat`): validate with zod, check Origin, persist the user message, open SSE stream. Emit `status: Reviewing startup context…`.
2. **Classify** (fast model, structured output, or skipped by rule for short follow-ups): returns `{mode, needs: [kinds], keywords[], needsResearch, isOnboarding}`. Mode is one of DISCOVER/RESEARCH/STRATEGY/VALIDATE/PRODUCT/BUILD/GROW/REVIEW. If no startup exists → onboarding/discovery path.
3. **Load fixed context:** Startup Brief (or founder profile + "no startup yet" note), current stage/objective, recommended next action (if fresh).
4. **Load conversation context:** last ~12 messages (token-capped) + rolling summary of older turns in this conversation.
5. **Retrieve** by mode recipe (deterministic queries), plus FTS5 on message keywords, ranked by `relevance × importance × recency`, capped per kind and total (~3k tokens target). Examples:
   - *"What should I work on tonight?"* → objective, active/blocked tasks, open high-importance assumptions, active experiments, recent decisions.
   - *"What did we learn about competitor pricing?"* → competitors (pricing fields), research items matching pricing, linked sources.
   - *"Where were we?"* → last conversation summary, recent memory events, in-progress tasks.
6. **Assemble prompt:** system prompt (persona: candid cofounder, epistemic rules, tone) + mode fragment + context block where each item is rendered with an id, kind, status, confidence ("`[a:42] ASSUMPTION (untested, low)`") + history + user message. Log token counts per section.
7. **Model/tool loop** (chat model, streamed): the model may call `search_memory`, `task_manager`, `web_research` etc. Each call passes through the registry/policy, is logged, and emits an activity status. The model cites items as `[a:42]`, which the UI renders as clickable references (progressive disclosure).
8. **Persist the assistant message** with metadata (trace id, referenced items).
9. **Post-turn (async):** extraction → policy → auto-apply or create proposals → write `memory_events` → update FTS → maybe enqueue brief regen and conversation title/summary updates → emit `memory_updated` event to the UI.
10. **Trace:** write `agent_traces` (context ids, tools, proposals, tokens, latency).

Failure behavior: classifier fails → default to STRATEGY recipe. Retrieval fails → answer with brief + recents and say so in the trace. Extraction fails → message is still saved; retry later; never blocks chat.

Cost/latency notes: classifier and extractor use the small model; prompt caching on the stable prefix (system prompt + brief) if the provider supports it.

---

## G. AI Provider Architecture

```ts
interface AIProvider {
  stream(req: ChatRequest): AsyncIterable<ChatEvent>;   // text_delta | tool_call | usage | stop
  complete(req: ChatRequest): Promise<ChatResult>;      // non-streaming convenience
  structured<T>(req: ChatRequest, schema: ZodSchema<T>): Promise<T>;
}
type ChatRequest = { model: string; system: string; messages: Msg[]; tools?: ToolDef[]; maxTokens: number; cacheHint?: … }
```
**Abstract (normalize):** message format, tool definitions (JSON Schema), tool-call/result events, streaming events, token usage, structured output (implemented per-provider via forced tool call or JSON mode), errors mapped to a small set (`rate_limited | unavailable | auth | bad_request | context_too_long`).

**Do NOT abstract:** prompt-caching mechanics (optional opaque `cacheHint`, ignored by providers without it), extended thinking, provider-hosted server tools (e.g., built-in web search), batch APIs, files APIs, safety settings. If we want one, it's used behind a specific service (e.g., research), not through the generic interface.

**Model roles:** `models.ts` maps `chat | classify | extract | summarize | research | brief` → `{provider, model}`, editable in settings/env. Swapping a role = config change. Application code imports `services/ai`, never the SDK. The tool loop lives in `agent/`, not the provider, so it works identically across providers. When implementing, I'll confirm current Anthropic model IDs/params from docs at that time.

---

## H. Agent Tool Architecture

```ts
type Tool<A, R> = {
  name: string;
  description: string;              // shown to model
  input: ZodSchema<A>;              // → JSON Schema for the provider
  risk: 'read' | 'write_internal' | 'external';
  execute(args: A, ctx: ToolContext): Promise<ToolResult<R>>;
  // ToolResult: { ok, summary (for model), data?, refs?: ItemRef[], error? }
};
```
- **Register:** `registry.register(tool)`; the agent asks `registry.forMode(mode)` for the tools exposed that turn (keeps the prompt small and the model focused).
- **Describe:** name + description + zod schema → provider tool defs.
- **Args:** validated with zod before execution; invalid args return a structured error to the model for one self-correction.
- **Results:** compact `summary` (what the model sees) separated from `data`/`refs` (what the UI and trace use).
- **Approval:** the executor checks `risk`. `read` and `write_internal` run immediately. `external` never executes inline: it writes an `approvals` row, returns "pending approval" to the model, and the UI shows an approve/deny card. On approval the action runs and the result is appended. No external tools exist in V1, but the gate does, so adding email later is additive.
- **Logging:** every call → `agent_traces.tools` (name, args hash/redacted, duration, ok, result size). Secrets never enter args or logs.

**V1 tools (only these):** `search_memory`, `task_manager` (create/update/list, internal), `web_research` (I), `get_startup_state`. Memory writing is the post-turn extraction pipeline rather than a free-form model tool, to keep writes policy-controlled. Deferred: DocumentReader/Creator, ExperimentTracker (initially UI/extraction-driven), GitHub, Email, Calendar, etc.

---

## I. Research Architecture

Simplest reliable design: **the model never states a sourced claim from memory; findings must reference sources we actually fetched.**

1. **Search backend interface** `search(query) → [{title, url, snippet}]`. V1 implementation: one search API (Brave/Tavily-style, or Anthropic's hosted web search if we accept the provider-specific trade-off) behind a `SearchBackend` interface. **[DECISION]**
2. **Fetch:** server-side fetch of top N pages, readability-extract to text, cap size, store in `sources` with URL, title, date, content hash. SSRF protection (block private/loopback IPs, limit redirects, timeouts). Fetched text is *data*, wrapped and marked untrusted in the prompt (prompt-injection defense).
3. **Synthesize:** research model call receives only the stored source texts (with ids) and must output structured findings: `{finding, source_id, quote, implication, confidence}`.
4. **Validate in code:** each finding must cite an existing `source_id` and the `quote` must appear in that source's text (fuzzy match). Failures are dropped or flagged "unverified." Numbers/statistics without a matching quote are rejected. This is the anti-fabrication mechanism.
5. **Store:** findings → `memory_items(kind=research)` + `research_sources`; competitor findings → `competitors` rows with per-field source ids; `researched_at` on all.
6. **Becoming knowledge:** a finding is *evidence*, not truth. It can be attached to an assumption (`evidence` row, stance, strength), which may then propose a status change (subject to policy). Single-source claims are `low`/`medium` confidence; multiple independent sources raise it. The brief cites research by item id.
7. **Chat display:** answers show inline citations linking to the source; clicking opens the context panel with URL, date, quote.

Fallbacks: search/fetch failure → tell the user plainly, offer to proceed from existing memory clearly labelled as unresearched.

---

## J. UI Architecture

- **Sidebar (left, collapsible):** New Chat, Search (FTS across conversations + memory), grouped recent conversations (Today / Previous), then Startup / Memory / Research / Tasks / Decisions, then Settings. Quiet, text-first items, no icons except where they add clarity.
- **Conversation (center):** document-style column (~720px max), no large bubbles: user messages as subtle right-aligned or lightly tinted blocks, assistant as plain prose with markdown (sanitized, no raw HTML). Streaming text, subtle activity line ("Reviewing startup context…"), inline **references** (`MemoryReference`, `ResearchReference`, `TaskReference`) that open the context panel. Proposal cards render inline.
- **Chat input:** anchored bottom, auto-growing, `Enter` send / `Shift+Enter` newline, single send control; attachment control hidden until the feature exists.
- **New chat:** wordmark-less heading "What are we working on?", the input, four quiet text suggestions. Nothing else.
- **Startup view:** stage, objective, recommended next action, the brief (readable document), editable profile sections. Founder profile editing lives here or in Settings → "You". Deliberately reads like a document, not a dashboard.
- **Memory view:** one list with kind filter tabs (Decisions, Assumptions, Questions, Ideas, Insights) + search + "Proposals" inbox. Row → detail sheet: text, status, confidence, evidence, provenance ("why saved"), edit/delete, history.
- **Research view:** research items and sources, grouped by topic; competitor table.
- **Tasks:** simple grouped list (Now / Next / Blocked / Done) with objective label; create/edit inline.
- **Settings:** theme, model roles, debug mode, data export/delete.
- **Context panel (right, hidden by default):** slides in when a reference is clicked; shows objective, source, decision, assumption+evidence, task, insight. One component that renders by item kind.
- **Debug drawer (dev flag):** last turn's context items, tools, proposals, tokens.
- **Mobile:** desktop-first, but layout uses a responsive shell (sidebar → drawer, context panel → sheet under a breakpoint), flexible units, min touch targets; no desktop-only assumptions in components.

---

## K. Apple-Inspired Design System (original)

Tokens as CSS variables in `styles/tokens.css`, surfaced through Tailwind theme so components never hard-code values.

- **Spacing:** 4px base — 0, 4, 8, 12, 16, 24, 32, 48, 64, 96. Chat column padding generous (≥ 24).
- **Typography:** `-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", Inter, system-ui, sans-serif` (nothing bundled except optionally self-hosted Inter as fallback). Scale: 12 / 13 / 15 (body) / 17 (chat prose) / 22 / 28 / 34. Weights 400/500/600. Line-height 1.5 body, 1.2 headings, slight negative tracking on large sizes. Hierarchy from size, weight, and whitespace, not boxes.
- **Radius:** 6 (chips), 10 (inputs/buttons), 14 (popovers/sheets), 20 (chat input container).
- **Light:** bg `#FAF9F7` (warm off-white), surface `#FFFFFF`, elevated surface `#FFFFFF` + shadow, text `#1D1D1F`-ish near-black, secondary `#6B6B70`, border `rgba(0,0,0,.08)`.
- **Dark:** bg `#0E0E10`, surface `#161618`, elevated `#1E1E21`, text `#F2F2F3`, secondary `#8E8E93`, border `rgba(255,255,255,.08)`.
- **Accent (single):** a restrained muted blue-slate (e.g. `#3B6FB6` light / `#7AA2E0` dark), exposed as `--accent` so it's configurable later. Used only for focus rings, primary action, links, selected state.
- **Shadows:** three levels, very soft and low-opacity (e.g. `0 1px 2px rgba(0,0,0,.04)`, `0 4px 16px rgba(0,0,0,.06)`, `0 12px 40px rgba(0,0,0,.10)`); dark mode relies more on surface tone than shadow.
- **Surfaces:** flat page, one step up for sidebar/inputs, popovers highest. Borders only where separation is otherwise unclear.
- **Motion:** durations 120 / 200 / 320ms; easing `cubic-bezier(0.2, 0.8, 0.2, 1)`; used for sidebar collapse, panel slide, popovers, message fade-in (opacity + 4px translate), hover states. `prefers-reduced-motion` disables non-essential motion.
- **Component philosophy:** few, composable, headless-behavior + token-styled. Variants via a tiny helper (e.g. `cva`) only if it stays small. Each component has hover/focus/disabled states from day one; focus rings always visible for keyboard users. No proprietary Apple assets, icons, or fonts; simple icon set (Lucide) used sparingly.

---

## L. Security

**Must-do now**
- API keys only in server env (`.env.local`, gitignored); never in client bundles or logs; `server-only` import guard on provider code.
- Bind dev server to localhost; **Origin/Host checks on mutating routes** (protects a local app from other websites in your browser / DNS rebinding).
- Validate every route input with zod; parameterized queries only (ORM/prepared statements).
- Sanitize rendered markdown (no raw HTML, safe links).
- Treat fetched web content and uploaded text as untrusted data; delimit it in prompts; tools that mutate anything sensitive go through policy so injected text can't cause consequential actions.
- SSRF guard in the fetch tool.
- Don't log prompts/responses/secrets by default (trace stores ids and counts; content logging behind explicit debug flag).
- DB file and exports gitignored; `owner_id` on all rows; auth-ready request context (`getCurrentUser()` returns the local user now).
- Approval gate for `external` tools (present before any exist).

**Later**
- Real authentication (passkeys/OAuth) when hosted; per-integration OAuth scopes and token storage; encryption at rest / SQLCipher; backups and retention policy; rate limiting; audit UI for approvals; multi-user permissioning; dependency/secret scanning in CI.

---

## M. Implementation Milestones

Each is shippable and testable; I stop after each for your review.

**M0 — Foundation & design system.** Next.js/TS/Tailwind scaffold, tokens, light/dark, layout shell (sidebar + main), primitives (Button, Input, ChatInput, NavigationItem, Tooltip), lint/typecheck/test setup, `.env` handling.
*Accept:* app runs locally; theme toggle works with system default; shell looks right at desktop and narrow widths; typecheck+lint pass.

**M1 — Chat with persistence.** SQLite+Drizzle, `conversations/messages`, provider abstraction + Anthropic impl, streaming chat, sidebar with New Chat / recents / titles / search, missing-key and provider-error states.
*Accept:* talk to the model with streamed replies; close and reopen and conversations persist; auto-titles; search finds past messages; unplugged key shows a clear message; no key appears in client bundle.

**M2 — Founder & startup context.** `founder`, `startups`, profile editing UI, conversational discovery/onboarding prompt, stage + objective fields, manual Startup view, profile injected into context.
*Accept:* first-run conversation asks progressive discovery questions (not a form), populating founder profile (proposal-confirmed); edits are respected; agent's advice visibly reflects constraints.

**M3 — Structured memory & extraction.** `memory_items`, `evidence`, `memory_events`, `proposals`, extraction pipeline, policy (auto vs confirm), Memory view with edit/delete/provenance, inline proposal cards, reference chips + minimal context panel.
*Accept:* "I think students struggle with X" creates an *untested, low-confidence assumption*, never a fact; adding interview evidence updates it; strategic change produces a proposal not a silent write; deleting/editing works and is audited; eval set passes for fact-vs-assumption.

**M4 — Context builder, brief & next action.** Intent classifier, mode recipes, FTS retrieval, token budgets, rolling summaries, Startup Brief generation/versioning, Recommended Next Action, debug drawer, `agent_traces`.
*Accept:* "Where were we?" and "Why did we decide X?" answered correctly from memory across sessions; retrieval differs per question type; brief contains no unverified claims as fact; debug drawer shows retrieved items and token use; context stays within budget on a seeded large dataset.

**M5 — Tasks, objectives, decisions, experiments.** `tasks/objectives/experiments`, task tool, objective→assumptions→experiments→tasks planning from "we need to validate X", Tasks and Decisions views.
*Accept:* the validation-plan flow produces the structured output from spec §18 and stores it after your confirmation; "What should I work on tonight?" uses active tasks/blockers.

**M6 — Research.** Search backend, fetch, `sources`, cited findings with quote validation, competitors table, research view, citation UI.
*Accept:* competitor question yields findings with real URLs; a fabricated quote is rejected in tests; findings can be attached as evidence; failure states handled.

**M7 — Polish & control.** Settings (model roles, export/delete), `⌘N/⌘K/⌘\`, refined motion, brief/proposals inbox polish, error-handling pass, README/runbook.
*Accept:* full export works; keyboard basics work; reduced-motion respected; error scenarios (no key, provider down, DB error, research failure) show clear messages.

*Later:* documents/attachments, embeddings, command palette, integrations, accent configuration, multi-startup UI.

---

## N. Major Decisions (before coding)

1. **ORM.** Drizzle+better-sqlite3 · Prisma · raw SQL. *Drizzle:* typed, light, FTS5 via raw SQL, migrations. Prisma heavier, weak SQLite FTS5. Raw SQL: more boilerplate. **Rec: Drizzle + better-sqlite3.**
2. **Memory table shape.** One `memory_items` + typed tables for tasks/experiments/competitors/sources · a table per noun. Single table gives uniform search/provenance/edit UI and less code; costs some JSON typing. **Rec: hybrid as in D.**
3. **Memory write path.** Model-driven writes via tools mid-turn · post-turn extraction with policy. Post-turn is more controllable and testable, and keeps latency off the reply. **Rec: post-turn extraction (+ `create_task` tool).**
4. **Streaming transport.** SSE from a route handler · WebSockets · polling. SSE is simplest and sufficient. **Rec: SSE.**
5. **Search backend for research.** Anthropic hosted web search · third-party search API (Brave/Tavily) + own fetch. Hosted is quicker but couples research to one provider and gives less control over source storage/quote validation; separate API adds a key and code. **Rec: third-party search behind `SearchBackend`; decide the specific vendor at M6 (not needed now).**
6. **Agent loop.** Own loop · Vercel AI SDK · agent framework. Own loop is ~100 lines, transparent, provider-neutral. **Rec: own loop; revisit if it grows.**
7. **UI primitives.** Hand-built · Radix/React Aria headless + own styling. **Rec: headless primitives, own styles (accessibility for free, original look).**
8. **Search/retrieval.** FTS5 + recipes · embeddings now. **Rec: FTS5 + recipes; embedding interface stub only.**
9. **Testing.** Vitest for services/agent (with a fake provider) + a small eval script; Playwright smoke later. **Rec: as stated.**

Things that can safely wait: search vendor, accent color, exact model IDs, brief regen cadence, competitor UI, hosting/auth.

---

## O. Risks

| Risk | Why it matters | Mitigation |
|---|---|---|
| **Hallucinated / wrong memory** | Poisoned memory compounds | Candidates + policy, quoted source spans, provenance, easy edit/undo, audit log, proposals for strategic items |
| **Assumptions becoming "facts"** | Core trust failure | Schema can't emit facts from user statements; status transitions gated by evidence in code; brief format separates assumed vs evidenced; eval set |
| **Agent too agreeable** | Defeats the purpose | System prompt with explicit anti-sycophancy rules and examples; eval cases; "challenge" instruction tied to evidence gaps; review transcripts early |
| **Agent too contrarian / verbose** | Annoying, ignored | Concise-default guidance, cap recommendations at ~3, tune from real use |
| **Context overload / irrelevance** | Cost, latency, worse answers | Budgets per section, per-mode recipes, ranking, trace inspection, rolling summaries |
| **Research unreliability** | Fabricated stats | Source-only synthesis, quote validation in code, confidence caps for single source, "unresearched" labeling |
| **Prompt injection via web content** | Manipulated behavior | Untrusted-content delimiting, no external-risk tools in V1, policy gate, SSRF limits |
| **Memory extraction noise/volume** | Clutter erodes trust | Conservative extraction thresholds, dedupe against existing items, importance scoring, inbox triage |
| **UX complexity creep** | Becomes the thing you didn't want | Chat-first rule; new views must justify themselves against the design standard (#51) |
| **Cost & latency** | Multiple model calls per turn | Small models for classify/extract/summarize; async extraction; caching; skip classifier on follow-ups; token metrics in trace |
| **Provider dependence** | Lock-in | Provider interface + role→model config; keep provider-specific features out of core paths |
| **Data loss (single SQLite file)** | Company memory is valuable | WAL, export in V1, simple backup script, soft deletes |
| **Local app exposure** | Browser-based attacks on localhost | Origin/Host checks, localhost binding |


---

## Implementation status (as built)

All seven milestones are implemented. How the build differs from this plan:

| Plan | As built | Why |
|---|---|---|
| Post-turn extraction **plus** a `create_task` tool (M5) | Tasks, status updates and plans come from the post-turn extraction pipeline; no `create_task` tool | Simpler and testable; plans arrive as one card the founder accepts |
| Tool registry in M5 | Introduced in M6 with `web_research` and `search_memory` | Research is the first thing that genuinely needs an in-turn tool loop |
| Research search vendor decided at M6 | `SearchBackend` interface; Anthropic hosted search (default, no extra key) and Brave | Zero extra setup for the default; the interface keeps the choice open |
| Founder facts "proposal-confirmed" | Founder facts save automatically, visibly, with Undo; **startup/strategic changes** are proposals | Low-risk personal facts vs company direction |
| Memory items table including research | `research` is a kind in `memory_items`; sources and competitors in their own tables | As planned in D, with `research_sources` linking findings to quotes |
| Agent modes internal only | Classifier picks the mode per message; shown only in the debug trace | As planned |
| `⌘N` new chat | `⌘⇧O`, plus a command menu on `⌘K` | Browsers reserve ⌘N |
| Embeddings | Not built; FTS5 keyword search plus per-mode recipes | As planned; revisit when volume demands |
| Approvals UI | The gate and `approvals` table exist; no UI | No external-risk tool exists yet |

Additions beyond the plan: evals (`npm run eval`) for the fact-vs-assumption, routing, brief-honesty, task, plan and research rules; per-reply traces; a trash with restore and erase; accent presets; `npm run backup`.

Not built, by decision: multi-agent orchestration, customer-facing AI, integrations (email, calendar, GitHub), billing, auth, mobile-specific UI. See section "Do NOT build yet" of the original spec.
