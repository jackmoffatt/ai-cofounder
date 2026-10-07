# Running your AI Co-Founder

A private, single-user app. You open it, talk, and it already knows your startup. Everything runs on your machine; the only thing that leaves it is what each message needs to reach the AI provider (and, for research, search queries and the pages it reads).

## 1. Set up (about 5 minutes)

You need **Node.js 22 or newer** and an **Anthropic API key**.

```bash
npm install
cp .env.example .env.local        # then open .env.local and paste your key after ANTHROPIC_API_KEY=
npm run dev                       # open http://127.0.0.1:3000
```

On first run the empty chat tells you if the key is missing. **Settings → Status** shows what is configured (it never shows the key itself), and **Settings → Models → Test** makes one tiny request to confirm the key and model work.

For everyday use, a production build is faster and steadier than dev mode:

```bash
npm run build && npm start        # http://127.0.0.1:3000
```

The server binds to `127.0.0.1` only. Don't expose it to a network: there is no login.

## 2. Using it

Just talk. Start with who you are and what you're curious about; there's no form. As you talk, it:

- **Remembers** what you say about yourself, and records your beliefs about the startup as *assumptions* (untested, low confidence) rather than facts. Each saved item appears under the reply with **Undo**. Nothing changes your company's direction without you clicking **Accept**.
- **Plans**: ask "we need to validate X" and you get a plan with a card that creates the objective, experiments and tasks when you accept it.
- **Researches** when a question needs outside facts. Findings are only kept if their quote is really on the page, and they show their sources. Research is sourced, not validated: you decide whether it counts as evidence.
- **Keeps a brief** (Startup page) and a recommended next action, rewritten as things change.

**Tabs.** Each conversation is a tab under the top bar, like browser tabs: switch instantly, and a tab keeps its draft, scroll position and any reply still streaming. Your open tabs come back after a reload. A new tab shows your most recent conversations, and ⌘K finds older ones.

**Top bar.** **Chat**, **Tasks**, **Memory**, then ⌘K. The **⋯** menu has **Startup** (company, you, brief), **Research**, **Decisions** and **Settings**.

### Keyboard

| | Mac | Windows / Linux |
|---|---|---|
| Command menu (search, switch tabs, jump anywhere) | ⌘K | Ctrl+K |
| New tab | ⌘⇧O | Ctrl+Shift+O |
| Close tab | ⌥W | Alt+W |
| Next / previous tab | ⌥] / ⌥[ | Alt+] / Alt+[ |
| Jump to tab 1–9 | ⌥1–9 | Alt+1–9 |
| Developer mode (a **Trace** link under each reply) | ⌘⇧D | Ctrl+Shift+D |
| Close a panel or menu | Esc | Esc |

(Browsers reserve ⌘N/⌘T/⌘W and Ctrl+N/T/W, so tabs use ⇧O and Alt chords. A desktop build can use the usual ones.)

## 3. Your data

Everything is in one SQLite file: `data/app.db` (override with `DATABASE_PATH`). It is gitignored.

| I want to… | Do this |
|---|---|
| See what it stores | **Memory**, **Tasks**, **Research** pages; every item shows where it came from and its history |
| Export everything | **Settings → Your data → Export** (one JSON file, includes things you deleted but haven't erased) |
| Back up the database | `npm run backup` (safe while the app runs) → `data/backups/` |
| Get back something I deleted | **Settings → Your data → Recently deleted → Restore** |
| Erase one thing for good | Same list → **Erase** (removes it and its history) |
| Wipe everything | **Settings → Your data → Delete all my data** (asks you to type DELETE; settings are kept) |

To start over by hand, stop the app and delete `data/app.db*`.

## 4. Choosing models and cost

Defaults: conversation `claude-opus-5-5`; routing, extraction, titles, summaries and search `claude-haiku-4-5`; brief, plans and research findings `claude-sonnet-5-5`. Change any of them in **Settings → Models** (or with `AI_MODEL_<ROLE>` in `.env.local`; the setting wins).

A normal message makes about four calls: routing and memory extraction (small model), the reply, and sometimes a summary. A plan adds one structuring call; research adds one search per query and one extraction call. The conversation model is the main cost, so switching it to `claude-sonnet-5-5` is the biggest lever.

Research uses Anthropic's hosted web search by default (no extra key). To use Brave instead, set `SEARCH_BACKEND=brave` and `BRAVE_API_KEY`.

## 5. Developing

```bash
npm test               # unit tests (no network, no key needed)
npm run typecheck && npm run lint
npm run eval           # behaviour checks against a real model; costs a few cents; needs your key
npm run backup
```

Offline development with no key and no network: `AI_PROVIDER=fake RESEARCH_FAKE=1 npm run dev` (scripted replies and fixture web pages).

Layout: `src/agent` (the co-founder: context, retrieval, extraction, loop), `src/services` (memory, research, work, brief, AI providers), `src/tools` (tool registry), `src/db` (schema, migrations, queries), `src/components` and `src/app` (UI). `docs/ARCHITECTURE_PLAN.md` has the design and the reasoning.

Migrations run automatically when the app starts. To change the schema: edit `src/db/schema.ts`, run `npx drizzle-kit generate --name=<what>`, commit the new file in `src/db/migrations`.

## 6. Security notes

- Your API key lives only in `.env.local` (gitignored) and is read on the server. It is never sent to the browser, stored in the database, logged, or included in exports.
- Every state-changing request is checked so another website open in your browser can't drive the app, and the app only answers to `localhost` / `127.0.0.1` host names, which also blocks DNS-rebinding attacks (a hostile site pointing its own domain at your machine). If you reach it by another name (a tailnet or LAN hostname), add it with `ALLOWED_HOSTS=name1,name2` in `.env.local`. Open it at `http://127.0.0.1:3000`.
- Web research only fetches public http(s) pages: private, loopback and cloud-metadata addresses are refused on every connection and redirect, and size and time are capped. Fetched text is treated as untrusted data.
- The AI can't take consequential actions on its own: anything that would affect the outside world is queued for your approval (no such tool exists yet).
- There is no login. Run it on a computer you trust, as yourself.

## 7. Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| "Add your ANTHROPIC_API_KEY…" on the empty chat | Put the key in `.env.local` and **restart** the server (env is read at startup) |
| "The AI provider rejected the API key" | Wrong or revoked key; check it at console.anthropic.com |
| "rate limiting" / "unavailable" | Provider-side; wait a moment and press Try again |
| A model test fails with "rejected the request" | The model ID is wrong or not available to your key. **Settings → Models → Reset** |
| "Research didn't work" | **Settings → Status** shows whether search is configured; with a proxy-only network the page fetcher can't connect (it doesn't use proxies, by design) |
| Page shows "Something went wrong" | See the terminal running the server. Most often the database file is locked or unreadable: close other copies of the app, check permissions on `data/`, or restore from `data/backups/` |
| Replies seem to forget things | **Settings → Developer mode**, then **Trace** under a reply shows exactly what context it had |
| Changed `.env.local` and nothing happened | Restart the server |

## 8. Note about this repository

This repo's `README.md` is your GitHub profile page, and the app currently lives beside it. If you'd like the profile repo kept clean, move everything except `README.md` into a new repository (the app has no dependency on its location).
