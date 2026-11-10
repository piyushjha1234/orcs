# orcs.ai design system

> Source of truth for `orcs ui` (`web/app.css`, `web/index.html`, `web/components/*`).
> Built from the ui-ux-pro-max search (developer tool, JetBrains Mono, dark code + green run),
> then changed where the product needs it. The overrides are listed at the end.

## Product

- Name: **orcs.ai**. Header wordmark: `orcs` plus `.ai` in the accent colour.
- Use: watch, answer and steer orcs runs from a phone or a desktop browser.
- Feel: a terminal-grade operations tool. Dense, exact, quiet. No marketing layout.

## Colour tokens

Every colour is a semantic token from `web/app.css` `:root`. Components never use raw hex.
Light and dark values use `light-dark()`; `data-theme` on `<html>` forces one scheme.

| Token | Light | Dark | Used for |
|---|---|---|---|
| `--bg` | `#f6f7f5` | `#0e1013` | page |
| `--surface` | `#ffffff` | `#161a1f` | header, cards, inputs, dialogs |
| `--sunken` | `#eef0ec` | `#1d2228` | table heads, hover, current nav item |
| `--text` | `#16191d` | `#e7eaee` | body text |
| `--muted` | `#515861` | `#a6aeb8` | helper text, meta, timestamps |
| `--border` | `#dde0e4` | `#2c333c` | dividers only (decorative) |
| `--ctrl` | `#6b7280` | `#7b8390` | control boundaries, outlined buttons (≥3:1) |
| `--accent` | `#15803d` | `#4ade80` | primary button, progress marks, bars |
| `--accent-text` | `#166534` | `#4ade80` | links, quiet buttons, status text |
| `--accent-on` | `#ffffff` | `#052e16` | text on `--accent` |
| `--tint` | `#f1faf4` | `#14231b` | selected answer option |
| `--ok-bg` | `#e3f4e8` | `#14231b` | done and running badges |
| `--focus` | `#14532d` | `#86efac` | focus outline |
| `--danger` | `#b42318` | `#f87171` | errors, stop, failed |
| `--danger-on` | `#ffffff` | `#2a1414` | text on `--danger` |
| `--danger-bg` | `#fdecea` | `#2a1414` | error summary, failed badge |
| `--warn-text` | `#8a3b00` | `#fbbf24` | "needs you" counts, waiting badges |
| `--warn-bg` | `#fdf3d7` | `#2a2110` | "needs you" background |
| `--neutral-text` / `--neutral-bg` | `#3f4650` / `#e9ebee` | `#c3cad3` / `#262c34` | stopped, low risk, waiting tasks |
| `--info-text` / `--info-bg` | `#1d4ed8` / `#e8f0fe` | `#93c5fd` / `#172036` | running runs, building and checking tasks |
| `--violet-text` / `--violet-bg` | `#6d28d9` / `#f1ebfe` | `#c4b5fd` / `#221a38` | model, skill and change events |
| `--h0`…`--h5` `-fill` / `-line` | green, blue, violet, amber, pink, teal | same hues, dark fills, bright lines | flow chart nodes and edges only |

Contrast (checked with the WCAG formula; all pass):

| Pair | Light | Dark |
|---|---|---|
| text on bg | 16.4:1 | 15.8:1 |
| muted on surface | 7.2:1 | 7.8:1 |
| accent text on surface | 7.1:1 | 10.0:1 |
| white on accent / dark on accent | 5.0:1 | 8.6:1 |
| danger text on surface | 6.6:1 | 6.3:1 |
| control boundary on surface | 4.8:1 | 4.6:1 |
| focus on surface | 9.1:1 | 12.5:1 |

## Type

- Body: `system-ui` stack, 16px, line height 1.5. No eyebrow or kicker above headings; ids go in the meta line below. Inputs are 16px so iOS does not zoom.
- Mono: **JetBrains Mono**, self-hosted from `web/fonts/` (variable weight 400 to 700, Latin
  subset, 8.7 KB, OFL licence in `LICENSE-jetbrains-mono.txt`). Used for ids, numbers, paths and code.
- Scale: h1 `clamp(1.5rem, 1.25rem + 1vw, 1.875rem)`, h2 18px, h3 and h4 16px and 15px, meta 15px,
  hints and table heads 13 to 14px. No text below 12px.
- Numbers: `font-variant-numeric: tabular-nums` in tables.

## Space, shape, targets

- 4px base scale: `--s1` 4, `--s2` 8, `--s3` 12, `--s4` 16, `--s5` 20, `--s6` 24, `--s8` 32.
- Radius 6px for controls and cards, 10px for dialogs. No shadows.
- Touch targets 44px minimum (`--target`), including outlined buttons, links in lists and radio rows.
- Content width 1120px. Mobile padding 16px; from 768px, 24px.

## Layout

- **Phone (below 900px):** single column. Five-item bottom bar for run sections
  (Progress, Questions, Bugs, Report, Plan) with counts; body gets bottom padding so content is not hidden.
- **Desktop (900px and up):** 200px side rail with the same five items, sticky under the header.
  The run header is sticky too.
- **Runs list:** cards below 768px, a table with caption and `scope` headers from 768px.
- **Wide tables** (report, plan, tasks) sit in a labelled, focusable scroll region. The page never scrolls sideways at 320px.
- **Stepper:** six plain steps, three columns on phones and six in a row from 768px.

## Components

- **Buttons:** `.btn` (outlined), `.btn-primary`, `.btn-danger`, `.btn-quiet`. Disabled buttons keep their label and drop to 60% opacity.
- **Status badges:** always text, never colour alone (Running, Waiting, Stopped, Failed, Done).
- **Questions:** `fieldset` with `legend`, each option a full-width bordered row (radio, number, text, `recommended` tag),
  keys 1 to 9 pick, Enter sends, typed text overrides the picked option. Answered questions are a ruled list with a check.
- **Activity timeline:** `role="log"` wrapper, `aria-live="off"`, newest first. Time, a marker on one rail, the line, then its kind
  as a word. Marker colour follows the kind; the word means colour is never the only signal.
- **Task rows:** status pill (icon plus word, tinted by state), title, then id and detail. A 600 ms highlight when a task changes.
  Rows only repaint when a task or its minute counter changes.
- **Bugs:** grouped by risk with a risk pill heading. Risk is written out, not only coloured.
- **Report:** numbers carry the meaning; share bars are decoration (`aria-hidden`), set from JavaScript to keep the CSP strict.
- **Plan:** facts lists and tables (`facts()` and `tableRegion()` in `components/shared.ts`). The flow is an SVG: one centred column
  of equal-width numbered nodes (pills at start and end), hue per step, straight arrows to the next step, skip-ahead links curve
  right and links back curve left, each in its own lane. Links are also listed for screen readers.
- **Tooltips:** `warning-tip`. A formula line in mono plus one short sentence; nothing longer. Opens towards the side with room.
- **Settings:** Display (theme, announcements; this browser) and Agent models (one select per agent; saved by the server in
  `~/.orcs/settings.json`, used by sessions that start after the change, limited to the step-up ladder models).
- **Dialogs:** native `<dialog>` with `showModal()`. Escape closes. Focus returns to the opener.
- **Errors:** next to the field, plus a summary at the top that takes focus after a failed submit.

## Interaction and accessibility rules

- WCAG 2.2 AA. Skip link, landmarks, one `h1` per view, focus moves to the section heading on route change.
- Focus: 2px outline with 2px offset in `--focus`. Headings focused by script show no ring.
- `scroll-padding` keeps focused elements clear of the sticky header and bottom bar.
- `prefers-reduced-motion` removes animations and transitions. `forced-colors` adds borders and uses system colours.
- Reflow works at 320px and 200% text. The viewport never disables zoom.
- Live region `#status` (`role="status"`) announces only: new questions, answers sent, runs finished, failed or stopped,
  stopping and resuming. Reader can turn these off in Settings.
- Shortcuts: `?` help, `n` new run, `g` then `r` runs. Ignored while typing or inside a dialog.

## Copy rules

- Short and exact, like the CLI (`src/view.ts`). Numbers always carry a label ("2 questions need you").
- Titles under 60 characters. Helper text one sentence. No exclamation marks, no filler words
  ("seamless", "effortless", "unlock", "journey", "magic" and similar). The Playwright suite checks this.
- Every state has its own line: empty, loading, saving, error, waiting, done, stopped.

## Overrides of the generated recommendations

The search suggested these. They were changed on purpose:

| Suggested | Used instead | Why |
|---|---|---|
| FAQ or documentation landing with hero and search | Dense operations console: rail, run header, sections | The user needs run state at a glance, not marketing sections |
| Dark mode only (OLED) | Follows the system, with a Settings toggle and checked light values | Light mode must pass contrast too; many users read in daylight |
| Google Fonts import (IBM Plex Sans, JetBrains Mono) | Self-hosted JetBrains Mono, `system-ui` for text | The CSP allows only `self`; the tool must work offline |
| Hover lift, `translateY`, shadows, `backdrop-filter` blur, glow | Flat surfaces, borders, tints | "Not AI slop" rules in the plan; blur hurts reading and is not needed |
| `#22C55E` accent on light | `#15803d` in light, `#4ade80` in dark | `#22C55E` on white is about 2.3:1 |
| Button `opacity` and `translateY` on hover | Background change with `filter` only | No layout shift on press |
| Modal with blurred overlay | Native dialog with a plain 55% scrim | Scrim measured against content; no blur |

## Files

- `web/app.css`: tokens, components, breakpoints, reduced motion, forced colours.
- `web/index.html`: shell (skip link, header, nav, status region, dialogs).
- `web/fonts/`: subset JetBrains Mono and its licence.
- `design-system/orcs/MASTER.md`: this file.
