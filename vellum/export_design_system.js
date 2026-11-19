#!/usr/bin/env node
/**
 * Vellum — Design System export.
 *
 * Lays Vellum out as the `project/` tree of Claude's "Design System" Artifact
 * type (format reference: the type's SKILL.md and artifact-type/reference/
 * format.md, read 2026-11-18). The repository stays the single source; this is
 * a derived view of it, written to a git-ignored folder and never committed.
 *
 *   node systems/vellum/export_design_system.js     write dist/design-system/project/
 *   node systems/vellum/build.js                     does the same as its last step
 *
 * Like build.js, generation and writing are separate. generateExport() computes
 * every file in memory and touches nothing; the validator (check 4t-export) calls it to
 * prove every token is either carried at the value styles.css ships or dropped
 * with a stated reason, that the tree keeps the format's caps and name rules,
 * and, when the folder exists, that what is on disk is what the sources say now.
 *
 * Every value comes from the current build (build.js generate(), the same
 * in-memory outputs check 4t compares), the card files, readme.md and the spec.
 * Nothing here holds a design value of its own.
 *
 * Not published from here. Publishing is a separate, owner-approved step.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DS_DIR = __dirname;
const REPO = path.join(DS_DIR, '..', '..');
const SPEC_DIR = path.join(DS_DIR, '..', 'spec');
const OUT_ROOT = path.join(REPO, 'dist', 'design-system');
const OUT_DIR = path.join(OUT_ROOT, 'project');

const TITLE = 'Vellum';
const NAMESPACE = 'Vellum';
const THEMES = [{ id: 'light', name: 'Light' }, { id: 'dark', name: 'Dark' }];

/* ------------------------------------------------------------ format rules */
// From the type's format.md. Kept here, beside the code that must obey them,
// so the validator reads the same numbers the generator was written against.
const RULES = {
  name: /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/,
  ident: /^[A-Za-z_$][A-Za-z0-9_$]*$/,
  maxColors: 600,
  maxOtherFamilies: 12,
  maxOtherTokens: 60,
  maxTypeGroups: 12,
  maxStyles: 80,
  maxThemes: 8,
  maxSections: 24,
  maxUsage: 1000,
  maxFiles: 4080,
  bytes: {
    'README.md': 200 * 1024,
    'tokens.json': 512 * 1024,
    'components/bundle.css': 2 * 1024 * 1024,
    preview: 256 * 1024,
    componentReadme: 64 * 1024,
    other: 512 * 1024,
    file: 15 * 1024 * 1024,
  },
  cardHeight: [40, 4000],
  coverHeight: [240, 360],
};

/* ------------------------------------------------------------ value grammar */

const balanced = (s) => {
  let d = 0;
  for (const c of s) {
    if (c === '(') d++;
    if (c === ')' && --d < 0) return false;
  }
  return d === 0;
};
const NUM = String.raw`[-+]?(?:\d+\.?\d*|\.\d+)(?:%|deg|turn|rad)?`;
const COLOR_FN = new RegExp(String.raw`^(rgba?|hsla?|oklch|oklab|lab|lch|color)\(\s*(?:${NUM}|[a-z-]+)(?:\s*[,/ ]\s*(?:${NUM}))*\s*\)$`, 'i');

/** Why a colour value would drop, or null if the page reads it. */
function colorProblem(v) {
  if (typeof v !== 'string') return 'not a string';
  if (/var\(/i.test(v)) return 'uses var()';
  if (/color-mix\(/i.test(v)) return 'uses color-mix()';
  if (/gradient\(/i.test(v)) return 'is a gradient';
  if (/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v)) return null;
  if (COLOR_FN.test(v.trim())) return null;
  return 'is not a hex or plain colour function';
}

/** Why a shadow value would drop, or null. */
function shadowProblem(v) {
  if (/var\(|url\(/i.test(v)) return 'uses var() or url()';
  if (v.length > 400) return 'is longer than 400 characters';
  if (!balanced(v)) return 'has unbalanced parentheses';
  return null;
}

/** Why a length (spacing, radius, fontSize, letterSpacing) would drop, or null. */
function lengthProblem(v) {
  if (/^[-+]?(\d+\.?\d*|\.\d+)(px|rem|em|%)?$/.test(String(v))) return null;
  if (/clamp\(/.test(v)) return 'uses clamp(), which a length field cannot hold';
  if (/max\(|min\(|calc\(/.test(v)) return 'is a CSS function, which a length field cannot hold';
  return 'is not a px, rem, em or % length';
}

/** Why a value in an "other" family would drop, or null. */
function otherProblem(v) {
  if (/var\(/i.test(v)) return 'uses var()';
  if (/url\(/i.test(v)) return 'uses url()';
  if (v.length > 200) return 'is longer than 200 characters';
  if (!/^[A-Za-z0-9 #%(),./+_-]*$/.test(v)) return 'holds a character an other-family value may not';
  if (!balanced(v)) return 'has unbalanced parentheses';
  return null;
}

/* ------------------------------------------------------------ token routing */
// Which export family each token group goes to, in the order the families are
// written. Names are Vellum's own CSS custom-property names without the "--",
// so the tokens.css the page compiles declares exactly the properties
// styles.css declares, under the same names.
const ROUTES = [
  { test: /^semantic\.color\./, family: 'color' },
  { test: /^semantic\.brand\./, family: 'color' },
  { test: /^semantic\.print\./, family: 'color' },
  { test: /^primitive\.color\./, family: 'color' },
  { test: /^semantic\.elevation\./, family: 'shadow' },
  { test: /^semantic\.space\./, family: 'spacing' },
  { test: /^semantic\.radius\./, family: 'radius' },
  { test: /^semantic\.font\./, family: 'type.families' },
  { test: /^semantic\.type\./, family: 'fontSize' },
  { test: /^semantic\.weight\./, family: 'fontWeight' },
  { test: /^semantic\.tracking\./, family: 'letterSpacing' },
  { test: /^semantic\.leading\./, family: 'lineHeight' },
  { test: /^semantic\.blur\./, family: 'blur' },
  { test: /^semantic\.duration\./, family: 'duration' },
  { test: /^semantic\.easing\./, family: 'easing' },
  { test: /^semantic\.breakpoint\./, family: 'breakpoint' },
  { test: /^semantic\.deck\./, family: 'deck' },
  // A lamp's colour is a whole-value reference to a palette colour (DECISIONS 064),
  // which the format carries as a colour alias, per theme.
  { test: /^semantic\.lamp\.[a-z0-9]+-color$/, family: 'color' },
  { test: /^semantic\.lamp\./, family: 'lamp' },
];
const OTHER_NOTES = {
  fontSize: 'The type scale as CSS values. Steps written with clamp() are fluid: they are listed here as text, and the Typography view cannot show them as styles.',
  fontWeight: 'The weight ladder. 600 is not a step.',
  letterSpacing: 'Tracking roles. Display tracking tightens with size and is never positive.',
  lineHeight: 'Leading roles, unitless.',
  blur: 'Backdrop blur per sheet depth, and the lamp blurs.',
  duration: 'Motion durations. The format has no motion section; these are shown as plain values.',
  easing: 'The one easing curve. The format has no motion section; this is shown as a plain value.',
  breakpoint: 'Layout breakpoints.',
  deck: 'Deck-medium sizes for 16:9 slides.',
  lamp: 'The lamp positions that are the same in both modes. The lamps themselves do not carry (see README, Not synced).',
};

// Type styles are lifted from the base rules in styles.css, which is where the
// system pairs a size with its family, weight, tracking and leading. tokens.json
// keeps those scales separate and records no pairing, so this list only names
// which selector each style is read from; every value is read from the CSS.
const TYPE_STYLES = [
  { name: 'text-h1', selector: 'h1', usage: 'h1.' },
  { name: 'text-h2', selector: 'h2', usage: 'h2, section titles.' },
  { name: 'text-h3', selector: 'h3', usage: 'h3, card titles.' },
  { name: 'text-h4', selector: 'h4', usage: 'h4.' },
  { name: 'text-h5', selector: 'h5', usage: 'h5.' },
  { name: 'text-h6', selector: 'h6', usage: 'h6.' },
  { name: 'text-statement', selector: '.statement-stack', usage: 'The statement banner (.statement-stack).' },
  { name: 'text-card-title', selector: '.card-feature-title', usage: 'Feature card titles (.card-feature-title).' },
  { name: 'text-body', selector: 'body', usage: 'Running prose; the base size.' },
  { name: 'text-faq', selector: '.faq-trigger', usage: 'FAQ questions (.faq-trigger).' },
  { name: 'text-spec-list', selector: '.spec-list', usage: 'Lists set in small type (.spec-list).' },
  { name: 'text-label', selector: '.label', usage: 'Monospace labels (.label).' },
  { name: 'text-tag', selector: '.tag-pill', usage: 'Pills (.tag-pill).' },
  { name: 'text-table-head', selector: '.data-table th', usage: 'Table headers (.data-table th).' },
  { name: 'text-code', selector: 'code', usage: 'Inline code.' },
];
const GROUP_OF_FAMILY = { display: 'Display', body: 'Body', mono: 'Mono' };

// Cards whose component identifier would not read well from the file name alone.
const CARD_IDENT = { 'foundations/cmf.html': 'CMF' };

/* ------------------------------------------------------------ CSS scanning */

/** Top-level rules of a stylesheet, outside any at-rule block, in order. */
function topLevelRules(css) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('{', i);
    if (open === -1) break;
    const prelude = text.slice(i, open).trim();
    // Find the matching close brace.
    let depth = 1;
    let j = open + 1;
    while (j < text.length && depth) {
      if (text[j] === '{') depth++;
      else if (text[j] === '}') depth--;
      j++;
    }
    const block = text.slice(open + 1, j - 1);
    const lastSemi = prelude.lastIndexOf(';');
    const sel = (lastSemi === -1 ? prelude : prelude.slice(lastSemi + 1)).trim();
    if (!sel.startsWith('@') && !block.includes('{')) {
      const decls = {};
      for (const d of block.split(';')) {
        const k = d.indexOf(':');
        if (k === -1) continue;
        decls[d.slice(0, k).trim()] = d.slice(k + 1).trim();
      }
      rules.push({ selectors: sel.split(',').map((s) => s.trim().replace(/\s+/g, ' ')), decls });
    }
    i = j;
  }
  return rules;
}

/** Every class selector defined anywhere in a stylesheet. */
function classesDefined(css) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = new Set();
  for (const m of text.matchAll(/([^{}]+)\{/g)) {
    if (m[1].trim().startsWith('@')) continue;
    for (const c of m[1].matchAll(/\.([A-Za-z_][\w-]*)/g)) out.add(c[1]);
  }
  return out;
}

/* ------------------------------------------------------------ helpers */

const LF = (s) => s.replace(/\r\n/g, '\n');
const read = (p) => LF(fs.readFileSync(p, 'utf8'));
const attrOf = (text, key) => {
  const m = new RegExp(`${key}="([^"]*)"`).exec(text);
  return m ? m[1] : null;
};
const unescapeHtml = (s) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const cssNameToToken = (n) => n.replace(/^--/, '');

/** A token's usage note: its own $description, else its nearest group's. */
function usageFor(source, tokenPath) {
  const parts = tokenPath.split('.');
  let node = source;
  const chain = [];
  for (const p of parts) {
    node = node && node[p];
    chain.push(node);
  }
  for (let k = chain.length - 1; k >= 0; k--) {
    const d = chain[k] && chain[k].$description;
    if (d) return d.length > RULES.maxUsage ? d.slice(0, RULES.maxUsage - 1) + '…' : d;
  }
  return null;
}

/** Drop a YAML frontmatter block; the brand book renders it as stray text. */
const stripFrontmatter = (md) => md.replace(/^---\n[\s\S]*?\n---\n+/, '');

/**
 * Repoint markdown links at where the file sits in the export, and unlink any
 * whose target the export does not carry. The link text is always kept.
 */
function repairLinks(md, map) {
  return md.replace(/(!?)\[([^\]]*)\]\(([^)\s]+)\)/g, (whole, bang, text, target) => {
    if (/^(https?:|mailto:|#)/.test(target)) return whole;
    const bare = target.split('#')[0];
    const key = bare.replace(/^\.\//, '').replace(/^(\.\.\/)+/, '').replace(/^spec\//, '');
    if (Object.prototype.hasOwnProperty.call(map, key)) {
      const to = map[key];
      return to ? `${bang}[${text}](${to})` : text;
    }
    return text;
  });
}

/* ================================================================ generate */

/**
 * Compute the whole project/ tree in memory. Reads, never writes.
 *
 * Returns {
 *   files:    { '<path under project/>': text },
 *   tokens:   the tokens.json object,
 *   report:   { carried: [...], dropped: [...], textOnly: [...], styles: {...}, cards: [...] },
 * }
 * `now` stamps design-system.json only; nothing else in the tree depends on time.
 */
function generateExport({ now = new Date().toISOString() } = {}) {
  const { generate } = require(path.join(DS_DIR, 'build.js'));
  const built = generate();
  const outOf = (base) => built.outputs.find((o) => path.basename(o.path) === base).text;

  // The values exactly as the current build ships them.
  const stylesCss = LF(outOf('styles.css'));
  const generatedJs = LF(outOf('tokens.generated.js'));
  const VT = vm.runInNewContext(`${generatedJs}\n;VellumTokens`, {}, { timeout: 1000 });
  const source = JSON.parse(read(path.join(SPEC_DIR, 'tokens.json')));

  const report = { carried: [], dropped: [], textOnly: [], styles: { carried: [], dropped: [] }, cards: [], unrouted: [] };
  const drop = (name, p, family, reason) => report.dropped.push({ name, path: p, family, reason });

  const color = [];
  const shadow = [];
  const spacing = [];
  const radius = [];
  const families = {};
  const others = {};

  // Order: semantic roles first, in tokens.json order, then the primitive ramps.
  const names = Object.keys(VT.META);
  const ordered = [
    ...names.filter((n) => VT.META[n].path.startsWith('semantic.')),
    ...names.filter((n) => VT.META[n].path.startsWith('primitive.')),
  ];

  // Colours the export carries as literal values: the only valid alias targets.
  const colorLiteral = new Set(ordered
    .filter((n) => { const r = ROUTES.find((x) => x.test.test(VT.META[n].path)); return r && r.family === 'color'; })
    .filter((n) => !colorProblem(VT.LIGHT[n]) && !colorProblem(VT.DARK[n]))
    .map(cssNameToToken));

  for (const cssName of ordered) {
    const meta = VT.META[cssName];
    const p = meta.path;
    const name = cssNameToToken(cssName);
    const light = VT.LIGHT[cssName];
    const dark = VT.DARK[cssName];
    const perMode = meta.dualMode && dark !== light;
    const route = ROUTES.find((r) => r.test.test(p));
    if (!route) { report.unrouted.push(p); continue; }
    const usage = usageFor(source, p);
    const entry = (value) => (usage ? { name, value, usage } : { name, value });

    if (route.family === 'color') {
      // A value that is exactly var(--x), where x is a colour this export carries
      // as a literal, becomes the format's alias "{x}" (compiled back to var(--x)).
      const asAlias = (v) => {
        const m = /^var\(--([a-z0-9-]+)\)$/.exec(String(v));
        return m && colorLiteral.has(m[1]) ? `{${m[1]}}` : v;
      };
      const l = asAlias(light);
      const d = asAlias(dark);
      const problem = (v) => (/^\{[a-z0-9-]+\}$/.test(v) ? null : colorProblem(v));
      const bad = problem(l) || (perMode && problem(d));
      if (bad) { drop(name, p, 'color', `value ${bad}`); continue; }
      color.push(entry(perMode ? { light: l, dark: d } : l));
    } else if (route.family === 'shadow') {
      const bad = shadowProblem(light) || (perMode && shadowProblem(dark));
      if (bad) { drop(name, p, 'shadow', `value ${bad}`); continue; }
      shadow.push(entry(perMode ? { light, dark } : light));
    } else if (route.family === 'spacing' || route.family === 'radius') {
      const bad = lengthProblem(light) || (perMode && 'differs by mode, which this family cannot hold');
      if (bad) { drop(name, p, route.family, `value ${bad}`); continue; }
      (route.family === 'spacing' ? spacing : radius).push(entry(light));
    } else if (route.family === 'type.families') {
      const key = name.replace(/^font-/, '');
      if (/[;{}<>\\()]/.test(light) || light.length > 200) { drop(name, p, 'type.families', 'stack holds a character a family stack may not'); continue; }
      families[key] = light;
    } else {
      // Every other family holds ONE plain CSS value per token, in every mode.
      // Name every reason, the value's own first: a lamp gradient would drop
      // for its var() and color-mix() even if it were the same in both modes.
      const reasons = [];
      const ownBad = otherProblem(String(light)) || (perMode && otherProblem(String(dark)));
      if (ownBad) reasons.push(`value ${ownBad}${/gradient\(/.test(light) ? ' (a gradient)' : ''}`);
      if (perMode) reasons.push('differs by mode, and families other than color and shadow hold one value');
      if (reasons.length) { drop(name, p, route.family, reasons.join('; ')); continue; }
      (others[route.family] = others[route.family] || []).push(entry(String(light)));
      if (/clamp\(|cubic-bezier\(|m?s$/.test(String(light))) {
        report.textOnly.push({ name, path: p, family: route.family, value: String(light) });
      }
    }
    report.carried.push({ name, path: p, family: route.family, light, dark: perMode ? dark : light });
  }

  /* ---------------------------------------------------------- type styles */

  const rules = topLevelRules(stylesCss.slice(stylesCss.indexOf('GENERATED:TOKENS:END')));
  const declsFor = (selector) => {
    const merged = {};
    for (const r of rules) if (r.selectors.includes(selector)) Object.assign(merged, r.decls);
    return merged;
  };
  const resolveVar = (v) => {
    const m = /^var\((--[a-z0-9-]+)\)$/.exec(v || '');
    return m ? { ref: m[1], value: VT.LIGHT[m[1]] } : { ref: null, value: v };
  };
  const groups = new Map();
  for (const spec of TYPE_STYLES) {
    const d = declsFor(spec.selector);
    if (!Object.keys(d).length) { report.styles.dropped.push({ ...spec, reason: `no rule for ${spec.selector} in styles.css` }); continue; }
    // declsFor merges every rule that lists the selector, so h3 picks up the
    // shared "h1, h2, h3, h4, h5, h6" rule too. A selector that sets no family
    // inherits body's, which is the body face.
    const fam = resolveVar(d['font-family']);
    const family = fam.ref ? fam.ref.replace(/^--font-/, '') : (d['font-family'] ? null : 'body');
    const size = resolveVar(d['font-size']);
    const sizeBad = size.value == null ? 'sets no font-size' : lengthProblem(size.value);
    if (sizeBad) {
      report.styles.dropped.push({ ...spec, reason: `font-size ${size.ref || ''} = ${size.value} ${sizeBad}`.replace(/\s+/g, ' ') });
      continue;
    }
    if (!family || !families[family]) {
      report.styles.dropped.push({ ...spec, reason: `font-family ${d['font-family']} is not one of the carried family stacks` });
      continue;
    }
    const style = { name: spec.name, fontSize: size.value };
    const lh = resolveVar(d['line-height']);
    if (lh.value != null && (/^\d*\.?\d+$/.test(lh.value) || !lengthProblem(lh.value))) style.lineHeight = /^\d*\.?\d+$/.test(lh.value) ? Number(lh.value) : lh.value;
    const fw = resolveVar(d['font-weight']);
    if (fw.value != null && /^\d+$/.test(fw.value)) style.fontWeight = Number(fw.value);
    const ls = resolveVar(d['letter-spacing']);
    if (ls.value != null && !lengthProblem(ls.value)) style.letterSpacing = ls.value;
    style.usage = spec.usage;
    if (!groups.has(family)) groups.set(family, { name: GROUP_OF_FAMILY[family] || family, family, styles: [] });
    groups.get(family).styles.push(style);
    report.styles.carried.push({ ...spec, family, fontSize: size.value });
  }

  /* ---------------------------------------------------------- tokens.json */

  const families_ = {};
  for (const [k, v] of Object.entries(families)) families_[k] = v;

  const tokens = {
    name: TITLE,
    version: source.version,
    meta: {
      source: 'repository',
      paths: {
        tokens: ['systems/spec/tokens.json'],
        styles: ['systems/vellum/styles.css'],
        docs: ['systems/vellum/readme.md', 'systems/spec/DESIGN.md', 'systems/spec/GRAMMAR.md', 'systems/spec/PROMPT_TEMPLATE.md'],
      },
      generator: 'systems/vellum/export_design_system.js',
    },
    color: { themes: THEMES, tokens: color },
    type: {
      fonts: [],
      families: families_,
      groups: [...groups.values()],
    },
    spacing: { tokens: spacing },
    radius: { tokens: radius },
    shadow: { tokens: shadow },
  };
  for (const r of ROUTES) {
    const fam = r.family;
    if (others[fam] && !tokens[fam]) tokens[fam] = { note: OTHER_NOTES[fam], tokens: others[fam] };
  }

  /* ---------------------------------------------------------- tokens.css */
  // The page writes tokens.css itself only on a save, and a system synced from
  // code is never saved on the page; so the sync writes the first one, laid out
  // as format.md's "tokens.css as compiled".
  const decl = (n, v) => `  --${n}: ${v};`;
  const val = (t, theme) => (typeof t.value === 'string' ? t.value : (t.value[theme] ?? t.value.light));
  const lowerHex = (v) => v.replace(/#[0-9A-Fa-f]{3,8}\b/g, (h) => h.toLowerCase()).replace(/^\{([A-Za-z0-9_.-]+)\}$/, 'var(--$1)');
  const tokensCss = [
    `/* ${TITLE} — generated from tokens.json */`,
    `:root, [data-theme="light"] {`,
    ...color.map((t) => decl(t.name, lowerHex(val(t, 'light')))),
    ...shadow.map((t) => decl(t.name, val(t, 'light'))),
    '}',
    `[data-theme="dark"] {`,
    ...color.filter((t) => typeof t.value !== 'string').map((t) => decl(t.name, lowerHex(t.value.dark))),
    ...shadow.filter((t) => typeof t.value !== 'string').map((t) => decl(t.name, t.value.dark)),
    '}',
    ':root {',
    ...spacing.map((t) => decl(t.name, t.value)),
    ...radius.map((t) => decl(t.name, t.value)),
    ...Object.keys(others).flatMap((k) => others[k].map((t) => decl(t.name, t.value))),
    ...Object.entries(families_).map(([k, v]) => decl(`font-${k}`, v)),
    '}',
    ...[...groups.values()].flatMap((g) => g.styles.map((s) => {
      const parts = [`font-family: var(--font-${g.family})`, `font-size: ${s.fontSize}`];
      if (s.lineHeight != null) parts.push(`line-height: ${s.lineHeight}`);
      if (s.fontWeight != null) parts.push(`font-weight: ${s.fontWeight}`);
      if (s.letterSpacing != null) parts.push(`letter-spacing: ${s.letterSpacing}`);
      return `.${s.name} { ${parts.join('; ')}; }`;
    })),
    '',
  ].join('\n');

  /* ---------------------------------------------------------- cards */

  const files = {};
  const definedClasses = classesDefined(stylesCss.slice(stylesCss.indexOf('GENERATED:TOKENS:END')));
  const manifest = JSON.parse(LF(outOf('_ds_manifest.json')));
  const STYLES_LINK = /[ \t]*<link rel="stylesheet" href="\.\.\/styles\.css"\s*\/?>\n?/;
  const TOKENS_SCRIPT = /src="\.\.\/tokens\.generated\.js"/g;
  let needsTokensJs = false;

  for (const card of manifest.cards) {
    const srcPath = path.join(DS_DIR, card.path);
    const text = read(srcPath);
    const lines = text.split('\n');
    const base = path.basename(card.path, '.html');
    const ident = CARD_IDENT[card.path] || base.replace(/(^|[-_])([a-z])/g, (m, s, c) => c.toUpperCase());
    const [w, h] = (card.viewport || '640x600').split('x').map(Number);
    const name = unescapeHtml(card.name);
    const subtitle = unescapeHtml(card.subtitle || '');
    const markerSub = `${name} — ${subtitle}`.replace(/"/g, "'");
    const marker = `<!-- @dsCard group="${card.group}" width=${w} height=${h} subtitle="${markerSub}" -->`;
    let body = lines.slice(1).join('\n');
    if (!STYLES_LINK.test(body)) throw new Error(`${card.path}: expected <link rel="stylesheet" href="../styles.css" /> (the frame preloads bundle.css in its place)`);
    body = body.replace(STYLES_LINK, '');
    if (TOKENS_SCRIPT.test(body)) needsTokensJs = true;
    body = body.replace(TOKENS_SCRIPT, 'src="../../components/tokens.generated.js"');
    files[`components/${ident}/preview.html`] = `${marker}\n${body}`;

    // Classes the card's markup uses that styles.css defines: what a consumer reaches for.
    const used = [];
    for (const m of body.matchAll(/class="([^"]+)"/g)) {
      for (const c of m[1].split(/\s+/)) if (c && definedClasses.has(c) && !used.includes(c)) used.push(c);
    }
    const readme = [
      `# ${name}`,
      '',
      `${subtitle.charAt(0).toUpperCase()}${subtitle.slice(1)}.`,
      '',
      'A consumer loads `components/bundle.css` (it carries the tokens and every class below) and supplies the markup; the preview shows it in place.',
      '',
      used.length ? `Classes shown: ${used.map((c) => '`.' + c + '`').join(', ')}.` : 'This card shows no stylesheet classes; it renders from the tokens.',
      '',
      `Source: \`systems/vellum/${card.path}\`.`,
      '',
    ].join('\n');
    files[`components/${ident}/README.md`] = readme;
    report.cards.push({ ident, path: card.path, group: card.group, width: w, height: h, classes: used.length });
  }

  // The cover: the repository's own cover card, unchanged but for the frame contract.
  {
    let cover = read(path.join(DS_DIR, 'thumbnail.html'));
    cover = cover.replace(/[ \t]*<link rel="stylesheet" href="styles\.css"\s*\/?>\n?/, '');
    if (/src="tokens\.generated\.js"/.test(cover)) needsTokensJs = true;
    cover = cover.replace(/src="tokens\.generated\.js"/g, 'src="../../components/tokens.generated.js"');
    files['components/Cover/preview.html'] = `<!-- @dsCard height=288 -->\n${cover}`;
  }

  if (needsTokensJs) files['components/tokens.generated.js'] = generatedJs;

  /* ---------------------------------------------------------- examples */
  // Ruled 2026-11-18 (audit 2026-11-18-design-system-export.md): every @dsExample
  // page becomes a `page` marker card, exported exactly as the source is, except
  // the frame-contract rewrites a card also gets. Those are the line-1 marker,
  // the ../../styles.css link (the frame preloads bundle.css) and the old host's
  // ./ds-base.js loader (it only re-adds styles.css and a _ds_bundle.js this
  // system does not have). A page written for the old host's canvas runtime is
  // kept as a plain file to read, not rendered.
  const KEPT_EXAMPLES = ['examples/deck/Deck.dc.html'];
  const EX_STYLES_LINK = /[ \t]*<link rel="stylesheet" href="\.\.\/\.\.\/styles\.css"\s*\/?>\n?/;
  const DS_BASE = /[ \t]*<script src="\.\/ds-base\.js"><\/script>\n?/;
  report.examples = [];
  for (const ex of manifest.examples) {
    const text = read(path.join(DS_DIR, ex.entryPath));
    if (KEPT_EXAMPLES.includes(ex.entryPath)) {
      files[ex.entryPath] = text;
      report.examples.push({ name: ex.name, path: ex.entryPath, kind: 'kept', to: ex.entryPath });
      continue;
    }
    const lines = text.split('\n');
    if (!lines[0].includes('@dsExample')) throw new Error(`${ex.entryPath}: expected the @dsExample marker on line 1, where the card marker replaces it`);
    const ident = ex.name.replace(/\([^)]*\)/g, '').split(/[^A-Za-z0-9]+/).filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
    if (files[`components/${ident}/preview.html`]) throw new Error(`${ex.entryPath}: component name ${ident} is already taken by a card`);
    let body = lines.slice(1).join('\n');
    if (!EX_STYLES_LINK.test(body)) throw new Error(`${ex.entryPath}: expected <link rel="stylesheet" href="../../styles.css" /> (the frame preloads bundle.css in its place)`);
    body = body.replace(EX_STYLES_LINK, '').replace(DS_BASE, '');
    const sub = `${ex.name} — ${ex.description || ''}`.replace(/"/g, "'");
    const marker = `<!-- @dsCard group="Examples" page${ex.minWidth ? ` width=${ex.minWidth}` : ''} subtitle="${sub}" -->`;
    files[`components/${ident}/preview.html`] = `${marker}\n${body}`;

    const anatomy = path.join(DS_DIR, ex.folder, 'ANATOMY.md');
    files[`components/${ident}/README.md`] = fs.existsSync(anatomy)
      ? repairLinks(read(anatomy), { 'GRAMMAR.md': '../../GRAMMAR.md', 'DESIGN.md': '../../DESIGN.md', 'PROMPT_TEMPLATE.md': '../../PROMPT_TEMPLATE.md', 'tokens.json': '../../spec/vellum.tokens.json' })
      : [`# ${ex.name}`, '', ex.description || '', '', 'A worked example, exported exactly as the source is. It is a showcase page, not a component.', '', `Source: \`systems/vellum/${ex.entryPath}\`.`, ''].join('\n');
    report.examples.push({ name: ex.name, path: ex.entryPath, kind: 'page', to: `components/${ident}/preview.html`, ident, readme: fs.existsSync(anatomy) ? `${ex.folder}/ANATOMY.md` : null });
  }

  // The ramp tool, verbatim: Node, or a page as window.VellumRamp (GRAMMAR §3.4).
  files['tools/derive_ramp.js'] = read(path.join(DS_DIR, 'derive_ramp.js'));

  /* ---------------------------------------------------------- stylesheet */
  // styles.css whole, generated block included. See the audit: the page's
  // tokens.css and this file declare the same custom properties with the same
  // values; bundle.css loads second, so where the two meet it decides, and it
  // also declares everything tokens.json cannot carry (the lamps, fluid sizes).
  files['components/bundle.css'] = stylesCss;

  /* ---------------------------------------------------------- docs */

  const LINKS = {
    'GRAMMAR.md': 'GRAMMAR.md',
    'DESIGN.md': 'DESIGN.md',
    'PROMPT_TEMPLATE.md': 'PROMPT_TEMPLATE.md',
    'tokens.json': 'spec/vellum.tokens.json',
    '': null,
  };
  const dropLines = (() => {
    const by = {};
    for (const d of report.dropped) (by[d.family] = by[d.family] || []).push(d);
    const lines = [];
    for (const [fam, list] of Object.entries(by)) {
      lines.push(`- ${fam}: ${list.map((d) => '`--' + d.name + '`').join(', ')} (${[...new Set(list.map((d) => d.reason))].join('; ')}).`);
    }
    for (const s of report.styles.dropped) lines.push(`- Type style \`${s.name}\` (${s.selector}): ${s.reason}.`);
    return lines;
  })();
  const pages = report.examples.filter((e) => e.kind === 'page');
  const kept = report.examples.filter((e) => e.kind === 'kept');
  const examplesAndTools = [
    '',
    '## Examples and tools',
    '',
    `Worked examples, under Components in the Examples group, as showcase pages: ${pages.map((e) => `${e.name} (\`${e.to}\`)`).join(', ')}. They show how the parts compose; they are not components to copy.`,
    '',
    ...kept.map((e) => `- \`${e.to}\` — ${e.name}, kept to read, not rendered here: it is written for a canvas runtime this system does not ship.`),
    '- `tools/derive_ramp.js` — derives a nine-rung ramp from a brand colour (GRAMMAR §3.4). Run it with Node (`node tools/derive_ramp.js "#0F62FE"`), or load it in a page with `<script src="../../tools/derive_ramp.js">`, which exposes the same functions as `window.VellumRamp`.',
    '',
  ].join('\n');
  const notSynced = [
    examplesAndTools,
    '## Not synced',
    '',
    'Generated from the repository. `components/bundle.css` is `styles.css` whole and declares every custom property, so the previews show everything; the token views below show only what the format can hold. Not in `tokens.json`:',
    '',
    ...dropLines,
    '',
    `Shown as plain values only: ${report.textOnly.map((t) => '`--' + t.name + '`').join(', ')}.`,
    '',
    'The full token source, with every value and both modes, is `spec/vellum.tokens.json` (W3C DTCG). Components are static HTML cards styled by `components/bundle.css`; there is no JavaScript bundle.',
    '',
  ].join('\n');

  files['README.md'] = repairLinks(read(path.join(DS_DIR, 'readme.md')), LINKS).replace(/\n*$/, '\n') + notSynced;
  for (const doc of ['DESIGN.md', 'GRAMMAR.md', 'PROMPT_TEMPLATE.md']) {
    files[doc] = repairLinks(stripFrontmatter(read(path.join(SPEC_DIR, doc))), LINKS);
  }
  files['spec/vellum.tokens.json'] = read(path.join(SPEC_DIR, 'tokens.json'));

  files['tokens.json'] = JSON.stringify(tokens, null, 2) + '\n';
  files['tokens.css'] = tokensCss;

  /* ---------------------------------------------------------- the index */

  const index = {
    v: 3,
    layout: 'files',
    createdOnFiles: { v: 1, at: now },
    title: TITLE,
    namespace: NAMESPACE,
    libraries: [],
    sections: {},
    groups: [],
    assetGroups: {},
    blobs: {},
    docs: { sections: [] },
    editing: 'code',
    lastChange: {
      by: 'Claude',
      at: now,
      via: 'Claude Code · systems/vellum/export_design_system.js',
      note: 'Generated from systems/spec/tokens.json, styles.css, the @dsCard cards and the spec.',
    },
  };
  files['design-system.json'] = JSON.stringify(index, null, 2) + '\n';

  return { files, tokens, report };
}

/* ================================================================ checks */

/**
 * Every format rule the tree must keep. Returns a list of problems; empty means
 * the tree is inside the caps. The validator reports these as errors.
 */
function formatProblems({ files, tokens }) {
  const problems = [];
  const bytes = (s) => Buffer.byteLength(s, 'utf8');
  const paths = Object.keys(files);
  if (paths.length > RULES.maxFiles) problems.push(`${paths.length} files; the cap is ${RULES.maxFiles}`);
  for (const p of paths) {
    if (p.startsWith('/') || p.includes('..') || p.includes('\\') || p.split('/').some((s) => s.startsWith('.'))) problems.push(`path ${p} is not a plain relative path`);
    const n = bytes(files[p]);
    const cap = RULES.bytes[p] || (/^components\/[^/]+\/preview\.html$/.test(p) ? RULES.bytes.preview
      : /^components\/[^/]+\/README\.md$/.test(p) ? RULES.bytes.componentReadme
      : /\.md$|^components\//.test(p) ? RULES.bytes.file : RULES.bytes.other);
    if (n > cap) problems.push(`${p} is ${n} bytes; the cap is ${cap}`);
  }
  const sections = paths.filter((p) => /\.mdx?$/.test(p) && p !== 'README.md' && !p.startsWith('components/') && !p.startsWith('archived/'));
  if (sections.length > RULES.maxSections) problems.push(`${sections.length} brand-book sections; the cap is ${RULES.maxSections}`);
  if (!files['README.md']) problems.push('README.md is missing');
  if (!files['design-system.json']) problems.push('design-system.json is missing');

  // Components: identifier folders, the marker on line 1.
  for (const p of paths.filter((x) => /^components\/[^/]+\/preview\.html$/.test(x))) {
    const comp = p.split('/')[1];
    if (!RULES.ident.test(comp) || /[^\x00-\x7f]/.test(comp)) problems.push(`components/${comp} is not an ASCII JS identifier`);
    const first = files[p].split('\n')[0];
    const m = /^<!-- @dsCard\b(.*)-->$/.exec(first);
    if (!m) { problems.push(`${p} line 1 is not an @dsCard marker`); continue; }
    const h = /\bheight=(\d+)/.exec(m[1]);
    const isPage = /\spage(\s|$)/.test(m[1]);
    const [lo, hi] = comp === 'Cover' ? RULES.coverHeight : RULES.cardHeight;
    // A showcase page may leave height out (the type then starts at 120 and grows to fit).
    if (h ? (+h[1] < lo || +h[1] > hi) : !isPage) problems.push(`${p} marker height ${h ? h[1] : '(none)'} is outside ${lo}-${hi}`);
    const w = /\bwidth=(\d+)/.exec(m[1]);
    if (w && (+w[1] < 1 || +w[1] > 4000)) problems.push(`${p} marker width ${w[1]} is not a layout width`);
    if (/<(iframe|frame|object|embed|portal|noscript)\b/i.test(files[p])) problems.push(`${p} holds a frame or embed element the preview contract forbids`);
    for (const u of files[p].matchAll(/(?:src|href)="([^"]+)"/g)) {
      const url = u[1];
      if (/^https?:/.test(url) && !/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(url)) problems.push(`${p} loads ${url}, which the frame will not load`);
      if (/^\.\.\/\.\.\//.test(url) && !files[url.slice(6)]) problems.push(`${p} links ${url}, which the export does not carry`);
      else if (/^\.\.?\//.test(url) && !/^\.\.\/\.\.\//.test(url)) {
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(p), url));
        if (!files[target]) problems.push(`${p} links ${url}, which the export does not carry`);
      }
    }
  }
  if (files['components/Cover/README.md']) problems.push('components/Cover/README.md makes the cover an ordinary component');

  // Tokens: list shape, names, caps.
  const seen = new Map();
  const nameCheck = (fam, t) => {
    if (!RULES.name.test(t.name)) problems.push(`token ${t.name} (${fam}) breaks the name rule`);
    if (seen.has(t.name)) problems.push(`token ${t.name} is in both ${seen.get(t.name)} and ${fam}; the second drops`);
    seen.set(t.name, fam);
    if (t.usage && t.usage.length > RULES.maxUsage) problems.push(`token ${t.name} usage is longer than ${RULES.maxUsage}`);
  };
  if (!tokens.color || !Array.isArray(tokens.color.tokens)) problems.push('color is not list-shaped');
  else {
    if (tokens.color.themes.length > RULES.maxThemes) problems.push('more themes than the cap');
    if (tokens.color.tokens.length > RULES.maxColors) problems.push(`${tokens.color.tokens.length} colours; the cap is ${RULES.maxColors}`);
    for (const t of tokens.color.tokens) {
      nameCheck('color', t);
      for (const v of typeof t.value === 'string' ? [t.value] : Object.values(t.value)) {
        const alias = /^\{([A-Za-z0-9_.-]+)\}$/.exec(v);
        if (alias) {
          const target = tokens.color.tokens.find((x) => x.name === alias[1]);
          if (!target || target.name === t.name) problems.push(`colour ${t.name} aliases {${alias[1]}}, which is not a colour token`);
          else if ((typeof target.value === 'string' ? [target.value] : Object.values(target.value)).some((x) => /^\{/.test(x))) problems.push(`colour ${t.name} aliases {${alias[1]}}, which is itself an alias`);
          continue;
        }
        const bad = colorProblem(v);
        if (bad) problems.push(`colour ${t.name} value ${v} ${bad}`);
      }
    }
  }
  const other = Object.keys(tokens).filter((k) => !['name', 'version', 'meta', 'color', 'type', 'spacing', 'radius', 'shadow'].includes(k));
  if (other.length > RULES.maxOtherFamilies) problems.push(`${other.length} other families; the cap is ${RULES.maxOtherFamilies}`);
  for (const fam of ['spacing', 'radius', 'shadow', ...other]) {
    if (!tokens[fam]) continue;
    if (!Array.isArray(tokens[fam].tokens)) { problems.push(`${fam} is not list-shaped`); continue; }
    if (tokens[fam].tokens.length > RULES.maxOtherTokens) problems.push(`${fam} has ${tokens[fam].tokens.length} tokens; the cap is ${RULES.maxOtherTokens}`);
    for (const t of tokens[fam].tokens) {
      nameCheck(fam, t);
      const vs = typeof t.value === 'string' ? [t.value] : Object.values(t.value);
      for (const v of vs) {
        const bad = fam === 'shadow' ? shadowProblem(v) : (fam === 'spacing' || fam === 'radius') ? lengthProblem(v) : otherProblem(v);
        if (bad) problems.push(`${fam} ${t.name} value ${v} ${bad}`);
      }
    }
  }
  const groups = (tokens.type && tokens.type.groups) || [];
  if (groups.length > RULES.maxTypeGroups) problems.push('more type groups than the cap');
  const styles = groups.flatMap((g) => g.styles);
  if (styles.length > RULES.maxStyles) problems.push('more type styles than the cap');
  const styleNames = new Set();
  for (const g of groups) {
    if (!tokens.type.families[g.family]) problems.push(`type group ${g.name} names family ${g.family}, which type.families does not define`);
    for (const s of g.styles) {
      if (!RULES.name.test(s.name)) problems.push(`type style ${s.name} breaks the name rule`);
      if (styleNames.has(s.name)) problems.push(`type style ${s.name} appears twice`);
      styleNames.add(s.name);
      if (lengthProblem(s.fontSize)) problems.push(`type style ${s.name} fontSize ${s.fontSize} ${lengthProblem(s.fontSize)}`);
    }
  }
  // A type style compiles to a .<name> class in tokens.css; it must not collide
  // with a class the stylesheet already means something else by.
  const bundleClasses = classesDefined(files['components/bundle.css'] || '');
  for (const s of styleNames) if (bundleClasses.has(s)) problems.push(`type style ${s} compiles to .${s}, which components/bundle.css already defines`);
  return problems;
}

/** Drop the timestamps from design-system.json so two builds can be compared. */
function comparable(p, text) {
  const t = LF(text);
  if (p !== 'design-system.json') return t;
  try {
    const o = JSON.parse(t);
    if (o.createdOnFiles) delete o.createdOnFiles.at;
    if (o.lastChange) delete o.lastChange.at;
    return JSON.stringify(o);
  } catch (e) {
    return t;
  }
}

/** Every file on disk under dir, as paths relative to it. */
function listTree(dir, base = dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) listTree(p, base, out);
    else out.push(path.relative(base, p).replace(/\\/g, '/'));
  }
  return out;
}

/* ================================================================ write */

function writeExport({ quiet = false } = {}) {
  const result = generateExport();
  // The folder is this script's alone: clear it so a removed card leaves nothing behind.
  if (path.basename(OUT_DIR) !== 'project' || path.basename(OUT_ROOT) !== 'design-system') throw new Error('refusing to clear an unexpected folder');
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  for (const [p, text] of Object.entries(result.files)) {
    const full = path.join(OUT_DIR, ...p.split('/'));
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text, 'utf8');
  }
  const problems = formatProblems(result);
  if (!quiet) {
    const r = result.report;
    console.log('=== Vellum: Design System export ===');
    console.log(`  -> ${path.relative(REPO, OUT_DIR).replace(/\\/g, '/')}/   ${Object.keys(result.files).length} files`);
    console.log(`  tokens        ${r.carried.length} carried, ${r.dropped.length} dropped, ${r.textOnly.length} shown as plain values only`);
    console.log(`  type styles   ${r.styles.carried.length} carried, ${r.styles.dropped.length} dropped`);
    console.log(`  components    ${r.cards.length} cards + Cover; ${r.examples.filter((e) => e.kind === 'page').length} example pages, ${r.examples.filter((e) => e.kind === 'kept').length} example kept as a file`);
    if (problems.length) problems.forEach((p) => console.log('  ⚠ ' + p));
  }
  return { ...result, problems };
}

module.exports = { generateExport, formatProblems, comparable, listTree, writeExport, OUT_DIR, RULES };

if (require.main === module) {
  const { problems } = writeExport();
  if (problems.length) process.exit(1);
}
