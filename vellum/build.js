#!/usr/bin/env node
/**
 * Vellum — system build.
 *
 * Every generated artifact in the system comes from here, so nothing can drift.
 *
 * From ../spec/tokens.json (W3C DTCG, the one source of truth):
 *   1. the custom-property block inside styles.css, between the GENERATED:TOKENS
 *      markers, and the light table's lamp layers, between the GENERATED:LAMPS
 *      markers (DECISIONS 064)
 *   2. tokens.generated.js — the same values as data, so the workbench cards can
 *      render swatches and scales without hardcoding a single literal
 *
 * From the @dsCard and @dsExample markers on the files themselves:
 *   3. _ds_manifest.json — the card index Claude Design ingests
 *   4. the workbench sidebar in index.html
 *
 * And, from all of the above, as the last step of a run (not part of generate()):
 *   5. dist/design-system/project/ — the Design System Artifact layout, written by
 *      export_design_system.js into a git-ignored folder; check 4t-export guards it
 *
 * Hand-written CSS below the styles.css END marker is never touched.
 * Run this after editing tokens.json or any @dsCard / @dsExample marker.
 *
 * Generation and writing are separate. generate() computes every output in
 * memory and touches nothing; running this file writes what it computed. The
 * validator calls generate() and compares the result with what is on disk
 * (check 4t), which is the only thing that proves the shipped files were built
 * from the CURRENT tokens rather than from whatever they said last time.
 *
 * CSS custom-property names are derived mechanically from token paths:
 *   semantic.color.text-primary  ->  --color-text-primary
 *   semantic.radius.pill         ->  --radius-pill
 *   primitive.color.neutral.500  ->  --color-neutral-500
 * so a name can always be recovered from a path and vice versa.
 */

const fs = require('fs');
const path = require('path');

const DS_DIR = __dirname;
const TOKENS_PATH = path.join(DS_DIR, '..', 'spec', 'tokens.json');
const STYLES_PATH = path.join(DS_DIR, 'styles.css');
const GENERATED_JS_PATH = path.join(DS_DIR, 'tokens.generated.js');
const MANIFEST_PATH = path.join(DS_DIR, '_ds_manifest.json');
const INDEX_PATH = path.join(DS_DIR, 'index.html');

const MODE_EXT = 'design.vellum.mode';
const START = '/* GENERATED:TOKENS:START';
const END = '/* GENERATED:TOKENS:END */';
const NAV_START = '<!-- GENERATED:NAV:START -->';
const NAV_END = '<!-- GENERATED:NAV:END -->';
const LAMPS_START = '/* GENERATED:LAMPS:START';
const LAMPS_END = '/* GENERATED:LAMPS:END */';

const keys = (o) => Object.keys(o).filter((k) => !k.startsWith('$'));
const isToken = (v) => v && typeof v === 'object' && !Array.isArray(v) && '$value' in v;

/** A build failure. main() prints it exactly as the build always has; generate() only throws it. */
class BuildError extends Error {
  constructor(headline, details = []) {
    super([headline, ...details].join('\n'));
    this.headline = headline;
    this.details = details;
  }
}

/* ---------------------------------------------------------------- flatten */

function flatten(tree) {
  const out = {};
  (function walk(node, prefix, inheritedType) {
    const type = node.$type || inheritedType;
    for (const key of keys(node)) {
      const value = node[key];
      const p = prefix ? `${prefix}.${key}` : key;
      if (isToken(value)) {
        out[p] = { ...value, $type: value.$type || type };
      } else if (value && typeof value === 'object') {
        walk(value, p, type);
      }
    }
  })(tree, '', undefined);
  return out;
}

/* ---------------------------------------------------------------- resolve */

function resolve(raw, flat, seen = []) {
  // A reference inside a longer value — a lamp's gradient naming a brand colour — is emitted
  // as var(), so the link survives into the CSS and a project that repoints the colour moves
  // everything built from it (GRAMMAR §3.5, DECISIONS 046). A whole-value reference still
  // resolves to the value itself, as it always has.
  if (typeof raw === 'string' && /\{[a-z0-9.-]+\}/i.test(raw) && !/^\{[^{}]+\}$/.test(raw)) {
    return raw.replace(/\{([a-z0-9.-]+)\}/gi, (whole, ref) => {
      if (!flat[ref]) throw new Error(`Dangling alias {${ref}} inside "${raw}"`);
      return `var(${cssName(ref)})`;
    });
  }
  if (typeof raw !== 'string' || !raw.startsWith('{') || !raw.endsWith('}')) return raw;
  const ref = raw.slice(1, -1);
  if (seen.includes(ref)) throw new Error(`Circular alias: ${[...seen, ref].join(' -> ')}`);
  const target = flat[ref];
  if (!target) throw new Error(`Dangling alias {${ref}} (referenced from ${seen[seen.length - 1] || 'root'})`);
  return resolve(target.$value, flat, [...seen, ref]);
}

/** Resolve a token for one mode. Falls through to the light value when a mode value is absent. */
function resolveMode(token, flat, mode) {
  const ext = token.$extensions && token.$extensions[MODE_EXT];
  const raw = mode === 'dark' && ext && ext.dark !== undefined ? ext.dark : token.$value;
  return resolve(raw, flat);
}

/* ------------------------------------------------------------ CSS output */

/** semantic.color.text-primary -> --color-text-primary ; primitive.color.neutral.500 -> --color-neutral-500 */
function cssName(tokenPath) {
  const parts = tokenPath.split('.');
  parts.shift(); // drop the layer (primitive / semantic)
  return `--${parts.join('-')}`;
}

function cssValue(token, resolved) {
  if (token.$type === 'cubicBezier' && Array.isArray(resolved)) {
    return `cubic-bezier(${resolved.join(', ')})`;
  }
  return String(resolved);
}

// Colour-like groups get a light and a dark emission; everything else is mode-invariant.
const DUAL_MODE_GROUPS = ['semantic.color.', 'semantic.elevation.', 'semantic.lamp.'];
const isDualMode = (p) => DUAL_MODE_GROUPS.some((g) => p.startsWith(g));

// A lamp's colour keeps its link to the palette. It is a whole-value reference, which
// would otherwise resolve to the hex; it is emitted as var(--brand-n) instead, so a project
// that repoints a brand colour moves the lamp lit by it, as the old gradient string did
// (GRAMMAR §3.5, DECISIONS 046, 064).
const KEEPS_LINK = /^semantic\.lamp\.[a-z]+-color$/;

/** The value a token is emitted with, for one mode. */
function emitValue(p, token, flat, mode) {
  if (KEEPS_LINK.test(p)) {
    const ext = token.$extensions && token.$extensions[MODE_EXT];
    const raw = mode === 'dark' && ext && ext.dark !== undefined ? ext.dark : token.$value;
    const m = /^\{([a-z0-9.-]+)\}$/i.exec(String(raw));
    if (m) {
      if (!flat[m[1]]) throw new Error(`Dangling alias {${m[1]}} (referenced from ${p})`);
      return `var(${cssName(m[1])})`;
    }
  }
  return cssValue(token, resolveMode(token, flat, mode));
}

/* ============================================================================
   The light table's lamps (DECISIONS 064)
   ----------------------------------------------------------------------------
   .light-table paints the lamps itself, as opaque radial-gradient layers: each
   stop is the lamp's colour pre-mixed into the canvas colour, and the layers
   combine per channel, darken in light and lighten in dark (GRAMMAR §2.3). No
   filter, and no translucent stop, so the rasteriser's dither survives and the
   field does not band.

   The softness blur() used to add is baked into the stops. A lamp drawn as a
   linear cone (1 at the centre to 0.3 at the box edge, transparent beyond 70% of
   the box) and blurred by sigma has, as a function of distance / radius, one
   fixed profile for each value of sigma / radius. blurredProfile() computes it
   numerically; the stops sample it at SEGMENTS + 1 points out to where it fades
   below 0.002. Ported from the feral-gradients experiment (tools/gen-d-css.mjs,
   itself a port of lamps.html's optionD()).

   Every number comes from tokens.json: each lamp's size, blur and pins, the
   per-mode scale and soft, the segment count. Softness is held constant at every
   width (the vw term of the blur). WIDTH_STEPS is where @media (min-width) steps
   would go to reproduce the old blur's px ceiling on wide windows. It is empty:
   the owner ruled for constant softness (DECISIONS 064).
   ========================================================================== */

const WIDTH_STEPS = []; // e.g. [1700, 2100, 2600]; each repeats the layers at that width's softness

const LAMP_MODES = [
  // The lamps are the only light in dark, so they add; in light they tint a table already lit (GRAMMAR §2.3).
  { id: 'light', blend: 'darken', selector: '.light-table' },
  { id: 'dark', blend: 'lighten', selector: '[data-theme="dark"] .light-table', screenOnly: true },
];

function blurredProfile(r, sigma) {
  const L = r + 3.2 * sigma, N = 256, h = (2 * L) / N, R0 = 0.7 * Math.SQRT2 * r;
  let a = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const px = -L + (x + 0.5) * h, py = -L + (y + 0.5) * h, dd = Math.hypot(px, py);
    a[y * N + x] = dd > r ? 0 : Math.max(0, 1 - dd / R0);
  }
  const s = sigma / h, rad = Math.ceil(3 * s), k = [];
  let ks = 0;
  for (let i = -rad; i <= rad; i++) { const v = Math.exp(-(i * i) / (2 * s * s)); k.push(v); ks += v; }
  for (let i = 0; i < k.length; i++) k[i] /= ks;
  const pass = (src, horiz) => {
    const dst = new Float32Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      let acc = 0;
      for (let i = -rad; i <= rad; i++) {
        const xx = horiz ? x + i : x, yy = horiz ? y : y + i;
        if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue;
        acc += src[yy * N + xx] * k[i + rad];
      }
      dst[y * N + x] = acc;
    }
    return dst;
  };
  a = pass(pass(a, true), false);
  const row = N / 2, prof = [];
  for (let x = N / 2; x < N; x++) prof.push({ d: (x + 0.5) * h - L, v: (a[row * N + x] + a[(row - 1) * N + x]) / 2 });
  return { L, prof };
}

function sampleProfile(P, dist) {
  const p = P.prof;
  if (dist <= p[0].d) return p[0].v;
  for (let i = 1; i < p.length; i++) {
    if (p[i].d >= dist) { const t = (dist - p[i - 1].d) / (p[i].d - p[i - 1].d); return p[i - 1].v + t * (p[i].v - p[i - 1].v); }
  }
  return 0;
}

const fmtNum = (v, dp) => String(+v.toFixed(dp));

/**
 * The blur's sigma as a fraction of the lamp's radius. With no width, the vw term alone:
 * constant softness. At a width, the clamp evaluated there, as the old filter drew it.
 */
function softnessRatio(blur, halfVw, scale, soft, widthPx) {
  const m = /^clamp\(\s*([\d.]+)px\s*,\s*([\d.]+)vw\s*,\s*([\d.]+)px\s*\)$/.exec(blur) || /^()([\d.]+)vw()$/.exec(blur);
  if (!m) return null;
  const vw = parseFloat(m[2]);
  if (widthPx == null) return (vw * soft) / (halfVw * scale);
  let px = (vw * widthPx) / 100;
  if (m[1] !== '') px = Math.min(Math.max(px, parseFloat(m[1])), parseFloat(m[3]));
  return (px * soft) / ((halfVw * widthPx * scale) / 100);
}

/** The stops for one lamp at one softness: fractions of the reach, and the weight at each. */
function lampStops(ratio, segments) {
  const R = 1000; // any radius gives the same curve; a large one keeps the sampling grid fine
  const P = blurredProfile(R, ratio * R);
  const reachPoint = P.prof.find((q) => q.v < 0.002 && q.d > R);
  const reach = reachPoint ? reachPoint.d : P.L;
  const stops = [];
  for (let i = 0; i <= segments; i++) stops.push({ f: (100 * i) / segments, w: i === segments ? 0 : sampleProfile(P, (reach * i) / segments) });
  return { rho: reach / R, stops };
}

/**
 * The generated lamp block for styles.css, from the tokens. Throws BuildError where a lamp
 * is not fully declared.
 */
function renderLamps(source, flat) {
  const lampGroup = (source.semantic || {}).lamp || {};
  const profile = ((lampGroup.$extensions || {})['design.vellum.profile']) || null;
  if (!profile || !profile.size || !profile.blur || !profile.soft || !Number.isInteger(profile.segments)) {
    throw new BuildError('semantic.lamp has no complete design.vellum.profile.', ['It needs segments, size, blur and soft, which the lamp layers are generated from (DECISIONS 064).']);
  }
  const problems = [];
  const lamps = keys(profile.size).filter((k) => !k.startsWith('$')).map((n) => {
    const size = /^([\d.]+)vw$/.exec(String(profile.size[n]));
    const blurRef = profile.blur[n];
    let blur = null;
    try { blur = String(resolve(blurRef, flat)); } catch (e) { problems.push(`lamp ${n}: ${e.message}`); }
    const x = flat[`semantic.lamp.${n}-left`] ? 'left' : flat[`semantic.lamp.${n}-right`] ? 'right' : null;
    if (!size) problems.push(`lamp ${n}: size ${JSON.stringify(profile.size[n])} is not a vw length`);
    if (blur !== null && softnessRatio(blur, 1, 1, 1, null) === null) problems.push(`lamp ${n}: blur ${JSON.stringify(blur)} is neither clamp(Apx, Bvw, Cpx) nor Bvw`);
    for (const t of [`${n}-color`, `${n}-opacity`, `${n}-top`]) if (!flat[`semantic.lamp.${t}`]) problems.push(`lamp ${n}: semantic.lamp.${t} is missing`);
    if (!x) problems.push(`lamp ${n}: neither semantic.lamp.${n}-left nor semantic.lamp.${n}-right is declared`);
    return { n, halfVw: size ? parseFloat(size[1]) / 2 : 0, blur, x };
  });
  if (!flat['semantic.lamp.scale']) problems.push('semantic.lamp.scale is missing');
  for (const mode of LAMP_MODES) if (typeof profile.soft[mode.id] !== 'number') problems.push(`profile soft has no ${mode.id} value`);
  if (!lamps.length) problems.push('the profile sizes no lamps');
  if (problems.length) throw new BuildError('The lamp layers could not be generated:', problems);

  const segments = profile.segments;
  const half = (l) => `${fmtNum(l.halfVw, 4)}vw * var(--lamp-scale)`;

  const layer = (l, spec) => {
    const n = l.n;
    const cx = l.x === 'left' ? `calc(var(--lamp-${n}-left) + ${half(l)})` : `calc(100% - var(--lamp-${n}-right) - ${half(l)})`;
    const cy = `calc(var(--lamp-${n}-top) + ${half(l)})`;
    const stops = spec.stops.map((s, i) => (i === spec.stops.length - 1
      ? `var(--color-bg-canvas) ${fmtNum(s.f, 3)}%`
      : `color-mix(in srgb, var(--lamp-${n}-color) calc(var(--lamp-${n}-opacity) * ${fmtNum(100 * s.w, 3)}%), var(--color-bg-canvas)) ${fmtNum(s.f, 3)}%`));
    return `    /* lamp ${n}: sigma/r ${fmtNum(spec.ratio, 5)}, reach ${fmtNum(spec.rho, 5)} r, peak ${fmtNum(spec.stops[0].w, 4)} of its opacity */\n`
      + `    radial-gradient(circle calc(${half(l)} * ${fmtNum(spec.rho, 5)}) at ${cx} ${cy} in srgb,\n      `
      + stops.join(',\n      ') + ')';
  };

  const rules = [];
  for (const widthPx of [null, ...WIDTH_STEPS]) {
    for (const mode of LAMP_MODES) {
      const scale = Number(resolveMode(flat['semantic.lamp.scale'], flat, mode.id));
      const soft = profile.soft[mode.id];
      const layers = lamps.map((l) => {
        const ratio = softnessRatio(l.blur, l.halfVw, scale, soft, widthPx);
        return layer(l, { ratio, ...lampStops(ratio, segments) });
      });
      let rule = [
        `/* ${mode.id}: --lamp-scale ${fmtNum(scale, 4)}, soft ${fmtNum(soft, 4)}${widthPx == null ? ', at every width' : `, from ${widthPx}px`} */`,
        `${mode.selector} {`,
        '  background:',
        `${layers.join(',\n')},`,
        '    var(--color-bg-canvas);',
        `  background-blend-mode: ${mode.blend};`,
        '}',
      ].join('\n');
      if (mode.screenOnly) rule = `@media screen {\n${rule}\n}`;
      if (widthPx != null) rule = `@media (min-width: ${widthPx}px) {\n${rule}\n}`;
      rules.push(rule);
    }
  }

  return [
    `${LAMPS_START} — built from ../spec/tokens.json by build.js (DECISIONS 064).`,
    '   Do not edit between these markers; your changes will be overwritten.',
    '   Each lamp is an opaque radial-gradient layer on .light-table: every stop is',
    '   the lamp colour, at its opacity times the blurred profile, pre-mixed into the',
    '   canvas colour. A project repoints a lamp with --lamp-a-color and',
    '   --lamp-a-opacity (and b, c), per mode, and moves it with the pins and',
    '   --lamp-scale. Dark is a screen mode, as in the token block (DECISIONS 042). */',
    '',
    rules.join('\n\n'),
    '',
    LAMPS_END,
  ].join('\n');
}

/* ------------------------------------------------ tokens.generated.js output */

function renderGeneratedJs(data, source) {
  return `/**
 * GENERATED by build.js from ../spec/tokens.json — do not edit.
 *
 * The workbench foundation cards read this so every swatch, scale row, and
 * coverage table renders the value the CSS actually ships. A doc page and the
 * stylesheet cannot disagree if neither one holds a literal.
 *
 * Deliberately a CLASSIC script, not an ES module. The workbench is opened
 * straight from disk, and browsers fetch ES modules with CORS — which a file://
 * origin cannot satisfy, so \`import\` would leave every card blank. A classic
 * script assigning to a global works over file://, over http, and in Node.
 *
 * Browser:  <script src="../tokens.generated.js"></script>
 *           const { LIGHT, DARK, META } = VellumTokens;
 * Node:     const { LIGHT } = require('./tokens.generated.js');
 */
var VellumTokens = (function () {
  /** Resolved values, keyed by CSS custom-property name. */
  var LIGHT = ${JSON.stringify(data.light, null, 2)};
  var DARK = ${JSON.stringify(data.dark, null, 2)};

  /** Path, $type, alias target, dual-mode flag, and description per token. */
  var META = ${JSON.stringify(data.meta, null, 2)};

  return {
    NAME: ${JSON.stringify(source.name)},
    VERSION: ${JSON.stringify(source.version)},
    LIGHT: LIGHT,
    DARK: DARK,
    META: META,

    /** Values for whichever mode is currently active on <html>. */
    active: function () {
      return document.documentElement.getAttribute('data-theme') === 'dark' ? DARK : LIGHT;
    },

    /** Both modes for one custom property, e.g. modes('--color-text-primary'). */
    modes: function (name) {
      return { light: LIGHT[name], dark: DARK[name] };
    },

    /** Every custom property under a group prefix, e.g. group('--radius-'). */
    group: function (prefix) {
      return Object.keys(META).filter(function (n) { return n.indexOf(prefix) === 0; });
    },

    /** Every custom property whose token path starts with a prefix. */
    byPath: function (prefix) {
      return Object.keys(META).filter(function (n) { return META[n].path.indexOf(prefix) === 0; });
    },
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = VellumTokens;
`;
}

/* ============================================================================
   Manifest and workbench navigation
   ----------------------------------------------------------------------------
   The @dsCard marker on line 1 of each card, and the @dsExample marker in each
   example entry, are the single authority for how a card is named. The manifest
   and the sidebar are both generated from them, so the three cannot drift apart.
   ========================================================================== */

const GROUP_ORDER = ['Foundations', 'Components'];

// Reading order, not alphabetical order. The grammar comes first because it is the
// document that decides whether everything after it may be changed; the rest runs
// from the most primitive decision (colour, type) outward to the most composed.
const CARD_ORDER = [
  'foundations/grammar.html',
  'foundations/color.html',
  'foundations/type.html',
  'foundations/sheets.html',
  'foundations/layout.html',
  'foundations/icons.html',
  'foundations/wayfinding.html',
  'foundations/antipatterns.html',
  'foundations/states.html',
  'foundations/specimen.html',
  'foundations/cmf.html',
  'foundations/print.html',
  'components/buttons.html',
  'components/console.html',
  'components/cards.html',
  'components/navigation.html',
  'components/forms.html',
  'components/table.html',
  'components/dialog.html',
];

function collect(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) collect(p, out);
    else if (e.name.endsWith('.html')) out.push(p);
  }
  return out;
}

const attrOf = (text, key) => {
  const m = new RegExp(`${key}="([^"]*)"`).exec(text);
  return m ? m[1].replace(/&amp;/g, '&') : null;
};

const escHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/'/g, '&#39;');

/* ------------------------------------------------------------------ build */

/**
 * Compute every build output from the current tokens.json and markers, in memory.
 * Reads, never writes. Throws BuildError where the build would have refused.
 *
 * Returns { outputs: [{ path, label, text }], stats }. The styles.css and
 * index.html texts are the WHOLE file with the generated region spliced in, so
 * each output can be compared with, or written over, its file as a unit.
 */
function generate() {
  const source = JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf8'));
  const flat = flatten(source);

  // Only colours are emitted from the primitive layer — every other primitive is
  // reachable through semantics, which is the point of having a semantic layer.
  //
  // Colours are the exception because two legitimate cases need a mode-INVARIANT
  // reference: a tonal ramp used as a palette, and a material or ink sample that
  // must show the same value in both modes (a bead-blasted aluminium swatch stays
  // the light value under dark — it is depicting a physical substrate, not a UI surface).
  const primitivePaths = Object.keys(flat).filter((p) => /^primitive\.color\./.test(p));
  const semanticPaths = Object.keys(flat).filter((p) => p.startsWith('semantic.'));

  const errors = [];

  // Every dual-mode token must actually declare a dark value. This is the
  // check that makes "light AND dark for every one" enforceable rather than aspirational.
  for (const p of semanticPaths.filter(isDualMode)) {
    const ext = flat[p].$extensions && flat[p].$extensions[MODE_EXT];
    if (!ext || ext.dark === undefined) {
      errors.push(`${p} is missing its dark value ($extensions['${MODE_EXT}'].dark)`);
    }
  }
  if (errors.length) throw new BuildError('Token build failed:', errors);

  function emitGroup(paths, mode, label) {
    const lines = [];
    let lastGroup = null;
    for (const p of paths) {
      const group = p.split('.').slice(0, 2).join('.');
      if (group !== lastGroup) {
        if (lastGroup !== null) lines.push('');
        lines.push(`  /* ${group.replace('.', ' · ')}${label ? ` (${label})` : ''} */`);
        lastGroup = group;
      }
      const token = flat[p];
      lines.push(`  ${cssName(p)}: ${emitValue(p, token, flat, mode)};`);
    }
    return lines.join('\n');
  }

  const iceBlock = [
    `${START} — built from ../spec/tokens.json by build.js.`,
    `   Do not edit between these markers; your changes will be overwritten.`,
    `   Component CSS below the END marker is hand-written and is never touched. */`,
    '',
    ':root {',
    emitGroup(primitivePaths, 'light', null),
    '',
    emitGroup(semanticPaths, 'light', null),
    '}',
    '',
    '/* Dark mode. Only the mode-dependent roles are redeclared — everything',
    '   else inherits from :root, so a role can never exist in one mode only.',
    '   Dark is a screen mode: paper always takes the light values, whatever mode',
    '   the reader printed from (GRAMMAR §2.11, DECISIONS 042). */',
    '@media screen {',
    '[data-theme="dark"] {',
    emitGroup(semanticPaths.filter(isDualMode), 'dark', 'Dark'),
    '}',
    '}',
    '',
    END,
  ].join('\n');

  /* --------------------------------------------------- splice into styles.css */

  const css = fs.readFileSync(STYLES_PATH, 'utf8');
  const startIdx = css.indexOf(START);
  const endIdx = css.indexOf(END);

  if (startIdx === -1 || endIdx === -1) {
    throw new BuildError('styles.css is missing the GENERATED:TOKENS markers.', [`Expected "${START} ... ${END}".`]);
  }

  let nextCss = css.slice(0, startIdx) + iceBlock + css.slice(endIdx + END.length);

  // The lamp layers, in their own block beside the hand-written .light-table rule: they are
  // rules on an element, not custom properties, so they do not belong in the token block.
  const lampsStartIdx = nextCss.indexOf(LAMPS_START);
  const lampsEndIdx = nextCss.indexOf(LAMPS_END);
  if (lampsStartIdx === -1 || lampsEndIdx === -1) {
    throw new BuildError('styles.css is missing the GENERATED:LAMPS markers.', [`Expected "${LAMPS_START} ... ${LAMPS_END}".`]);
  }
  nextCss = nextCss.slice(0, lampsStartIdx) + renderLamps(source, flat) + nextCss.slice(lampsEndIdx + LAMPS_END.length);

  /* ---------------------------------------------- tokens.generated.js data */

  const data = { light: {}, dark: {}, meta: {} };
  for (const p of [...primitivePaths, ...semanticPaths]) {
    const token = flat[p];
    const name = cssName(p);
    data.light[name] = emitValue(p, token, flat, 'light');
    data.dark[name] = emitValue(p, token, flat, 'dark');
    data.meta[name] = {
      path: p,
      type: token.$type || null,
      alias: typeof token.$value === 'string' && token.$value.startsWith('{') ? token.$value.slice(1, -1) : null,
      dualMode: isDualMode(p),
      description: token.$description || null,
    };
    // A status role says whether its job is fixed (with the hue range it may move in) or free,
    // so a card can state the rule from the tokens (GRAMMAR §3.9, DECISIONS 058).
    const status = (token.$extensions || {})['design.vellum.status'];
    if (status) data.meta[name].status = status;
  }

  const generatedJs = renderGeneratedJs(data, source);

  /* ------------------------------------------------------ cards and examples */

  const cards = [];
  const examples = [];

  for (const file of collect(DS_DIR)) {
    const relPath = path.relative(DS_DIR, file).replace(/\\/g, '/');
    // A card marker is always line 1. An example marker sits in the preamble, which
    // for a .dc.html canvas file runs past its <helmet> block — hence the wider window.
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    const head = lines[0];
    const preamble = lines.slice(0, 14).join('\n');

    if (head.includes('@dsCard')) {
      cards.push({
        path: relPath,
        group: attrOf(head, 'group'),
        viewport: attrOf(head, 'viewport'),
        subtitle: attrOf(head, 'subtitle'),
        name: attrOf(head, 'name'),
      });
    }
    if (preamble.includes('@dsExample')) {
      // Scope attribute lookup to the marker line so an example's own page content
      // can never be mistaken for its metadata.
      const exMarker = preamble.split('\n').find((l) => l.includes('@dsExample'));
      // minWidth marks a FIXED-VIEWPORT format (GRAMMAR 2.12): a deck is composed
      // at a fixed aspect and is not expected to reflow. Everything without it must
      // be responsive, and the validator enforces exactly that split.
      const minWidth = attrOf(exMarker, 'minWidth');
      examples.push({
        name: attrOf(exMarker, 'name'),
        description: attrOf(exMarker, 'description'),
        folder: path.dirname(relPath),
        entryPath: relPath,
        ...(minWidth ? { minWidth: Number(minWidth) } : {}),
      });
    }
  }

  cards.sort((a, b) => {
    const g = GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group);
    if (g !== 0) return g;
    const ia = CARD_ORDER.indexOf(a.path);
    const ib = CARD_ORDER.indexOf(b.path);
    // A card not yet listed sorts to the end of its group rather than disappearing.
    return (ia === -1 ? Infinity : ia) - (ib === -1 ? Infinity : ib) || a.path.localeCompare(b.path);
  });

  const unordered = cards.filter((c) => !CARD_ORDER.includes(c.path));
  examples.sort((a, b) => a.name.localeCompare(b.name));

  /* --------------------------------------------------------------- manifest */

  const existing = fs.existsSync(MANIFEST_PATH) ? JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')) : {};

  const manifest = {
    namespace: 'Vellum',
    // Vestigial, and preserved rather than dropped on purpose. Both have been
    // empty since RC1 and nothing here populates them: the Design System pane
    // builds its index from the @dsCard marker on each card's first line, which
    // is what `cards` below carries. `existing.* || []` means that if the host
    // ever writes into them, a local rebuild will not erase it — which is why
    // these are not simply deleted while the sync remains untested.
    components: existing.components || [],
    startingPoints: existing.startingPoints || [],
    cards,
    examples,
    hasThumbnailHtml: fs.existsSync(path.join(DS_DIR, 'thumbnail.html')),
    globalCssPaths: ['styles.css'],
    // Advertise the roles, not the ramps: a consumer picking a colour should be
    // choosing by meaning, and the ramps are reachable through them.
    tokens: semanticPaths
      .filter((p) => isDualMode(p) || /^semantic\.(font|radius|blur|type)\./.test(p))
      .map((p) => ({
        name: cssName(p),
        value: emitValue(p, flat[p], flat, 'light'),
        kind: (flat[p].$type || 'other').toLowerCase(),
        definedIn: 'styles.css',
      })),
    themes: [
      { name: 'Light', selector: ':root', description: 'Light mode. Light ground, sheets lit from behind.' },
      { name: 'Dark', selector: '[data-theme="dark"]', description: 'Dark mode. Dark ground, dark sheets over dim lamps.' },
    ],
    fonts: [],
    brandFonts: [
      { family: 'Geist', status: 'ok', tokens: ['--font-display'], path: 'styles.css' },
      { family: 'Inter', status: 'ok', tokens: ['--font-body'], path: 'styles.css' },
      { family: 'JetBrains Mono', status: 'ok', tokens: ['--font-mono'], path: 'styles.css' },
    ],
    source: 'spa',
  };

  const manifestJson = JSON.stringify(manifest, null, 2) + '\n';

  /* ------------------------------------------------------ workbench sidebar */

  const navLines = [NAV_START];
  let lastGroup = null;
  for (const card of cards) {
    if (card.group !== lastGroup) {
      navLines.push(`    <div class="nav-section-title">${escHtml(card.group)}</div>`);
      lastGroup = card.group;
    }
    navLines.push(
      `    <div class="nav-item" onclick="loadCard('${card.path}', this)">${escHtml(card.name)}</div>`
    );
  }
  navLines.push('    <div class="nav-section-title">Examples</div>');
  for (const ex of examples) {
    navLines.push(
      `    <div class="nav-item" onclick="loadCard('${ex.entryPath}', this)">${escHtml(ex.name)}</div>`
    );
  }
  navLines.push(`    <div class="nav-item" onclick="loadCard('thumbnail.html', this)">Cover Thumbnail</div>`);
  navLines.push(`    ${NAV_END}`);

  const indexHtml = fs.readFileSync(INDEX_PATH, 'utf8');
  const navStartIdx = indexHtml.indexOf(NAV_START);
  const navEndIdx = indexHtml.indexOf(NAV_END);
  if (navStartIdx === -1 || navEndIdx === -1) {
    throw new BuildError('index.html is missing the GENERATED:NAV markers.');
  }
  const nextIndexHtml =
    indexHtml.slice(0, navStartIdx) + navLines.join('\n').trimStart() + indexHtml.slice(navEndIdx + NAV_END.length);

  return {
    outputs: [
      { path: STYLES_PATH, label: 'styles.css GENERATED:TOKENS and GENERATED:LAMPS blocks', text: nextCss },
      { path: GENERATED_JS_PATH, label: 'tokens.generated.js', text: generatedJs },
      { path: MANIFEST_PATH, label: '_ds_manifest.json', text: manifestJson },
      { path: INDEX_PATH, label: 'index.html GENERATED:NAV sidebar', text: nextIndexHtml },
    ],
    stats: {
      primitives: primitivePaths.length,
      semantics: semanticPaths.length,
      dual: semanticPaths.filter(isDualMode).length,
      cards: cards.length,
      examples: examples.length,
      unordered: unordered.map((c) => c.path),
      entries: Object.keys(data.meta).length,
      advertised: manifest.tokens.length,
    },
  };
}

/* ------------------------------------------------------------------ write */

function main() {
  let built;
  try {
    built = generate();
  } catch (e) {
    if (!(e instanceof BuildError)) throw e;
    console.error(`\x1b[31m✖ ${e.headline}\x1b[0m`);
    e.details.forEach((d) => console.error('  ' + d));
    process.exit(1);
  }

  const { outputs, stats } = built;
  if (stats.unordered.length) {
    console.warn(`  ⚠ not in CARD_ORDER, appended to group: ${stats.unordered.join(', ')}`);
  }
  for (const o of outputs) fs.writeFileSync(o.path, o.text, 'utf8');

  console.log('=== Vellum: build ===');
  console.log(`  source        ${path.relative(DS_DIR, TOKENS_PATH).replace(/\\/g, '/')}`);
  console.log(`  primitives    ${stats.primitives} ramp steps emitted`);
  console.log(`  semantics     ${stats.semantics} roles (${stats.dual} dual-mode, ${stats.semantics - stats.dual} mode-invariant)`);
  console.log(`  cards         ${stats.cards} from @dsCard markers`);
  console.log(`  examples      ${stats.examples} from @dsExample markers`);
  console.log(`  -> styles.css            token block and lamp layers spliced between markers`);
  console.log(`  -> tokens.generated.js   ${stats.entries} entries`);
  console.log(`  -> _ds_manifest.json     ${stats.advertised} tokens advertised`);
  console.log(`  -> index.html            sidebar regenerated`);

  // The Design System export is derived from the outputs just written, so it
  // runs last. It writes to dist/design-system/ (git-ignored), never into the
  // system, and check 4t-export compares it with the sources. DECISIONS 063 follow-up.
  const { writeExport } = require(path.join(DS_DIR, 'export_design_system.js'));
  const exported = writeExport({ quiet: true });
  console.log(`  -> dist/design-system/   ${Object.keys(exported.files).length} files, ${exported.report.carried.length} tokens carried, ${exported.report.dropped.length} dropped`);
  if (exported.problems.length) {
    console.error(`\x1b[31m✖ The Design System export breaks the format's rules:\x1b[0m`);
    exported.problems.forEach((p) => console.error('  ' + p));
    process.exit(1);
  }
  console.log('\x1b[32m✔ Build passed\x1b[0m');
}

module.exports = { generate, BuildError, START, END, NAV_START, NAV_END, LAMPS_START, LAMPS_END };

if (require.main === module) main();
