# llm-bench UI/UX Review

**Reviewer:** Senior UX/UI design pass
**Date:** 2026-05-02
**Scope:** `src/App.tsx`, `src/components/Sidebar.tsx`, `src/pages/*`, `src/styles.css`, `tailwind.config.js`
**Reference points:** Ollama desktop, Claude Code CLI, Linear, Vercel, Raycast

The skeleton is solid: information density is good, the zinc-on-near-black palette is restful, the chat surface already does the right things (status pill, per-response stats, history drawer, gen-config drawer). What follows is a targeted punch list. Most items are 5–30 minutes of work each.

Priority legend: **HIGH** = broken/confusing, **MEDIUM** = significant polish, **LOW** = nice-to-have.

---

## Global (cross-cutting)

### G1. Body text contrast on `text-zinc-500` and `text-zinc-600` likely fails WCAG AA — HIGH
**Where:** Used pervasively. Examples: `Sidebar.tsx:16` (`text-zinc-500` on `bg-zinc-950`), `Sidebar.tsx:34` ("soon" badge `text-zinc-500`), `Chat.tsx:472,475` (history subtitle `text-zinc-500/600` at 10px), `Chat.tsx:601` slider hint `text-zinc-600` on `bg-zinc-950`, `Models.tsx:139` modality chip `text-zinc-600` at 10px, `Evals.tsx:44` "planned" badge.
**Issue:** zinc-500 (#71717a) on zinc-950 (#09090b) is roughly 4.0:1 — under the 4.5:1 AA threshold for normal text. zinc-600 on zinc-950 is ~2.8:1 and fails outright. Anything 10–11px in zinc-500/600 is actively hard to read.
**Recommendation:** Define two semantic tokens — `text-secondary` = zinc-400 (~7.0:1) for hint/secondary copy, `text-tertiary` = zinc-500 reserved for non-essential timestamps only. Replace all `text-zinc-500` body copy with zinc-400 and all `text-zinc-600` body copy with zinc-500. Reserve zinc-600 strictly for borders/dividers, never text.

### G2. No design tokens — colors and sizes are open-coded everywhere — MEDIUM
**Where:** Tailwind classes inlined throughout. `tailwind.config.js:5-17` only extends `fontFamily`.
**Issue:** Border colors (`border-zinc-800`), surface colors (`bg-zinc-900`, `bg-zinc-950`), and hover states (`hover:border-zinc-600`, `hover:border-zinc-500`) are inconsistent. Buttons in Models.tsx use `border-zinc-700`; buttons in Chat.tsx use `border-zinc-800`. Same role, different value.
**Recommendation:** Add semantic tokens to `tailwind.config.js` under `theme.extend.colors` — e.g. `surface: { 0: zinc-950, 1: zinc-900, 2: zinc-800 }`, `border: { default: zinc-800, hover: zinc-600, strong: zinc-700 }`, `accent: zinc-100`. Then refactor incrementally. At minimum, pick one hover-border value and use it everywhere.

### G3. No system font / monospace stack tuned for native macOS feel — MEDIUM
**Where:** `styles.css:13-23` sets a generic `-apple-system, BlinkMacSystemFont, …` stack but no `system-ui`, no SF Pro Text/Display fallback hinting, and no fluid font scaling.
**Issue:** Looks fine on macOS, but the stats footer and gen-opts labels (`font-mono` at 10–12px) don't render crisply because zinc-200 + ui-monospace + 10px hits a sweet spot only on macOS Retina. On Linux/Windows builds expect this to look thin.
**Recommendation:** Add `system-ui` first, ensure `font-feature-settings: "ss01", "cv11";` on body for SF tabular numerals and consider raising the smallest text size from 10px to 11px (`text-[11px]` instead of `text-[10px]`). Add `font-variant-numeric: tabular-nums` globally to `body` so all numeric stats line up without per-span `tabular-nums`.

### G4. No keyboard shortcuts beyond Enter-to-send — HIGH
**Where:** `Chat.tsx:343-348` only.
**Issue:** Linear/Raycast/Vercel-class apps live and die by Cmd-K. Right now there is no global shortcut surface: no Cmd-K palette, no Cmd-N for new chat, no Cmd-1..5 to jump between sidebar pages, no Cmd-Enter alternative for send, no Esc to close drawers/dialogs.
**Recommendation:** Add a global `useKeyboardShortcuts` hook in `src/lib/`. Minimum set:
- `Cmd/Ctrl+N`: new chat (also reset to Chat page)
- `Cmd/Ctrl+1..5`: jump to sidebar items
- `Cmd/Ctrl+,`: toggle Generation drawer on Chat
- `Cmd/Ctrl+H`: toggle History drawer
- `Esc`: close any open drawer/dialog (currently the import dialog also lacks this — `Models.tsx:200-208`)
- `Cmd/Ctrl+K`: stub a command palette now (even if it's only a blank modal); registering the binding signals "this app is keyboard-first".
Display shortcuts in tooltips (e.g. `title="History (⌘H)"`) and in the sidebar nav (small grey `⌘1` on the right).

### G5. Native `alert()` and `confirm()` for non-trivial flows — MEDIUM
**Where:** `Chat.tsx:234,240,246`; `Models.tsx:69,77,81,87`.
**Issue:** Tauri/Electron apps lose their custom-app feel the second a stock Chrome modal appears. Especially jarring against the dark zinc theme.
**Recommendation:** Build one `Toast`/`Dialog` primitive (or pull in `sonner` or radix-ui Dialog/Alert). Replace error `alert(...)` with non-blocking toasts; replace `confirm(...)` with a styled Dialog matching the existing Import dialog (`Models.tsx:346-444`).

### G6. No app-level error boundary or empty/error fallback for failed IPC — MEDIUM
**Where:** `Chat.tsx:90`, `Chat.tsx:98`, `Models.tsx:34` all use `.catch(() => {})` or `.catch(() => setModels([]))`. The user sees the empty state but never knows the IPC failed.
**Recommendation:** Surface an inline banner ("Couldn't reach the runtime — is the daemon running?") when `listModels()` rejects vs returns `[]`. Distinguish "no models installed" from "IPC error" — they need different recovery paths.

### G7. No focus ring styling — MEDIUM
**Where:** All buttons use `focus:outline-none` only on the textarea (`Chat.tsx:338`); the rest rely on the browser default, which is invisible-ish on dark zinc.
**Issue:** Tab-navigating the app is nearly impossible to follow visually.
**Recommendation:** Add a global `*:focus-visible { outline: 2px solid theme(colors.zinc.300); outline-offset: 2px; border-radius: inherit; }` rule, or add `focus-visible:ring-2 focus-visible:ring-zinc-300` to a shared button utility. Linear/Raycast use a 1px outline + 2px offset to keep it crisp.

### G8. Inconsistent capitalization on labels — LOW
**Where:** Sidebar uses Title Case ("Chat", "Models"). Status pill uses lowercase ("loading model", "thinking"). Drawer labels mix ("Chat history", "Generation"). Buttons mix ("+ New chat", "+ Import model", "delete · 4.5 GB", "▶ resume").
**Recommendation:** Pick one. Linear/Vercel use Sentence case for actions and labels; Raycast uses Title Case for nav, lowercase for log-style text. Suggested rule: **Sentence case for all UI labels and buttons; lowercase only for monospaced log/metric text** (status pill, stats footer, gen-opts param names).

### G9. No window-narrow behavior for sidebar / drawers — MEDIUM
**Where:** `App.tsx:11-13` is `flex h-screen w-screen overflow-hidden`. Sidebar is fixed `w-56` (`Sidebar.tsx:13`); chat right drawer is fixed `w-72` (`Chat.tsx:369`).
**Issue:** At ~900px window width with both drawer + sidebar, the chat column is ~570px and bubbles get cramped. At < 700px the drawers and sidebar can overlap content.
**Recommendation:** (a) Make the sidebar collapsible (icon-only at < 900px, with a hamburger to expand). (b) Make the right drawer overlay-style on narrow windows (absolute-positioned, semi-transparent backdrop) instead of pushing content. (c) Consider `min-w-[640px]` on the chat column so the input never gets too narrow.

### G10. No app-wide loading skeleton — LOW
**Where:** First-paint of `ModelsPage` and `ChatPage` shows empty UI for a beat while `listModels()` resolves.
**Recommendation:** Render a 3-row skeleton in the Models table and a "Loading models…" placeholder above the chat header dropdowns for the first ~200ms.

### G11. Sidebar version string is a placeholder — LOW
**Where:** `Sidebar.tsx:16` — `v0.1.0 · skeleton`.
**Recommendation:** Read version from `package.json` via Vite env (`import.meta.env.VITE_APP_VERSION`); drop "skeleton". Add a tiny green/grey dot if backend connection is healthy (state-aware footer like Ollama).

### G12. Sidebar bottom footer is just a runtime label list, not actionable — LOW
**Where:** `Sidebar.tsx:41-43` — `llama.cpp · LiteRT-LM` (note: missing MLX).
**Issue:** This is wasted real estate, AND it's wrong (omits MLX which the rest of the app supports).
**Recommendation:** Either delete it, or replace with three small status pills (one per runtime) showing build availability — green = available, grey = not built — clickable to open Models filtered to that runtime.

---

## Sidebar (`src/components/Sidebar.tsx`)

### S1. "soon" badge is invisible — HIGH
**Where:** `Sidebar.tsx:34` — `text-[10px] uppercase tracking-wider text-zinc-500`.
**Issue:** zinc-500 on zinc-950 at 10px fails contrast (see G1) and doesn't visually distinguish enabled from disabled nav items. The user can click into Evals/Benchmarks/Compare and find pages — so the badge is the only signal that those are not real.
**Recommendation:** Style as a proper pill: `text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 uppercase tracking-wider`. Same idea as the status pill in Chat. Or use a colored dot.

### S2. NavLink active state is too subtle — MEDIUM
**Where:** `Sidebar.tsx:26-29` — active item gets `bg-zinc-800 text-zinc-100`; inactive items hover to `bg-zinc-900`.
**Issue:** zinc-800 vs zinc-900 is ~5% luminance difference. Hover-on-inactive feels almost identical to active. There's no left-edge indicator, no icon weight change, no font weight change.
**Recommendation:** Add a 2px left border-accent on active (`border-l-2 border-zinc-100 -ml-0.5`) OR bump active to `bg-zinc-800 font-medium` + leading icon. Also: add icons next to each label. Linear/Raycast/Vercel sidebars are unreadable scanning text-only — a chat-bubble icon, a download icon, etc., are more useful than the words.

### S3. No icons on nav items — MEDIUM
**Where:** `Sidebar.tsx:32` — `<span>{item.label}</span>` only.
**Recommendation:** Add `lucide-react` (already a common Tauri choice) and prepend a 14px icon: MessageSquare for Chat, Box for Models, BarChart for Evals, Activity for Benchmarks, Columns for Compare. Not necessary, but a 5-minute upgrade.

### S4. Sidebar not collapsible — MEDIUM
See **G9**. Specifically: clicking the `llm-bench` header could collapse the sidebar to 56px (icons only) and persist that in localStorage.

---

## Chat page (`src/pages/Chat.tsx`)

### C1. Model dropdown shows only `display_name`; no metadata at a glance — HIGH
**Where:** `Chat.tsx:255-266`.
**Issue:** Once a user has 5+ models, the dropdown is a flat list of names. No quant, no size, no MoE/dense tag. Users will pick the wrong one.
**Recommendation:** Either (a) render `display_name (quant, size GB)` in `<option>` text — cheap; or (b) replace `<select>` with a custom popover that shows model name + quant + arch chip + size on each row. Option (b) doubles as the foundation for a Cmd-K palette.

### C2. Runtime dropdown silently disables unsupported options — MEDIUM
**Where:** `Chat.tsx:268-283`.
**Issue:** `<option disabled>` items are present but indistinguishable in macOS native `<select>`. User selects model, opens runtime, sees three options, picks one, nothing happens. There's no inline reason ("LiteRT-LM build pending").
**Recommendation:** Filter unsupported runtimes out of the list entirely, OR append " (unavailable)" to the label. Even better: replace the runtime `<select>` with a 3-segment toggle showing all three runtimes, the supported ones clickable, the unsupported ones greyed with a tooltip explaining why ("No LiteRT-LM build for this 31B model").

### C3. Status pill placement is buried — MEDIUM
**Where:** `Chat.tsx:285` — sits between the runtime dropdown and the right-side icon button group.
**Issue:** Status (loading model / thinking / streaming / error) is the most important state on this page when something is happening. Right now it's in a busy header next to two dropdowns and three buttons.
**Recommendation:** Move the pill to the right of the model name or, even better, attach it to the assistant bubble (as a pill above or beside the spinner). Today, the bubble has its own pending dot (`Chat.tsx:732-745`) AND the pill duplicates the same info elsewhere — pick one location.

### C4. Icon-only buttons use unicode symbols, not real icons — HIGH
**Where:** `Chat.tsx:293,302` — `⏱` and `⚙`. Also `Models.tsx:255` `⏸`, `Models.tsx:174` `▶`, `Chat.tsx:484` `×`.
**Issue:** Unicode glyphs render inconsistently across OSes (Apple emoji on macOS, blocky on Windows, missing in some Linux fonts). Sizing and vertical alignment are off. They also don't match the visual density of zinc-on-zinc.
**Recommendation:** Adopt `lucide-react` and replace: ⏱ → `History`, ⚙ → `Settings2`, ⏸ → `Pause`, ▶ → `Play`, × → `X`. Sized to 14px. Fixes visual quality, accessibility (aria-label friendly), and platform consistency.

### C5. IconButton has only `title` attr, no `aria-label` — MEDIUM (accessibility)
**Where:** `Chat.tsx:410-425`. The `title` attribute provides hover tooltip but not screen-reader friendly.
**Recommendation:** Add `aria-label={label}` to the button. Also wrap the unicode children with `<span aria-hidden="true">` (or remove when switching to lucide) so SR users hear "History" not "stopwatch emoji history".

### C6. "+ New chat" button affordance is weak — LOW
**Where:** `Chat.tsx:304-309`.
**Issue:** It's text-only on a thin border, looks identical to other secondary buttons. New chat is a primary action.
**Recommendation:** Either elevate to a primary-style button (dark fill on hover) OR add a Plus icon and Cmd-N shortcut hint. Even a `bg-zinc-900 hover:bg-zinc-800` background would help separate it visually from the icon group.

### C7. Empty chat state is one bland line — HIGH (onboarding)
**Where:** `Chat.tsx:317-321` — "Pick a model and runtime, then send a message." centered in zinc-600.
**Issue:** First-run users with zero models see the same message. There's no path to Models, no example prompts, no explanation of what each runtime does. This is THE moment to onboard.
**Recommendation:** Branch on state:
- **No models installed:** show a card with "Welcome to llm-bench" headline + "You don't have any models yet" + a primary "Browse models" button linking to /models. Optionally show 3 suggested models as cards.
- **Models installed, no chat yet:** show 3–4 example prompt chips ("Explain quantization in one paragraph", "Write a Python script to…", "What can you do?") that pre-fill the textarea.
- **Active conversation, no messages yet:** keep the current copy but in zinc-400.

### C8. Pending/loading bubble uses italic-only text — LOW
**Where:** `Chat.tsx:732-745`.
**Issue:** A single pulsing dot + italic "thinking…" is fine but the dot + text are competing. When `loading_model` runs, the bubble may sit there for 30+ seconds (loading a 4GB GGUF) with no progress signal.
**Recommendation:** During `loading_model`, show a small thin progress bar in the bubble OR cycle the label ("loading model…" → "warming up…") with a subtle skeleton shimmer. At minimum, add an estimated-time hint on first model load.

### C9. User bubble and assistant bubble visual weight is mismatched — MEDIUM
**Where:** `Chat.tsx:649-655` (user, white-on-dark, rounded right) vs `Chat.tsx:658-691` (assistant, zinc-900, rounded left, with metadata above).
**Issue:** White bubbles on a near-black background pull the eye too hard for the *user's own* messages. Most chat apps keep user messages slightly less prominent than assistant content (which is what the user came here to read).
**Recommendation:** Soften user bubble to `bg-zinc-200 text-zinc-900` or `bg-zinc-800 text-zinc-100 border border-zinc-700`. Reserve full white for the primary CTA (Send button) only. This will also make screenshots/demos feel less harsh.

### C10. Model id chip duplicates info already in the header dropdown — LOW
**Where:** `Chat.tsx:663-667`.
**Issue:** When all bubbles share the same model and runtime, repeating the chip on every assistant bubble is noise. Useful only when the conversation has switched models (which today is hard to do mid-conversation).
**Recommendation:** Render the model/runtime chip only when (a) it's the *first* assistant bubble, or (b) it differs from the previous assistant bubble. Otherwise hide. Optional: show on hover-over instead.

### C11. Stats footer label keys are unlabeled monospace — MEDIUM
**Where:** `Chat.tsx:694-730`.
**Issue:** "ttft 220ms · prefill 81.4 tok/s · decode 24.1 tok/s · total 3.2s · out 124 tok" is dense and the keys (ttft, hw) are jargon. New users have no idea what these mean.
**Recommendation:** Add `title` tooltips to each `<span>` ("Time to first token", "Tokens per second during generation", etc.). Or add an info icon at the end of the row that opens a 1-screen explainer. Also consider only showing the most-impactful 2-3 metrics by default and a "more" toggle for the rest.

### C12. Chat input lacks send-on-Cmd-Enter and no character/token counter — LOW
**Where:** `Chat.tsx:337-349`. Only `Enter` (no shift) sends. Pressing Shift+Enter inserts a newline as expected.
**Recommendation:** Also accept `Cmd/Ctrl+Enter` to send (matches Slack/Discord/Linear convention). Optional: a tiny `xxx tok` estimate in the bottom-right of the textarea once you have a tokenizer estimate.

### C13. Disabled "+ image" button is permanent dead UI — LOW
**Where:** `Chat.tsx:330-336`.
**Issue:** Permanently disabled buttons signal "broken app" more than "future feature." They take screen real estate without delivering value.
**Recommendation:** Hide it entirely until v0.4, or move it into a small `+` menu next to send (which can also house future features like file attach, voice).

### C14. Send button hits multiple disabled states with no differentiation — LOW
**Where:** `Chat.tsx:351-362`.
**Issue:** Disabled-because-empty-input vs disabled-because-streaming feel identical. During streaming, users want a "Stop" button, not a greyed-out Send.
**Recommendation:** When `turnStatus` is `streaming` or `thinking`, swap the Send button label to "Stop" and wire it to a cancel-turn IPC (probably needs backend work too). At minimum, change the button copy/icon to communicate "in progress."

### C15. Drawer close button is text "close" not an X — LOW
**Where:** `Chat.tsx:374-379`.
**Recommendation:** Use an X icon (lucide `X`) with `aria-label="Close"`. Matches the dialog's "close" link in `Models.tsx:351-356`, both should be icon buttons.

### C16. Drawer width is fixed; no way to widen for long history titles — LOW
**Where:** `Chat.tsx:369` — `w-72` (288px).
**Issue:** Conversation titles truncate aggressively (`Chat.tsx:471` — `truncate`); subtitle truncates at `slice(0, 80)`. With a long title and a model id chip, very little fits.
**Recommendation:** Make the drawer resizable via a 4px drag handle on its left edge, or expose a width preference.

### C17. History delete-on-hover X is invisible until hovered — MEDIUM
**Where:** `Chat.tsx:480-484` — `opacity-0 group-hover:opacity-100`.
**Issue:** Pure-on-hover destructive actions are an accessibility footgun (no keyboard discovery, no touch). Also no way to multi-select / bulk-delete.
**Recommendation:** Show the X at `opacity-30` always, full opacity on row hover or focus-within. Provides discoverability without visual clutter. Also: make sure the delete button is keyboard-focusable (currently it's a `<button>` so it should be — but verify tab order).

### C18. SeedField allows non-numeric typing without feedback — LOW
**Where:** `Chat.tsx:606-639`.
**Issue:** Typing "abc" silently no-ops via the `Number.isFinite(n)` guard, leaves text in the input but doesn't update opts. Confusing.
**Recommendation:** Either restrict the input via `pattern="\d*"` and reject non-digits visually, or show a small inline hint when input is invalid.

### C19. Slider hint copy is good but visually too dim — MEDIUM
**Where:** `Chat.tsx:601` — `text-[10px] text-zinc-600`.
**Issue:** See G1; this hint is the most useful part of the panel for non-experts and it's the lowest-contrast.
**Recommendation:** Bump to `text-[11px] text-zinc-500` (still subordinate to the label, but readable).

### C20. No "Apply to current conversation" affordance for gen opts — LOW
**Where:** Gen opts persist to localStorage and apply to the next turn (`Chat.tsx:75-81`, `Chat.tsx:188`).
**Issue:** Unclear to user whether changing temperature mid-conversation affects the next message or all messages, or requires a new chat.
**Recommendation:** Add a single line at the top of the drawer: "Applies to your next message." Or, when changes are unsaved, show a "save & apply" affordance.

---

## Models page (`src/pages/Models.tsx`)

### M1. Table is the entire page; no filter, sort, or search — MEDIUM
**Where:** `Models.tsx:109-198`.
**Issue:** Once 10+ models populate, scanning by quant or runtime support requires reading every row. There's no way to "show me only Gemma" or "show me only what's installed."
**Recommendation:** Add a thin filter row above the table: a search input (filters `display_name` and `id`), a "family" dropdown, and a "show installed only" checkbox. Make column headers clickable to sort.

### M2. Per-runtime cell layout makes it hard to see which runtimes a model supports at a glance — MEDIUM
**Where:** `Models.tsx:151-192` — three columns, each independently rendering an empty dash `—`, "build pending", a download button, or a delete button.
**Issue:** A row with one runtime supported has two near-empty columns flanking it. A user scanning vertically can't see "what's installed locally" because installed and not-installed look similar.
**Recommendation:** (a) Add an "Installed" indicator column at the start (filled circle if local on any runtime, hollow if not). (b) Use color: `border-emerald-700/40 text-emerald-400` for installed cells, default for downloadable, `text-zinc-700` for unavailable. Currently only the "delete" button hover hints red on the wrong-direction action.

### M3. Delete button reuses the slot of the download button — HIGH
**Where:** `Models.tsx:177-182`.
**Issue:** Once installed, the same cell becomes a "delete · 4.5 GB" button with hover-red styling. There's no way to *use* the model from this page (no "Open in chat" action) — only delete or do nothing. Worse, an accidental click followed by a confirm-prompt (which we want to replace per G5) is the only path. New users will misclick.
**Recommendation:** Split into two actions when installed: a primary "Open in chat" link/button + a smaller secondary trash-icon for delete. Use a kebab menu (`MoreVertical`) for delete to make it intentional.

### M4. Download button shows size but not what gets downloaded — LOW
**Where:** `Models.tsx:184-189`.
**Issue:** "download · 4.5 GB" is good but doesn't preview where it goes (`~/.llm-bench/models/`), nor allow you to commit before clicking. The page heading explains the location but most users won't read it.
**Recommendation:** Show on hover a tooltip with the destination path and the HF repo source (`m.bindings[].hf_repo/hf_file`). Also consider a confirm step the *first* time a user downloads a model > 1 GB (with a "don't ask again" checkbox).

### M5. Pause/resume affordance has good color logic but unicode glyph & hard-coded color — LOW
**Where:** `Models.tsx:170-175,250-256`.
**Issue:** ▶/⏸ unicode (G4 issue applies). Amber color set inline; should be a token. `border-amber-700` on `bg-zinc-950` is acceptable contrast.
**Recommendation:** Use lucide `Play`/`Pause`. Add resume keyboard shortcut while focused (Space).

### M6. Download progress speed/ETA and bar are stuck on the right of a dense row — LOW
**Where:** `Models.tsx:242-262`.
**Issue:** Three runtime columns × 140-min-width of progress = horizontal scroll on narrow windows. The progress bar is 32px wide which is too small to read smoothly.
**Recommendation:** When downloading, expand the cell to span the row OR show a separate stack of "active downloads" cards above the table. Pattern from Ollama and HF Hub apps: queue + active download list, not inline.

### M7. Empty state is "No models loaded" centered text — HIGH (onboarding)
**Where:** `Models.tsx:124-133`.
**Issue:** First-run user comes here, sees an empty table with column headers and "No models loaded." — no path forward, no explanation of what a "model" is.
**Recommendation:** Replace the empty `<tr>` with a full-width empty-state card: icon + headline ("No models yet") + paragraph ("Download an int4-quantized model from Unsloth to get started — typically 2–8 GB.") + two buttons ("Browse popular models" - links to docs / "Import existing model" - opens dialog). Show 3–4 suggested-model cards inline as a starter.

### M8. Header explanation has a `<code>` path that is dim and untruncated — LOW
**Where:** `Models.tsx:96-99` — `text-zinc-400` `<code>` inside `text-zinc-500` paragraph.
**Issue:** zinc-500 paragraph fails contrast (G1). The path is fine.
**Recommendation:** Bump paragraph to zinc-400, code to zinc-300. Make the path clickable to reveal in Finder/Explorer (Tauri's `revealItemInDir`).

### M9. Import dialog has no Esc-to-close and no backdrop-click-to-close — MEDIUM
**Where:** `Models.tsx:347-443`.
**Issue:** The fixed-position modal traps the user; only the small "close" link in the corner dismisses it.
**Recommendation:** Add `onKeyDown={e => e.key === 'Escape' && onClose()}` to a focused container, and `onClick` on the backdrop. Also focus-trap using `react-focus-lock` or a small custom impl, and auto-focus the first input.

### M10. Import dialog "close" link is text — LOW
See C15. Replace with X icon.

### M11. Import dialog runtime selector is good; format hint changes well — LOW (note)
**Where:** `Models.tsx:362-383`.
**Note:** This is one of the better-designed parts of the app — keep this pattern. The 3-button segmented control is clearer than a select.

### M12. Path input is read-only with monospace placeholder — LOW
**Where:** `Models.tsx:391-396`.
**Issue:** "(none selected)" in monospace looks like a value the user typed wrong, not a placeholder.
**Recommendation:** Lighten to `text-zinc-500` (it's currently inheriting). Use a non-monospace placeholder, monospace the value when set.

### M13. Display name auto-suggest happens on first path pick only — LOW
**Where:** `Models.tsx:317-322`.
**Issue:** If the user picks a path, then changes their mind and picks another, the `name` doesn't re-suggest.
**Recommendation:** Re-suggest on each path change unless the user has manually edited the name (track a `nameEdited` state).

---

## Evals page (`src/pages/Evals.tsx`)

### E1. Empty state uses generic disabled cards with "soon" badges — HIGH (onboarding)
**Where:** `Evals.tsx:36-57`.
**Issue:** Cards look the same as enabled cards — only the disabled "Run" button distinguishes them. The "planned · v0.3" badge is in zinc-500 (fails contrast). New users may not realize this is unimplemented.
**Recommendation:** (a) Add a single-line note at top: "Coming in v0.3 — these eval definitions are wired but not yet runnable." (b) Style cards as previews: dashed border, a faint "PREVIEW" watermark, the Run button replaced with a "Notify me" or "Read about MMLU →" link. (c) Show what the result UI *will* look like — a faint mock chart.

### E2. Card hover state is missing — LOW
**Where:** `Evals.tsx:38-41`.
**Issue:** No `hover:` styling. Cards are static even though they look clickable.
**Recommendation:** Add `hover:border-zinc-700 transition-colors` even if there's no click action — or remove any clickable affordance and make them flat.

### E3. Eval description copy quality is great — LOW (note)
Keep — these one-liners ("57-subject multiple-choice; classic knowledge benchmark.") are exactly the right tone. Apply same style elsewhere.

### E4. No "back-to-Models" or related-context hint — LOW
**Recommendation:** Add a footer: "Eval requires a downloaded model — check the Models page."

---

## Benchmarks page (`src/pages/Benchmarks.tsx`)

### B1. Single static info card, no interactive previews — HIGH (onboarding)
**Where:** `Benchmarks.tsx:11-24`.
**Issue:** A bullet list of what *will* be measured doesn't show what the result UI will look like. Users with no LLM background won't know what TTFT or prefill speed mean.
**Recommendation:** Replace with a mocked-up benchmark result card showing fake numbers in the same layout you'll use later. Greyed-out, with "EXAMPLE" overlay. Show a simple bar chart placeholder (just SVG rectangles is fine). Same idea as Vercel's Analytics empty state.

### B2. Inline `<code>PLAN.md §9</code>` is a self-link with no click target — LOW
**Where:** `Benchmarks.tsx:7-9` (and `Evals.tsx:34`, `Compare.tsx:7-9`).
**Issue:** Internal codename, not user-facing. Looks like an unfinished TODO.
**Recommendation:** Either remove the references in user-facing copy, or replace with a real link to a public roadmap.

### B3. List items use `text-zinc-500` — MEDIUM
**Where:** `Benchmarks.tsx:13`.
**Issue:** See G1.
**Recommendation:** Bump to `text-zinc-400`.

---

## Compare page (`src/pages/Compare.tsx`)

### Cmp1. Two dashed boxes is the entire UI — HIGH (onboarding)
**Where:** `Compare.tsx:11-21`.
**Issue:** Even more than Evals/Benchmarks, this page screams "unfinished." Dashed boxes with placeholder text "slot A — model + runtime picker goes here" expose internal scaffolding to users.
**Recommendation:** Replace with a more deliberate empty state: header explaining the feature, a screenshot or animated GIF of how compare will work (or a static mock with two side-by-side fake conversations + diverging stats), and a "Get notified" or "Read the design doc" link. If dashed boxes stay, at least style them like proper drop-zones with an explanation of what goes there once available.

### Cmp2. The slot height is `h-[60vh]` — LOW
**Where:** `Compare.tsx:11`.
**Issue:** Fixed-vh sizing on an unfinished feature. On a short laptop this gets cramped; on a tall monitor leaves a giant gap.
**Recommendation:** Use a flexible layout once implemented. For the empty state, a smaller fixed height (300–400px) is fine.

---

## Onboarding (cross-cutting, ranked HIGH)

### O1. First launch with zero models has no welcome flow — HIGH
**State:** App opens on `/chat`. Sidebar shows nav. Chat dropdown shows "(no models)". Empty state says "Pick a model and runtime, then send a message." with no path forward.
**Recommendation:** A first-run experience:
1. Detect zero models (`models.length === 0` from `listModels()`).
2. Render a welcome screen on Chat: hero copy, a checklist ("Download your first model" → goes to /models, "Try a chat" → disabled until model present, "Configure generation" → opens drawer).
3. After the user installs their first model, set a localStorage flag and never show the welcome again.
4. Optional: a 30-second tour overlay on first launch.

### O2. Runtime concept is never explained — MEDIUM
**State:** "llama.cpp", "MLX", "LiteRT-LM" appear in dropdowns and table headers with no context.
**Recommendation:** Add an info icon next to the runtime selector (and the Models table headers) that opens a small popover explaining each runtime's tradeoffs ("MLX: Apple-Silicon native, fastest on Macs", etc.). Reuse content from your README.

### O3. No "what is a quant?" hint — LOW
**State:** `Models.tsx:148-150` shows `q4_k_m` etc. as monospace text.
**Recommendation:** Tooltip on quant column header explaining int4 quantization in 1–2 sentences.

---

## Quick wins (do these first, ordered by ROI)

1. **G1** — fix `text-zinc-500/600` body-text contrast across the app. One sweep, large UX gain.
2. **G7** — add `:focus-visible` ring globally. Three lines of CSS, large accessibility gain.
3. **C7 / O1** — first-run welcome on Chat. ~1 hour, transforms the new-user experience.
4. **C4 / G8** — replace unicode glyphs with `lucide-react` and pick one casing convention. ~30 min, polish-per-minute is high.
5. **G4** — wire up Cmd-N, Cmd-1..5, Esc. ~1 hour, repositions app as keyboard-first.
6. **M3** — split delete from open-in-chat in Models table. Eliminates a foot-gun.
7. **C2** — runtime dropdown shows reasons or filters to supported only. Fixes a confusing dead-end.
8. **G5** — replace `alert()`/`confirm()` with styled dialogs/toasts. Big "this is a real app" upgrade.
9. **M7 / E1 / B1 / Cmp1** — better empty states across the four "soon" pages. ~2 hours total.
10. **S1 / S2** — better sidebar active state and visible "soon" badges. 15-minute polish.

---

## Things this UI gets right (keep doing)

- The status pill (`Chat.tsx:751-787`) has the right structure — distinct color per state, uppercase tracking, small footprint. Generalize this primitive.
- The stats footer (`Chat.tsx:694-730`) is a very clean information-dense component. Once labels are tooltipped (C11), this is great.
- The Import dialog runtime segmented control (`Models.tsx:362-383`) is the right pattern; reuse it elsewhere.
- The download speed/ETA computation (`Models.tsx:226-240`) is accurate and the formatting (`formatSpeed`, `formatEta`) is well-tuned.
- Border + small radius + zinc surfaces is a strong baseline — no shadow, no glassmorphism. Restrained and Linear-esque.
- Persistent gen opts via localStorage (`Chat.tsx:75-81`) is the right call; just communicate it (C20).
- Conversation history with subtitle preview (`Chat.tsx:450-456`) is a nice touch.

---

## Files referenced

- `src/App.tsx`
- `src/components/Sidebar.tsx`
- `src/pages/Chat.tsx`
- `src/pages/Models.tsx`
- `src/pages/Evals.tsx`
- `src/pages/Benchmarks.tsx`
- `src/pages/Compare.tsx`
- `src/styles.css`
- `src/main.tsx`
- `tailwind.config.js`
- `src/lib/types.ts` (informational only — no UI changes needed)
