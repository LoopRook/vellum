# Vellum

A design system by Jonathan Hockaday: Swiss typography over translucent sheets, lit from behind,
in light and dark. Plain HTML and CSS, driven by one token file. No framework and no build step
is needed to use it.

**See it live: <https://looprook.github.io/vellum/>**

The live site is the Vellum workbench. Its sidebar lists every foundation, component and example
page, and each page has its own light and dark switch.

## What is here

| Path | What it is |
|---|---|
| `vellum/styles.css` | The stylesheet. Link this one file to use the system. |
| `vellum/index.html` | The workbench: every page of the system in one viewer. |
| `vellum/foundations/`, `vellum/components/` | One page per foundation and component. |
| `vellum/examples/` | Worked examples: a landing page, a dashboard, a printable spec sheet and a pitch deck. They are references to check work against, not templates. |
| `spec/GRAMMAR.md` | The rules: what every Vellum page must obey, and what each project is free to choose. |
| `spec/DESIGN.md` | The design language in prose. |
| `spec/tokens.json` | The tokens. `styles.css` is generated from this file. |
| `spec/PROMPT_TEMPLATE.md` | A prompt for building with Vellum using an AI coding agent. |
| `vellum/derive_ramp.js` | Derives a nine-step colour ramp from a brand colour. Runs in Node or in a page. |

`vellum/readme.md` describes the bundle in more detail.

This repository is a published copy of the system. It is generated from a private working
repository, so changes are made there and copied here. The rules cite a decision log
(`DECISIONS.md`) that is not part of this copy, and the build and validation scripts in `vellum/`
expect it, so they are here to read, not to run.

## Using Vellum

Vellum is licensed under the Mozilla Public License 2.0 (see `LICENSE`). You may use it in your own
work, including commercial work. If you change Vellum's own files and distribute them, publish
those changes under the same licence. Your own pages and code stay yours.

Two requests. Neither is a condition of the licence:

- **Credit it.** A line such as "Built with Vellum by Jonathan Hockaday", with a link, is
  appreciated.
- **Tell us what you built.** Open an issue at <https://github.com/LoopRook/vellum/issues> with a
  link, so it can be shown alongside the system.

© 2026 Jonathan Hockaday · Licensed under MPL-2.0.
