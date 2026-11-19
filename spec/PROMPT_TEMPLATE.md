# Vellum — AI Prompt Templates

Paste one of these into Claude Code, Claude Design, Google Stitch, Cursor, v0, Bolt, or
Antigravity.

**Each template has two halves that behave differently.** The *invariants* block is fixed —
copy it verbatim, every time, for every project. The *project* block is yours to fill, and
it is deliberately open: it asks what your project needs, not what the example needed.

If you fill the project block by copying the bracketed hints, you will get the example back.
That is the one way to misuse these.

Attach [`GRAMMAR.md`](./GRAMMAR.md) and [`tokens.json`](./tokens.json) alongside the prompt.
Those two files are sufficient to produce on-brand work without an example to copy.

---

## 1. Web — site, page, or application

````markdown
You are an expert UI engineer and visual designer. Build a production-grade, responsive
interface in the Vellum design system.

Authoritative sources, in priority order:
1. tokens.json — every value. Never invent one, never hardcode one that exists here.
2. GRAMMAR.md — what is invariant (§2) and what is mine to choose (§3).
3. DESIGN.md — component anatomy and rationale.
Link styles.css; do not restate its token values.

## MY PROJECT

- Brand / wordmark:
- What this is for (one sentence):
- Who reads it:
- Tone:

- Sections I actually need, in order:
  (Decide from my content. Do NOT default to a ten-section layout — that belongs to one
  example, not to the system. Three sections is a valid answer.)

- Primary action, and what it does:
- Do I need a live/interactive stage? (yes/no — if no, omit the stage and cavity entirely)
- Do I need controls? (yes/no — if no, omit the console entirely)
- Real numbers worth showing, if any:
  (Omit the stat strip rather than inventing numbers.)
- Brand colours, as many as the brand has, each a hex exactly as given (optional;
  defaults to Vellum's own palette):
- Which brand colour lights each lamp, in light and in dark, and how strongly (optional; a
  lamp may also be a lighter or darker step of a brand colour, a neutral grey, or off):

## INVARIANTS — copy verbatim, never edit

1. Consume tokens by role (--color-text-primary, --color-surface). Never reach past a
   role to a raw value.
2. Both modes. light and dark, toggled, persisted to localStorage. Every role already
   carries both values — never write a second hardcoded dark rule.
3. Type: Geist 800–900 for display, Inter for prose, JetBrains Mono for every mechanical
   label. Monospace is ALWAYS uppercase.
4. Headlines are monochrome. No tint, no gradient, no accent word in display type.
5. The primary action is monochrome ink, inverting across modes. NEVER an accent hue.
6. Status colours (red = failure, amber = warning, emerald = live; cyan and purple are the
   project's to name, GRAMMAR §3.9) and the accent report LIVE STATE only. If you cannot
   name the state one reports, remove it. Brand colour is carried by the lamps.
7. Pills are binary: untinted = category, tinted = live state. Never tint a category.
8. Elevation ladder, in order: page → sheet (--blur-stage) → drawer → nav → tray
   (--blur-raised) → field → cavity (opaque, NO blur). Skip rungs freely; never reorder.
9. Sheets: blur on the sheet only, never on text or buttons. Edge is mode-aware: in
   light mode exactly 1px, never coloured; in dark mode exactly zero (depth reads by the
   luminance step between sheets, not by an edge). Two or three lamps behind all content
   wherever sheets are used: one empty <div class="light-table"></div>, which paints them.
   Each lamp, in each mode, is --lamp-a-color (a brand colour, var(--brand-N), a step of
   one, or a neutral grey; opaque, never a literal) and --lamp-a-opacity (a number, 0 for
   off), set in :root and in [data-theme="dark"]. Never write the gradient; nothing goes
   beneath the table.
10. Hover: a sheet rises translateY(-2px), a primary action translateY(-1px). In light
    mode the sheet's edge also brightens to --color-border-hover; in dark mode the rise is
    the whole gesture, with no shadow, edge, or rim added. NEVER a coloured glow, a
    coloured border, or scale.
11. Focus: monochrome ink ring on :focus-visible. Never the browser-default blue, never
    removed. Everything keyboard-reachable.
12. Responsive: data tables collapse to card stacks below --breakpoint-mobile. No
    horizontal scrolling, ever.
13. Honour prefers-reduced-motion.
14. Text on a cavity is --color-text-on-sunken (--color-text-on-sunken-secondary for
    secondary text), never --color-text-primary. A cavity is dark in both modes, so its
    text takes its own mode-invariant role.

## PROHIBITED

- Neon glows, rainbow outlines, or coloured borders on hover
- Coloured or gradient-filled headlines
- Centred body paragraphs longer than two lines
- Accent-coloured primary buttons
- Browser-default focus rings, or pastel/gradient button fills
- Detached numbering tags floating in whitespace
- Reproducing an example's section order when my content does not need it
````

---

## 2. Print, stationery, and email collateral

````markdown
You are an expert production designer. Produce Vellum collateral.

Sources: tokens.json (semantic.print for inks), DESIGN.md §7, GRAMMAR.md §2.11.

## MY PROJECT

- Collateral type: [letterhead / business card / invoice / email signature / other]
- Brand / wordmark:
- Name and role, if applicable:
- Contact details to include:
- Document metadata (doc ID, date, revision, security), if applicable:
- Body content or line items:

## INVARIANTS — copy verbatim, never edit

1. Process inks only: 100% K (--print-ink) for text and rules, 60% K
   (--print-ink-secondary) for subtitles, on unprinted stock (--print-paper).
2. ZERO digital artifacts. No backdrop blur, no lamps, no drop shadows, no
   translucency. These do not survive the crossing to paper.
3. All structural dividers, table borders, and tag frames are 0.5pt (0.176mm) solid rules.
4. Type: wordmark and names in Geist 900 uppercase; metadata and tabular figures in
   JetBrains Mono uppercase; body in Inter.
5. Numeric columns are right-aligned monospace so digits align.
6. Print inks are mode-invariant. Never emit a dark-mode variant for paper.
7. Email signature only: table-based layout, inline CSS only, zero external stylesheets,
   max-width 460px, 2px solid left-border accent with 12px padding. Must survive Gmail,
   Outlook, Apple Mail, and iOS.
````

---

## 3. Checking what came back

Walk [`GRAMMAR.md`](./GRAMMAR.md) §4 — ten pass/fail questions. Any single failure means
off-brand, however good it looks.

The one people miss is the last: *is the layout driven by this project's content, or copied
from an example?* A page can pass every style check and still fail the system.
