---
name: "Vellum — Visual Grammar"
version: "1.0.0-RC12"
description: "The constant-vs-variable line. What every Vellum artifact must obey, and what each project is free to choose."
author: "Jonathan Hockaday"
license: "MPL-2.0"
source_of_truth: "./tokens.json"
---

# Vellum — Visual Grammar

> Vellum is a **toolkit, not a template.** Two sites built from it should look
> nothing alike and still be recognisably the same system — the way two Braun products
> from different decades are obviously Braun without sharing a silhouette.

This document draws the line that makes that possible. Everything in **§2 Constants** is
invariant: break one and the artifact stops being Vellum. Everything in **§3 Variables**
is yours: fix one across every project and you have built a template, not a system.

`tokens.json` is the source of truth for every value referenced here. This document explains
*why* a value is what it is and *when* you may change it; it never restates a value that the
token file already owns. Where a number appears below, it is quoted from a token, not defined
here.

---

## 1. How to use this

**Designing something new** — read §2 as constraints and §3 as your palette of choices.
The constraints are narrow enough to guarantee family resemblance and loose enough that two
projects sharing them will not look alike.

**Checking an AI's output** — walk §4. It is written as pass/fail questions with no room for
"close enough". An artifact that fails any question in §4 is off-brand regardless of how good
it looks.

**Briefing an AI** — hand it this file plus `tokens.json`. Those two documents are sufficient
to produce on-brand work without an example to copy. If a generated artifact drifts, the fix is almost
always that a §2 constant was stated too vaguely here — not that another example was needed.

---

## 2. The Constants

Thirteen rules. All of them are load-bearing.

### 2.1 Type carries the hierarchy — never colour

Three families, and each has exactly one job.

| Family | Owns | Never used for |
| :--- | :--- | :--- |
| **Geist** (`--font-display`) | Headlines, card titles, stat numerals | Running prose |
| **Inter** (`--font-body`) | Running prose, descriptions, answers | Labels, badges, buttons |
| **JetBrains Mono** (`--font-mono`) | Every mechanical label, badge, counter, unit, CTA, table header | Prose of any length |

- Display type is **weight 800–900 only**. A 600-weight headline is not a lighter Vellum
  headline; it is a different system. That includes the subheads, `h3`–`h6`, which sit at 800
  (§2.13), and wordmarks.
- **Display tracking tightens with size and is never positive.** It is always one of three
  roles: `--tracking-display` for headlines and large numerals, `--tracking-statement` for
  statement banners, slide titles and headings set larger than a section title, and
  `--tracking-title`, which is zero, for section and card titles, subheads and wordmarks. Never a number: a typed value cannot be retuned with the rest. Display
  type is nearly always set in capitals, and capitals crowd when tightened, which is why the
  small step sits at zero. Check 4w enforces the weight and the roles everywhere
  (`DECISIONS.md` 027, 029, 061).
- Monospace is **always uppercase.** Lowercase in a mechanical label is a violation, not a
  stylistic variant. Two kinds of text are not labels and keep their literal case, because
  uppercasing changes what they say: **code and identifiers** (token and class names, a
  glyph's component name, a version string), set in `<code>` or `class="literal"`; and
  **units of measurement** (`ms`, `dB`, `px`, `nm`, `k/s`), set in `class="unit"`. `MS` is
  not milliseconds and `--SPACE-4` is not a name anyone can type. A counted noun is not a
  unit: `18 JOBS`. Both exceptions state `text-transform: none` themselves, since case is
  inherited from the label around them, and check 4x holds the rest (`DECISIONS.md` 030).
  Check 4y reads what each marker holds, so a label marked `literal` fails (032).
  Mono is never prose; a sentence belongs in Inter. Tracking is positive: `--tracking-mono` inside a bordered control,
  `--tracking-mono-wide` when it stands alone as a section eyebrow.
- **A disclosure's question is prose.** An FAQ question (`.faq-trigger`) sits inside the
  disclosure's button, but what it holds is the reader's question, not a command, so it is set
  in Inter like the answer beneath it. The chevron is the control. `verify.html` holds each
  family to its job as rendered: twelve words of mono or more fail, and so does Inter inside a
  button, badge, label or table header, this one excepted (`DECISIONS.md` 040).
- **Headlines are monochrome.** `--color-text-primary` or nothing. No tint, no gradient
  fill, no accent word. Emphasis comes from size, weight, and the ghost/solid contrast of a
  statement banner — never from hue. This covers all display type, every heading and every
  wordmark, and a neutral grey too: display type takes `--color-text-primary`, or the
  display role of the surface it sits on (`--color-text-on-sunken` on a cavity,
  `--color-text-document` on the document sheet, `--color-text-ghost` for a statement
  banner's ghost words, paper ink on paper). Checked in source for every heading and
  display-face rule, and rendered by `verify.html` (`DECISIONS.md` 036).
- Body copy is **left-aligned** whenever it runs past two lines. `verify.html` measures it at
  desktop and phone width: Inter prose of more than eight words that renders past two lines
  centred, right-aligned or justified fails (`DECISIONS.md` 040).

### 2.2 The elevation ladder is fixed

Depth is expressed by blur, and the ordering never changes:

```
page ground                    no blur          --color-bg-canvas
  └── sheet / stage            --blur-stage     furthest back, most diffuse
        └── spec drawer        --blur-drawer
        └── fixed nav          --blur-nav
        └── tray               --blur-raised    nested sheet, denser fill
              └── input field  --blur-field
                    └── cavity  NO BLUR         opaque, recessed, reads as cut in
```

A tray is always *inside* a card. A cavity is always *inside* a card, always opaque, and
never receives sheet treatment — it is a hole cut through, not another layer. You may skip rungs (a page with no
stage is fine); you may not reorder them or invent one. `verify.html` finds every rendered tray
and cavity and fails one with no sheet above it (`DECISIONS.md` 040).

### 2.3 The material has physics

The system is modelled on **matte translucent vellum laid over a lit drafting table**,
not on glass. Vellum scatters light softly through its body; it does not reflect, glare, or
show what is behind it. Everything below follows from that, read under one of two lighting
conditions.

**The material never changes. The lighting does.** A sheet is a thin translucent body. It
scatters the light that falls on its front, and it passes on only part of the light that
reaches it from behind. Whether it reads brighter or darker than the ground it covers
depends on one thing: whether any light is falling on its front.

- **With ambient front-light** — light mode, a lit room — the sheet scatters that light back
  toward the viewer. The gain outweighs what the sheet takes from the light behind it, so it
  reads *brighter* than what it covers, and each further sheet adds more: stacking compounds
  toward milky white.
- **Without it** — dark mode, a dim room — there is nothing to scatter. Only the ground's own
  glow reaches the sheet, and the sheet can only pass on part of it, so it reads *darker*
  than what it covers, and each further sheet takes another share: stacking darkens. This is
  not a second behaviour. It is the loss light mode also has, with nothing to pay it back.

Three things that would otherwise be mode carve-outs are consequences of that, and are
derived here once rather than defended each time they appear:

- **No rim or edge in dark.** A sheet's edge is front-light catching its thickness. With no
  front-light there is nothing to catch, so the edge is zero, and so is the brighter edge on
  hover (§2.4).
- **No cast shadow in dark.** A shadow needs a directional source above the sheet. A dim room
  has none, so the shadow is zero, at rest and on hover. That holds for every shadow the
  system names, not only the sheet's, because it follows from the room rather than from the
  object: check 4u holds every `--elevation-*` role to zero in dark, and fails a shadow written
  literally, since a literal would render in dark too. The one exception is the
  primary action's hover, a glow given off by an opaque fill rather than a shadow cast, and
  under review in `DECISIONS.md` 011 (see 025).
- **Inverted stacking.** Derived in the two paragraphs above; the stacking bullet below
  states the rule.

**The test for a mode-aware rule is: does it follow from the lighting condition?** If it
does, it may differ between modes, and this section is its reason. If it does not, it needs
a reason of its own, written where the rule is made. The action fill (§2.5) is the one
mode-aware amendment that does not follow from the lighting, and says so there.

- Blur belongs to the **sheet**, never to text or to a button. Type sitting on a sheet is
  100% sharp and solid, always — it is ink stamped on the surface, not something seen
  through it.
- **In light mode**, every sheet carries a **1px edge** (`--color-border`). One pixel. Never
  coloured, never thicker to signal state. **In dark mode the edge is zero**, because dark
  has no front-light for an edge to catch; depth there is the luminance step between sheets,
  which reads by getting *darker* than what is under it. See `DECISIONS.md` 011 and 013.
  A page never overrides a sheet's edge with another colour or role; a sheet that needs to
  read differently changes its opacity or its content, not its edge. This is about sheets:
  a **control** (an input, a button, a pill) keeps its own edge, `--color-action-border`,
  in both modes, because its outline is how a reader finds it. A line drawn *inside* a sheet
  (a table rule, a header's underline) is a divider, not an edge (`DECISIONS.md` 033).
- A sheet is **translucent by definition.** An opaque card with a blur value set is not a
  Vellum card — light has to come through it, or the sheet is doing nothing.
- **Stacking follows the lighting condition.** A second sheet laid over the first never
  reveals what is beneath it; it takes the first as its ground. In light that lightens it,
  toward a calmer milky white. In dark it darkens it, further from the glow underneath. That
  is why cards sit only a couple of L\* off the ground, in either direction, and still read
  as separate objects. Almost invisible, but not invisible.
- **Lamps are mandatory** on any page using sheets: two or three per mode, never fewer
  (§3.5, `DECISIONS.md` 008). They are the light table. Remove them and every sheet flattens
  to a grey rectangle. Their *hue* is yours (§3.5); their opacity budget is not (see
  `semantic.lamp.*`).
- **The table paints its own lamps, and how they combine follows the lighting.** Each lamp
  is an opaque layer on the light table, its colour already mixed into the canvas
  (`DECISIONS.md` 064). Where two lamps overlap, the mode decides. In dark the lamps are the
  only light, so they add: the table takes the brighter of the two (`lighten`). In light they
  tint a table that is already lit, so the deeper tint holds (`darken`). Because the table is
  opaque, nothing is ever painted beneath it: content sits above it (`z-index` 1 or more),
  never under.
- **A sheet may be off the board, but it may not be half a sheet.** A nav is either laid
  down — full density, edge, blur — or it is not there at all. The seamless header at the
  top of a page is the second case: no sheet, so the lamps read straight through. What is
  prohibited is a sheet that changes its own density to suit its backdrop. It responds to
  what is under it because that is what translucency *does*, not because it thins out.
- **A nav is the one sheet with an unbounded backdrop.** Everything else sits on the known
  ground; a nav may have a black photograph scrolled beneath it. It therefore carries
  its own density, `--color-surface-nav`, set by a contrast floor rather than by eye. A page
  that hardcodes a nav fill has almost certainly just rediscovered that floor — badly.

### 2.4 Hover is quiet

**The gesture rises toward the light.** In light mode it also catches more of that light at
its edge; in dark mode the rise is the entire gesture, because catching light needs
front-light and dark has none (§2.3). Which of the two applies is stated per mode below, and
nothing beyond it is permitted — **no coloured glow, no neon border, no
scale-up, no tilt.** The §2.4 check reads every hover rule, and every simulated hover state,
for each of those, for a fade, and for a hue on an edge, outline, text or fill
(`DECISIONS.md` 036).

How the lift reads depends on the material — and, for the sheet, the mode:

| Material | Rises | Shadow | Catches more light as |
| :--- | :--- | :--- | :--- |
| **Sheet**, light | `translateY(-2px)` | deepens, but too faint to read as lift | the edge brightens to `--color-border-hover` |
| **Sheet**, dark | `translateY(-2px)` | absent, at rest and on hover — carries nothing | nothing — the rise is the whole gesture |
| **Solid** (primary action) | `translateY(-1px)` | → `--elevation-action-hover` | the fill lightens to `--color-action-bg-hover` |

In light, the shadow deepens on hover but is already too faint at rest to register the climb,
so the edge carries the cue. In dark, per DECISIONS 011, the sheet has no shadow at all —
neither resting nor hovered — because the owner dialled it to zero; depth is the luminance
step between attenuating sheets, full stop. Dark's edge and inset rim, both zero at rest, are
now zero on hover too — the owner ruled directly that the rim, like the border, should be 0
(DECISIONS 010's second addendum). On a lifted ground with attenuating sheets and no cast
shadow, there is nothing left for a hover state to brighten: the `translateY(-2px)` rise is
not *accompanied by* catching more light, it *is* the gesture, complete on its own. See
`DECISIONS.md` 010 (dark's mechanism, and why the rim did not survive) and 011 (why the shadow
is gone rather than merely quieter).

**Both modes' action fill has a ceiling now, and both use it.** In light mode the fill is dark
ink with headroom above it, so it lightens by one ramp step on hover. In dark mode the fill is
no longer pure white — DECISIONS 011 ships the owner's dialled grey, L\* 88 — so it too has
headroom above it, and now lightens on hover the same way, toward the same ceiling
(`--color-action-bg-hover` was already `white`; what changed is that white is now something
the fill visibly rises *to* rather than a value it already sat at). The rule is symmetric; the
material no longer differs between modes the way it used to.

**Press is the same gesture reversed.** Lifting decouples a sheet from the board and it
brightens; pressing re-couples it and it darkens, by the same magnitude, wherever the
material has room:

| | hover | press |
| :--- | ---: | ---: |
| Light mode | **+8.4 L\*** | holds — only 8.0 L\* to pure black, prohibited as a fill (§2.5) |
| Dark mode | **+11.9 L\***, to white | **−8.2 L\***, to L\* 79.9 |

Light still has one gesture that moves the fill and one that cannot: nothing above the ink
except white (used on hover) and nothing below except a near-black fill GRAMMAR §2.5
prohibits (so press holds and the shadow/geometry carry it alone). Dark no longer has that
asymmetry — DECISIONS 011's L\* 88 fill has real headroom in both directions, so both gestures
now move the fill, each by the same magnitude the system already used (hover to the ceiling it
always pointed at; press by the same -8.2 L\* it always dropped, re-based off 88 instead of
100). Never a fade, for the same reason as above.

Never express this as a fade. `opacity` composites the element toward the page, which
moves the two modes in *opposite* directions and dims the label along with the fill.

### 2.5 Colour has roles, and status colours are state-only

The single most-violated rule, so it is stated bluntly:

> **Status colours never indicate brand. They indicate state.**

- **Action colour is monochrome ink**, inverting across modes (`--color-action-bg`:
  near-black on light mode, near-white on dark mode). Dark's fill is the owner's dialled grey,
  L\* 88 — not pure white, which stays reserved for a raised surface (see the last bullet
  below, `--color-surface-solid`); see `DECISIONS.md` 011. A primary button is never amber,
  never cyan, never the project accent.
  **This difference between modes does not follow from the lighting condition (§2.3)** — the
  fill is an opaque solid, which no front-light scatters through or off — so it does not
  borrow §2.3's reason. Its own: the fill sits below white so both gestures have room to move
  it. Hover lightens it toward white; press darkens it. A pure-white fill could only ever
  darken. Argue any change to it from that headroom, not from the light.
- **The status colours** are reserved for live state: a status dot, a running indicator,
  a warning, a reading. Never a headline, never a button fill, never decoration. The core is
  five (§3.9). **Red** reports failure, **amber** a warning, **emerald** that something is live
  or operational: jobs a reader already knows. **Cyan** and **purple** are free, and each
  project names the state they report. The test holds for both kinds: point at one and name
  its state.
  **A status dot is never the whole message.** It sits beside the word that names its state, a
  dot and UPDATED, and the word carries the meaning; the dot only draws the eye to it. So a
  reader who cannot tell red from green loses nothing. `verify.html` fails a rendered dot with
  no word beside it (`DECISIONS.md` 059).
  A status dot may **glow** in its own hue, in either mode: a lit LED is a light source, not a
  shadow, so §2.3's dark rule does not reach it (`DECISIONS.md` 028).
- **Structural taxonomy is untinted.** A category label, a section marker, a version number,
  an architectural tag — all neutral.
- Neither ground is pure: light mode is `--color-bg-canvas`, not `#FFFFFF`; dark mode is not
  `#000000`. Pure white is a *raised surface*; pure black appears only as the label on a
  primary action in dark mode.

### 2.6 A foreground on a generated background is a rung, not a colour

When text sits on something the system computes — a tint, a wash, a translucent sheet — its
colour is **derived from the ladder**, never picked by eye. The background composites
differently in each mode, so a single mode-invariant value cannot be correct in both.

Status pill text is the worked example. The 12% tint composites to L* ~94 in light mode and ~15 in
dark mode. Against those, the **700** rung clears 4.5:1 in light mode at every hue angle (worst
4.62:1, at 189°) and the **500** rung clears it in dark mode (worst 5.60:1, at 300°). One rule,
every hue, both modes — possible only because §3.4 makes a step number mean the same lightness
in every hue, and the reason a project may recolour or add a status (§3.9) without choosing
its text colour. (Dark's
figures moved from ~12/6.01–6.08 when the dark ground lifted — the tint composites over the sheet,
and the sheet got lighter along with the ground it sits on.)

Every such pairing is declared in `validate_system.js` and its contrast is **computed**, in
both modes, on every build. Adding a pairing means adding a row; the arithmetic is shared.
This exists because the three contrast defects this system has shipped — muted text
(DECISIONS 001), the nav sheet (002), and status pill text, which never cleared AA in any
release — all had the same cause: a foreground and its background chosen separately and
never measured together.

Changing a tint percentage invalidates the pairing that was measured against it. The check
will say so.

A control's **boundary** is measured the same way, at the 3:1 WCAG 1.4.11 asks of it:
`--color-action-border`, which outlines every input, secondary button, chip and neutral pill,
is composited over the ground and over a sheet in both modes on every build. It sits at
exactly the opacity that clears 3:1, so it cannot be lightened without failing
(`DECISIONS.md` 034).

A cavity (`--color-surface-sunken`) is a computed background too, and it is dark in **both**
modes (`#0F172A` light, `#0B0C0D` dark). Text on it therefore takes a mode-invariant role,
`--color-text-on-sunken` or `--color-text-on-sunken-secondary`, not the sheet's
`--color-text-primary`, which is `#0F172A` in light mode — 1.00:1 on a light-mode cavity. Both
pairings are declared and measured like the others, as is a third: `--color-status-cyan` on the
cavity, for a cyan reading shown inside one. A caption that reports no state takes
`--color-text-on-sunken-secondary`, as the landing example's stage caption does (`DECISIONS.md` 066).

**There is a dead zone, and it is symmetric** — a constraint that exists in both modes, not a
light-mode-only defect. Measured against the sheet each mode renders, AA requires text **darker
than L\* 49.1** in light mode and **lighter than L\* 53.1** in dark mode. No colour between those
two values clears AA in either mode — a 4.0 L\* band where nothing works.

Only dark's number moved. When the dark ground lifted, its sheet went from L\* 4.68 to L\* 7.26 —
lighter, so a foreground now needs to be *lighter still* to hold the same 4.5:1 against it, which
raised the floor from L\* 51.7 to 53.1. Light's ground and sheet did not move, so light's 49.1 is
unchanged. The band widened (2.6 L\* to 4.0 L\*) entirely from the dark side.

The neutral ramp brackets it deliberately: `neutral-650` (L\* 46.6) is the light side,
`neutral-550` (L\* 55.0) the dark side. Those are **boundary rungs**, not decorative
half-steps, which is why muted text is the only role that uses them. `neutral-550`'s margin over
the new dark floor is tighter than it was (1.9 L\*, was 3.3 L\*) but it still clears — measured on
every build by check 4f, currently 4.81:1 against the 4.5:1 requirement — so it keeps its rung; no
half-step needs to move.

The band is a property of the two grounds, not a flaw in either. It was mis-filed for two
releases as "light mode sits too close to white" — an light mode-specific reading of a symmetric
constraint. See `DECISIONS.md` 002, RC6 addendum.

### 2.7 Pill grammar is binary

Full-radius capsules (`--radius-pill`) come in exactly two kinds, and the distinction is
semantic, not decorative:

| | Untinted pill | Tinted pill |
| :--- | :--- | :--- |
| **Means** | This is a category | This is a live state |
| **Looks** | Transparent fill, neutral border, secondary text | ~12% wash, ~30% border, tinted text |
| **Examples** | `TYPOGRAPHY`, `v1.1.0`, `SURFACES` | `LIVE`, `60 FPS`, `DEGRADED` |

Tinting a category is the error to watch for. If the label would read the same tomorrow, it
is a category and must be untinted. That is a reading, not a measurement, so nothing checks it.

**A capsule never wraps.** The shape carries the meaning; a pill broken across four lines is
not a pill. Labels are `nowrap`, and where one genuinely cannot fit it truncates *inside* an
intact capsule rather than breaking the page. If a label needs two lines it is not pill
content — shorten it, or use a different component. `verify.html` checks every rendered
capsule, anything rounded to at least half its height, holds its text on one line
(`DECISIONS.md` 038).

**Corollary for fluid type:** a `clamp()` floor stops type shrinking while the viewport keeps
shrinking, so a floor set too high guarantees overflow on a small screen. Display steps carry
`overflow-wrap: break-word` as a last resort. Breaking a word is ugly; breaking the page is
worse.

### 2.8 Radius encodes identity

Radius says what a thing *is*, not how large it is. A pill is fully round because it is a
capsule; a mode button is `--radius-control` because it is a machined part. Two components
with the same radius are the same *kind* of object. Choosing a radius by eye breaks the
grammar even when it looks fine.

So a radius is always a `--radius-*` role, never a number, even a number that equals a step:
`20px` says a size, `var(--radius-stage)` says what the thing is. It does not change with the
viewport either. A stage is a stage on a phone, and keeps the stage radius. Two shapes are
not steps and are written as they are: a circle is `50%`, and a fully rounded end is
`--radius-pill`. Check 4z holds every radius to the roles, and every blur to the `--blur-*`
roles (`DECISIONS.md` 035), and every media-query width to a `semantic.breakpoint` step
(`DECISIONS.md` 054).

### 2.9 Persistent controls stay reachable

A control the reader may need at any moment must be available at any moment. In practice
this means the mode toggle, and anything like it, lives in **persistent chrome** — a
header, a sticky rail, a sidebar — and is reachable without scrolling.

The system deliberately has no required page shape (§3.1), so this cannot be phrased as
"put it in the header". What is invariant is the reachability, not the furniture. A
toggle in the footer of a long page is present in the markup and absent in practice.

So a mode toggle says what it is: `data-mode-toggle` on the control. The build fails a control
that switches the mode without it, and a page that switches the mode with none. `verify.html`
then measures the reach: at least one on the first screen, 1280×800 and 375×812, without
scrolling. A fixed-viewport example (§2.12) is measured only at its declared width and above
(`DECISIONS.md` 041).

### 2.10 Focus is monochrome and always visible

`:focus-visible` transitions to a crisp ink border plus a monochrome halo
(`--color-focus-ring`). The browser default blue ring is prohibited; so is removing focus
styling. Every interactive element is keyboard-reachable and visibly focused.

### 2.11 Paper is not a screen

Translating to print, stationery, or PDF: **zero digital artifacts.** No backdrop blur, no
lamps, no drop shadows, no translucency. Structure is carried by 0.5pt hairline rules,
100% K text, and the same type hierarchy. A printed Vellum document and a Vellum
web page are recognisably siblings because the *typography and grid* survive the translation —
not because the paper imitates glass.

**Paper is always light.** Dark mode is a screen mode: whatever mode the reader printed from,
the page prints with the light values. So every `[data-theme="dark"]` rule sits inside
`@media screen`, the generated token block included, and the build fails one that does not
(`DECISIONS.md` 042).

**Paper has two inks.** 100% K, pure black, for text and rules, and 60% K for secondary text.
Every print colour is a neutral grey; nothing on paper carries the screen's slate blue. The
print block repoints the screen's text roles to the inks, so a rule that names
`--color-text-primary` or `--color-text-secondary` prints in K without restating it. The build
fails a print colour with a hue, an ink or rule that is not pure black, and a text role the
print block leaves on its screen colour (`DECISIONS.md` 045).

### 2.12 A deck is not a page

Every example is one of exactly two things, and it must say which.

**Responsive** is the default. Anything a reader arrives at on their own device —
a landing page, a dashboard, a document — reflows, and carries at least one
`max-width` breakpoint. The page never scrolls sideways; wide content (tables,
diagrams, code) scrolls inside its own container.

**Fixed-viewport** is the exception, and it must be declared: `minWidth="…"` on
the example's `@dsExample` marker. A deck is composed at a fixed 16:9 aspect and
is *presented*, not browsed — slide geometry is the content, so reflowing it
destroys the artifact rather than adapting it. The same reasoning as §2.11: a
format with its own physics is translated, not imitated.

What is not permitted is silence. An example with no breakpoints and no declared
`minWidth` is not a decision, it is an oversight — it is simply broken on a
phone. The build fails on it, and it fails equally on an example that declares
`minWidth` *and* carries breakpoints, because that one cannot say what it is.

---

### 2.13 The weight ladder is five steps, and each one has a job

**400 · 500 · 700 · 800 · 900.** There is no 600.

| | |
| :--- | :--- |
| **400** `--weight-body` | Running prose. Inherited, so it is rarely declared. |
| **500** `--weight-medium` | The resting state of an interactive label whose selected state is 700. A sidebar row you have not clicked; an accordion question that is closed. It is a *state*, not a decoration. |
| **700** `--weight-bold` | The emphasis weight, and the workhorse — labels, table headers, spec keys, eyebrows, the selected half of every 500/700 pair. |
| **800** `--weight-title` | Section heads, and every subhead set in the display face: `h3`–`h6` and card titles. Display type never drops below it (§2.1). |
| **900** `--weight-headline` | Headlines. |

**600 is not a step.** It is close enough to 700 that the two do not read as
different, so a 600 label next to a 700 label looks like an inconsistency rather
than a distinction. Where a weight must be visibly lighter than 700, that is what
500 is for, and the gap is wide enough to be read as deliberate.

This rule exists because its absence caused the fault. Nothing in this document
or in the tokens ever said what 500 and 700 were for, so seven places across four
files set a raw 600 — picked by eye, each time, including one rule
(`.brand-badge`) that matched no element at all and had been shipping as dead CSS.
A ladder nobody states is a ladder everybody re-invents.

Display type carries its own narrower constraint on top of this — see §2.1.

Check **4s** enforces it: any `font-weight` literal that is not one of the five
fails, in a stylesheet rule, inside a `style="…"` attribute, or in an example's
JavaScript runtime (DECISIONS 021). It does not demand
the token in place of the number; it demands that the number be one the system
defines.

---

## 3. The Variables

Everything here is a per-project decision. Fixing any of them across all projects turns the
system back into a template.

### 3.1 Layout and composition — entirely yours

Section count, section order, grid structure, page length, whether there is a hero at all,
whether there is a stage, how many columns anything has. **The system has no required page
shape.**

The landing example's 10-section structure, its 560px stage, its 2×2 feature grid and
4-column telemetry bar are *that example's* anatomy — documented in
`examples/landing/ANATOMY.md`, not here. Reproduce it if it suits the project; ignore it
freely if it does not. A single-column editorial page with no stage and no console is fully
Vellum if it obeys §2.

The examples under `systems/vellum/examples/` exist to be checked output against — by a
person or an agent holding a finished page up beside one and asking whether it reads as the
same system. They are a verification reference, not a starting point, and were named
*templates* until `DECISIONS.md` 014 (the name implied the opposite of their purpose).

### 3.2 Content, voice, and wordmark

All yours. The demo system's vocabulary — telemetry readouts, frame rates, render pipelines —
belongs to the product that system was demonstrating. A law firm's Vellum site has no
FPS counters, and is not less Vellum for it. Mechanical *labels* stay uppercase mono
(§2.1); what they *say* is entirely the project's.

### 3.3 Brand colour

**A project supplies its brand's hexes. The system derives everything else.**

A brand brings as many colours as it has. Each is declared exactly as given, numbered in the
order they are declared: `--brand-1`, `--brand-2`, and so on. Do not round one to a rung; it is
their colour, not ours. The palette lives in `semantic.brand`. Vellum's own five (sky, purple,
green, cyan, deep purple) are what the system ships until a project replaces them.

Each brand colour's *steps* are derived rather than chosen. Take the hue angle of the hex and
walk the nine rungs (§3.4). That produces tints and shades that sit correctly against every
other colour in the system, with no hand-tuning and no judgement call. Each colour gets its
own nine.

```bash
node systems/vellum/derive_ramp.js "#0F62FE" --css --name brand-1
```

That prints `--color-brand-1-100` through `--color-brand-1-900`, and it is the whole operation.
Without Node, load the same file in a page, `<script src="derive_ramp.js">`: it exposes
`VellumRamp.deriveRamp(hex)`, whose `steps` are the nine rungs (`DECISIONS.md` 063).
`--json` emits a `tokens.json` fragment instead; `--verify` regenerates the five shipped
ramps and diffs them against the token file, which the build also does on every run. A
project declares the steps it uses. The build regenerates each one, and fails a step tuned by
hand, a step with no `--brand-<n>` to come from, and the old unnumbered spellings `--brand` and
`--color-brand-<rung>` (`DECISIONS.md` 041, 046).

A brand colour does not change with the mode: a hex is a hex on either ground. What changes
per mode is which brand colours light the lamps (§3.5), because light to dark does not always
carry over.

**The accent.** `--color-accent` is one colour for small marks. It is one of the brand colours,
named from the palette (`var(--brand-<n>)`), never a hex of its own. Brand 1 is the default,
and a project may point it at any brand colour it declares. The build fails an accent that is
a literal, a status colour, or a brand colour the site does not declare (`DECISIONS.md` 047).
It remains bound by §2.5: it may tint a status pill, a dot, or a rule. It
may not fill a primary action or colour a headline. This is why a Vellum site with a magenta
brand still reads as Vellum: the accent was never carrying the brand. The lamps carry it.

**Status colours are not the accent.** `--color-status-*` report state (§2.5), and the accent
does not move them. A project may recolour them within limits, and may light a free one with a
brand colour (§3.9); a fixed one keeps its job whoever the client is, because green means
operational in every brand. Every status sits on the 500 rung of its hue, which puts them all
at the same lightness and makes them interchangeable in a pill.

### 3.4 The ramp ladder

Ramps are **derived, not chosen.** Each family walks nine fixed CIELAB L\* targets at its own
hue angle:

```
100:95   200:89   300:82   400:74   500:65   600:55   700:45   800:36   900:29
```

Chroma at each rung is `min(target, gamut maximum)`, with OKLCH targets 0.030, 0.062, 0.098,
0.126, 0.145, 0.138, 0.120, 0.100, 0.082. Hues that can reach the target do; hues that cannot
take their maximum and taper gracefully.

**A step number therefore means the same lightness in every hue.** That is the whole point:
contrast can be reasoned about without checking each ramp, which is the same premise as
Material 3's tones and USWDS's grades. Take a hue angle, walk the ladder, and the result is
correct by construction.

Fixed: the L\* targets, the chroma targets, and that every generated family carries the same
nine rungs. `neutral` is the one exemption — it is tuned for interface use rather than for
smooth interpolation, and says so in its own description.

### 3.5 Lamp hue

**The lamps are the brand's light.** Each lamp, in each mode, takes its colour from the brand
palette (§3.3):
- a brand colour, `--brand-<n>`;
- a step of one, `--color-brand-<n>-<rung>`;
- a neutral grey, `--color-neutral-<rung>`;
- or nothing: it is off, at opacity 0.

Which colour lights which lamp is the project's choice, and it is made **per mode**. A brand
with three colours might light one lamp each. A brand with one might light lamp A with the
colour, lamp B with a lighter step of it, and lamp C grey. Dark mode may use different colours
altogether: Vellum's own lamp A is sky in light and cyan in dark.

**A lamp is a colour and an opacity.** Each lamp is declared, per mode, by two values: its
colour, `--lamp-a-color`, and the peak opacity it is drawn at, `--lamp-a-opacity`, a number
from 0 to 1 (and the same for B and C). A project repoints a lamp by setting both: in `:root`
for light, and in `[data-theme="dark"]` inside `@media screen` for dark. Set both modes, or
the light value can carry into dark. Moving a lamp is a separate act, done with its pins
(`--lamp-a-top`, `--lamp-a-left`, and so on) and `--lamp-scale`. The gradient itself is
never written by hand: `build.js` generates each lamp's stops from the tokens, and a page
holds only an empty `<div class="light-table"></div>` (`DECISIONS.md` 064).

The colour is **opaque**. A lamp's strength is its opacity, never an alpha inside its
colour. The table mixes the colour into the canvas at that opacity so that every stop is
opaque; a translucent colour makes the stops translucent again and brings back the banding
they exist to remove. The build fails a translucent lamp colour.

A lamp names its colour; it is never a literal. The build fails a lamp with a literal
colour, or with a colour from outside the palette: a status colour, a step the page does not
declare, or a brand colour the site does not declare. That last one covers a lamp a site
leaves on the system default, which would light it with Vellum's own colour
(`DECISIONS.md` 046).

Warm lamps, cool lamps, monochrome lamps: all valid. What is fixed is that there are two or
three per mode, that they sit behind everything, and that their opacity stays **within
bounds at both ends**:

| | floor | ceiling |
| :--- | ---: | ---: |
| Light mode | **0.12** | **0.45** |
| Dark mode | **0.07** | **0.26** |

Above the ceiling they stop being ambient light and become decoration. Below the floor a
sheet has nothing left to diffuse and flattens to a grey rectangle — the failure §2.3 says
the lamps exist to prevent.

**The two modes differ because equal alpha is not equal effect.** dark mode's dark ground does
not compete with the lamp, so it passes more colour per unit. Both bounds are matched by
*effect* rather than by value. Dark mode 0.07 and light mode 0.12 each move a sheet 8.25; dark mode
0.26 and light mode 0.45 each move it about 30.8. So "has nothing left to diffuse" and "stops being
ambient light" mean the same thing in both modes rather than naming different thresholds.

Dark mode's ceiling sits well above its own default of 0.08 on purpose. A ceiling equal to the
default would forbid a site being brighter than the system, which nothing has decided should
be forbidden.

The bounds are declared on `semantic.lamp` and enforced on every build, for the system's own
defaults and for anything that repoints them.

**Distribution and count are per-mode, and each falls off.** In light mode there are
three: lamp A is 55vw at the top-left, B is 50vw top-right, C is 45vw mid-centre, each
smaller and softer than the last. Softness is how far the light spreads past the lamp's
edge as it fades, in proportion to the lamp's size; it is baked into the generated stops and
holds at every window width (`DECISIONS.md` 064). In dark mode the lamps are the only light
source rather than ambience, so they take their own arrangement — diagonally opposed,
and two is permitted. Sizes and the falloff are shared; only position and count differ.
See `DECISIONS.md` 008.

### 3.6 Header variant

Persistent or retracting — both correct, chosen per project (`DESIGN.md` §5.1). The choice
is a material one, not only a motion one: a retracting header is off the board at rest, so
it is seamless with the ground at the top of the page; a persistent one is always a sheet
and never seamless.

The coupling is fixed: **a header may be absent at rest only if it retracts.** A persistent
header is always a sheet, because its text must stay legible over whatever is beneath it at
every scroll position. Seamlessness is bought with the retract, and a page cannot have it
without paying.

Pinned top chrome declares its variant: `data-header="retracting"` or
`data-header="persistent"`. The build fails pinned chrome that says neither; a persistent
header with no fill, or a transparent one, at rest in either mode; and a retracting header
with no rule that takes it off the board (`DECISIONS.md` 041).

### 3.7 Density, imagery, and iconography

Which spacing steps you favour, how much air the layout carries, whether the project uses
photography, illustration, 3D, or nothing. Which Lucide glyphs you draw on. All open.

### 3.8 Medium

Web, application, deck, print, stationery, email. The grammar survives all of them; §2.11
governs the crossing to paper.

### 3.9 Status colours

**The core is five, and a project may recolour any of them. What differs is how far.**

| Status | Job | A project may move it |
| :--- | :--- | :--- |
| **Red** | Failure: down, failed, refused | inside red's family, 0–35° or 345–360° |
| **Amber** | Warning, attention | inside amber's family, 40–95° |
| **Emerald** | Live, connected, operational | inside emerald's family, 120–170° |
| **Cyan** | Free: the project names it | anywhere a free status may sit |
| **Purple** | Free: the project names it | anywhere a free status may sit |

Red, amber and emerald carry meanings a reader brings with them. A forest green still reads as
operational; a teal "warning" does not. So each may move within its family, never out of it.
Cyan and purple carry no meaning until a project gives them one, so a project may light them
with anything, its brand colours included. Their defaults sit on Vellum's own brand hues,
brand 4 and brand 2.

**A free status keeps clear of the families.** It may not sit inside one, within the margin of
one (10°, about one just-noticeable difference at status lightness), or in the gap between
amber and emerald (95–120°), which reads as neither. That leaves 180–335°.

**Any two statuses sit at least 40° apart.** Every status has the same lightness, so hue is
all that tells two apart. 40° is about four just-noticeable differences even where status
colours are least saturated, near 190°. It also caps the set without a number: at most four
free statuses fit, so about seven in all.

**A project may add statuses.** An added status is free, and follows the same rules. A
backordered item, a scheduled job, a draft: if the state is real and the core has no word for
it, add it rather than reuse a colour that means something else.

**A status is a seed, and the system derives the rest.** The seed is a hex, or
`var(--brand-<n>)` for a brand colour the project declares:

```bash
node systems/vellum/derive_ramp.js "#679EF8" --status backordered
```

That prints the seed, the 500 rung (the colour), the 700 rung (text in light mode), the 500
again for text in dark mode, and the rule for its pill, used as
`class="tag-pill tag-status tag-backordered"`. To recolour a core status, give its own name:
`--status cyan`. Without Node, `VellumRamp.deriveStatus(hex)` in a page returns the same three
values: `colour`, `fg` and `fgDark` (`DECISIONS.md` 063).

The numbers live in `tokens.json`: each role's range, and the margin, separation and closed gap
on `semantic.color` (`design.vellum.status`). The build fails a core status outside its family,
a free or added status inside a family, its margin or the closed gap, two statuses closer than
40°, a rung that is not what its seed derives, a status with no seed, and a seed that is neither
a hex nor a brand colour the project declares (`DECISIONS.md` 058).

---

## 4. The audit

Ten pass/fail questions. Use these to check a human's work or an AI's. **Any single failure
means the artifact is off-brand**, however good it looks.

1. **Type** — Are headlines Geist 800–900 on a display tracking role, and is every mechanical
   label uppercase monospace?
2. **Monochrome headlines** — Is every headline `--color-text-primary` (or its inverse), with
   no tint, gradient, or accent word anywhere in display type?
3. **Action colour** — Is every primary action monochrome ink, inverting between modes, with
   no accent hue used as a button fill?
4. **Status discipline** — Does every status colour, and the accent, indicate a live state? Point
   at one and ask what state it reports. If there is no answer, it fails.
5. **Pill grammar** — Are all category and taxonomy pills untinted, with tint reserved for
   live state?
6. **Elevation** — Does the blur ladder run in the right order, with consoles nested inside
   cards and cavities opaque and unblurred?
7. **Sheet integrity** — Is all text on a sheet sharp; in light mode is every sheet edge
   exactly 1px and uncoloured (in dark, exactly zero — depth reads by luminance step, not by
   edge, see `DECISIONS.md` 011); and are the lamps present behind the content (two or
   three per mode — §2.3, §3.5, `DECISIONS.md` 008), with nothing hidden beneath the opaque
   light table (`DECISIONS.md` 064)?
8. **Quiet hover** — Does every interactive surface lift (`translateY`) on hover with no
   coloured glow, border colour change to a hue, or scaling — and, in light mode specifically,
   does its edge brighten to `--color-border-hover` as well (in dark, per DECISIONS 010/011,
   the lift arrives with nothing else — no rim, no border, no shadow)?
9. **Focus** — Does every interactive element show a monochrome focus ring on keyboard
   navigation, with no browser-default blue? And is the mode toggle reachable without
   scrolling?
10. **Not a template** — Is the layout driven by *this* project's content rather than copied
    from a Vellum example? A page that reproduces the demo's section order without needing
    it has passed the style check and failed the system.

---

## 5. Boundary cases

Situations where the rules appear to conflict, resolved.

| Situation | Resolution |
| :--- | :--- |
| The brand colour is a strong hue and the client wants it on the CTA | It goes in the palette, where it lights the lamps (§3.5), and the accent takes it for small marks (§3.3). It stays off the CTA. Monochrome action colour is not negotiable (§2.5); this is the rule that keeps every Vellum site legible as one family. |
| A data visualisation needs many colours | Charts may use the tonal ramps freely — a chart series is data, not chrome. The surrounding UI still obeys §2.5. |
| A page uses no sheets at all | Fine. Sheets are available, not mandatory. With no sheets the lamps may go too — §2.3's lamp requirement applies only where sheets are used. |
| A dense application needs smaller text | `--type-micro` is the floor. Below it, reduce the amount of content rather than the type size. One exception, and only one: the console family's compact controls (`.btn-control`, `.btn-chip`, `.btn-stepper`, `.btn-status-toggle` and a console group's `.label`) may go down to 9.5px inside a `max-width` block of 420px or less, because a control label is scanned, not read. Pills and every other label hold the floor. Check 4v enforces both (`DECISIONS.md` 026). |
| The medium cannot render backdrop blur (email, print, older clients) | Fall back to opaque surfaces with a 1px border and keep the type hierarchy exactly. §2.11's logic applies to any blur-incapable medium. |
| A project has a second brand colour | It joins the palette as `--brand-2`: it can light a lamp, and its steps are derived the same way (§3.3, §3.5). It is not a second accent. The accent stays one colour for small marks, and a second state distinction is a status, from the core or added by the project (§3.9); a second free accent is how a system starts drifting. |

---

## 6. Where things live

| Question | File |
| :--- | :--- |
| What is the value of X? | [`tokens.json`](./tokens.json) — the only source of truth |
| May I change X? | This document, §2 vs §3 |
| What are the full rules and rationale? | [`DESIGN.md`](./DESIGN.md) |
| How do I brief an AI? | [`PROMPT_TEMPLATE.md`](./PROMPT_TEMPLATE.md) |
| How was the landing example composed? | `../vellum/examples/landing/ANATOMY.md` |
| Can I see all of this rendered? | `../vellum/index.html` — the workbench |
