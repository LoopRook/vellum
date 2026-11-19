# Vellum — System Bundle

**Author**: Jonathan Hockaday
**License**: MPL-2.0
**Version**: 1.0.0-RC12

Swiss International Typographic Style, translucent vellum layering, and Dieter Rams functionalism, in
light and dark modes.

This is a **toolkit, not a template.** It encodes an invariant grammar — type discipline,
pill logic, elevation, sheet rules, colour-role semantics — separately from the choices any
one project makes. Two sites built from it should look nothing alike and still read as the
same system.

---

## Layout

```
vellum/
├── build.js               # Generates everything below marked (generated)
├── validate_system.js     # Measures the system, writes VERIFICATION.md, exits non-zero on failure
├── derive_ramp.js         # Derives a nine-rung ramp from a brand colour (GRAMMAR §3.4)
│
├── styles.css             # Token block (generated) + hand-written component CSS
├── tokens.generated.js    # (generated) Token values as data, for the doc cards
├── _ds_manifest.json      # (generated) Card index, from the @dsCard markers
├── index.html             # Workbench — sidebar (generated)
├── VERIFICATION.md        # (generated) Evidence report
│
├── theme.json             # Theme summary for host tooling (checked against the tokens, rule 4r)
├── thumbnail.html         # Cover card
│
├── foundations/           # 12 cards — grammar, colour, type, sheets, spacing, icons,
│                          #   wayfinding, anti-patterns, specimen, states, CMF, print
├── components/            # 7 cards — buttons, console, cards, navigation, forms,
│                          #   tables, dialogs
└── examples/              # 5 examples to check output against — landing, dashboard, deck, pitch deck, spec sheet
```

`build.js`, `validate_system.js`, `verify.html` and `VERIFICATION.md` are repository tooling.
They are not part of a synced design-system project, which carries the cards, the examples,
`styles.css`, `derive_ramp.js` and the four specification files below.

The specification lives one level up in [`../spec/`](../spec/):

| File | Holds |
| :--- | :--- |
| [`tokens.json`](../spec/tokens.json) | **The single source of truth.** W3C DTCG, two layers, both modes |
| [`GRAMMAR.md`](../spec/GRAMMAR.md) | Constants vs. variables — what every artifact must obey, what each project chooses |
| [`DESIGN.md`](../spec/DESIGN.md) | Component anatomy, rationale, print translation, anti-patterns |
| [`PROMPT_TEMPLATE.md`](../spec/PROMPT_TEMPLATE.md) | AI prompt scaffolds |

---

## One source for every value

`tokens.json` is the only place a value is set. `build.js` derives from it:

```
spec/tokens.json ──┬──> styles.css        (the :root and [data-theme="dark"] block)
                   └──> tokens.generated.js  (the same values as data)

@dsCard markers ───┬──> _ds_manifest.json  (the card index)
                   └──> index.html          (the workbench sidebar)
```

The foundation cards that show values import `tokens.generated.js` and render swatches,
scales, and tables from it, so those values and the stylesheet cannot disagree. Two files
restate some values by hand, `theme.json` and the spec sheet example's token table; the
validator compares both to `tokens.json` (rules 4r and 4h).

**After editing `tokens.json`, or any `@dsCard` / `@dsExample` marker:**

```bash
node build.js && node validate_system.js
```

Hand-written component CSS lives below the `GENERATED:TOKENS:END` marker in `styles.css`
and is never touched by the build.

**Adding a brand colour to a project:**

```bash
node derive_ramp.js "#0F62FE" --css --name brand-1
```

Declare each brand colour as `--brand-1`, `--brand-2` and so on, exactly as given; it is not
rounded to a rung. Hand each hex to the script: it walks the nine L\* rungs at that hue and
prints that colour's steps, `--color-brand-1-100` to `-900`. Then light the lamps from the
palette, per mode: each lamp is a colour and an opacity, `--lamp-a-color: var(--brand-1);
--lamp-a-opacity: 0.3;`, set in `:root` and again in `[data-theme="dark"]` (GRAMMAR §3.5).
The page holds one empty `<div class="light-table"></div>`; the stylesheet paints the lamps on
it, so nothing else goes in it or beneath it. `--json` emits a `tokens.json` fragment, `--verify` diffs
the shipped ramps against the rule, and `--status <name>` prints a status declaration (GRAMMAR
§3.9). Without Node, load `derive_ramp.js` in a page: it exposes the same functions as
`window.VellumRamp`, including `deriveRamp(hex)` and `deriveStatus(hex)`.

---

## Core invariants

The full set is [`GRAMMAR.md`](../spec/GRAMMAR.md) §2. The ones broken most often:

1. **Status colours are state, not brand.** The primary action is monochrome ink that inverts
   across modes. The five status colours (red, amber, emerald, cyan, purple) report live
   state only — never a button fill, never a headline. A project may recolour them within
   limits and add its own (GRAMMAR §3.9).
2. **Pills are binary.** Untinted means category; tinted means live state.
3. **Hover is quiet.** Lift 2px; in light mode the edge brightens too. Never a glow.
4. **The elevation ladder is fixed.** Rungs may be skipped, never reordered. A cavity is a
   hole, not a pane: opaque and unblurred.
5. **Monospace is always uppercase.**
6. **Focus is monochrome** and always visible.

And the one that makes this a system rather than a skin: **there is no required page
shape.** Layout, section count, and composition are per-project. The landing example's
ten-section structure is documented as [that example's anatomy](./examples/landing/ANATOMY.md),
not as a rule.

---

## Verification

`validate_system.js` produces evidence rather than assertions. It writes
`VERIFICATION.md`, in the source repository, with:

1. **Structure** — every card and example exists and is marked
2. **Token coverage** — every role with its light and dark value; a blank cell fails
3. **Reference integrity** — nothing used-but-undefined; unused tokens classified as scale
   (expected) or role (a defect)
4. **Drift** — `tokens.json` ↔ `styles.css` ↔ `_ds_manifest.json` ↔ `@dsCard` ↔ sidebar
5. **Naming** — no retired name survives anywhere
6. **Convention** — kebab-case properties, each derivable from a token path

---

## Using Vellum

Vellum is licensed under the Mozilla Public License 2.0 (see `LICENSE` at the repository root). You may use it in your own
work, including commercial work. If you change Vellum's own files and distribute them, publish
those changes under the same licence. Your own pages and code stay yours.

Two requests. Neither is a condition of the licence:

- **Credit it.** A line such as "Built with Vellum by Jonathan Hockaday", with a link, is
  appreciated.
- **Tell us what you built.** Open an issue at <https://github.com/LoopRook/vellum/issues> with a
  link, so it can be shown alongside the system.


© 2026 Jonathan Hockaday · Licensed under MPL-2.0.
