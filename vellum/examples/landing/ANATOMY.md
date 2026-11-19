# Landing Example — Anatomy

**This describes one example's composition, not a system rule, and not a recipe to follow.**

The ten-section structure below, the 560px stage, the three console rows, the 2×2
feature grid and the four-column stat strip all used to be documented as Vellum
invariants. They are not. They are the composition *this* example makes. They are
written down here so the example can be read and checked against, without the system
claiming every project must look like it. An example is a reference for verifying
output, not a starting point for producing it.

For what actually is invariant, see [`../../../spec/GRAMMAR.md`](../../../spec/GRAMMAR.md).
A single-column editorial page with no hero, no stage and no console is fully
Vellum provided it obeys that document.

Use this file when you want *this* layout. Ignore it freely when you don't.

---

## The ten sections

| # | Section | What it does | Notes |
| :--- | :--- | :--- | :--- |
| 01 | Fixed nav sheet | Hides on scroll down, returns on scroll up or on pointer within 70px of the top | `--blur-nav`; the only fixed element |
| 02 | Split hero | Oversized headline set at `--type-hero`, with a short standfirst | One hero per page, at most |
| 03 | Stage card | A sheet holding an opaque cavity for a canvas, video, or live demo | 560px desktop, `clamp(380px, 50vh, 480px)` mobile |
| 04 | Specification drawer | Four-column disclosure, collapsed by default | `--blur-drawer` |
| 05 | Statement banner | Alternating solid and ghost lines of display type | The only place `--color-text-ghost` appears |
| 06 | Feature grid | 2×2 on desktop, single column below the desktop breakpoint | Quiet lift on hover |
| 07 | Stat strip | Four columns divided by hairlines, collapsing to 2×2 on mobile | Display numerals, monospace units |
| 08 | Conversion callout | Centred, narrow measure, one primary action | The one place centred text is correct — it is not a paragraph |
| 09 | FAQ accordion | Stacked disclosure, 760px measure | `[+]` / `[−]` monospace indicator |
| 10 | Footer | Monospace, minimal | |

## The stage

The stage is a **sheet containing an opaque cavity**. That nesting is the part
worth copying — it is the elevation ladder made visible:

```
sheet             --blur-stage    translucent, the lamps show through
  └── cavity      NO BLUR         opaque, reads as cut into the surface
  └── console     --blur-raised  nested tray, denser fill than the card
```

The cavity is deliberately unblurred and opaque. It is a hole, not a pane; giving it
sheet treatment collapses the depth the whole arrangement is built to express.

## The console rows

Three rows, grouped by *kind* of control rather than by importance:

| Row | Holds |
| :--- | :--- |
| 1 | Segmented mode toggle + stepper — mutually exclusive states |
| 2 | Axis and layout chips — orthogonal toggles |
| 3 | Presets + status toggle + range slider with a numeric readout |

This grouping is a sensible default for a control surface with mixed control types.
It is not a rule. A console with one row, or five, or none is fine — what matters is
that a row groups controls of the same kind, so a reader can predict where to look.

## What will not carry over

These are the parts of this example most likely to be wrong for your
project, and so the parts most worth not reproducing:

1. **The stage.** Most projects do not have a live interactive asset. If yours does
   not, delete sections 03 and 04 rather than filling the cavity with a screenshot.
2. **The stat strip.** Four numbers only if you have four that matter. Numbers nobody
   asked for read as filler in a system this spare.
3. **Section count.** Ten sections is a product launch page. A portfolio, a service
   page, or a piece of writing wants a different count — usually fewer.
4. **The console.** Purely demonstrative here. Keep it only if your product actually
   has controls to expose.

## What holds in every project

The invariants in [`GRAMMAR.md`](../../../spec/GRAMMAR.md) §2. In particular, and
most often broken when drawing on an example:

- The primary action stays monochrome ink. Not your brand hue.
- Headlines stay untinted.
- Category pills stay untinted; tinted pills mean live state.
- Card hover lifts; in light mode its edge brightens too. It never glows.
