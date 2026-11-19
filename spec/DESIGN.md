---
name: "Vellum Design System"
version: "1.0.0-RC12"
description: "Swiss International Typographic Style, translucent vellum layering, and Dieter Rams functionalism, in light and dark modes."
author: "Jonathan Hockaday"
license: "MPL-2.0"
source_of_truth: "./tokens.json"
grammar: "./GRAMMAR.md"
target_frameworks:
  - "Claude Code / Claude Design"
  - "Google Stitch"
  - "React 18 / 19"
  - "Tailwind CSS v3 / v4"
  - "Framer"
  - "v0 / Bolt / Cursor / Antigravity"
---

# DESIGN.md — Vellum

> **The design language in prose**, for the people and the AI agents building with Vellum:
> what each part is for, and why its rules hold.

## Read this first

This file does **not** contain token values. It used to, and the copies drifted from the
real ones. There is now exactly one source of truth:

| You want | Read |
| :--- | :--- |
| A value | [`tokens.json`](./tokens.json) — W3C DTCG, two layers, both modes |
| Whether you may change it | [`GRAMMAR.md`](./GRAMMAR.md) — constants vs. variables |
| Why a rule exists | This file |
| To brief an AI | [`PROMPT_TEMPLATE.md`](./PROMPT_TEMPLATE.md) |
| To see it rendered | `../vellum/index.html` — the workbench |
| How one example was composed | `../vellum/examples/landing/ANATOMY.md` |

Where a value appears below it is quoted from a token and named as such. If this file and
`tokens.json` ever disagree, `tokens.json` is right and this file is a bug —
`validate_system.js` is there to catch that before it ships.

---

## 1. Aesthetic position

**Swiss International Typographic Style** supplies the grid, the type discipline, and the
refusal to decorate. **Translucent layering** supplies the depth model — the system is modelled on matte vellum stacked over a lit drafting table. **Dieter Rams
functionalism** supplies the restraint that keeps the other two from becoming a style
exercise — every element earns its place or leaves.

The result reads as instrument-like: precise, quiet, and built rather than styled. The
reference points are Braun, Teenage Engineering, Linear, and European transit signage.

**Two modes, one material:**

- **Light mode** — vellum over a lit table, in a lit room: cool near-white, softly backlit,
  high-contrast ink. Ambient light falls on each sheet and the sheet scatters some of it back
  toward you, so it reads brighter than what it covers.
- **Dark mode** — the same vellum in a dim room. Nothing falls on the front of the sheet, so
  there is nothing to scatter; only the table's own glow passes through, and the sheet can
  only take some of it away. It reads darker than what it covers.

These are not a light theme and its afterthought, and they are not two materials. The
material is fixed and the lighting is what changes. Every role carries both values, and the
validator fails the build if one is missing.

That is stated as one material on purpose. Without it, the specification claimed a single
physical model and then described dark doing the opposite, and every dark-specific rule read
as an exception someone had allowed. With it, three of them stop being exceptions. An edge is
front-light catching the sheet's thickness, and dark has no front-light, so it has no edge.
A cast shadow needs a directional source above the sheet, and dark has none, so it has no
shadow. Stacking carries each sheet further in whichever direction the first one went —
toward milky white in light, deeper into the dark in dark. When a rule is proposed to differ
between modes, ask whether it follows from the lighting condition. If it does, this is its
reason. If it does not, it needs one of its own: the action fill is the case that does not
follow, and GRAMMAR §2.5 gives its reason. GRAMMAR §2.3 carries the rule; `DECISIONS.md` 013
carries the measurements.

**Who it is for:** creative technologists, product designers, agencies, hardware
engineers, and developers building high-performance applications, portfolios, and tools.

---

## 2. Colour

### 2.1 Roles, not palettes

Components consume **roles** (`--color-text-primary`, `--color-surface`), never raw
values. Roles carry both modes; the ramps beneath them are a palette to draw from, not
something a component addresses directly. Full role table with both mode values:
`tokens.json` → `semantic.color`, and rendered live on the **Color & Ramps** card.

### 2.2 Text hierarchy

Four steps, and the distinction is meaning rather than emphasis:

| Role | Carries |
| :--- | :--- |
| `--color-text-primary` | Headlines, titles, active control labels, key values |
| `--color-text-secondary` | Body prose, captions, descriptive copy |
| `--color-text-muted` | Monospace labels, units, counters, table headers |
| `--color-text-ghost` | The statement banner's outline weight — decorative only, never carries information a reader needs |

In light mode, primary text is the same ink as the stage cavity. That is deliberate: the type and
the recess read as the same material, and contrast exceeds WCAG AAA.

### 2.3 Status colours

The five status colours exist **only to report live state**. A status dot, a running
indicator, a warning, a reading that changes. Red, amber and emerald have fixed jobs: failure,
warning, live. Cyan and purple are free, named per project. A project may recolour any of them
within limits, and add its own (GRAMMAR §2.5, §3.9).

They are never a headline, never a button fill, never decoration. The test: point at any
status colour and name the state it reports. If there is no answer, it is misused.

Neither ground is pure. Light mode is not `#FFFFFF`; dark mode is not `#000000`. Pure white is a
*raised surface*; pure black appears only as the label on a primary action in dark mode.

Dark's primary action fill is not pure white either, as of `DECISIONS.md` 011 — it is the
owner's dialled near-white grey (L\* 88). Pure white stays reserved for the raised surface
above; the fill beneath a dark-mode primary action's black label is a shade off it, with real
headroom above for hover to use. See GRAMMAR §2.4/§2.5.

### 2.4 The light table

Two or three fixed lamps sit behind all content — see `tokens.json` → `semantic.lamp`.
The table paints them itself: a page holds one empty `<div class="light-table"></div>`, and
`build.js` generates the lamps as opaque gradient layers on it (DECISIONS 064).

They are not decoration; they are the light source. A sheet has nothing to diffuse without
them and flattens into a grey rectangle. They are the brand's light: each lamp, in each mode,
takes its colour from the brand palette (`semantic.brand`), a step of one, or a neutral grey,
or is off. Which colour lights which lamp is a per-project choice, made per mode; the opacity
ceilings are not (GRAMMAR §3.3, §3.5).

A lamp is two values per mode: a colour, `--lamp-a-color`, which is opaque, and the peak
opacity it is drawn at, `--lamp-a-opacity`, from 0 to 1. A project repoints a lamp by
setting both, in `:root` for light and in `[data-theme="dark"]` for dark. The opacity is
held to the bounds; a translucent colour is refused, because it would bring back the
banding the opaque layers remove (GRAMMAR §3.5). Where lamps overlap, the layers combine by
the lighting: the brighter one wins in dark, where the lamps are the only light, and the
deeper tint wins in light, where they tint a table already lit (GRAMMAR §2.3). The table is
opaque, so content always sits above it.

Distribution and count are per-mode (GRAMMAR §3.5). Light keeps three: Lamp A top-left
(55vw), Lamp B top-right (50vw), Lamp C mid-centre (45vw), each smaller and softer than the
last. The softness is baked into the generated stops and holds at every width. Dark takes
its own arrangement and may run on two.

---

## 3. Typography

Three families, one job each. Full scale with live specimens on the **Typography Scale**
card; values in `tokens.json` → `semantic.type`.

| Family | Owns | Never |
| :--- | :--- | :--- |
| Geist (`--font-display`) | Headlines, card titles, stat numerals. Weight 800–900 only | Running prose |
| Inter (`--font-body`) | Prose, descriptions, answers | Labels, badges, buttons |
| JetBrains Mono (`--font-mono`) | Every mechanical label, badge, counter, unit, CTA, table header | Prose of any length |

**Rules:**

- Monospace is **always uppercase**. Lowercase in a mechanical label is a violation, not a
  variant. Code, identifiers and units keep their literal case (`class="literal"`,
  `class="unit"`, `<code>`); see GRAMMAR §2.1.
- Display type is weight 800–900, and its tracking tightens with size and is never positive.
  A 600-weight headline is a different system, not a lighter one.
- Headlines are monochrome. Emphasis comes from size, weight, and the solid/ghost contrast
  of a statement banner — never from hue.
- Body copy is left-aligned whenever it runs past two lines.

**Tracking is bound to the step, not chosen per use.** Two monospace values exist and the
difference is structural, not aesthetic:

| Token | Applies to |
| :--- | :--- |
| `--tracking-mono` | Monospace inside a bordered control — a button, a pill, an inline label |
| `--tracking-mono-wide` | Monospace standing alone as a section eyebrow or kicker, where there is no border to give it structure |

---

## 4. Depth and material

### 4.1 The elevation ladder

Blur expresses depth and the ordering never changes:

```
page ground                    no blur          --color-bg-canvas
  └── sheet / stage            --blur-stage     furthest back, most diffuse
        └── spec drawer        --blur-drawer
        └── fixed nav          --blur-nav
        └── tray               --blur-raised    nested sheet, denser fill
              └── input field  --blur-field
                    └── cavity  NO BLUR         opaque, reads as cut in
```

Rungs may be skipped. They may not be reordered, and the ladder may not be extended with a
new value.

### 4.2 Sheet physics

- Blur belongs to the **sheet**, never to text or a button. Type on a sheet is sharp and
  solid, always — it is ink on the surface, not something seen through it.
- **In light mode**, every sheet carries a **1px edge**. One pixel. Never coloured, never
  thickened to signal state. **In dark mode the edge is zero** — an edge is front-light
  catching the sheet's thickness, and dark has none, so depth reads by the luminance step
  between sheets instead. See `DECISIONS.md` 011 and 013, GRAMMAR §2.3.
- A sheet is **translucent by definition**. An opaque card with a blur value set is not a
  Vellum card. Stacking sheets never reveals what is beneath; each takes the sheet below as
  its ground, lightening it in light mode and darkening it in dark.
- A **cavity is a hole cut through, not another layer**: opaque, unblurred, recessed.
  Giving it sheet treatment collapses the depth the arrangement exists to express.

### 4.3 Where blur is unavailable

Email clients, older engines, and print cannot composite a backdrop blur. A sheet degrades
to an opaque raised surface (`--color-surface-solid`) keeping its 1px edge and its radius; the
light table is dropped. Translucency is what is lost — the hierarchy is not. `styles.css`
implements this under `@supports not (backdrop-filter: ...)`.

### 4.4 Hover

Interactive surfaces lift: `translateY(-2px)`. Whether that rise is *accompanied by* catching
more light, or *is* the whole gesture, is stated per mode rather than assumed shared, and it follows from the lighting condition
(§1, GRAMMAR §2.3): catching light needs front-light, which only light mode has. In
light, the shadow deepens on hover but is already too faint at rest for the climb to register,
so it is the border that brightens to `--color-border-hover`, and that is what a reader
perceives alongside the rise. In dark, per `DECISIONS.md` 011, there is no shadow at all — not
merely one with no room left to darken into, but zero at rest and on hover, the owner's own
dialled value — and, per the owner's later, explicit ruling ("as for the rim, both should be
0"), the specular inset rim and the 1px edge are zero at rest *and* on hover too. Nothing
brightens. On a lifted ground with attenuating sheets and no cast shadow, there is no material
left to carry a "catches more light" cue, so the rise itself is the entire gesture: dark's
hover state is `translateY(-2px)` and nothing else. See `DECISIONS.md` 010 (dark's mechanism,
and why the rim was retained provisionally, then removed) and 011 (why the shadow is gone, not
merely quiet).

That is the entire vocabulary. No coloured glow, no neon border, no scale, no tilt. In light
the lift reads as a physical object catching more light; in dark it reads as a physical object
rising, full stop — a narrower gesture, not a broken one.

Dark's resting edge, resting shadow, hover edge, and hover rim are now all zero, exactly as
the owner dialled. The hover rim was the last holdout — kept lit under a separate, explicit
carve-out for the hover state specifically (*"we can put the rim in, it may be removed in the
future though"*) after the resting edge and shadow had already gone to zero under DECISIONS
011. The owner has since ruled directly that the rim goes to zero too, closing that carve-out.
See DECISIONS 010's second addendum.

---

## 5. Component anatomy

What each component **is**, and the rules that hold wherever it appears. How any specific
page arranges them is that page's business — see `GRAMMAR.md` §3.

### 5.1 Sheet header

A full-width bar at `--blur-nav` with a `--color-border-subtle` underline.

**What is invariant** is the material and the reachability: a sheet at nav depth, a single
hairline underline, and the controls inside it available without scrolling (GRAMMAR §2.9).

**Scroll behaviour is a per-project choice.** Two variants, both correct:

| Variant | Behaviour | Suits |
| :--- | :--- | :--- |
| **Persistent** | `position: sticky`, always visible | Pages where the header carries navigation or controls the reader reaches for often — a store, an application, an index |
| **Retracting** | Hides on downward scroll past ~80px; returns on upward scroll, or when the pointer enters the top ~70px. `--duration-smooth` on `--easing-spring` | Long reading or presentation pages where the header is chrome rather than a tool, and the content deserves the full viewport |

Pick by asking whether the reader needs the header *while* reading. If yes, persistent. If
it is only there to get them somewhere else, retracting is a courtesy.

**The variant is a material choice, not just a motion one.** A retracting header is off the
board while the page is at rest at the top; pulling it down is the act of laying a sheet on
whatever is there. A persistent header is a sheet that never leaves.

| | At rest, top of page | With content scrolled beneath |
| :--- | :--- | :--- |
| **Persistent** | A sheet on the bare ground. Faint edge, slightly milky, colour muted. | Milkier — a second layer between the lamps and the eye. |
| **Retracting** | No sheet. Seamless: the lamps read straight through and the header is continuous with the ground. | Identical to persistent. |

Both columns use the same sheet. The only difference is whether it is on the board at rest,
so the two variants must never carry different densities — a page that hardcodes its own is
reintroducing the failure in §5.1's note below.

**Density is a legibility floor.** The nav sheet is `--color-surface-nav`, denser than every
other surface, because it is the only sheet whose backdrop is unbounded: a page may scroll a
black photograph under it in light mode, or a white one in dark mode. At the `--color-surface`
used by cards, nav links measure **3.41:1** over `--color-surface-sunken` and **3.11:1** over
pure black — both below AA. At light mode's shipped **0.85** they measure **5.15:1** and
**4.95:1**. The AA floor in light mode is alpha 0.785; 0.85 is that floor plus headroom.

Dark mode is no longer the same figure — only dark's ground moved, and the two modes are not
matched by the same alpha any more. The dark-ground lift raised the ground from L\* 3.03
(`#0A0B0E`) to L\* 8.36 (`#18181B`); at the old 0.85, the correctly ground-coloured nav (now
literally `#18181B`, not the pre-lift ground) measured only **4.38:1** over pure white — below
AA, for the first time. The recomputed dark floor is alpha **0.858**; dark now ships at **0.9**,
measuring **5.20:1** over pure white and **6.99:1** over `--color-surface-sunken` — headroom in
the same spirit as light's. Light is untouched: its ground did not move, so its figures above are
unchanged.

It is ground-coloured rather than white on purpose — a dense sheet approaches the tone of the
paper itself, which is what diffusion does. White at that alpha reads as an opaque bar, not
vellum — and the ground it approaches in dark mode is `#18181B` now, not the pre-lift `#0A0B0E`.

A page may also have **no header at all** — see GRAMMAR §3.1. In that case its persistent
controls live in whatever chrome the page does have (a sticky rail, a sidebar), and §2.9
still applies.

### 5.2 Sheet

The system's primary surface — one sheet of vellum. `--blur-stage`, `--radius-stage`, a 1px edge in light mode,
`--elevation-stage` at rest. Interactive instances take the §4.4 hover.

### 5.3 Cavity

An opaque recess at `--color-surface-sunken`, `--radius-cavity`, overflow hidden. Holds a
canvas, video, image, or live demo. Never blurred, never translucent.

A cavity is dark in **both** modes, so text on it is not `--color-text-primary`, which is the
same value as the cavity in light mode. It takes `--color-text-on-sunken` and
`--color-text-on-sunken-secondary`, which do not change with the mode (GRAMMAR §2.6).

### 5.4 Tray

A tray at `--blur-raised` and `--radius-tray`, denser than the card containing it so
the nesting reads. Controls are grouped into rows **by kind** — mutually exclusive states
in one row, orthogonal toggles in another — so a reader can predict where to look. The
number of rows is a per-project decision.

### 5.5 Controls

| Control | Radius | Active state |
| :--- | :--- | :--- |
| Primary action | `--radius-pill` | Solid `--color-action-bg`, monochrome ink, inverts per mode |
| Mode button | `--radius-control` | Inverts to solid ink |
| Chip | `--radius-chip` | `--color-wash-active` + ink border |
| Icon trigger | Circular | Sheet fill, ink border on hover |

Range sliders use a solid 18px handle (`--color-control-thumb`) with a contrasting collar,
over a track split at the current value. The split shows the value; it is not a decorative line.

### 5.6 Mode toggle

Every Vellum artifact ships both modes, so every artifact needs a way to switch.
There are two presentations and the distinction is context, not preference:

| Context | Presentation |
| :--- | :--- |
| **A site or application** | A circular `.btn-icon` carrying a sun or moon glyph. The glyph shows the mode you would switch **to** — moon while in light mode, sun while in dark mode. |
| **A documentation card** | A labelled `.btn-control` reading `TOGGLE DARK`. A card has no chrome to hold an icon, and a reader studying the system benefits from the mode being named rather than implied. |

**Placement is a rule, not a preference: the toggle lives in persistent chrome and must
be reachable without scrolling.** A header, a sticky rail, a sidebar — whichever this
project has. What it must not be is a footer. The system has no required page shape
(GRAMMAR §3.1), so this cannot be stated as "put it in the header"; what is invariant is
that a control the reader may need at any moment stays available at any moment. A toggle
at the bottom of a long page is present in the markup and absent in practice.

Both write the choice to `localStorage` and both fall back to `prefers-color-scheme` on
first visit. The toggle is a control, not a decoration: it takes the same monochrome focus
ring and the same quiet hover as any other control, and it carries an `aria-label` naming
the destination mode plus `aria-pressed` for its state.

The mode names are **light** and **dark** everywhere they are surfaced — in labels, in code,
in tokens, and in prose. They were once called Ice and Obsidian; that vocabulary was retired
because the platform already has words for this. `prefers-color-scheme` says light and dark,
the stylesheet's own selector is `[data-theme="dark"]`, and a private name forces every
reader — human, generator, or model — to learn a mapping that buys nothing.

### 5.7 Pills and badges

Two kinds, and the distinction is semantic:

| | Untinted (`.tag-pill`) | Tinted (`.tag-red` / `.tag-amber` / `.tag-emerald` / `.tag-cyan` / `.tag-purple`, or a project's own with `.tag-status`) |
| :--- | :--- | :--- |
| Means | This is a category | This is a live state |
| Looks | Transparent fill, neutral border, secondary text | 12% wash, 30% border, tinted text |
| Examples | `TYPOGRAPHY`, `v1.1.0` | `LIVE`, `DEGRADED` |

Tints derive from the status role via `color-mix`, so repointing a status colour carries
its wash and border with it.

### 5.8 Status dot

A 7px circle taking a status role, always beside the word that names its state: the word
carries the meaning, the dot draws the eye (GRAMMAR §2.5). The `.status-dot-live` modifier
pulses, and only something genuinely live may use it. Honours `prefers-reduced-motion`.

### 5.9 Data table

Hairline rows at `--color-divider`, monospace uppercase headers at `--type-micro`, numeric
columns in monospace so digits align. Below `--breakpoint-mobile` rows collapse into
self-contained card stacks — never horizontal scroll.

### 5.10 Disclosure

FAQ items and specification drawers are stacked sheets with a monospace `[+]` / `[−]`
indicator. Collapsed by default.

---

## 6. States and accessibility

Every interactive element defines all five states — default, hover, active, focus,
disabled — rendered together on the **Component State Anatomy** card.

**Focus is monochrome and always visible.** `:focus-visible` transitions to a crisp ink
border plus a `--color-focus-ring` halo. The browser-default blue ring is prohibited; so is
removing focus styling. Every interactive element is keyboard-reachable.

Contrast: primary text on either ground exceeds WCAG AAA. Muted text is used only for
labels and metadata, never for content a reader must be able to read at length.

Motion respects `prefers-reduced-motion`.

---

## 7. Print, stationery, and email

Paper is not a screen. **Zero digital artifacts**: no backdrop blur, no lamps, no shadow, no
translucency. Structure is carried by hairline rules, process ink, and the same type
hierarchy — which is what makes a printed sheet and a web page recognisably siblings.

Print inks are mode-invariant (`tokens.json` → `semantic.print`): a sheet has no dark mode.

| Medium | Format | Type | Layout |
| :--- | :--- | :--- | :--- |
| **Letterhead / memo** | A4 or US Letter, 15mm margins | Brand Geist 900 22pt; body Inter 10.5pt/1.6; metadata JetBrains Mono 9pt | Wordmark top-left; four-line metadata block (`DOC ID`, `REVISION`, `SECURITY`, `PAGE`) top-right; 1.5pt rule beneath; 0.5pt signature baseline |
| **Business card** | 85×55mm or 3.5×2in, 350gsm matte | Brand Geist 900 18pt; name Geist 900 12pt; details Mono 7.5pt | Front: monochrome wordmark + uppercase tagline. Back: two columns split by a 0.5pt vertical hairline |
| **Invoice / quote** | A4 or US Letter | Title Geist 900 24pt; table Mono 9.5pt tabular; totals Geist 900 14pt | 0.5pt hairline grid. Description left; quantity, unit price, amount right-aligned monospace. Total in a bold callout, bottom-right |
| **HTML email signature** | `<table>`, max-width 460px, inline CSS only | Name 14px bold sans; title Mono 10.5px; links Mono 10px | 2px solid left-border accent with 12px padding. No external stylesheets — table layout for Gmail, Outlook, Apple Mail, iOS |

**Never violate:** 100% K for text and rules, 60% K for subtitles; no digital effects on
paper; 0.5pt (0.176mm) hairlines throughout.

---

## 8. Anti-patterns

Each row is a real failure mode, rendered side by side on the **Do's & Don'ts** card.

| Area | Do | Don't |
| :--- | :--- | :--- |
| Card hover | Lift 2px; in light mode the edge also brightens | Neon glow or coloured border on hover |
| Sheets | Multi-layer blur over the light table, with a 1px edge in light mode | Flat opaque cards with a blur value that does nothing |
| Text on a sheet | Sharp and solid | Blur applied to the text or the button itself |
| Headlines | Monochrome ink or white | Tinted, gradient-filled, or one accent word |
| Monospace | Uppercase, tracked | Lowercase mechanical labels |
| Body copy | Left-aligned past two lines | Centred paragraphs |
| Category pills | Untinted | Tinted — that means live state |
| Status tints | Reserved for live state | Decorative tints on static content |
| Primary action | Monochrome ink, inverting per mode | Accent hue, pastel fill, or gradient wash |
| Focus | Monochrome ink ring | Browser-default blue, or no focus at all |
| Sliders | Solid handle, track filled to the value | Invisible track, flat square handle |
| Numbering | Inside a pill or a step marker | Detached tags floating in whitespace |
| Print | Hairlines and process ink | Blur, lamps, or shadow on paper |

---

## 9. Verifying an artifact

Ten pass/fail questions, in [`GRAMMAR.md`](./GRAMMAR.md) §4. Any single failure means
off-brand, however good it looks.

For the system itself rather than an artifact built from it:

```bash
node systems/vellum/build.js && node systems/vellum/validate_system.js
```

Writes `systems/vellum/VERIFICATION.md` with token coverage, reference integrity,
drift, naming, and convention reports, and exits non-zero on any failure.

That reads source. What a browser actually draws — inherited case, relative sizes, the
dark cascade, sheet edges — is checked by `systems/vellum/verify.html`, which needs
nothing but a browser. Open it served over http (Claude Design, Claude Code's browser
pane, or any browser) and it measures every card and example in light and dark, at
desktop and phone width. `verify.html?page=path/to/page.html` checks one page, including
one built from the system. The result is in the page title and on `<html data-verify>`
(`DECISIONS.md` 033).
