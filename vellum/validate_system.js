#!/usr/bin/env node
/**
 * Vellum — system validator and evidence generator.
 *
 * Does not assert that the system is consistent; it measures it, writes the
 * measurements to VERIFICATION.md, and exits non-zero if any check fails.
 *
 *   1. Structure     — every card and example in the manifest exists and is marked
 *   2. Token coverage— every semantic role has a light AND a dark value
 *   3. Reference     — no token used-but-undefined, none defined-but-unused
 *   4. Drift         — tokens.json <-> styles.css <-> _ds_manifest.json <-> @dsCard
 *   5. Naming        — no retired name survives anywhere in the system
 *   6. Grammar       — mechanically checkable invariants from GRAMMAR.md
 *   7. Convention    — kebab-case custom properties, derivable from token paths
 *
 * Usage: node validate_system.js [--no-report]
 *
 * --no-report runs every check and exits the same way, but does not rewrite
 * VERIFICATION.md. The pre-commit hook and CI use it: they gate a commit, and a
 * gate that dirties the tree it is checking leaves an unstaged file behind.
 *
 * Neither the hook nor CI runs build.js first. Building before validating would
 * regenerate the outputs and make check 4t pass by construction.
 */

const fs = require('fs');
const path = require('path');

const DS = __dirname;
const MODE_EXT = 'design.vellum.mode';

const manifestPath = path.join(DS, '_ds_manifest.json');
const themePath = path.join(DS, 'theme.json');
const stylesPath = path.join(DS, 'styles.css');
const tokensPath = path.join(DS, '..', 'spec', 'tokens.json');
const reportPath = path.join(DS, 'VERIFICATION.md');

const errors = [];
const warnings = [];
const out = [];

const rel = (p) => path.relative(DS, p).replace(/\\/g, '/');
const keys = (o) => Object.keys(o).filter((k) => !k.startsWith('$'));
const isToken = (v) => v && typeof v === 'object' && !Array.isArray(v) && '$value' in v;
const fail = (m) => errors.push(m);
const warn = (m) => warnings.push(m);

/* ------------------------------------------------------------ collect files */

const sourceFiles = [];
const walkInto = (dir) => {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkInto(p);
    else if (/\.(html|css|js|json|md)$/.test(e.name)) sourceFiles.push(p);
  }
};
walkInto(DS);

/*
 * Consumer sites are held to the same grammar as the system.
 *
 * They were outside the walk until RC6, which is how the acceptance test came
 * to cite `semantic.mesh` — retired in RC4 — and how two of the three test
 * sites ended up lit by Vellum's own palette. A rule nothing checks on the
 * artifacts built from the system is a rule that only applies to the manual.
 *
 * Token-level checks stay system-only; there are no tokens out here to check.
 */
const IMPLEMENTATIONS = path.join(DS, '..', '..', 'implementations');
const implFiles = [];
{
  const before = sourceFiles.length;
  walkInto(IMPLEMENTATIONS);
  for (let i = before; i < sourceFiles.length; i++) implFiles.push(sourceFiles[i]);
}

// examples/ is already inside DS, so walkInto(DS) above already walked it —
// walking it again here would double-add every example file. Filter instead.
const EXAMPLES = path.join(DS, 'examples');
const exampleFiles = sourceFiles.filter((p) => p.startsWith(EXAMPLES + path.sep));

const styleFiles = sourceFiles.filter((p) => /\.(html|css)$/.test(p));

/* ------------------------------------------------------------------ inputs */

// Every check below reads these three. If one cannot be read there is nothing to
// check, so this stops here and says which file and why. It used to throw a bare
// stack trace from this line — loud, but not a diagnosis. DECISIONS 018.
const readInput = (p, parse) => {
  try {
    const text = fs.readFileSync(p, 'utf8');
    return parse ? JSON.parse(text) : text;
  } catch (e) {
    console.error(`\x1b[31m✖ VALIDATION FAILED — cannot read ${rel(p)}, so no check could run: ${e.message}\x1b[0m`);
    process.exit(1);
  }
};
const tokens = readInput(tokensPath, true);
const manifest = readInput(manifestPath, true);
const css = readInput(stylesPath, false);

function flatten(tree) {
  const flat = {};
  (function walk(node, prefix, inherited) {
    const type = node.$type || inherited;
    for (const k of keys(node)) {
      const v = node[k];
      const p = prefix ? `${prefix}.${k}` : k;
      if (isToken(v)) flat[p] = { ...v, $type: v.$type || type };
      else if (v && typeof v === 'object') walk(v, p, type);
    }
  })(tree, '', undefined);
  return flat;
}
const flat = flatten(tokens);

function cssName(tokenPath) {
  const parts = tokenPath.split('.');
  parts.shift();
  return `--${parts.join('-')}`;
}

function resolve(raw, seen = []) {
  if (typeof raw !== 'string' || !raw.startsWith('{') || !raw.endsWith('}')) return raw;
  const ref = raw.slice(1, -1);
  if (seen.includes(ref)) return '<circular>';
  return flat[ref] ? resolve(flat[ref].$value, [...seen, ref]) : '<dangling>';
}

/* ============================================ 1. STRUCTURE ================ */

out.push('## 1. Structure\n');
out.push('| Kind | Name | Path | Marker |');
out.push('| :--- | :--- | :--- | :--- |');

for (const card of manifest.cards) {
  const p = path.join(DS, card.path);
  if (!fs.existsSync(p)) {
    fail(`Card file missing: ${card.path}`);
    out.push(`| Card | ${card.name} | \`${card.path}\` | **FILE MISSING** |`);
    continue;
  }
  const marked = fs.readFileSync(p, 'utf8').includes('@dsCard');
  if (!marked) fail(`Card missing @dsCard marker: ${card.path}`);
  out.push(`| Card | ${card.name} | \`${card.path}\` | ${marked ? 'ok' : '**NO @dsCard**'} |`);
}
for (const ex of manifest.examples) {
  const p = path.join(DS, ex.entryPath);
  if (!fs.existsSync(p)) {
    fail(`Example entry missing: ${ex.entryPath}`);
    out.push(`| Example | ${ex.name} | \`${ex.entryPath}\` | **FILE MISSING** |`);
    continue;
  }
  const src = fs.readFileSync(p, 'utf8');
  const marked = src.includes('@dsExample');
  if (!marked) fail(`Example missing @dsExample marker: ${ex.entryPath}`);

  /* GRAMMAR 2.12 — an example is either RESPONSIVE or a declared FIXED-VIEWPORT
     format. There is no third state, and neither may be silent: an example with
     no breakpoints and no minWidth is simply broken on a phone, which is how the
     deck sat unnoticed. */
  const hasBreakpoint = /@media[^{]*max-width/.test(src);
  let reach;
  if (ex.minWidth) {
    reach = `fixed ≥${ex.minWidth}px`;
    if (hasBreakpoint) {
      fail(`Example declares minWidth but also carries max-width breakpoints — ` +
        `pick one: ${ex.entryPath}`);
      reach = '**BOTH**';
    }
  } else if (hasBreakpoint) {
    reach = 'responsive';
  } else {
    fail(`Example is neither responsive nor declared fixed-viewport: ${ex.entryPath} ` +
      `— add a max-width breakpoint, or minWidth="…" to its @dsExample marker (GRAMMAR §2.12)`);
    reach = '**NEITHER**';
  }

  out.push(`| Example | ${ex.name} | \`${ex.entryPath}\` | ${marked ? reach : '**NO @dsExample**'} |`);
}
out.push(`\n${manifest.cards.length} cards, ${manifest.examples.length} examples.\n`);

/* ============================================ 2. TOKEN COVERAGE =========== */

const DUAL = ['semantic.color.', 'semantic.elevation.', 'semantic.lamp.'];
const isDual = (p) => DUAL.some((g) => p.startsWith(g));
const semanticPaths = Object.keys(flat).filter((p) => p.startsWith('semantic.'));

/*
 * Which files consume each custom property.
 *
 * Two forms count. A static `var(--x)` is the obvious one. But the foundation
 * cards now render swatches and scales by importing tokens.generated.js and
 * naming tokens as strings — `LIGHT['--color-neutral-500']`, `var(${n})`. Those are
 * real consumers, and counting only the static form would under-report exactly
 * the cards that were fixed to stop hardcoding values.
 */
const usedBy = new Map();
const addUse = (name, file) => {
  // A trailing hyphen means this is a group prefix being used for string matching
  // (e.g. n.replace('--radius-', '')), not a reference to a token.
  if (name.endsWith('-')) return;
  if (!usedBy.has(name)) usedBy.set(name, new Set());
  usedBy.get(name).add(rel(file));
};

for (const file of styleFiles) {
  const text = fs.readFileSync(file, 'utf8');
  for (const m of text.matchAll(/var\((--[a-z0-9-]+)/g)) addUse(m[1], file);
  // Dynamic reference: a token named as a quoted string inside a module script.
  if (text.includes("from '../tokens.generated.js'") || text.includes('tokens.generated.js')) {
    for (const m of text.matchAll(/['"`](--[a-z0-9-]+)['"`]/g)) addUse(m[1], file);
    // Ramp families enumerated by regex rather than listed literally.
    for (const m of text.matchAll(/--color-\(?([a-z|]+)\)?-\\d/g)) {
      for (const family of m[1].split('|')) {
        Object.keys(flat)
          .filter((p) => p.startsWith(`primitive.color.${family}.`))
          .forEach((p) => addUse(cssName(p), file));
      }
    }
    // Groups discovered by token PATH rather than by name — the colour card walks
    // META looking for `primitive.color.*`, so it consumes every ramp step without
    // ever writing one of their names down.
    for (const m of text.matchAll(/['"`]((?:primitive|semantic)\.[a-z-]+)['"`]/g)) {
      Object.keys(flat)
        .filter((p) => p.startsWith(m[1] + '.'))
        .forEach((p) => addUse(cssName(p), file));
    }
    for (const m of text.matchAll(/parts\[1\] !== '([a-z-]+)'/g)) {
      Object.keys(flat)
        .filter((p) => p.startsWith(`primitive.${m[1]}.`))
        .forEach((p) => addUse(cssName(p), file));
    }
  }
}

out.push('## 2. Token coverage\n');
out.push('Every semantic role, both modes. A blank cell in light or dark is a failure.\n');
out.push('| Custom property | Light | Dark | Source | Used by |');
out.push('| :--- | :--- | :--- | :--- | ---: |');

let dualCount = 0;
for (const p of semanticPaths) {
  const t = flat[p];
  const name = cssName(p);
  const light = resolve(t.$value);
  const ext = t.$extensions && t.$extensions[MODE_EXT];
  const dual = isDual(p);
  if (dual) dualCount++;

  let obs;
  if (dual) {
    if (!ext || ext.dark === undefined) {
      fail(`${p} has no dark value`);
      obs = '**MISSING**';
    } else {
      obs = resolve(ext.dark);
    }
  } else {
    obs = '_(inherits)_';
  }

  if (light === undefined || light === '' || String(light).startsWith('<')) fail(`${p} has no resolvable light value`);

  const alias = typeof t.$value === 'string' && t.$value.startsWith('{') ? t.$value.slice(1, -1) : 'literal';
  const consumers = usedBy.get(name);
  out.push(
    `| \`${name}\` | \`${light}\` | ${obs === '_(inherits)_' ? obs : '`' + obs + '`'} | \`${alias}\` | ${consumers ? consumers.size : 0} |`
  );
}
out.push(`\n${semanticPaths.length} semantic roles — ${dualCount} dual-mode, ${semanticPaths.length - dualCount} mode-invariant.\n`);

/* ============================================ 3. REFERENCE INTEGRITY ====== */

const definedProps = new Set([...css.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map((m) => m[1]));

// A consumer site declares its own properties — a brand hex and its derived ramp.
// Those are defined, just not by the system, so collect them before the
// undefined-property check runs.
const consumerProps = new Set();
for (const f of implFiles) {
  if (!/\.(html|css)$/.test(f)) continue;
  for (const m of fs.readFileSync(f, 'utf8').matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)) {
    if (!definedProps.has(m[1])) consumerProps.add(m[1]);
    definedProps.add(m[1]);
  }
}

// Custom properties legitimately set from JavaScript or scoped to one component.
const RUNTIME_PROPS = new Set(['--range-progress', '--status', '--status-fg']);

const missing = [...usedBy.keys()].filter((n) => !definedProps.has(n) && !RUNTIME_PROPS.has(n));
const orphan = [...definedProps].filter((n) => !usedBy.has(n));

out.push('## 3. Reference integrity\n');

out.push('### Used but never defined\n');
if (missing.length === 0) {
  out.push('None.\n');
} else {
  out.push('| Custom property | Referenced in |');
  out.push('| :--- | :--- |');
  for (const n of missing) {
    fail(`Undefined custom property ${n} (used in ${[...usedBy.get(n)].join(', ')})`);
    out.push(`| \`${n}\` | ${[...usedBy.get(n)].map((f) => '`' + f + '`').join(', ')} |`);
  }
  out.push('');
}

/*
 * Two kinds of unused token, and only one is a defect.
 *
 * A SCALE member (a ramp step, a spacing step, a type step) is unused because a
 * complete scale is the deliverable — you ship the whole ramp so a project can
 * reach for any step. A BREAKPOINT is unused because CSS @media cannot read a
 * custom property at all; those values exist for JavaScript and documentation.
 *
 * A ROLE is different. An unused role means the system declares a meaning that
 * nothing expresses — either wire it up or delete it.
 */
// Classify by token PATH, not by name pattern: the path already records whether
// something is a raw palette value or a declared role, so the check cannot drift
// out of step with how tokens happen to be named.
const pathOf = {};
for (const p of Object.keys(flat)) pathOf[cssName(p)] = p;

// Weight is not here. Each weight step has its own job (GRAMMAR §2.13), so an unused
// weight is a role nothing expresses, not a spare step (DECISIONS 050).
// A site's status seed (--status-<name>, GRAMMAR §3.9) is read by the validator, which derives
// the rungs from it, and by no CSS. It is not a scale step (DECISIONS 059).
const isSeed = (n) => consumerProps.has(n) && /^--status-[a-z]/.test(n) && n !== '--status-fg';
const isScale = (n) =>
  !isSeed(n) && (
    consumerProps.has(n) ||
    (pathOf[n] || '').startsWith('primitive.') ||
    /^semantic\.(space|type|leading|tracking)\./.test(pathOf[n] || ''));
const isReference = (n) => (pathOf[n] || '').startsWith('semantic.breakpoint.');

const orphanScale = orphan.filter(isScale);
const orphanReference = orphan.filter(isReference);
const orphanSeed = orphan.filter(isSeed);
const orphanRole = orphan.filter((n) => !isScale(n) && !isReference(n) && !isSeed(n));

/*
 * A use inside a rule that matches nothing is not a use (DECISIONS 054). .brand-badge was the
 * only consumer of --color-wash-strong and matched no element, so the orphan check read the
 * role as expressed for eight releases. Here a rule is dead when every selector in its list
 * names a class that no element carries anywhere in the tree: written in markup, in a script's
 * template string, or added with classList. One-sided on purpose. A class used anywhere counts
 * as present, so this misses a compound or structural selector that cannot match and never
 * calls a live rule dead. verify.html's "Every rule can match" reads the rendered pages and
 * sees the rest. A role whose every var() use is in a dead rule joins the orphans.
 */
const classesPresent = new Set();
for (const f of sourceFiles) {
  const r = rel(f);
  const isPage = /\.html$/.test(r);
  const isScript = /\.js$/.test(r) && /^examples\//.test(r) && !/\/(support|ds-base)\.js$/.test(r);
  if (!isPage && !isScript && !implFiles.includes(f)) continue;
  if (!/\.(html|js)$/.test(r)) continue;
  const text = fs.readFileSync(f, 'utf8');
  for (const m of text.matchAll(/class(?:Name)?\s*=\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/g)) {
    for (const c of (m[1] || m[2] || m[3] || '').split(/\s+/)) if (c) classesPresent.add(c);
  }
  for (const m of text.matchAll(/classList\.(?:add|toggle|replace)\(([^)]*)\)/g)) {
    for (const s of m[1].matchAll(/["'`]([A-Za-z0-9_-]+)["'`]/g)) classesPresent.add(s[1]);
  }
}
const ruleBlocks = (file) => {
  const text = fs.readFileSync(file, 'utf8')
    .replace(/GENERATED:TOKENS:START[\s\S]*?GENERATED:TOKENS:END/g, (s) => s.replace(/[^\n]/g, ''))
    .replace(/\/\*[\s\S]*?\*\//g, (s) => s.replace(/[^\n]/g, ''));
  const sheets = /\.css$/.test(file) ? [text] : [...text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
  const blocks = [];
  for (const sheet of sheets) {
    for (const m of sheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = m[1].trim();
      if (!selector || selector.startsWith('@') || /^(?:from|to|[\d.]+%)(?:\s*,\s*(?:from|to|[\d.]+%))*$/.test(selector)) continue;
      const dead = selector.split(',').every((part) => {
        const named = [...part.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((c) => c[1]);
        return named.some((c) => !classesPresent.has(c));
      });
      blocks.push({ selector: selector.replace(/\s+/g, ' '), body: m[2], dead });
    }
  }
  return blocks;
};
const deadOnlyRoles = [];
{
  const live = new Map();
  const dead = new Map();
  const staticFiles = new Map();
  for (const f of styleFiles) {
    for (const b of ruleBlocks(f)) {
      for (const v of b.body.matchAll(/var\((--[a-z0-9-]+)/g)) {
        const bucket = b.dead ? dead : live;
        if (!bucket.has(v[1])) bucket.set(v[1], []);
        bucket.get(v[1]).push(`${rel(f)}  ${b.selector}`);
        if (!staticFiles.has(v[1])) staticFiles.set(v[1], new Set());
        staticFiles.get(v[1]).add(rel(f));
      }
    }
  }
  for (const [n, where] of dead) {
    if (live.has(n) || isScale(n) || isReference(n) || orphan.includes(n)) continue;
    // A use outside any rule (a style attribute, a script naming the property) is a live use.
    const users = usedBy.get(n) || new Set();
    if ([...users].some((u) => !staticFiles.get(n).has(u))) continue;
    const inline = styleFiles.some((f) => /\.html$/.test(f) && [...fs.readFileSync(f, 'utf8').matchAll(/style\s*=\s*"[^"]*"/g)].some((s) => s[0].includes(`var(${n}`)));
    if (inline) continue;
    deadOnlyRoles.push({ name: n, where });
  }
}

out.push('### Defined but never used\n');
out.push('| Class | Count | Verdict | Tokens |');
out.push('| :--- | ---: | :--- | :--- |');
out.push(
  `| Scale step | ${orphanScale.length} | Expected — a complete scale is the deliverable | ${orphanScale.map((n) => '`' + n + '`').join(', ') || '—'} |`
);
out.push(
  `| Reference value | ${orphanReference.length} | Expected — CSS \`@media\` cannot read custom properties | ${orphanReference.map((n) => '`' + n + '`').join(', ') || '—'} |`
);
out.push(
  `| Status seed | ${orphanSeed.length} | Expected — read by the validator, which derives the rungs; no CSS reads it (GRAMMAR §3.9) | ${orphanSeed.map((n) => '`' + n + '`').join(', ') || '—'} |`
);
out.push(
  `| **Role** | ${orphanRole.length} | ${orphanRole.length === 0 ? 'None — every declared role is expressed' : '**Defect — wire up or delete**'} | ${orphanRole.map((n) => '`' + n + '`').join(', ') || '—'} |`
);
out.push('');

for (const n of orphanRole) warn(`Orphaned role ${n} — declared as a meaning but nothing expresses it`);
for (const { name, where } of deadOnlyRoles) {
  warn(`Orphaned role ${name} — every use is in a rule that matches no element (${where.join('; ')}). Nothing on screen expresses it (DECISIONS 054)`);
}
if (deadOnlyRoles.length) {
  out.push(`Roles whose every use is in a rule that matches no element: ${deadOnlyRoles.map((r) => '`' + r.name + '`').join(', ')}.\n`);
}

out.push(
  `Defined: ${definedProps.size} · Referenced: ${usedBy.size} · Undefined: ${missing.length} · Orphaned roles: ${orphanRole.length + deadOnlyRoles.length}\n`
);

/* ============================================ 4. DRIFT ==================== */

out.push('## 4. Drift\n');

const driftRows = [];

// 4a. tokens.json -> styles.css
const notEmitted = semanticPaths.map(cssName).filter((n) => !definedProps.has(n));
for (const n of notEmitted) fail(`Semantic token ${n} is in tokens.json but not emitted into styles.css — run node systems/vellum/build.js (see check 4t)`);

// 4t. The build's outputs were written from the CURRENT tokens.
//
// build.js reads tokens.json and writes the GENERATED:TOKENS block in styles.css,
// tokens.generated.js, _ds_manifest.json and the index.html sidebar. Until this
// rule, nothing checked that those files were written from the tokens.json that is
// on disk NOW. Two things passed with 0 errors: a token changed in tokens.json with
// the build never run, so styles.css shipped the old value; and a value hand-edited
// inside the generated block, the one edit the handoff says never to make. 4a only
// asks whether a property NAME is present; every other check that reads a value
// (4f, 4q, 4r) reads it from tokens.json, not from what styles.css ships.
//
// This re-runs the build in memory (build.js's generate(), which writes nothing)
// and compares every output with its file, value by value, then byte for byte.
// Line endings are normalised first: with core.autocrlf a Windows checkout holds
// CRLF files that the build writes as LF, and that is not drift. Nothing else is.
//
// It cannot pass on an empty comparison. It fails if the build cannot run, if an
// expected output is missing from what generate() returns, or if any output yields
// zero values to compare — the same guard 4f and 4s carry, for DECISIONS 006.
//
// Lettered 4t because letters go in order of creation; it sits beside 4a because
// 4r reads its verdict. When the build is stale, 4r used to say theme.json was
// wrong and that "the system ships" a value styles.css did not yet ship.
const buildStale = [];
{
  const LF = (s) => s.replace(/\r\n/g, '\n');
  const vm = require('vm');
  const { generate, START: TOK_START, END: TOK_END, NAV_START, NAV_END } = require(path.join(DS, 'build.js'));
  const between = (text, a, b) => {
    const i = text.indexOf(a);
    const j = text.indexOf(b, i + 1);
    if (i === -1 || j === -1) throw new Error(`markers ${a} ... ${b} not found`);
    return text.slice(i, j + b.length);
  };

  // Each output becomes a map of named values, so a failure can name what moved
  // instead of only saying the bytes differ.
  const UNITS = {
    'styles.css': (text) => {
      const units = new Map();
      let selector = null;
      for (const line of between(text, TOK_START, TOK_END).split('\n')) {
        const sel = /^(\S[^{]*?)\s*\{\s*$/.exec(line);
        if (sel) { selector = sel[1]; continue; }
        const decl = /^\s*(--[a-z0-9-]+)\s*:\s*(.*?);\s*$/.exec(line);
        if (decl) units.set(`${decl[1]} (${selector})`, decl[2]);
      }
      return units;
    },
    'tokens.generated.js': (text) => {
      const t = vm.runInNewContext(`${text}\n;VellumTokens`, {}, { timeout: 1000 });
      const units = new Map([['NAME', JSON.stringify(t.NAME)], ['VERSION', JSON.stringify(t.VERSION)]]);
      for (const [group, obj] of [['LIGHT', t.LIGHT], ['DARK', t.DARK], ['META', t.META]]) {
        for (const [k, v] of Object.entries(obj || {})) units.set(`${group} ${k}`, JSON.stringify(v));
      }
      return units;
    },
    '_ds_manifest.json': (text) => {
      const m = JSON.parse(text);
      const units = new Map();
      for (const [k, v] of Object.entries(m)) {
        if (k === 'tokens') for (const t of v) units.set(`tokens ${t.name}`, JSON.stringify(t));
        else if (k === 'cards') for (const c of v) units.set(`cards ${c.path}`, JSON.stringify(c));
        else if (k === 'examples') for (const e of v) units.set(`examples ${e.entryPath}`, JSON.stringify(e));
        else units.set(k, JSON.stringify(v));
      }
      return units;
    },
    'index.html': (text) => {
      const units = new Map();
      between(text, NAV_START, NAV_END).split('\n').map((l) => l.trim()).filter(Boolean)
        .forEach((l, i) => units.set(`sidebar line ${i + 1}`, l));
      return units;
    },
  };

  // What each output is generated from, so a failure points at the file to change.
  const SOURCE_OF = {
    'styles.css': 'tokens.json',
    'tokens.generated.js': 'tokens.json',
    '_ds_manifest.json': 'tokens.json and @dsCard / @dsExample markers',
    'index.html': '@dsCard / @dsExample markers',
  };

  let built = null;
  try {
    built = generate();
  } catch (e) {
    fail(`BUILD — check 4t could not re-run build.js in memory, so it compared nothing and cannot vouch for styles.css, tokens.generated.js or _ds_manifest.json: ${e.message}`);
  }

  let totalCompared = 0;
  const perOutput = [];
  // Every output that was not compared is named in the report, so VERIFICATION.md
  // can never say "every output matches" about one this check did not look at.
  const uncompared = built ? [] : Object.keys(UNITS);
  if (built) {
    const byName = new Map(built.outputs.map((o) => [path.basename(o.path), o]));
    for (const name of Object.keys(UNITS)) {
      if (!byName.has(name)) {
        uncompared.push(name);
        fail(`BUILD — check 4t expected build.js's generate() to return ${name} and it did not, so that output is no longer compared. An output that drops out of a comparison is a guard that quietly stopped running.`);
      }
    }
    for (const o of built.outputs) {
      const name = path.basename(o.path);
      const extract = UNITS[name];
      if (!extract) {
        uncompared.push(name);
        fail(`BUILD — build.js now generates ${name}, which check 4t has no comparison for. Add it to UNITS in validate_system.js.`);
        continue;
      }
      const expectedText = LF(o.text);
      const diskText = fs.existsSync(o.path) ? LF(fs.readFileSync(o.path, 'utf8')) : null;

      let expected;
      try {
        expected = extract(expectedText);
      } catch (e) {
        uncompared.push(name);
        fail(`BUILD — check 4t could not read ${name} as build.js generates it (${e.message}), so it compared nothing for that output.`);
        continue;
      }
      if (expected.size === 0) {
        uncompared.push(name);
        fail(`BUILD — check 4t found 0 values in ${name} as build.js generates it, so the comparison could not have failed on anything. A check that cannot fail is DECISIONS 006.`);
        continue;
      }
      totalCompared += expected.size;
      perOutput.push(`${name} ${expected.size}`);

      const stale = (detail) => {
        buildStale.push(name);
        const src = SOURCE_OF[name];
        fail(`BUILD — ${o.label} does not match what build.js produces from the current ${src}: ${detail}. ` +
          `Either ${src} changed and the build was not run, or the file was edited by hand. ` +
          `If the on-disk value is the one you want, put it in ${src}. Then run node systems/vellum/build.js (check 4t).`);
      };

      if (diskText === null) { stale('the file does not exist'); continue; }
      let onDisk;
      try {
        onDisk = extract(diskText);
      } catch (e) {
        stale(`the file on disk cannot be read (${e.message})`);
        continue;
      }

      const diffs = [];
      for (const [k, v] of expected) {
        if (!onDisk.has(k)) diffs.push(`${k} is missing on disk; the build writes ${v}`);
        else if (onDisk.get(k) !== v) diffs.push(`${k} is ${onDisk.get(k)} on disk; the build writes ${v}`);
      }
      for (const [k, v] of onDisk) if (!expected.has(k)) diffs.push(`${k} (${v}) is on disk but the build does not write it`);

      if (diffs.length) {
        const shown = diffs.slice(0, 3).join('; ') + (diffs.length > 3 ? `; and ${diffs.length - 3} more (VERIFICATION.md lists them)` : '');
        stale(`${diffs.length} of ${expected.size} value(s) differ — ${shown}`);
        for (const d of diffs) driftRows.push(`| \`${name}\` | build output | ${d.replace(/\|/g, '\\|')} | run \`build.js\` |`);
      } else if (diskText !== expectedText) {
        // Every value matches, but something else in the file does not — a comment,
        // an ordering, text around the generated region that the build rewrites.
        const a = diskText.split('\n');
        const b = expectedText.split('\n');
        let i = 0;
        while (i < Math.max(a.length, b.length) && a[i] === b[i]) i++;
        stale(`all ${expected.size} values match, but the file differs at line ${i + 1}: on disk ${JSON.stringify((a[i] || '').trim())}, the build writes ${JSON.stringify((b[i] || '').trim())}`);
        driftRows.push(`| \`${name}\` | build output | line ${i + 1} differs outside the values | run \`build.js\` |`);
      }
    }
  }
  if (built && totalCompared === 0) {
    fail('BUILD — check 4t compared 0 values across every build output. It cannot have failed on anything, so it has not shown the build is current.');
  }
  const verdict = [];
  if (buildStale.length) verdict.push(`**Stale: ${buildStale.join(', ')}.**`);
  if (uncompared.length) verdict.push(`**Not compared: ${uncompared.join(', ')}.**`);
  out.push(`Build currency (check 4t): ${totalCompared} value(s) compared against a fresh in-memory build — ${perOutput.join(', ') || 'none'}. ` +
    `${verdict.length ? verdict.join(' ') : 'Every output matches.'}\n`);
}

// 4t-export. The Design System export agrees with its sources.
//
// export_design_system.js lays Vellum out as the project/ tree of Claude's Design
// System Artifact type, in dist/design-system/ (git-ignored). It is derived, like
// the outputs 4t compares, but it lives outside the repository's tracked files, so
// it gets its own rule. Three parts:
//
//   1. Accounting. Every token the build emits (tokens.generated.js META, from the
//      in-memory build 4t just ran) is either carried into the export's tokens.json
//      at the value styles.css ships, in every mode, or listed as dropped with a
//      reason. A token that is neither has fallen out of the export unnoticed, which
//      is the drift this rule exists for.
//   2. Format. The tree keeps the type's caps and name rules (export_design_system.js
//      RULES): list-shaped families, one shared name namespace, card identifiers,
//      line-1 markers, file sizes.
//   3. Currency. When the folder exists on disk, it is byte-for-byte what the
//      generator writes now (design-system.json's two timestamps aside). The hook
//      and CI validate a copy without it, so this part only runs on a working tree.
//
// It cannot pass on an empty comparison: 0 tokens accounted for fails (DECISIONS 006).
{
  let exp = null;
  let ex = null;
  try {
    ex = require(path.join(DS, 'export_design_system.js'));
    exp = ex.generateExport();
  } catch (e) {
    fail(`EXPORT — check 4t-export could not run export_design_system.js in memory, so the Design System export is unchecked: ${e.message}`);
  }
  if (exp) {
    const vm = require('vm');
    const { generate } = require(path.join(DS, 'build.js'));
    const genJs = generate().outputs.find((o) => path.basename(o.path) === 'tokens.generated.js').text;
    const VT = vm.runInNewContext(`${genJs}\n;VellumTokens`, {}, { timeout: 1000 });

    // Every carried token, found again in tokens.json by name, per mode.
    const inExport = new Map();
    for (const [fam, block] of Object.entries(exp.tokens)) {
      if (!block || !Array.isArray(block.tokens)) continue;
      for (const t of block.tokens) inExport.set(t.name, { fam, value: t.value });
    }
    for (const [k, v] of Object.entries((exp.tokens.type && exp.tokens.type.families) || {})) inExport.set(`font-${k}`, { fam: 'type.families', value: v });
    const dropped = new Map(exp.report.dropped.map((d) => [d.name, d]));

    let accounted = 0;
    const lost = [];
    const wrong = [];
    for (const cssName of Object.keys(VT.META)) {
      const name = cssName.replace(/^--/, '');
      const light = String(VT.LIGHT[cssName]);
      const dark = String(VT.DARK[cssName]);
      if (dropped.has(name)) { accounted++; continue; }
      const t = inExport.get(name);
      if (!t) { lost.push(cssName); continue; }
      accounted++;
      // A colour alias "{x}" is the format's spelling of var(--x), which is what styles.css ships.
      const unalias = (v) => (typeof v === 'string' ? v.replace(/^\{([A-Za-z0-9_.-]+)\}$/, 'var(--$1)') : v);
      const l = unalias(typeof t.value === 'string' ? t.value : t.value.light);
      const d = unalias(typeof t.value === 'string' ? t.value : (t.value.dark !== undefined ? t.value.dark : t.value.light));
      if (l !== light) wrong.push(`${cssName} light is ${l} in the export; styles.css ships ${light}`);
      if (d !== dark) wrong.push(`${cssName} dark is ${d} in the export; styles.css ships ${dark}`);
    }
    for (const n of lost) fail(`EXPORT — ${n} is in tokens.json but neither carried into the Design System export nor listed as dropped. Route it in export_design_system.js ROUTES (check 4t-export).`);
    for (const w of wrong) fail(`EXPORT — ${w}. The export no longer matches the build (check 4t-export).`);
    if (accounted === 0) fail('EXPORT — check 4t-export accounted for 0 tokens, so it cannot have failed on anything (DECISIONS 006).');

    // Examples and tools: exported exactly as the sources are (ruled 2026-11-18).
    // Every @dsExample is in the export. A kept file and tools/derive_ramp.js are
    // byte-identical to their source. A page card is its source with line 1
    // replaced by the card marker and, at most, the ../../styles.css link and the
    // ./ds-base.js loader taken out; this is recomputed here from the source
    // rather than from the generator's code, so a content edit in the generator
    // cannot pass.
    let examplesChecked = 0;
    {
      const LFx = (s) => s.replace(/\r\n/g, '\n');
      const REMOVABLE = [/^\s*<link rel="stylesheet" href="\.\.\/\.\.\/styles\.css"\s*\/?>\s*$/, /^\s*<script src="\.\/ds-base\.js"><\/script>\s*$/];
      const byPath = new Map((exp.report.examples || []).map((e) => [e.path, e]));
      for (const m of manifest.examples) {
        const e = byPath.get(m.entryPath);
        if (!e) { fail(`EXPORT — example ${m.entryPath} is not in the Design System export, as a page card or a kept file (check 4t-export).`); continue; }
        const src = LFx(fs.readFileSync(path.join(DS, m.entryPath), 'utf8'));
        const got = exp.files[e.to];
        if (got === undefined) { fail(`EXPORT — example ${m.entryPath} is recorded at ${e.to}, which the export does not contain (check 4t-export).`); continue; }
        examplesChecked++;
        if (e.kind === 'kept') {
          if (LFx(got) !== src) fail(`EXPORT — ${e.to} is not byte-identical to ${m.entryPath}; a kept example is exported exactly as the source is (check 4t-export).`);
          continue;
        }
        const gl = LFx(got).split('\n');
        if (!/^<!-- @dsCard group="Examples" page\b/.test(gl[0])) fail(`EXPORT — ${e.to} line 1 is not a page marker in the Examples group (check 4t-export).`);
        const expected = src.split('\n').slice(1).filter((l) => !REMOVABLE.some((r) => r.test(l)));
        const body = gl.slice(1);
        if (body.join('\n') !== expected.join('\n')) {
          let i = 0;
          while (i < Math.max(body.length, expected.length) && body[i] === expected[i]) i++;
          fail(`EXPORT — ${e.to} differs from ${m.entryPath} beyond the frame-contract rewrites, at line ${i + 2}: export ${JSON.stringify((body[i] || '').trim().slice(0, 80))}, source ${JSON.stringify((expected[i] || '').trim().slice(0, 80))}. Examples are exported exactly as the sources are (check 4t-export).`);
        }
      }
      const ramp = LFx(fs.readFileSync(path.join(DS, 'derive_ramp.js'), 'utf8'));
      if (exp.files['tools/derive_ramp.js'] === undefined) fail('EXPORT — tools/derive_ramp.js is missing from the Design System export (check 4t-export).');
      else if (LFx(exp.files['tools/derive_ramp.js']) !== ramp) fail('EXPORT — tools/derive_ramp.js is not byte-identical to derive_ramp.js (check 4t-export).');
      else examplesChecked++;
      const readme = exp.files['README.md'] || '';
      for (const p of [...(exp.report.examples || []).filter((e) => e.kind === 'kept').map((e) => e.to), 'tools/derive_ramp.js']) {
        if (!readme.includes('`' + p + '`')) fail(`EXPORT — the exported README.md does not name ${p}, so an agent reading it cannot find the file (check 4t-export).`);
      }
      if (manifest.examples.length && examplesChecked === 0) fail('EXPORT — check 4t-export compared 0 examples, so it cannot have failed on any (DECISIONS 006).');
    }

    const problems = ex.formatProblems(exp);
    for (const p of problems) fail(`EXPORT — the Design System export breaks the format: ${p} (check 4t-export).`);

    // Currency of the folder on disk, when there is one.
    let currency = 'no export on disk (dist/design-system/ is git-ignored; build.js writes it)';
    if (fs.existsSync(ex.OUT_DIR)) {
      const onDisk = ex.listTree(ex.OUT_DIR);
      const expected = Object.keys(exp.files);
      const diffs = [];
      for (const p of expected) {
        const full = path.join(ex.OUT_DIR, ...p.split('/'));
        if (!fs.existsSync(full)) diffs.push(`${p} is missing`);
        else if (ex.comparable(p, fs.readFileSync(full, 'utf8')) !== ex.comparable(p, exp.files[p])) diffs.push(`${p} differs`);
      }
      for (const p of onDisk) if (!exp.files[p]) diffs.push(`${p} is on disk but no longer generated`);
      if (diffs.length) {
        fail(`EXPORT — dist/design-system/project/ is stale: ${diffs.slice(0, 3).join('; ')}${diffs.length > 3 ? `; and ${diffs.length - 3} more` : ''}. Run node systems/vellum/build.js (check 4t-export).`);
        currency = `**stale: ${diffs.length} file(s) differ**`;
      } else {
        currency = `${expected.length} file(s) on disk match`;
      }
    }

    const r = exp.report;
    out.push(`Design System export (check 4t-export): ${accounted} token(s) accounted for — ${r.carried.length} carried at the shipped value, ${r.dropped.length} dropped with a reason` +
      `${lost.length ? `, **${lost.length} lost**` : ''}${wrong.length ? `, **${wrong.length} wrong**` : ''}; ` +
      `${r.styles.carried.length} type style(s) carried, ${r.styles.dropped.length} dropped; ${r.cards.length} card(s) + cover; ${examplesChecked} example(s) and tool(s) exported exactly as their sources; ` +
      `${problems.length ? `**${problems.length} format problem(s)**` : 'inside the format\'s caps'}; ${currency}.\n`);
  }
}

// 4b. @dsCard <-> manifest
for (const card of manifest.cards) {
  const p = path.join(DS, card.path);
  if (!fs.existsSync(p)) continue;
  const head = fs.readFileSync(p, 'utf8').split('\n')[0];
  const attr = (k) => {
    const m = new RegExp(`${k}="([^"]*)"`).exec(head);
    return m ? m[1].replace(/&amp;/g, '&') : null;
  };
  for (const [field, manifestValue] of [['name', card.name], ['viewport', card.viewport], ['subtitle', card.subtitle]]) {
    const cardValue = attr(field);
    if (cardValue !== manifestValue) {
      fail(`Manifest drift in ${card.path} [${field}]: @dsCard "${cardValue}" vs manifest "${manifestValue}"`);
      driftRows.push(`| \`${card.path}\` | ${field} | \`${cardValue}\` | \`${manifestValue}\` |`);
    }
  }
}

// 4c. workbench sidebar labels must match @dsCard names
const workbench = fs.readFileSync(path.join(DS, 'index.html'), 'utf8');
let sidebarMatched = 0;
for (const card of manifest.cards) {
  const re = new RegExp(`loadCard\\('${card.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'[^>]*>([^<]*)<`);
  const m = re.exec(workbench);
  if (m) {
    sidebarMatched++;
    const label = m[1].replace(/&amp;/g, '&').replace(/&#39;/g, "'").trim();
    if (label !== card.name) {
      fail(`Workbench label drift for ${card.path}: sidebar "${label}" vs card "${card.name}"`);
      driftRows.push(`| \`${card.path}\` | sidebar label | \`${card.name}\` | \`${label}\` |`);
    }
  }
}
if (manifest.cards.length && sidebarMatched === 0) {
  fail(`Workbench label check (4c) found none of the ${manifest.cards.length} cards in the index.html sidebar, so it compared nothing. The loadCard pattern has stopped matching (DECISIONS 006).`);
}

// 4d. cards must DERIVE role lists from the token file, not hand-list them
const HAND_LISTED = [
  ['foundations/color.html', 'ROLES', /const ROLES\s*=\s*\[[^\]]*'--color-/],
];
for (const [file, what, re] of HAND_LISTED) {
  const full = path.join(DS, file);
  // A card that moved used to switch this check off without a word.
  if (!fs.existsSync(full)) {
    fail(`${file} does not exist, so check 4d could not confirm it derives ${what} from the tokens. Update HAND_LISTED in validate_system.js if the card moved.`);
    continue;
  }
  const text = fs.readFileSync(full, 'utf8');
  if (re.test(text)) {
    fail(`${file} hand-lists ${what}; derive it from META so it cannot fall behind semantic.color`);
    driftRows.push(`| \`${file}\` | ${what} | hand-listed | must derive from \`META\` |`);
  } else if (!/parts\[0\] === 'semantic' && parts\[1\] === 'color'/.test(text)) {
    fail(`${file} no longer derives ${what} from the semantic.color path`);
    driftRows.push(`| \`${file}\` | ${what} | derivation missing | must filter on \`semantic.color\` |`);
  }
}


// 4e. ramps still follow the rule that generated them
const L_TARGET = { 100:95, 200:89, 300:82, 400:74, 500:65, 600:55, 700:45, 800:36, 900:29 };
const L_TOLERANCE = 1.5;
// `neutral` is deliberately uneven and documented as such; it is not generated.
const EXEMPT_RAMPS = new Set(['neutral']);

const _lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const _labL = (hex) => {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255);
  const Y = 0.2126 * _lin(r) + 0.7152 * _lin(g) + 0.0722 * _lin(b);
  return 116 * (Y > 0.008856 ? Math.cbrt(Y) : 7.787 * Y + 16 / 116) - 16;
};

const rampFamilies = {};
for (const [p2, v] of Object.entries(flat)) {
  const parts = p2.split('.');
  if (parts[0] !== 'primitive' || parts[1] !== 'color' || parts.length !== 4) continue;
  if (EXEMPT_RAMPS.has(parts[2])) continue;
  (rampFamilies[parts[2]] = rampFamilies[parts[2]] || []).push({ step: parseInt(parts[3], 10), value: v.$value });
}

const rampNames = Object.keys(rampFamilies);
const stepSets = rampNames.map((n) => rampFamilies[n].map((s) => s.step).sort((a, b) => a - b).join(','));
const uniqueSets = [...new Set(stepSets)];
// The basis is the step set most ramps carry. It used to be whichever ramp was
// enumerated first, so a rung deleted from amber failed the four intact ramps and
// never named amber.
const basis = uniqueSets.reduce((a, b) =>
  (stepSets.filter((s) => s === b).length > stepSets.filter((s) => s === a).length ? b : a), uniqueSets[0]);
const basisName = rampNames[stepSets.indexOf(basis)];

// Every generated family carries the same rungs.
if (uniqueSets.length > 1) {
  rampNames.forEach((n, i) => {
    if (stepSets[i] !== basis) {
      fail(`GRAMMAR — ramp \`${n}\` carries steps ${stepSets[i]}, but \`${basisName}\` carries ${basis}; every generated ramp uses the same basis`);
      driftRows.push(`| \`primitive.color.${n}\` | step basis | \`${stepSets[i]}\` | \`${basis}\` |`);
    }
  });
}

// The same rungs, and the nine GRAMMAR §3.4 names. The basis check above would pass if a
// rung were deleted from every family alike, and regeneration skips a family without nine
// (DECISIONS 037).
const NINE = Object.keys(L_TARGET).map(Number).sort((a, b) => a - b).join(',');
rampNames.forEach((n, i) => {
  if (stepSets[i] === NINE) return;
  fail(`GRAMMAR — ramp \`${n}\` carries steps ${stepSets[i]}; every generated ramp carries the nine rungs ${NINE} (GRAMMAR §3.4, DECISIONS 037)`);
  driftRows.push(`| \`primitive.color.${n}\` | nine rungs | \`${stepSets[i]}\` | \`${NINE}\` |`);
});
if (rampNames.length === 0) fail('GRAMMAR — no generated ramps were found to hold to the nine rungs, so the ramp checks read nothing (DECISIONS 006).');

// Status colours sit on the 500 rung of their hue, in both modes, so they stay interchangeable
// in a pill (GRAMMAR §3.3, DECISIONS 037). What a site may do with them is §3.9, checked below.
{
  const statusRoles = Object.keys(flat).filter((p) => /^semantic\.color\.status-[a-z]+$/.test(p));
  if (statusRoles.length === 0) fail('GRAMMAR — found no semantic.color.status-* roles to hold to the 500 rung (DECISIONS 006).');
  for (const p of statusRoles) {
    const hue = p.split('status-')[1];
    const want = `{primitive.color.${hue}.500}`;
    const ext = flat[p].$extensions && flat[p].$extensions[MODE_EXT];
    for (const [mode, v] of [['light', flat[p].$value], ['dark', ext && ext.dark !== undefined ? ext.dark : flat[p].$value]]) {
      if (v === want) continue;
      fail(`GRAMMAR — ${p} is ${v} in ${mode}; a status colour sits on the 500 rung of its hue, ${want}, so every status stays interchangeable in a pill (GRAMMAR §3.3, DECISIONS 037)`);
      driftRows.push(`| \`${p}\` (${mode}) | status rung | \`${v}\` | \`${want}\` |`);
    }
  }
}

// Exact regeneration: the tool that derives ramps must reproduce what shipped.
// Each family records the hue it came from, because re-deriving the angle from a
// stored hex would inherit that hex's 8-bit rounding.
let deriveTool = null;
try { deriveTool = require('./derive_ramp.js'); } catch (e) { /* optional */ }
if (deriveTool) {
  const pcRaw = tokens.primitive.color;
  for (const [name, ramp] of Object.entries(pcRaw)) {
    if (EXEMPT_RAMPS.has(name) || typeof ramp !== 'object' || ramp.$value) continue;
    const rungs = Object.keys(ramp).filter((k) => !k.startsWith('$'));
    if (rungs.length !== 9) continue;
    const ext = ramp.$extensions && ramp.$extensions['design.vellum.ramp'];
    if (!ext || typeof ext.hue !== 'number') {
      fail(`GRAMMAR — ramp \`${name}\` records no generating hue, so it cannot be regenerated`);
      driftRows.push(`| \`primitive.color.${name}\` | recorded hue | missing | \`$extensions.design.vellum.ramp.hue\` |`);
      continue;
    }
    const derived = deriveTool.deriveRampAtHue(ext.hue);
    for (const step of rungs) {
      const want = derived[step] && derived[step].hex.toUpperCase();
      const got = (ramp[step].$value || '').toUpperCase();
      if (want && want !== got) {
        fail(`GRAMMAR — ${name}.${step} is ${got}, but the rule at hue ${ext.hue} derives ${want}`);
        driftRows.push(`| \`primitive.color.${name}.${step}\` | derived value | \`${got}\` | \`${want}\` |`);
      }
    }
  }
}

// §3.3 — a site's brand steps are derived, not chosen (DECISIONS 041, 046). A site declares its
// brand colours as --brand-1, --brand-2 … each a hex exactly as given, and every step it declares,
// --color-brand-<n>-<rung>, must be what derive_ramp.js makes of brand <n>. A step with no
// brand colour to derive it from fails, since nothing says it was derived. The unnumbered
// spellings (--brand, --color-brand-<rung>) predate a palette of several colours and fail too:
// one spelling, so an agent never has to guess which one a project uses.
let siteRamps = 0;
for (const file of implFiles) {
  if (!/\.(html|css)$/.test(file)) continue;
  const text = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, (s) => s.replace(/[^\n]/g, ''));
  const lineAt = (i) => text.slice(0, i).split('\n').length;
  for (const m of text.matchAll(/--brand\s*:|--color-brand-\d{3}\b/g)) {
    fail(`GRAMMAR §3.3 — ${rel(file)}:${lineAt(m.index)} uses \`${m[0].replace(/\s*:$/, '')}\`; brand colours are numbered: --brand-1, and its steps --color-brand-1-<rung> (DECISIONS 046)`);
  }
  const steps = [...text.matchAll(/--color-brand-(\d+)-(\d{3})\s*:\s*([^;}"']+)/gi)];
  if (!steps.length) continue;
  siteRamps++;
  const hexes = Object.fromEntries([...text.matchAll(/--brand-(\d+)\s*:\s*(#[0-9a-f]{6})\b/gi)].map((m) => [m[1], m[2]]));
  if (!deriveTool) { fail(`GRAMMAR §3.3 — derive_ramp.js is unavailable, so ${rel(file)}'s brand steps could not be regenerated`); continue; }
  for (const m of steps) {
    const hex = hexes[m[1]];
    if (!hex) { fail(`GRAMMAR §3.3 — ${rel(file)}:${lineAt(m.index)} declares a step of brand ${m[1]}, but no \`--brand-${m[1]}\` hex to derive it from; a project supplies a hex and the system derives the rest (DECISIONS 041, 046)`); continue; }
    const want = deriveTool.deriveRamp(hex).steps[m[2]];
    const got = m[3].trim().toUpperCase();
    if (!want || want.hex.toUpperCase() !== got) {
      fail(`GRAMMAR §3.3 — ${rel(file)}:${lineAt(m.index)} sets brand ${m[1]}'s ${m[2]} step to ${got}, but ${hex} derives ${want ? want.hex.toUpperCase() : 'no such rung'}. The steps are derived, not chosen: node systems/vellum/derive_ramp.js "${hex}" --css --name brand-${m[1]} (DECISIONS 041, 046)`);
    }
  }
}

for (const [name, steps] of Object.entries(rampFamilies)) {
  steps.sort((a, b) => a.step - b.step);
  let prev = null;
  for (const { step, value } of steps) {
    const L = _labL(value);
    if (L === null) continue;
    const target = L_TARGET[step];
    if (target !== undefined && Math.abs(L - target) > L_TOLERANCE) {
      fail(`GRAMMAR — ${name}.${step} is L* ${L.toFixed(1)}, off its ${target} target by ${Math.abs(L - target).toFixed(1)}`);
      driftRows.push(`| \`primitive.color.${name}.${step}\` | L* target | \`${L.toFixed(1)}\` | \`${target}\` |`);
    }
    if (prev !== null && L >= prev.L) {
      fail(`GRAMMAR — ramp \`${name}\` reverses at ${step}: L* ${L.toFixed(1)} is not below ${prev.step}'s ${prev.L.toFixed(1)}`);
      driftRows.push(`| \`primitive.color.${name}.${step}\` | monotonic | \`${L.toFixed(1)}\` | \`< ${prev.L.toFixed(1)}\` |`);
    }
    prev = { step, L };
  }
}


// 4f. declared foreground/background pairings clear WCAG AA, in both modes
const AA = 4.5;
const PAIRINGS = [
  // One row per core status, read from the tokens, so a status added to the core is measured
  // without anyone remembering to list it (DECISIONS 058).
  ...Object.keys(flat).filter((p) => /^semantic\.color\.status-[a-z]+$/.test(p)).map((p) => {
    const h = p.split('status-')[1];
    return [`status pill, ${h}`, `--color-status-${h}-fg`, `--color-status-${h}`, 0.12];
  }),
  ['status toggle badge',  '--color-status-emerald-fg', '--color-status-emerald', 0.10],
  ['action label, resting', '--color-action-fg',         '--color-action-bg',        1],
  ['action label, hover',   '--color-action-fg',         '--color-action-bg-hover',  1],
  ['action label, pressed', '--color-action-fg',         '--color-action-bg-active', 1],
  ['body text on a sheet', '--color-text-primary',      null,                     0],
  ['secondary on a sheet', '--color-text-secondary',    null,                     0],
  ['muted on a sheet',     '--color-text-muted',        null,                     0],
  // A cavity is dark in BOTH modes, so its text is mode-invariant and is not any of the
  // sheet rows above (text-primary is #0F172A in light: 1.00:1 on a #0F172A cavity).
  ['text on a cavity',      '--color-text-on-sunken',           '--color-surface-sunken', 1],
  ['secondary on a cavity', '--color-text-on-sunken-secondary', '--color-surface-sunken', 1],
  // The landing example's stage-placeholder caption is coloured with the raw status role
  // (--color-status-cyan, not its -fg rung) directly on the cavity. Declared so it is measured.
  ['status-cyan on a cavity', '--color-status-cyan',             '--color-surface-sunken', 1],
];

const _hexOnly = (v) => /^#[0-9a-f]{6}$/i.test((v || '').trim());
const _rgb = (v) => { const h = v.trim().replace('#', ''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
const _lin8 = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const _Y = (v) => 0.2126 * _lin8(v[0]) + 0.7152 * _lin8(v[1]) + 0.0722 * _lin8(v[2]);
const _ratio = (a, b) => { const x = _Y(a), y = _Y(b), hi = Math.max(x, y), lo = Math.min(x, y); return (hi + 0.05) / (lo + 0.05); };
const _mix = (c, alpha, back) => [0, 1, 2].map((i) => alpha * c[i] + (1 - alpha) * back[i]);
// A translucent surface value, composited over the ground it sits on.
const _flatten = (value, ground) => {
  const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)/i.exec(value || '');
  if (m) return _mix([+m[1], +m[2], +m[3]], m[4] === undefined ? 1 : +m[4], ground);
  return _hexOnly(value) ? _rgb(value) : null;
};

// A semantic role's resolved value in one mode. Shared by 4f and 4q.
const readRoleIn = (isDark, name) => {
  const path2 = Object.keys(flat).find((k) => cssName(k) === name);
  if (!path2) return null;
  const t = flat[path2];
  const raw = isDark
    ? ((t.$extensions && t.$extensions['design.vellum.mode'] && t.$extensions['design.vellum.mode'].dark) || t.$value)
    : t.$value;
  return resolve(raw);
};

// A pairing that cannot be measured is an ERROR, never a pass (DECISIONS 006: a guard that
// matches too narrowly is worse than no guard). The only way out is to name the pairing here
// with the reason its value cannot be a flat colour. Empty today: every pairing is measured.
const UNMEASURABLE = {
  // 'label of the pairing': 'why no contrast ratio can be computed for it (e.g. a gradient)',
};
for (const [label, reason] of Object.entries(UNMEASURABLE)) {
  if (!PAIRINGS.some((p) => p[0] === label)) fail(`CONTRAST — UNMEASURABLE names "${label}", which is not a declared pairing`);
  if (!String(reason || '').trim()) fail(`CONTRAST — "${label}" is excluded as unmeasurable without a stated reason`);
}

const pairRows = [];
let pairMeasured = 0;
for (const mode of ['LIGHT', 'DARK']) {
  const read = (name) => readRoleIn(mode === 'DARK', name);
  const ground = _flatten(read('--color-bg-canvas'), [255, 255, 255]);
  const sheet = ground && _flatten(read('--color-surface'), ground);
  if (!ground || !sheet) {
    fail(`CONTRAST — ${mode} mode is unmeasured: --color-bg-canvas (${JSON.stringify(read('--color-bg-canvas'))}) or --color-surface (${JSON.stringify(read('--color-surface'))}) does not resolve to a colour`);
    continue;
  }

  for (const [label, fgName, tintName, alpha] of PAIRINGS) {
    if (Object.prototype.hasOwnProperty.call(UNMEASURABLE, label)) continue;
    const fgVal = read(fgName);
    const tintVal = tintName ? read(tintName) : null;
    if (!_hexOnly(fgVal)) {
      fail(`CONTRAST — "${label}" in ${mode} is unmeasured: foreground ${fgName} resolves to ${JSON.stringify(fgVal)}, not a 6-digit hex`);
      continue;
    }
    if (tintName && !_hexOnly(tintVal)) {
      fail(`CONTRAST — "${label}" in ${mode} is unmeasured: background ${tintName} resolves to ${JSON.stringify(tintVal)}, not a 6-digit hex`);
      continue;
    }
    const bg = tintName ? _mix(_rgb(tintVal), alpha, sheet) : sheet;
    const v = _ratio(_rgb(fgVal), bg);
    if (!Number.isFinite(v)) {
      fail(`CONTRAST — "${label}" in ${mode} is unmeasured: the ratio is ${v}`);
      continue;
    }
    pairMeasured++;
    if (v < AA) {
      fail(`CONTRAST — ${label} in ${mode}: ${v.toFixed(2)}:1, below AA (${fgName} on ${tintName ? tintName + ' at ' + alpha * 100 + '%' : 'the sheet'})`);
      pairRows.push(`| ${label} | ${mode} | \`${v.toFixed(2)}:1\` | \`>= ${AA}\` |`);
    }
  }
}
// Every declared pairing, in both modes, is either measured or named in UNMEASURABLE.
const pairExpected = (PAIRINGS.length - Object.keys(UNMEASURABLE).length) * 2;
if (pairMeasured !== pairExpected) {
  fail(`CONTRAST — ${pairMeasured} of ${pairExpected} expected pairing measurements were made; the rest were not measured`);
}
if (pairRows.length) driftRows.push(...pairRows);

// 4f, non-text. A control's boundary is how a reader finds it, and WCAG 1.4.11 asks 3:1 for
// it. The edge is translucent, so it is composited over what it sits on, in both modes, on
// the ground and on a sheet. The control edge stood at 1.31:1 in light and 1.57:1 in dark
// until DECISIONS 034. A value that cannot be composited is a failure, never a pass.
{
  const NON_TEXT = 3;
  const EDGES = [
    ['control edge', '--color-action-border'],
  ];
  let edgeMeasured = 0;
  for (const mode of ['LIGHT', 'DARK']) {
    const read = (name) => readRoleIn(mode === 'DARK', name);
    const ground = _flatten(read('--color-bg-canvas'), [255, 255, 255]);
    const sheet = ground && _flatten(read('--color-surface'), ground);
    for (const [label, name] of EDGES) {
      for (const [where, under] of [['the ground', ground], ['a sheet', sheet]]) {
        const edge = under && _flatten(read(name), under);
        const v = edge ? _ratio(edge, under) : NaN;
        if (!Number.isFinite(v)) {
          fail(`CONTRAST — ${label} (${name}) on ${where} in ${mode} is unmeasured: ${JSON.stringify(read(name))} does not composite to a colour`);
          continue;
        }
        edgeMeasured++;
        if (v < NON_TEXT) {
          fail(`CONTRAST — ${label} on ${where} in ${mode}: ${v.toFixed(2)}:1, below the ${NON_TEXT}:1 WCAG 1.4.11 asks of a control's boundary (${name}; DECISIONS 034)`);
          driftRows.push(`| ${label} on ${where} | ${mode} | \`${v.toFixed(2)}:1\` | \`>= ${NON_TEXT}\` |`);
        }
      }
    }
  }
  if (edgeMeasured !== EDGES.length * 4) fail(`CONTRAST — ${edgeMeasured} of ${EDGES.length * 4} control-edge measurements were made; the rest were not measured`);
}


// 4g. every GRAMMAR section cross-reference resolves to a real section
const grammarPath = path.join(DS, '..', 'spec', 'GRAMMAR.md');
let grammarRefs = 0;
if (!fs.existsSync(grammarPath)) {
  fail('GRAMMAR.md is missing, so check 4g could not resolve a single § reference');
} else {
  const grammarText = fs.readFileSync(grammarPath, 'utf8');
  const sections = new Set(
    [...grammarText.matchAll(/^###\s+(\d+\.\d+)\s/gm)].map((m) => m[1])
  );
  // Where a reference is allowed to appear. Release notes are frozen history.
  const refFiles = sourceFiles.filter(
    (f) => /\.(md|js|html)$/.test(f) && !/VERIFICATION\.md$/.test(f)
  );
  const specDir = path.join(DS, '..', 'spec');
  for (const f of ['GRAMMAR.md', 'DESIGN.md', 'DECISIONS.md', 'PROMPT_TEMPLATE.md']) {
    const full = path.join(specDir, f);
    if (fs.existsSync(full) && !refFiles.includes(full)) refFiles.push(full);
  }
  for (const file of refFiles) {
    const text = fs.readFileSync(file, 'utf8');
    text.split('\n').forEach((line, i) => {
      // Only GRAMMAR sections are numbered this way; DESIGN uses single digits.
      for (const m of line.matchAll(/GRAMMAR[^\n]{0,12}?§(\d+\.\d+)|§(\d+\.\d+)/g)) {
        const ref = m[1] || m[2];
        grammarRefs++;
        // DESIGN.md §5.1 and validate_system's own §-labelled checks are grammar refs too,
        // but a reference to a section that does not exist is always wrong.
        if (!sections.has(ref) && /^[23]\./.test(ref)) {
          fail(`Dangling reference §${ref} at ${rel(file)}:${i + 1} — no such section in GRAMMAR.md`);
          driftRows.push(`| \`${rel(file)}:${i + 1}\` | cross-reference | \`§${ref}\` | no such section |`);
        }
      }
    });
  }
  if (grammarRefs === 0) fail('Check 4g found 0 § references across the system and spec, so it resolved nothing. The spec cites GRAMMAR sections throughout, so the pattern has stopped matching (DECISIONS 006).');
}


// 4h. consumer sites must not hardcode a value the system already owns
const systemColours = new Map();
for (const [p2, t] of Object.entries(flat)) {
  // Vellum's own brand palette is identity too (DECISIONS 046): a site hardcoding #38BDF8 is lit
  // by Vellum's sky whether it reached it through a lamp or a literal.
  if (!/^primitive\.color\.|^semantic\.brand\./.test(p2)) continue;
  const v = (t.$value || '').trim();
  if (/^#[0-9a-f]{6}$/i.test(v)) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16));
    systemColours.set(`${r},${g},${b}`, p2);
  }
}
// Neutrals and the two grounds are shared furniture, not identity.
const SHARED = /^primitive\.color\.(neutral|ground-light|ground-dark|white|black|steel)/;

// A page whose job is to DISPLAY the system's values has to type them. Inside <code> only,
// 4h does not look; check the block after 4z compares exactly those <code> literals to the tokens, so
// the exemption is a swap of guards, not a hole. Outside <code> the page is held as before.
const DOC_PAGES = [path.join(EXAMPLES, 'document', 'spec.html')];

let brandLiterals = 0;
for (const file of implFiles.concat(exampleFiles)) {
  if (!/\.(html|css)$/.test(file)) continue;
  const text = fs.readFileSync(file, 'utf8');
  text.split('\n').forEach((rawLine, i) => {
    const line = DOC_PAGES.includes(file) ? rawLine.replace(/<code>[^<]*<\/code>/g, '<code></code>') : rawLine;
    const seen = new Set();
    // #RRGGBBAA and space-separated rgb() are the same owned colour in another
    // notation. rgba(r, g, b, a) was already a leak at any alpha, but `\b` after six
    // hex digits refused #D98E1ECC and the comma-only pattern refused rgb(217 142 30).
    for (const m of line.matchAll(/#([0-9a-f]{6})(?:[0-9a-f]{2})?\b|rgba?\(\s*(\d{1,3})(?:\s*,\s*|\s+)(\d{1,3})(?:\s*,\s*|\s+)(\d{1,3})/gi)) {
      brandLiterals++;
      let key;
      if (m[1]) {
        const [r, g, b] = [0, 2, 4].map((k) => parseInt(m[1].slice(k, k + 2), 16));
        key = `${r},${g},${b}`;
      } else {
        key = `${+m[2]},${+m[3]},${+m[4]}`;
      }
      const owner = systemColours.get(key);
      if (owner && !SHARED.test(owner) && !seen.has(key)) {
        seen.add(key);
        fail(`BRAND LEAK — ${rel(file)}:${i + 1} hardcodes ${m[0]}, which is \`${owner}\`; a site's colours are its own (GRAMMAR §3.3)`);
        driftRows.push(`| \`${rel(file)}:${i + 1}\` | brand leak | \`${m[0]}\` | \`${owner}\` |`);
      }
    }
  });
}
// Every site declares its own brand hex and ramp, so the scan always has colours to
// compare. None means the pattern has stopped matching.
if (brandLiterals === 0) fail('BRAND LEAK — check 4h read 0 colour literals across the sites and examples, so it compared nothing. Each site declares its own brand ramp, so the pattern has stopped matching (DECISIONS 006).');


// 4i. one mechanism for dark mode. Two selectors applied at two levels means a
// token can be "applied" and silently not apply — see DECISIONS 009.
for (const file of styleFiles) {
  const text = fs.readFileSync(file, 'utf8');
  text.split('\n').forEach((line, i) => {
    if (/\bdark-theme\b/.test(line)) {
      fail(`DUAL DARK MECHANISM — ${rel(file)}:${i + 1} uses \`.dark-theme\`; the only dark selector is [data-theme="dark"] on <html> (GRAMMAR §2, DECISIONS 009)`);
    }
  });
}


// Every colour in a declaration, and the opacity it is drawn at. Shared by 4u, which holds
// dark shadows and sheet edges to zero, and by 4j, which holds a lamp's colour to opaque.
//
// Returns { alphas, unread }. `unread` lists every colour whose opacity cannot be
// read, and the whole declaration when it holds no colour at all (`none`, a bare
// var()). It began as the lamps' reader, when a lamp was one gradient string whose
// colour-mix() carried its opacity (DECISIONS 019). The old reader knew two
// spellings and returned nothing for any other, and nothing to compare passed:
// rgb(6 182 212 / 0.9), three and a half times the dark ceiling, built clean.
const lampColours = (decl) => {
  const alphas = [];
  const unread = [];
  const num = (s) => {
    const t = String(s).trim();
    if (/^\d*\.?\d+%$/.test(t)) return parseFloat(t) / 100;
    if (/^\d*\.?\d+$/.test(t)) return parseFloat(t);
    return null;
  };
  const closeOf = (text, open) => {
    let depth = 0;
    for (let i = open; i < text.length; i++) {
      if (text[i] === '(') depth++;
      else if (text[i] === ')' && --depth === 0) return i;
    }
    return -1;
  };
  const splitTop = (s) => {
    const parts = [];
    let depth = 0, start = 0;
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '(') depth++;
      else if (s[i] === ')') depth--;
      else if (s[i] === ',' && depth === 0) { parts.push(s.slice(start, i)); start = i + 1; }
    }
    parts.push(s.slice(start));
    return parts.map((p) => p.trim());
  };
  // A colour function's arguments, comma or space syntax. Three channels and no
  // alpha is opaque.
  const rgbAlpha = (args) => {
    if (args.includes('var(')) return null;
    if (args.includes(',')) {
      const p = args.split(',');
      if (p.length === 3) return 1;
      return p.length === 4 ? num(p[3]) : null;
    }
    const [chans, a] = args.split('/');
    if (chans.trim().split(/\s+/).length !== 3) return null;
    return a === undefined ? 1 : num(a);
  };
  // Any colour function: rgb/hsl take either syntax; hwb, lab, lch, oklab and oklch
  // take the space syntax; color() carries its colour space as a first token.
  const fnAlpha = (name, args) => {
    const n = name.toLowerCase();
    if (n === 'color-mix') return mixAlpha(args);
    if (n === 'color') return rgbAlpha(args.replace(/^\s*\S+\s+/, ''));
    return rgbAlpha(args);
  };
  const hexAlpha = (h) => (h.length === 5 ? parseInt(h[4] + h[4], 16) / 255
    : h.length === 9 ? parseInt(h.slice(7), 16) / 255 : 1);
  // color-mix(in <space>, <colour> [P%], transparent [Q%]), in either order.
  const mixAlpha = (args) => {
    const p = splitTop(args);
    if (p.length !== 3 || !/^in\s/.test(p[0])) return null;
    const comps = p.slice(1).map((c) => {
      let m = /^(.*?)\s+(\d*\.?\d+)%$/.exec(c);
      if (m) return { colour: m[1].trim(), pct: parseFloat(m[2]) };
      m = /^(\d*\.?\d+)%\s+(.*)$/.exec(c);
      if (m) return { colour: m[2].trim(), pct: parseFloat(m[1]) };
      return { colour: c, pct: undefined };
    });
    const t = comps.findIndex((c) => c.colour === 'transparent');
    if (t === -1) return null;
    const c = comps[1 - t];
    let pc = c.pct, pt = comps[t].pct;
    if (pc === undefined && pt === undefined) { pc = 50; pt = 50; }
    else if (pc === undefined) pc = 100 - pt;
    else if (pt === undefined) pt = 100 - pc;
    const sum = pc + pt;
    if (!(sum > 0)) return null;
    // The colour's own opacity: a var() or a keyword is taken as opaque, as it
    // always was here; a literal with an alpha of its own multiplies in.
    let own = 1;
    const fn = /^([a-z-]+)\(/i.exec(c.colour);
    if (fn && fn[1].toLowerCase() !== 'var') own = fnAlpha(fn[1], c.colour.slice(fn[0].length, c.colour.lastIndexOf(')')));
    else if (/^#[0-9a-f]{3,8}$/i.test(c.colour)) own = hexAlpha(c.colour);
    if (own === null) return null;
    return own * (pc / sum) * Math.min(1, sum / 100);
  };

  const re = /\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color-mix|color)\(|#[0-9a-f]{3,8}\b/gi;
  let m;
  while ((m = re.exec(decl)) !== null) {
    if (m[0].startsWith('#')) { alphas.push(hexAlpha(m[0])); continue; }
    const open = m.index + m[0].length - 1;
    const close = closeOf(decl, open);
    if (close === -1) { unread.push(decl.slice(m.index).trim()); break; }
    const args = decl.slice(open + 1, close);
    const a = fnAlpha(m[1], args);
    if (a === null || !Number.isFinite(a)) unread.push(decl.slice(m.index, close + 1));
    else alphas.push(Math.round(a * 10000) / 10000);
    re.lastIndex = close + 1;
  }
  if (alphas.length === 0 && unread.length === 0) unread.push(decl.trim());
  return { alphas, unread };
};

/*
 * The lamps, as DECISIONS 064 declares them. Each lamp, in each mode, is two values: a
 * colour (--lamp-a-color) and the peak opacity it is drawn at (--lamp-a-opacity, a number
 * from 0 to 1). build.js turns them into .light-table's opaque layers. Shared by 4j, 4p,
 * 4r and the §3.5 palette check, so all four read one declaration the same way.
 */
const LAMP_KEYS = ['a', 'b', 'c'];
const LAMP_DECL = /--lamp-([abc])-(color|opacity)\s*:\s*([^;]+)/g;

/** A lamp token's raw value for one mode: `semantic.lamp.<k>-<prop>`. */
const systemLamp = (k, prop, mode) => {
  const t = tokens.semantic.lamp && tokens.semantic.lamp[`${k}-${prop}`];
  if (!t) return undefined;
  const ext = t.$extensions && t.$extensions[MODE_EXT];
  return mode === 'dark' && ext && ext.dark !== undefined ? ext.dark : t.$value;
};

/** A lamp's opacity as a number, or null when it is not a plain number (or N%). */
const lampOpacity = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const t = String(v === undefined ? '' : v).replace(/!important/i, '').trim();
  if (/^\d*\.?\d+$/.test(t)) return parseFloat(t);
  if (/^\d*\.?\d+%$/.test(t)) return parseFloat(t) / 100;
  return null;
};

/**
 * Every lamp declaration a page or stylesheet makes outside the generated blocks, with the
 * modes it holds in. A rule on the root in dark ([data-theme="dark"]) is dark; a rule on
 * the root otherwise (:root, html) is light; any other rule sits nearer the table than the
 * root's mode values, and an inline style outranks them both, so either holds in both modes.
 * Comments are blanked to their newlines, so line numbers still hold.
 */
const lampDeclsIn = (rawText) => {
  // Most files declare no lamp. The block scan below is slow on long brace-free text, so
  // they return here.
  if (!/--lamp-[abc]-(?:color|opacity)\s*:/.test(rawText)) return [];
  const keep = (s) => s.replace(/[^\n]/g, '');
  const text = rawText
    .replace(/GENERATED:TOKENS:START[\s\S]*?GENERATED:TOKENS:END/g, keep)
    .replace(/GENERATED:LAMPS:START[\s\S]*?GENERATED:LAMPS:END/g, keep)
    .replace(/\/\*[\s\S]*?\*\//g, keep);
  const lineAt = (i) => text.slice(0, i).split('\n').length;
  const decls = [];
  for (const m of text.matchAll(/([^{}]*)\{([^{}]*--lamp-[abc]-(?:color|opacity)[^{}]*)\}/g)) {
    const selector = m[1].split(/[;}]/).pop();
    const modes = /\[data-theme=["']?dark["']?\]/.test(selector) ? ['dark']
      : /(^|[\s,]):root\b|(^|[\s,])html\b/.test(selector) ? ['light'] : ['light', 'dark'];
    const bodyStart = m.index + m[0].indexOf('{') + 1;
    for (const d of m[2].matchAll(LAMP_DECL)) {
      decls.push({ k: d[1], prop: d[2], value: d[3].trim(), modes, line: lineAt(bodyStart + d.index), inline: false });
    }
  }
  for (const a of text.matchAll(/\sstyle=(?:"([^"]*)"|'([^']*)')/g)) {
    const body = a[1] !== undefined ? a[1] : a[2];
    const at = a.index + a[0].indexOf(body);
    for (const d of body.matchAll(LAMP_DECL)) {
      decls.push({ k: d[1], prop: d[2], value: d[3].trim(), modes: ['light', 'dark'], line: lineAt(at + d.index), inline: true });
    }
  }
  return decls;
};

/** What a page shows for each lamp, per mode: its own declarations over the system's. */
const lampsShown = (decls) => {
  const shown = {};
  for (const mode of ['light', 'dark']) {
    shown[mode] = {};
    for (const k of LAMP_KEYS) {
      shown[mode][k] = {
        color: { value: systemLamp(k, 'color', mode), own: false },
        opacity: { value: systemLamp(k, 'opacity', mode), own: false },
      };
    }
  }
  // Inline styles come last: they outrank every rule.
  for (const d of [...decls.filter((x) => !x.inline), ...decls.filter((x) => x.inline)]) {
    for (const mode of d.modes) shown[mode][d.k][d.prop] = { value: d.value, own: true };
  }
  return shown;
};

// 4j. lamp opacity stays within the bounds declared on semantic.lamp
const lampBounds = (tokens.semantic.lamp.$extensions || {})['design.vellum.bounds'];
if (!lampBounds) {
  fail('semantic.lamp declares no opacity bounds, so nothing constrains the light table');
} else {
  const checkLamp = (where, value, mode) => {
    const b = lampBounds[mode];
    if (!b) return;
    const a = lampOpacity(value);
    if (a === null) {
      fail(`GRAMMAR §3.5 — ${where}: lamp opacity cannot be read from \`${value}\` (${mode}), so it cannot be held to the ${b.min}–${b.max} band. Write --lamp-<x>-opacity as a number from 0 to 1. A lamp that is off is opacity 0 (DECISIONS 019, 064).`);
      driftRows.push(`| ${where} | lamp opacity (${mode}) | \`unreadable\` | \`${b.min}–${b.max}, or 0\` |`);
      return;
    }
    // Zero is not a dim lamp, it is no lamp — GRAMMAR §3.5 (DECISIONS 008) lets
    // dark mode run on two, and an unused lamp is not held to the floor that
    // exists to catch a lamp too faint to still be doing its job.
    if (a === 0) return;
    if (a < b.min) {
      fail(`GRAMMAR §3.5 — ${where}: lamp opacity ${a} is below the ${mode} floor of ${b.min}; a sheet has nothing left to diffuse`);
      driftRows.push(`| ${where} | lamp floor (${mode}) | \`${a}\` | \`>= ${b.min}\` |`);
    } else if (a > b.max) {
      fail(`GRAMMAR §3.5 — ${where}: lamp opacity ${a} is above the ${mode} ceiling of ${b.max}; the lamps stop being ambient light`);
      driftRows.push(`| ${where} | lamp ceiling (${mode}) | \`${a}\` | \`<= ${b.max}\` |`);
    }
  };

  // The system's own defaults, from the token file. Every lamp declares both values.
  for (const k of LAMP_KEYS) {
    for (const prop of ['color', 'opacity']) {
      if (!tokens.semantic.lamp[`${k}-${prop}`]) fail(`GRAMMAR §3.5 — semantic.lamp.${k}-${prop} is missing; every lamp declares a colour and an opacity, per mode (DECISIONS 064).`);
    }
    for (const mode of ['light', 'dark']) {
      if (tokens.semantic.lamp[`${k}-opacity`]) checkLamp(`semantic.lamp.${k}-opacity`, systemLamp(k, 'opacity', mode), mode);
    }
  }

  // Anything that repoints them.
  let lampRepoints = 0;
  for (const file of styleFiles) {
    for (const d of lampDeclsIn(fs.readFileSync(file, 'utf8'))) {
      if (d.prop !== 'opacity') continue;
      lampRepoints++;
      for (const mode of d.modes) checkLamp(`${rel(file)}:${d.line}${d.inline ? ' (inline style)' : ''}`, d.value, mode);
    }
  }
  // Every site lights its own table in its brand hue (GRAMMAR §3.5), so there are
  // always repoints to read. None means the scan has stopped matching.
  if (lampRepoints === 0) fail('GRAMMAR §3.5 — check 4j found 0 lamp opacity repoints across every page and site, so it held nothing to the bands. Each site repoints its lamps, so the scan has stopped matching (DECISIONS 006).');
}

// 4j, the colour. A lamp's colour is opaque. build.js mixes it into the canvas colour at
// the lamp's opacity, so every stop comes out opaque and the rasteriser can dither the
// ramp; a translucent colour makes the stops translucent again and brings the banding
// back (DECISIONS 064). A var() is followed to its declaration: the page's own first, then
// the system's.
{
  const systemValue = (name, mode) => {
    const p = pathOf[name];
    if (!p || !flat[p]) return undefined;
    const ext = flat[p].$extensions && flat[p].$extensions[MODE_EXT];
    return String(resolve(mode === 'dark' && ext && ext.dark !== undefined ? ext.dark : flat[p].$value));
  };
  const literalOf = (value, own, mode) => {
    let v = String(value).trim();
    for (let i = 0; i < 8; i++) {
      const m = /^var\(\s*(--[a-z0-9-]+)\s*(?:,[^)]*)?\)$/i.exec(v);
      if (!m) return v;
      const next = own[m[1]] !== undefined ? own[m[1]] : systemValue(m[1], mode);
      if (next === undefined) return null;
      v = String(next).trim();
    }
    return null;
  };
  let coloursHeld = 0;
  const holdOpaque = (where, value, own, mode) => {
    coloursHeld++;
    const lit = literalOf(value, own, mode);
    if (lit === null) {
      fail(`GRAMMAR §3.5 — ${where}: lamp colour \`${value}\` (${mode}) leads to no declared colour, so it cannot be shown to be opaque (DECISIONS 064).`);
      return;
    }
    const { alphas, unread } = lampColours(lit);
    if (unread.length || alphas.length !== 1) {
      fail(`GRAMMAR §3.5 — ${where}: lamp colour \`${value}\` (${mode}) resolves to \`${lit}\`, whose opacity cannot be read, so it cannot be shown to be opaque. A lamp's colour is one opaque colour; its strength is --lamp-<x>-opacity (DECISIONS 064).`);
    } else if (alphas[0] !== 1) {
      fail(`GRAMMAR §3.5 — ${where}: lamp colour \`${value}\` (${mode}) is translucent (\`${lit}\`, opacity ${alphas[0]}). A translucent lamp colour makes the generated stops translucent and brings the banding back; use an opaque colour and set the strength with --lamp-<x>-opacity (DECISIONS 064).`);
      driftRows.push(`| ${where} | lamp colour (${mode}) | \`${lit}\` | \`opaque\` |`);
    }
  };
  for (const k of LAMP_KEYS) for (const mode of ['light', 'dark']) {
    const v = systemLamp(k, 'color', mode);
    if (v !== undefined) holdOpaque(`semantic.lamp.${k}-color`, String(resolve(v)), {}, mode);
  }
  for (const file of styleFiles) {
    if (/styles\.css$/.test(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    const decls = lampDeclsIn(text).filter((d) => d.prop === 'color');
    if (!decls.length) continue;
    // The page's own custom properties, last declaration wins. Mode is not tracked here: a
    // colour the page declares is a brand hex or a step, which do not change with the mode.
    const own = {};
    for (const m of text.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(--[a-z0-9-]+)\s*:\s*([^;{}]+)/gi)) own[m[1]] = m[2].trim();
    for (const d of decls) for (const mode of d.modes) holdOpaque(`${rel(file)}:${d.line}${d.inline ? ' (inline style)' : ''}`, d.value, own, mode);
  }
  if (coloursHeld === 0) fail('GRAMMAR §3.5 — the lamp colour check held 0 colours to opaque, so it could not have failed on anything (DECISIONS 006, 064).');
}


// 4l. the browser must be told the scheme, or it paints its own chrome light.
// Comments are removed first: `:root { /* color-scheme: light */ }` declares nothing,
// and it passed.
const cssUncommented = css.replace(/\/\*[\s\S]*?\*\//g, '');
if (!/:root\s*\{[^}]*color-scheme\s*:\s*light/.test(cssUncommented) ||
    !/\[data-theme="dark"\]\s*\{[^}]*color-scheme\s*:\s*dark/.test(cssUncommented)) {
  fail('NO COLOR-SCHEME — styles.css must declare `color-scheme: light` on :root and `color-scheme: dark` under [data-theme="dark"], or scrollbars and native controls render light on a dark page');
}


// 4m. an example must consume roles, not restate them. A consumer site declares its
// own brand ramp and is exempt; an example has no brand of its own.
const ROLE_BYPASS = [
  ['background-color', '--color-surface-sunken'],
  // `background` shorthand is the same bypass as `background-color` — DECISIONS
  // 006, "a guard that matches too narrowly is worse than no guard." The regex
  // below requires the prop name to be followed by optional whitespace then
  // `:`, so `background-color:` never matches this `background` entry (the
  // `-color` right after `background` is neither whitespace nor `:`) and this
  // entry never double-reports a `background-color:` line.
  ['background',       '--color-surface-sunken'],
  ['box-shadow',       '--elevation-stage'],
  // Widened 2026-09-04 per the user's direct rule: "I don't think anything
  // should be hardcoded in examples." Every colour-bearing property, not
  // just the three the dark-mode work happened to touch (DECISIONS 006).
  ['color',            '--color-text-primary'],
  // `border-color` is longhand; `border` is the shorthand that also carries
  // width/style before the colour. Same anti-double-report trick as
  // `background`/`background-color`: the `border` entry's regex requires
  // `border` to be followed by optional whitespace then `:`, so it never
  // matches a `border-color:` line (the `-color` right after `border` is
  // neither whitespace nor `:`). The colour match itself is not anchored to
  // right after the colon (`[^;]*` before it), so a shorthand like
  // `border: 1px solid #fff` is still caught.
  ['border-color',     '--color-border'],
  ['border',           '--color-border'],
  ['outline-color',    '--color-focus-ring'],
  // `outline` is the shorthand `outline-color` is longhand for — same
  // anti-double-report as `border`/`border-color`: this entry's anchor
  // requires `outline` to be followed by optional whitespace then `:`, so it
  // never matches an `outline-color:` line. No example currently sets a
  // literal colour on the bare shorthand, but the family stays closed so the
  // next author cannot introduce one (DECISIONS 006).
  ['outline',          '--color-focus-ring'],
  ['fill',             '--color-text-primary'],
  ['stroke',           '--color-text-primary'],
  // Fix round 1 (2026-09-04): `border`/`border-color` alone left the four
  // per-side longhands and their colour longhands uncovered — DECISIONS 006
  // again, a guard too narrow is worse than none. Per-side colour longhands
  // must come before their matching per-side shorthand in this list for the
  // same reason `background-color` precedes `background`: each entry's own
  // anchor (`prop` immediately followed by optional whitespace then `:`)
  // already prevents a shorter prop from matching a longer line (`border-top`
  // never matches a `border-top-color:` line, because `-color` sits where
  // the anchor requires whitespace-or-colon) — list order here doesn't
  // change matching, only groups the family for readability.
  ['border-top-color',    '--color-border'],
  ['border-right-color',  '--color-border'],
  ['border-bottom-color', '--color-border'],
  ['border-left-color',   '--color-border'],
  ['border-top',          '--color-border'],
  ['border-right',        '--color-border'],
  ['border-bottom',       '--color-border'],
  ['border-left',         '--color-border'],
];
let roleDecls = 0;
// styles.css is read too, outside its generated token block, which is where the values are
// defined: the system's own stylesheet takes its colours from roles like an example does. It
// was outside this scan, which is how the Firefox slider thumb kept two literals while the
// WebKit thumb used the roles (DECISIONS 031).
for (const file of exampleFiles.concat([stylesPath])) {
  if (!/\.(html|css)$/.test(file)) continue;
  const text = fs.readFileSync(file, 'utf8')
    .replace(/GENERATED:TOKENS:START[\s\S]*?GENERATED:TOKENS:END/g, (s) => s.replace(/[^\n]/g, ''));
  text.split('\n').forEach((line, i) => {
    // Every declaration on the line, not only one that opens it. Anchored to the line,
    // `.x { color: #fff; }` and `padding: 0; color: #fff;` were invisible, and a var(--
    // anywhere on the line excused every literal beside it. style="..." bodies are
    // blanked first: 4n owns those and reports them itself.
    const decls = line.replace(/\sstyle=(?:"[^"]*"|'[^']*')/g, ' ').split(/[{;}]/);
    for (const decl of decls) {
      for (const [prop, role] of ROLE_BYPASS) {
        if (new RegExp('^\\s*' + prop + '\\s*:').test(decl)) roleDecls++;
        const re = new RegExp('^\\s*' + prop + '\\s*:[^;]*(#[0-9A-Fa-f]{3,8}|rgba?\\()');
        if (re.test(decl) && !decl.includes('var(--')) {
          fail(`ROLE BYPASS — ${rel(file)}:${i + 1} sets ${prop} literally; use \`var(${role})\` or the role the value belongs to (DESIGN §2.1: roles, not palettes)`);
        }
      }
    }
  });
}
if (roleDecls === 0) fail('ROLE BYPASS — check 4m read 0 colour-bearing declarations across the examples, so it checked nothing. Every example sets colours, so the scan has stopped matching (DECISIONS 006).');


// 4n. A colour literal inside an inline `style="..."` attribute. This rule exists
// because 4m's regex was anchored to line start and could not see one — not
// exempt, just unseen. 4m now blanks attribute bodies and leaves them to this
// check, so each literal is reported once. This is a FAILURE. It began as a warning while it was
// undecided whether text inside a `.stage-cavity` was chrome; the owner ruled
// that it is, and it now takes --color-text-on-sunken / -secondary, whose
// pairings 4f measures in both modes. No literal remains, so any new one is a
// defect. Reuses ROLE_BYPASS so widening one list widens both checks.
let inlineDecls = 0;
for (const file of exampleFiles) {
  if (!/\.html$/.test(file)) continue;
  const text = fs.readFileSync(file, 'utf8');
  // Either quote. style='...' is as valid as style="..." and was unseen.
  for (const attrMatch of text.matchAll(/\sstyle=(?:"([^"]*)"|'([^']*)')/g)) {
    const styleBody = attrMatch[1] !== undefined ? attrMatch[1] : attrMatch[2];
    const bodyStart = attrMatch.index + attrMatch[0].indexOf(styleBody);
    let cursor = 0;
    for (const decl of styleBody.split(';')) {
      // Past the whitespace a declaration starts with. In a style attribute that
      // runs over several lines that whitespace holds the newline, and the line
      // reported was the one before the declaration.
      const declStart = bodyStart + cursor + (decl.length - decl.trimStart().length);
      cursor += decl.length + 1; // +1 for the ';' consumed by split
      if (decl.trim()) inlineDecls++;
      for (const [prop] of ROLE_BYPASS) {
        const re = new RegExp('^\\s*' + prop + '\\s*:[^;]*(#[0-9A-Fa-f]{3,8}|rgba?\\()');
        if (re.test(decl) && !decl.includes('var(--')) {
          const lineNum = text.slice(0, declStart).split('\n').length;
          fail(`INLINE STYLE COLOUR — ${rel(file)}:${lineNum} sets ${prop} literally inside a \`style="..."\` attribute (4m leaves attributes to this check). Use a role. Text on a cavity takes --color-text-on-sunken or --color-text-on-sunken-secondary (a cavity is dark in both modes, so --color-text-primary is wrong there) — see GRAMMAR §2.6, DESIGN §5.3.`);
        }
      }
    }
  }
}
if (inlineDecls === 0) fail('INLINE STYLE COLOUR — check 4n read 0 declarations inside style attributes across the examples, so it checked nothing. The examples carry hundreds, so the scan has stopped matching (DECISIONS 006).');

// 4o. tray is a nested rung. A sheet laid directly on the canvas is --color-surface.
// GRAMMAR §2.2: "A tray is always inside a card."
// It began reading implFiles only, a constraint of the task that wrote it; it now
// reads the examples too (DECISIONS 023).
//
// Walks a real tag stack rather than testing textual proximity. "Does a card
// class appear within N characters before this class" is neither necessary
// nor sufficient for DOM containment: an element declared after every card
// is invisible to it (false negative), and enough intervening markup makes a
// genuinely nested element invisible too (false positive). A tag stack
// answers containment exactly, independent of ordering or distance.
const TRAY_VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);
const TRAY_TAG_RE = /<!--[\s\S]*?-->|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^"'>])*?)(\/?)>/g;

// Returns { satisfied, inconclusive }. `satisfied` holds every tray-role
// class for which at least one element carrying it opened with a
// `card`/`stage-card` element somewhere on the currently-open tag stack.
// `inconclusive` is true when a closing tag couldn't be matched to anything
// open on the stack — the markup is too irregular to trust either answer,
// so the caller should assert neither containment nor its absence.
function traysNestedInCards(text, trayClasses) {
  // <script>/<style> bodies can contain "<"/">" that are not markup (JS
  // comparisons, CSS combinators like ".foo > .bar") — blank the bodies but
  // keep the tags themselves so the stack still balances around them.
  const scrubbed = text.replace(
    /<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,
    (whole, tag) => `<${tag}></${tag}>`
  );
  const stack = [];
  const satisfied = new Set();
  let inconclusive = false;
  TRAY_TAG_RE.lastIndex = 0;
  let m;
  while ((m = TRAY_TAG_RE.exec(scrubbed))) {
    if (m[0].startsWith('<!--')) continue;
    const closingName = m[1];
    if (closingName) {
      const name = closingName.toLowerCase();
      let idx = -1;
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === name) { idx = i; break; }
      }
      if (idx === -1) {
        // No open element anywhere on the stack matches this close — note
        // it and keep walking so one stray tag doesn't abort the whole file.
        inconclusive = true;
      } else {
        stack.length = idx;
      }
      continue;
    }
    const tagName = (m[2] || '').toLowerCase();
    if (!tagName) continue;
    const attrs = m[3] || '';
    const selfClosing = Boolean(m[4]) || TRAY_VOID_ELEMENTS.has(tagName);
    const classAttr = attrs.match(/\bclass\s*=\s*"([^"]*)"/i) || attrs.match(/\bclass\s*=\s*'([^']*)'/i);
    // Whole-token comparison — "card-feature" must not satisfy a check for "card".
    const classes = new Set((classAttr ? classAttr[1] : '').split(/\s+/).filter(Boolean));
    const hasCardAncestor = stack.some(
      (frame) => frame.classes.has('card') || frame.classes.has('stage-card')
    );
    if (hasCardAncestor) {
      for (const cls of classes) {
        if (trayClasses.has(cls)) satisfied.add(cls);
      }
    }
    if (!selfClosing) stack.push({ tag: tagName, classes });
  }
  return { satisfied, inconclusive };
}

// It used to read only the sites, and only tray classes a site defined itself, so a
// site using the system's own `.tray` was never checked and the rule inspected
// nothing. It now also recognises `.tray` wherever an element carries it, and reads
// the examples as well (DECISIONS 023).
let trayFiles = 0;
for (const file of implFiles.concat(exampleFiles)) {
  if (!/\.(html|css)$/.test(file)) continue;
  const text = fs.readFileSync(file, 'utf8');
  const trayClasses = new Set();
  for (const m of text.matchAll(/\.([a-z0-9_-]+)\s*\{([^}]*)\}/gi)) {
    const [, cls, body] = m;
    if (body.includes('--color-surface-raised') && body.includes('--blur-raised')) {
      trayClasses.add(cls);
    }
  }
  if (/\bclass\s*=\s*["'](?:[^"']*\s)?tray(?:\s[^"']*)?["']/i.test(text)) trayClasses.add('tray');
  if (trayClasses.size === 0) continue;
  trayFiles++;
  const { satisfied, inconclusive } = traysNestedInCards(text, trayClasses);
  if (inconclusive) {
    warn(`TRAY NESTING INCONCLUSIVE — ${rel(file)}: an unmatched or unbalanced closing tag made card-containment for its tray-role class(es) impossible to determine (GRAMMAR §2.2)`);
    continue;
  }
  for (const cls of trayClasses) {
    if (!satisfied.has(cls)) {
      warn(`TRAY AT CANVAS DEPTH — ${rel(file)}: \`.${cls}\` takes the tray role but no element with that class appears inside a card (GRAMMAR §2.2)`);
    }
  }
}
// Zero is a clean result here, not a broken scan: a page with no tray has nothing
// to nest. So the count is reported rather than asserted.
out.push(`Tray depth (check 4o): ${trayFiles} page(s) with a tray-role class checked for card containment.\n`);


// 4p. lamp count per mode. DECISIONS 008: a mode's freedom over distribution and
// count is bounded at 2-3 lamps, in both modes. A lamp at opacity 0 is not a dim
// lamp, it is an unused slot, and does not count toward the floor. The count is read
// from the opacities: the table paints every lamp, so markup no longer fixes it
// (DECISIONS 064).
{
  // The same reader as 4j. An unreadable opacity counts as no lamp here; 4j fails it.
  const lit = (v) => {
    const a = lampOpacity(v);
    return a !== null && a > 0;
  };

  for (const mode of ['light', 'dark']) {
    const count = LAMP_KEYS.filter((k) => lit(systemLamp(k, 'opacity', mode))).length;
    if (count < 2 || count > 3) {
      fail(`LAMP COUNT — semantic.lamp's ${mode} opacities light ${count} lamp(s) above zero; DECISIONS 008 bounds this at 2-3 in both modes (GRAMMAR §3.5)`);
      driftRows.push(`| semantic.lamp (${mode}) | lamp count | \`${count}\` | \`2-3\` |`);
    }
  }

  // A site that repoints its lamps is held to the same count, per mode (DECISIONS 037). A
  // lamp it does not repoint keeps the system's value for that mode.
  let sitesCounted = 0;
  for (const file of implFiles.filter((f) => /\.(html|css)$/.test(f))) {
    const decls = lampDeclsIn(fs.readFileSync(file, 'utf8'));
    if (!decls.length) continue;
    sitesCounted++;
    const shown = lampsShown(decls);
    for (const mode of ['light', 'dark']) {
      const count = LAMP_KEYS.filter((k) => lit(shown[mode][k].opacity.value)).length;
      if (count < 2 || count > 3) {
        fail(`LAMP COUNT — ${rel(file)} lights ${count} lamp(s) in ${mode}; a page using sheets runs 2-3 in both modes (GRAMMAR §3.5, DECISIONS 008, 037)`);
        driftRows.push(`| \`${rel(file)}\` (${mode}) | lamp count | \`${count}\` | \`2-3\` |`);
      }
    }
  }
  // Every site repoints its lamps (4j's tripwire says so too), so none counted means the
  // scan has stopped matching (DECISIONS 006).
  if (sitesCounted === 0) fail('LAMP COUNT — check 4p found 0 sites that repoint their lamps, so it counted nothing but the system (DECISIONS 006).');
  out.push(`Lamp count (check 4p): the system's lamps and ${sitesCounted} site(s) that repoint theirs, held to 2-3 per mode.\n`);
}


// 4q. the material's physics. DECISIONS 013: with ambient front-light (light mode) a
// sheet composites LIGHTER than the ground it covers; without it (dark mode) DARKER,
// and each further layer moves the same way as the last. Composited in sRGB, read with
// derive_ramp.js's own labL. Unlike 4o this reads the values, not the markup: a token
// edit that reversed either mode used to build clean. A missing labL is a failure, not
// a skip — a guard that quietly does not run is DECISIONS 006's defect.
{
  if (!deriveTool || typeof deriveTool.labL !== 'function') {
    fail('PHYSICS — derive_ramp.js is unavailable, so DECISIONS 013\'s lightness direction cannot be measured');
    driftRows.push('| derive_ramp.js | labL | `missing` | `exported` |');
  } else {
    const Lstar = (rgb) => deriveTool.labL(rgb.map((c) => c / 255));
    for (const mode of ['light', 'dark']) {
      const isDark = mode === 'dark';
      const ground = _flatten(readRoleIn(isDark, '--color-bg-canvas'), [255, 255, 255]);
      const card = ground && _flatten(readRoleIn(isDark, '--color-surface'), ground);
      const tray = card && _flatten(readRoleIn(isDark, '--color-surface-raised'), card);
      if (!ground || !card || !tray) {
        fail(`PHYSICS — ${mode}: --color-bg-canvas, --color-surface or --color-surface-raised did not resolve to a colour, so the lightness direction cannot be measured (DECISIONS 013)`);
        driftRows.push(`| ${mode} sheet stack | resolves | \`no\` | \`yes\` |`);
        continue;
      }
      const want = isDark ? 'darker' : 'lighter';
      const steps = [
        ['--color-surface over --color-bg-canvas', Lstar(ground), Lstar(card)],
        ['--color-surface-raised over --color-surface', Lstar(card), Lstar(tray)],
      ];
      for (const [label, under, over] of steps) {
        const ok = isDark ? over < under : over > under;
        if (!ok) {
          fail(`PHYSICS — ${mode}: ${label} composites to L* ${over.toFixed(2)} over L* ${under.toFixed(2)}; ${isDark ? 'without front-light' : 'with ambient front-light'} a sheet must read ${want} than what it covers (DECISIONS 013, GRAMMAR §2.3)`);
          driftRows.push(`| ${mode}: ${label} | composites ${want} | \`L* ${over.toFixed(2)}\` | \`${isDark ? '<' : '>'} L* ${under.toFixed(2)}\` |`);
        }
      }
    }
  }
}


// 4r. theme.json describes the system to host tooling, and nothing consumes it, so
// nothing noticed it still holding RC10's dark palette a release after the ground
// moved. Its accent had been updated a commit earlier, which made it look maintained.
// Every field is compared against the token it claims to describe. There are three
// outcomes and none of them is a skip:
//   compared — the value must equal what the system ships, or this fails naming the
//              field, theme.json's value and the shipped value;
//   excluded — listed BY NAME in THEME_EXCLUDED with the reason it cannot be
//              compared, and printed in VERIFICATION.md so the exclusion is visible;
//   neither  — a field with no counterpart and no exclusion fails. A check that
//              passes what it cannot read is DECISIONS 006's defect, and 4f shipped it.
// A mapping or exclusion whose field theme.json no longer carries fails too: an entry
// that matches nothing is a guard that quietly stopped running.
const themeReport = [];
{
  const theme = JSON.parse(fs.readFileSync(themePath, 'utf8'));

  const modeVal = (p, mode) => {
    const t = flat[p];
    if (!t) return `<no token ${p}>`;
    const ext = t.$extensions && t.$extensions[MODE_EXT];
    const raw = mode === 'dark' && ext && ext.dark !== undefined ? ext.dark : t.$value;
    return String(resolve(raw));
  };
  // A role that is the same in both modes reports one value; if they differ, the
  // shipped value says so and can never equal a single string in theme.json.
  const bothModes = (p) => {
    const l = modeVal(p, 'light');
    const d = modeVal(p, 'dark');
    return l === d ? l : `light ${l} / dark ${d}`;
  };
  const stackOf = (p) => modeVal(p, 'light').split(',').map((s) => s.trim());
  const firstFamily = (p) => stackOf(p)[0].replace(/^['"]|['"]$/g, '');
  const genericOf = (p) => { const g = stackOf(p).pop(); return g === 'sans-serif' ? 'sans' : g; };
  const definedWeights = Object.keys(flat)
    .filter((p) => p.startsWith('primitive.font.weight.'))
    .map((p) => Number(flat[p].$value))
    .sort((a, b) => a - b);
  const dualDeclared = semanticPaths.filter(isDual).every((p) => {
    const ext = flat[p].$extensions && flat[p].$extensions[MODE_EXT];
    return ext && ext.dark !== undefined;
  });

  // Formatting is not drift: "#0a0b0e" and "#0A0B0E", "rgba(0,0,0,.5)" and
  // "rgba(0, 0, 0, 0.5)" are the same value. Nothing else is normalised.
  const norm = (v) => String(v).replace(/\s+/g, '').toLowerCase()
    .replace(/(^|[^0-9])\.([0-9])/g, (m, a, b) => `${a}0.${b}`);

  // field in theme.json -> { shipped: what the system ships, src: where that comes from,
  //                          same?: (themeValue) => bool  for a field that is not a scalar }
  const THEME_MAP = {
    'name': { shipped: String(tokens.name), src: 'tokens.json name' },
    'palette.scheme': { shipped: String(tokens.name).toLowerCase(), src: 'tokens.json name, lower-cased' },
    'palette.band': { shipped: dualDeclared ? 'dual' : 'single', src: 'every semantic.color/elevation/lamp token declares a dark value' },
    'palette.accent': { shipped: bothModes('semantic.color.accent'), src: 'semantic.color.accent' },
    'palette.success': { shipped: bothModes('semantic.color.status-emerald'), src: 'semantic.color.status-emerald' },
  };
  for (const mode of ['light', 'dark']) {
    for (const [k, role] of [['bg', 'bg-canvas'], ['surface', 'surface'], ['text', 'text-primary'], ['border', 'border']]) {
      THEME_MAP[`palette.${mode}.${k}`] = { shipped: modeVal(`semantic.color.${role}`, mode), src: `semantic.color.${role} (${mode})` };
    }
  }
  for (const [k, sem] of [['heading', 'display'], ['body', 'body'], ['mono', 'mono']]) {
    THEME_MAP[`fonts.${k}.family`] = { shipped: firstFamily(`semantic.font.${sem}`), src: `semantic.font.${sem}, first family` };
    THEME_MAP[`fonts.${k}.class`] = { shipped: genericOf(`semantic.font.${sem}`), src: `semantic.font.${sem}, generic fallback` };
    THEME_MAP[`fonts.${k}.weights`] = {
      shipped: `only weights from {${definedWeights.join(', ')}}`,
      src: 'primitive.font.weight.*',
      same: (v) => Array.isArray(v) && v.length > 0 && v.every((w) => definedWeights.includes(w)),
    };
  }
  // theme.json's "card" is the host's word for the outer sheet, which the system calls the
  // stage; the separate card role was retired (DECISIONS 048).
  const themeRadius = { card: 'stage', tray: 'tray', pill: 'pill', control: 'control' };
  for (const [k, role] of Object.entries(themeRadius)) THEME_MAP[`radius.${k}`] = { shipped: modeVal(`semantic.radius.${role}`, 'light'), src: `semantic.radius.${role}` };
  for (const k of ['stage', 'raised', 'nav']) THEME_MAP[`blur.${k}`] = { shipped: modeVal(`semantic.blur.${k}`, 'light'), src: `semantic.blur.${k}` };
  // The brand palette, in order, and which colour lights each lamp per mode (DECISIONS 046).
  // A host tool reads the palette from here, so it must be the palette the tokens declare.
  const brandHexes = Object.keys(flat).filter((p) => /^semantic\.brand\.\d+$/.test(p))
    .sort((a, b) => +a.split('.').pop() - +b.split('.').pop()).map((p) => String(flat[p].$value).toUpperCase());
  THEME_MAP['palette.brand'] = {
    shipped: JSON.stringify(brandHexes), src: 'semantic.brand.*, in order',
    same: (v) => Array.isArray(v) && JSON.stringify(v.map((h) => String(h).toUpperCase())) === JSON.stringify(brandHexes),
  };
  for (const mode of ['light', 'dark']) {
    const lit = LAMP_KEYS.map((k) => {
      if (lampOpacity(systemLamp(k, 'opacity', mode)) === 0) return 'off';
      const ref = /^\{semantic\.brand\.(\d+)\}$|^\{primitive\.color\.(neutral\.\d+)\}$/.exec(String(systemLamp(k, 'color', mode)).trim());
      return ref ? (ref[1] ? `brand-${ref[1]}` : ref[2].replace('.', '-')) : '<no palette colour>';
    });
    THEME_MAP[`palette.lamps.${mode}`] = {
      shipped: JSON.stringify(lit), src: `semantic.lamp.a/b/c-color and -opacity (${mode})`,
      same: (v) => JSON.stringify(v) === JSON.stringify(lit),
    };
  }

  // Fields that genuinely cannot be compared. By name, with the reason. Adding a
  // field to theme.json does NOT add it here: it fails until someone decides.
  const THEME_EXCLUDED = {
    'density': 'A unitless multiplier for host tooling. The system has one fixed spacing scale and no density token to compare against.',
    'dividers': 'A categorical label ("hairline"). Tokens hold values, not style names; the divider colour itself is semantic.color.divider.',
    'buttonAlign': 'A categorical label for the button style. Its measurable parts are compared separately as radius.pill and radius.control.',
    'modes.light': 'A display label for the mode, not a value. The mode itself is enforced by check 2 (every dual-mode role carries both values).',
    'modes.dark': 'A display label for the mode, not a value. The mode itself is enforced by check 2 (every dual-mode role carries both values).',
  };

  const leaves = {};
  (function walk(node, prefix) {
    for (const k of Object.keys(node)) {
      const v = node[k];
      const p = prefix ? `${prefix}.${k}` : k;
      // An empty object is a leaf on purpose: recursing into it would yield nothing,
      // and a field that yields nothing is a field that was never compared.
      if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length) walk(v, p);
      else leaves[p] = v;
    }
  })(theme, '');

  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const shown = (v) => JSON.stringify(v);
  let compared = 0;

  for (const [field, value] of Object.entries(leaves)) {
    if (has(THEME_EXCLUDED, field)) continue;
    if (!has(THEME_MAP, field)) {
      fail(`THEME — theme.json field \`${field}\` (${shown(value)}) has no counterpart in tokens.json and is not in the named exclusion list — compare it in check 4r's THEME_MAP or exclude it there with a reason; it is never skipped`);
      driftRows.push(`| theme.json | ${field} | \`${shown(value)}\` | \`(no counterpart)\` |`);
      continue;
    }
    compared++;
    const rule = THEME_MAP[field];
    if (/^<|undefined|<dangling>|<circular>/.test(rule.shipped) || rule.shipped.includes('<no token')) {
      fail(`THEME — ${field}: the token it describes (${rule.src}) did not resolve (${rule.shipped}), so theme.json's ${shown(value)} cannot be verified`);
      driftRows.push(`| theme.json | ${field} | \`${shown(value)}\` | \`${rule.shipped}\` |`);
      continue;
    }
    const ok = rule.same ? rule.same(value) : norm(value) === norm(rule.shipped);
    if (!ok && buildStale.length) {
      // `shipped` is read from tokens.json, which is only what the system ships once
      // the build has run. With the build stale (4t), styles.css may still ship exactly
      // what theme.json says, so the first thing out of date is the build, not this file.
      fail(`THEME — theme.json ${field} is ${shown(value)} and tokens.json now says ${shown(rule.shipped)} (${rule.src}), but the build is stale (check 4t: ${buildStale.join(', ')}), so the system does not ship ${shown(rule.shipped)} yet. Run node systems/vellum/build.js first; if this still fails afterwards, update theme.json to match (check 4r)`);
      driftRows.push(`| theme.json | ${field} | \`${shown(value)}\` | \`${rule.shipped}\` (tokens.json; build stale) |`);
    } else if (!ok) {
      fail(`THEME — theme.json ${field} is ${shown(value)} but the system ships ${shown(rule.shipped)} (${rule.src}). Nothing reads theme.json, so it does not follow the tokens by itself — update it to match (check 4r)`);
      driftRows.push(`| theme.json | ${field} | \`${shown(value)}\` | \`${rule.shipped}\` |`);
    }
  }
  for (const field of [...Object.keys(THEME_MAP), ...Object.keys(THEME_EXCLUDED)]) {
    if (!has(leaves, field)) {
      fail(`THEME — check 4r expects theme.json to carry \`${field}\` but it does not — a compared or excluded field that has gone is an entry that matches nothing; remove it from THEME_MAP / THEME_EXCLUDED in validate_system.js if the field was removed on purpose`);
      driftRows.push(`| theme.json | ${field} | \`(absent)\` | \`expected\` |`);
    }
  }

  themeReport.push('### theme.json <-> tokens (check 4r)', '');
  themeReport.push(`${compared} field(s) compared against the resolved tokens; ${Object.keys(THEME_EXCLUDED).length} excluded by name:`, '');
  themeReport.push('| Excluded field | Why it cannot be compared |', '| :--- | :--- |');
  for (const [f, why] of Object.entries(THEME_EXCLUDED)) themeReport.push(`| \`${f}\` | ${why} |`);
  themeReport.push('');
}

// 4s. The weight ladder is 400 / 500 / 700 / 800 / 900. Seven places had typed a
// raw 600 — a weight with no token, no $description and no line of prose anywhere
// in GRAMMAR or DESIGN saying what it was for. Five of them were labels in the deck,
// one a print spec key, and one a rule (`.brand-badge`) that matched no element at
// all. Nobody chose 600 over 500; there was nothing stating which to choose, so it
// was picked by eye, seven times, in four files.
//
// The ladder is now stated in GRAMMAR §2.13, and this is the check behind it.
// It fails on any font-weight literal that is not a defined weight, wherever it
// appears — a stylesheet rule or an inline `style="..."` attribute, since 4m and 4n
// learned the hard way that a line-anchored regex never sees the attribute.
//
// It does NOT require the token in place of the number: 65 sites set 700 directly
// (28 more reach it through --weight-bold, 93 in all) and converting them is a
// separate change. This check is only that the number is one the system defines.
//
// This comment said 87 when the rule was written, and DECISIONS 015 shipped that
// figure in RC12. It was never measured — it came from a count that conflated raw
// literals with token references and matched neither. See DECISIONS 016. A wrong
// number in a comment about measurement is the thing this system exists to catch.
//
// It did not scan .js, so two raw 600s in the deck runtimes (deck-stage.js:524,
// support.js:1359) were invisible here (DECISIONS 016). Both are now 700, and the
// example runtimes (every .js under examples/) are scanned for weights, so neither
// can come back unseen. DECISIONS 021. This covers weights only: whether their
// colour literals are held to the grammar is still open.
{
  const allowed = Object.keys(flat)
    .filter((p) => p.startsWith('primitive.font.weight.'))
    .map((p) => Number(resolve(flat[p].$value)))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);

  if (allowed.length === 0) {
    fail('WEIGHT — check 4s found no primitive.font.weight.* tokens to check against, so it could not have failed on anything. A check that cannot fail is DECISIONS 006.');
  }

  let inspected = 0;
  const exampleRuntimes = exampleFiles.filter((f) => f.endsWith('.js'));
  for (const file of styleFiles.concat(exampleRuntimes)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/font-weight\s*:\s*([0-9]+)/g)) {
      inspected++;
      const weight = Number(m[1]);
      if (allowed.includes(weight)) continue;
      const lineNum = text.slice(0, m.index).split('\n').length;
      fail(`WEIGHT — ${rel(file)}:${lineNum} sets font-weight ${weight}, which the system does not define. The ladder is ${allowed.join(' / ')} (GRAMMAR §2.13). Use the nearest defined weight, or add the primitive and say in GRAMMAR what it is for.`);
    }
    // Two other ways to set a weight, which the literal scan above cannot see (DECISIONS
    // 037): the `font:` shorthand, whose weight is a bare number before the size; and a
    // custom property the file declares itself, `--w: 600; font-weight: var(--w)`.
    for (const m of text.matchAll(/(?:^|[;{\s"'])font\s*:\s*([^;"'}]+)/g)) {
      const before = m[1].split(/\s+\d+(?:\.\d+)?(?:px|rem|em|%|pt)\b/)[0];
      const w = (before.match(/\b([1-9]00)\b/) || [])[1];
      if (!w) continue;
      inspected++;
      if (allowed.includes(Number(w))) continue;
      fail(`WEIGHT — ${rel(file)}:${text.slice(0, m.index).split('\n').length} sets weight ${w} in a font shorthand, which the system does not define. The ladder is ${allowed.join(' / ')} (GRAMMAR §2.13).`);
    }
    const ownProps = new Map([...text.matchAll(/(--[a-z0-9-]+)\s*:\s*([0-9]+)\s*[;}]/g)].map((d) => [d[1], Number(d[2])]));
    for (const m of text.matchAll(/font-weight\s*:\s*var\(\s*(--[a-z0-9-]+)\s*\)/g)) {
      if (!ownProps.has(m[1])) continue;
      inspected++;
      const w = ownProps.get(m[1]);
      if (allowed.includes(w)) continue;
      fail(`WEIGHT — ${rel(file)}:${text.slice(0, m.index).split('\n').length} sets font-weight through ${m[1]}, which this file declares as ${w}: not a weight the system defines. The ladder is ${allowed.join(' / ')} (GRAMMAR §2.13).`);
    }
  }

  // The deck's five literals lived inside style="..." attributes, which is exactly
  // where 4m could not see. If this ever counts nothing, the regex has stopped
  // matching and the check is passing on an empty set rather than on clean files.
  if (inspected === 0) {
    fail('WEIGHT — check 4s inspected 0 font-weight declarations across ' + styleFiles.length + ' files. The system sets font-weight in well over a hundred places, so this means the scan matched nothing, not that nothing is wrong.');
  }
  out.push(`Weight ladder (check 4s): ${inspected} font-weight literal(s) inspected against ${allowed.join(' / ')}, including ${exampleRuntimes.length} example runtime(s).\n`);
}


// 4u. No cast shadow and no sheet edge in dark mode. GRAMMAR §2.3: a shadow needs a
// directional source above, and an edge is front-light catching a sheet's thickness; dark
// has neither. DECISIONS 011 zeroed `stage` and `hover` and left every other shadow role at
// 0.5-0.8 black in dark, so five sheets cast a shadow there and nothing noticed.
// DECISIONS 025.
//
// Every semantic.elevation role's dark value must draw every colour at opacity 0, read with
// the lamps' reader (4j), so a value it cannot read fails rather than passes. The ruling is
// about the lighting, not about what kind of object casts the shadow, so there is no
// sheet/non-sheet split to maintain. The one way out is DARK_SHADOW_EXEMPT, by name, with a
// reason. A dark-mode rule that writes its own literal shadow is read the same way.
{
  const DARK_SHADOW_EXEMPT = {
    'semantic.elevation.action-hover': 'The primary action is an opaque solid, not a sheet, and its dark value is a glow the fill gives off, not a shadow cast onto the board. Whether it stays is the open review in DECISIONS 011 ("without the light it emits"). Remove this entry when that review rules.',
  };
  // A sheet's edge. border-subtle is a divider drawn inside a sheet, not the sheet's edge.
  const DARK_EDGES = ['semantic.color.border', 'semantic.color.border-hover', 'semantic.color.border-document'];
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const darkOf = (p) => {
    const e = flat[p].$extensions && flat[p].$extensions[MODE_EXT];
    return String(resolve(e && e.dark !== undefined ? e.dark : flat[p].$value));
  };
  const holdDark = (where, value, what) => {
    const { alphas, unread } = lampColours(value);
    for (const u of unread) {
      fail(`DARK LIGHTING — ${where}: the opacity of \`${u}\` cannot be read, so it cannot be shown to be 0 in dark. Write the colour as rgba(r, g, b, 0) (GRAMMAR §2.3, DECISIONS 025).`);
      driftRows.push(`| ${where} | dark ${what} | \`unreadable\` | \`opacity 0\` |`);
    }
    const lit = alphas.filter((a) => a !== 0);
    if (lit.length) {
      fail(`DARK LIGHTING — ${where} draws a ${what} in dark at opacity ${lit.join(', ')} (\`${value}\`). Dark has no front-light, so a ${what} there is 0 (GRAMMAR §2.3, DECISIONS 025).`);
      driftRows.push(`| ${where} | dark ${what} | \`${lit.join(', ')}\` | \`0\` |`);
    }
  };

  let shadowRoles = 0;
  for (const p of Object.keys(flat).filter((k) => k.startsWith('semantic.elevation.'))) {
    if (own(DARK_SHADOW_EXEMPT, p)) continue;
    shadowRoles++;
    holdDark(p, darkOf(p), 'shadow');
  }
  for (const [p, why] of Object.entries(DARK_SHADOW_EXEMPT)) {
    if (!flat[p]) fail(`DARK LIGHTING — DARK_SHADOW_EXEMPT names ${p}, which is not a token. An exemption that matches nothing is a guard that quietly stopped running.`);
    if (!String(why || '').trim()) fail(`DARK LIGHTING — ${p} is exempt without a stated reason.`);
  }
  if (shadowRoles === 0) fail('DARK LIGHTING — check 4u found no semantic.elevation.* roles to hold to zero in dark, so it could not have failed on anything (DECISIONS 006).');
  for (const p of DARK_EDGES) {
    if (!flat[p]) fail(`DARK LIGHTING — ${p} is not a token, so check 4u could not hold that sheet edge to zero in dark. Update DARK_EDGES if it was renamed.`);
    else holdDark(p, darkOf(p), 'sheet edge');
  }

  // A dark-mode rule that writes its own shadow sidesteps the roles above.
  let darkRules = 0;
  for (const file of styleFiles) {
    if (/antipatterns\.html$/.test(file)) continue; // depicts violations on purpose, as §2.1, §2.4, §2.5 allow
    const keep = (s) => s.replace(/[^\n]/g, '');
    const text = fs.readFileSync(file, 'utf8')
      .replace(/GENERATED:TOKENS:START[\s\S]*?GENERATED:TOKENS:END/g, keep)
      .replace(/\/\*[\s\S]*?\*\//g, keep);
    for (const m of text.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
      const selector = m[1].split(/[;}]/).pop();
      if (!/\[data-theme=["']?dark["']?\]/.test(selector)) continue;
      darkRules++;
      const bs = /box-shadow\s*:\s*([^;]+)/i.exec(m[2]);
      if (!bs || /^\s*(none|var\(--elevation-[a-z-]+\))\s*(!important)?\s*$/i.test(bs[1])) continue;
      const line = text.slice(0, m.index + m[0].indexOf('{')).split('\n').length;
      holdDark(`${rel(file)}:${line}`, bs[1].trim(), 'shadow');
    }
  }
  // A literal shadow in an ordinary rule renders in dark as well, where the roles above are
  // zero, so every shadow goes through a role. Three kinds of layer are not cast shadows and
  // pass: a focus ring (no offset, no blur, a spread in a role colour, GRAMMAR §2.10), a
  // layer already at opacity 0, and a status dot's glow in its own hue: a lit LED is a light
  // source, and the owner ruled it may glow (DECISIONS 028). Only the anti-patterns card,
  // which depicts violations, is skipped. DECISIONS 028.
  let literalShadows = 0;
  const splitLayers = (v) => {
    const parts = [];
    let depth = 0, start = 0;
    for (let i = 0; i < v.length; i++) {
      if (v[i] === '(') depth++;
      else if (v[i] === ')') depth--;
      else if (v[i] === ',' && depth === 0) { parts.push(v.slice(start, i).trim()); start = i + 1; }
    }
    parts.push(v.slice(start).trim());
    return parts.filter(Boolean);
  };
  const layerPasses = (layer, body) => {
    if (/^var\(\s*--elevation-[a-z-]+\s*\)$/i.test(layer)) return true;
    if (/^(inset\s+)?0(px)?\s+0(px)?\s+0(px)?\s+[\d.]+px\s+var\(\s*--color-[a-z-]+\s*\)$/i.test(layer)) return true;
    const { alphas, unread } = lampColours(layer);
    if (!unread.length && alphas.length && alphas.every((a) => a === 0)) return true;
    if (/^0(px)?\s+0(px)?\s+[\d.]+px\b/.test(layer) && /background(?:-color)?\s*:\s*var\(\s*--color-status-/i.test(body)) return true;
    return false;
  };
  const holdLiteral = (where, value, body) => {
    const v = value.replace(/!important/i, '').trim();
    if (/^(none|inherit|initial|unset)$/i.test(v)) return;
    literalShadows++;
    const bad = splitLayers(v).filter((l) => !layerPasses(l, body));
    if (bad.length) {
      fail(`DARK LIGHTING — ${where} writes a literal shadow, \`${bad.join(', ')}\`. It renders in dark as well, where every shadow is 0; use an --elevation-* role, which 4u holds to zero in dark (GRAMMAR §2.3, DECISIONS 028).`);
      driftRows.push(`| ${where} | literal shadow | \`${bad.join(', ').replace(/\|/g, '\\|')}\` | \`an --elevation-* role\` |`);
    }
  };
  for (const file of styleFiles) {
    if (/antipatterns\.html$/.test(file)) continue;
    const keep = (s) => s.replace(/[^\n]/g, '');
    const text = fs.readFileSync(file, 'utf8')
      .replace(/GENERATED:TOKENS:START[\s\S]*?GENERATED:TOKENS:END/g, keep)
      .replace(/\/\*[\s\S]*?\*\//g, keep);
    const lineOf = (i) => text.slice(0, i).split('\n').length;
    for (const m of text.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
      if (/\[data-theme=["']?dark["']?\]/.test(m[1].split(/[;}]/).pop())) continue; // read above
      for (const bs of m[2].matchAll(/box-shadow\s*:\s*([^;]+)/gi)) holdLiteral(`${rel(file)}:${lineOf(m.index + m[0].indexOf('{') + 1 + bs.index)}`, bs[1], m[2]);
    }
    for (const a of text.matchAll(/\sstyle=(?:"([^"]*)"|'([^']*)')/g)) {
      const body = a[1] !== undefined ? a[1] : a[2];
      for (const bs of body.matchAll(/box-shadow\s*:\s*([^;]+)/gi)) holdLiteral(`${rel(file)}:${lineOf(a.index)} (style attribute)`, bs[1], body);
    }
  }
  if (literalShadows === 0) fail('DARK LIGHTING — check 4u read 0 box-shadow declarations outside dark rules. There are about thirty today, so the scan has stopped matching (DECISIONS 006).');
  if (darkRules === 0) fail('DARK LIGHTING — check 4u found no [data-theme="dark"] rules in any stylesheet or page outside the generated block. There are four today, so the scan has stopped matching (DECISIONS 006).');
  out.push(`Dark lighting (check 4u): ${shadowRoles} shadow role(s) and ${DARK_EDGES.length} sheet edge(s) held to opacity 0 in dark, ${Object.keys(DARK_SHADOW_EXEMPT).length} exempt by name; ${darkRules} dark-mode rule(s) and ${literalShadows} other box-shadow declaration(s) read for literal shadows.\n`);
}


// 4v. --type-micro is the floor for type. GRAMMAR §5: below it, reduce the content, not the
// size. Nothing read font-size, and 113 rendered elements on 13 pages sat under it at desktop
// width, from 47 literal declarations. DECISIONS 026.
//
// Every font-size literal in px, in rem (at 16px) or as a clamp()'s first argument is held to
// the floor, in stylesheets, pages, examples, sites, style attributes and example runtimes (the
// files 4s reads). The one exception is the one tokens.json already described and GRAMMAR §5
// now states: the console family's compact controls, inside a max-width block of 420px or
// less, down to COMPACT_FLOOR. em and % sizes are relative and cannot be resolved here; they
// are counted, not held.
{
  const COMPACT_SELECTORS = new Set(['.console-group .label', '.btn-control', '.btn-chip', '.btn-stepper', '.btn-status-toggle']);
  const COMPACT_MAX_WIDTH = 420;
  const COMPACT_FLOOR = 9.5;
  const microPath = 'semantic.type.micro';
  const floorMatch = flat[microPath] && /^([\d.]+)px$/.exec(String(resolve(flat[microPath].$value)).trim());
  if (!floorMatch) {
    fail(`SIZE — ${microPath} does not resolve to a px value, so check 4v has no floor to hold font sizes to.`);
  } else {
    const FLOOR = Number(floorMatch[1]);
    const toPx = (v) => {
      let m = /^clamp\(\s*([\d.]+)(px|rem)\b/.exec(v);
      if (m) return m[2] === 'rem' ? +m[1] * 16 : +m[1];
      m = /^([\d.]+)(px|rem)\b/.exec(v);
      if (m) return m[2] === 'rem' ? +m[1] * 16 : +m[1];
      return null;
    };
    let sizes = 0;
    let relative = 0;
    const keep = (s) => s.replace(/[^\n]/g, '');
    for (const file of styleFiles.concat(exampleFiles.filter((f) => f.endsWith('.js')))) {
      const text = fs.readFileSync(file, 'utf8')
        .replace(/GENERATED:TOKENS:START[\s\S]*?GENERATED:TOKENS:END/g, keep)
        .replace(/\/\*[\s\S]*?\*\//g, keep);
      // The block each position sits in: the narrowest enclosing max-width, and the selector.
      const heads = [];
      const at = [];
      let prev = 0;
      const decls = [...text.matchAll(/font-size\s*:\s*([^;"'}\n]+)/g)];
      let d = 0;
      for (let i = 0; i <= text.length && d < decls.length; i++) {
        while (d < decls.length && decls[d].index === i) { at.push(heads.slice()); d++; }
        const c = text[i];
        if (c === '{') {
          const head = text.slice(prev, i).trim();
          const mw = /@media[^{]*max-width\s*:\s*(\d+)px/.exec(head);
          heads.push({ maxWidth: mw ? Number(mw[1]) : null, selector: head.replace(/\s+/g, ' ') });
          prev = i + 1;
        } else if (c === '}') {
          heads.pop();
          prev = i + 1;
        } else if (c === ';') {
          prev = i + 1;
        }
      }
      decls.forEach((m, k) => {
        const value = m[1].trim();
        sizes++;
        const px = toPx(value);
        if (px === null) { if (/(^|[\d.])(em|%)\b|%/.test(value) && !/rem\b/.test(value)) relative++; return; }
        if (px >= FLOOR) return;
        const ctx = at[k] || [];
        const widths = ctx.map((h) => h.maxWidth).filter((w) => w !== null);
        const narrow = widths.length ? Math.min(...widths) : null;
        const selector = ctx.length ? ctx[ctx.length - 1].selector : '';
        const compact = narrow !== null && narrow <= COMPACT_MAX_WIDTH && COMPACT_SELECTORS.has(selector);
        if (compact && px >= COMPACT_FLOOR) return;
        const line = text.slice(0, m.index).split('\n').length;
        const why = compact
          ? `below the ${COMPACT_FLOOR}px the compact controls may go to`
          : `below --type-micro (${FLOOR}px), the floor for anything a reader reads`;
        fail(`SIZE — ${rel(file)}:${line} sets font-size ${value}, ${why} (GRAMMAR §5). Use var(--type-micro), or reduce the content. The only exception is the console family's compact controls at max-width ${COMPACT_MAX_WIDTH}px or less, down to ${COMPACT_FLOOR}px.`);
        driftRows.push(`| \`${rel(file)}:${line}\` | font-size | \`${value}\` | \`>= ${FLOOR}px\` |`);
      });
    }
    if (sizes === 0) fail('SIZE — check 4v read 0 font-size declarations. The system sets hundreds, so the scan has stopped matching (DECISIONS 006).');
    out.push(`Type floor (check 4v): ${sizes} font-size declaration(s) held to ${FLOOR}px (${COMPACT_FLOOR}px for the console family at max-width ${COMPACT_MAX_WIDTH}px or less); ${relative} relative (em/%) size(s) counted, not resolvable here.\n`);
  }
}


// 4w. Display type is weight 800-900 only (GRAMMAR §2.1). 4s asks only whether a weight is on
// the ladder, and 700 is, so h3 and h4 sat in the display face at --weight-bold from the first
// release, against a spec whose typography table had set card titles at 800 from the start.
// DECISIONS 027.
//
// Two readings. (a) The base heading rules in styles.css: every h1-h6 must be given a weight
// that resolves to 800 or 900, because a heading that sets none takes the browser's bold, 700;
// and a letter-spacing that names a display tracking role. (b) Every rule and style attribute,
// anywhere, that sets the display family, targets a heading, or sits on a heading tag: if it
// sets a weight, the weight resolves to 800 or 900, and if it sets tracking, the tracking names
// a role (DECISIONS 029, 061). The roles themselves tighten with size and are never positive.
{
  const DISPLAY_WEIGHTS = new Set([800, 900]);
  const keep = (s) => s.replace(/[^\n]/g, '');
  const lastPart = (sel) => sel.trim().split(/[\s>+~]+/).pop() || '';
  const tokenValue = (name) => {
    const p = Object.keys(flat).find((k) => cssName(k) === name);
    return p ? String(resolve(flat[p].$value)).trim() : null;
  };
  const weightOf = (v) => {
    v = v.replace(/!important/i, '').trim();
    const t = /^var\(\s*(--[a-z0-9-]+)\s*\)$/.exec(v);
    const raw = t ? tokenValue(t[1]) : v;
    return raw !== null && /^\d+$/.test(raw) ? Number(raw) : null;
  };
  const trackingOf = (v) => {
    v = v.replace(/!important/i, '').trim();
    const t = /^var\(\s*(--[a-z0-9-]+)\s*\)$/.exec(v);
    const raw = t ? tokenValue(t[1]) : v;
    const m = raw !== null && /^(-?[\d.]+)(em|px|rem)?$/.exec(raw);
    return m ? Number(m[1]) : null;
  };
  // Display tracking is one of three roles, largest type first (DECISIONS 061). A literal, even a
  // negative one, is a value nobody can retune: 26 of them had slipped through when this check
  // asked only for "negative".
  const TRACKING_ROLES = new Set(['--tracking-display', '--tracking-statement', '--tracking-title']);
  const trackingRole = (v) => {
    const t = /^var\(\s*(--[a-z0-9-]+)\s*\)$/.exec(String(v).replace(/!important/i, '').trim());
    return t && TRACKING_ROLES.has(t[1]) ? t[1] : null;
  };
  const DISPLAY_FAMILY = /font-family\s*:\s*(?:var\(\s*--font-display\s*\)|['"]?Geist\b)/i;
  const OTHER_FAMILY = /font-family\s*:\s*(?!var\(\s*--font-display\s*\))(?!['"]?Geist\b)\S/i;
  const isHeadingSel = (sel) => sel.split(',').some((part) => /^h[1-6](?![\w-])/i.test(lastPart(part)));

  // (a) The base heading rules.
  const baseText = css.replace(/GENERATED:TOKENS:START[\s\S]*?GENERATED:TOKENS:END/g, keep).replace(/\/\*[\s\S]*?\*\//g, keep)
    .replace(/@media\s+print\s*\{[\s\S]*?\n\}/g, keep); // paper has its own rules (§2.11)
  const base = {};
  for (const m of baseText.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const parts = m[1].trim().split(',').map((s) => s.trim());
    if (!parts.every((s) => /^h[1-6]$/i.test(s))) continue;
    for (const h of parts) {
      const b = (base[h.toLowerCase()] = base[h.toLowerCase()] || {});
      const w = /font-weight\s*:\s*([^;]+)/i.exec(m[2]);
      const ls = /letter-spacing\s*:\s*([^;]+)/i.exec(m[2]);
      if (w) b.weight = w[1].trim();
      if (ls) b.tracking = ls[1].trim();
    }
  }
  if (!Object.keys(base).length) fail('DISPLAY WEIGHT — check 4w found no h1-h6 rules in styles.css, so the base headings were not checked (DECISIONS 006).');
  for (let n = 1; n <= 6; n++) {
    const h = `h${n}`;
    const b = base[h] || {};
    const w = b.weight === undefined ? null : weightOf(b.weight);
    if (b.weight === undefined) {
      fail(`DISPLAY WEIGHT — styles.css gives ${h} no font-weight, so it renders at the browser's bold, 700, in the display face. Display type is 800-900 only (GRAMMAR §2.1, DECISIONS 027).`);
      driftRows.push(`| \`styles.css\` ${h} | font-weight | \`unset (700)\` | \`800 or 900\` |`);
    } else if (!DISPLAY_WEIGHTS.has(w)) {
      fail(`DISPLAY WEIGHT — styles.css sets ${h} to font-weight ${b.weight}${w !== null ? ` (${w})` : ''}. ${h} is display type, which is 800-900 only (GRAMMAR §2.1, DECISIONS 027).`);
      driftRows.push(`| \`styles.css\` ${h} | font-weight | \`${b.weight}\` | \`800 or 900\` |`);
    }
    if (b.tracking === undefined || !trackingRole(b.tracking)) {
      fail(`DISPLAY WEIGHT — styles.css gives ${h} ${b.tracking === undefined ? 'no letter-spacing' : `letter-spacing ${b.tracking}`}. Display tracking names a role: ${[...TRACKING_ROLES].map((r) => `var(${r})`).join(', ')} (GRAMMAR §2.1, DECISIONS 061).`);
      driftRows.push(`| \`styles.css\` ${h} | letter-spacing | \`${b.tracking || 'unset'}\` | \`a display tracking role\` |`);
    }
  }

  // The roles themselves: tracking tightens with size and is never positive (DECISIONS 061).
  {
    const vals = [...TRACKING_ROLES].map((r) => [r, trackingOf(`var(${r})`)]);
    if (vals.some(([, v]) => v === null)) fail(`DISPLAY WEIGHT — a display tracking role does not resolve: ${vals.map(([r, v]) => `${r} ${v}`).join(', ')} (DECISIONS 006, 061).`);
    else {
      for (let i = 0; i < vals.length; i++) {
        if (vals[i][1] > 0) fail(`DISPLAY WEIGHT — ${vals[i][0]} is ${vals[i][1]}em; display tracking is never positive (GRAMMAR §2.1, DECISIONS 061).`);
        if (i && !(vals[i - 1][1] < vals[i][1])) fail(`DISPLAY WEIGHT — ${vals[i - 1][0]} (${vals[i - 1][1]}em) is not tighter than ${vals[i][0]} (${vals[i][1]}em); display tracking tightens with size (GRAMMAR §2.1, DECISIONS 061).`);
      }
    }
  }

  // (b) Every display rule and heading, everywhere.
  let displayUnits = 0;
  for (const file of styleFiles) {
    if (/antipatterns\.html$/.test(file)) continue; // depicts violations on purpose
    const text = fs.readFileSync(file, 'utf8')
      .replace(/GENERATED:TOKENS:START[\s\S]*?GENERATED:TOKENS:END/g, keep)
      .replace(/\/\*[\s\S]*?\*\//g, keep);
    const judge = (where, body, heading) => {
      displayUnits++;
      // Tracking (DECISIONS 029, 061): anything that sets the display face, or is a heading in
      // it, names a display tracking role when it sets letter-spacing; one that sets the face and
      // is not a heading must set it. A heading with none takes its role from (a). A heading set
      // in another face (a mono label in an h4) is not display type.
      if (DISPLAY_FAMILY.test(body) || (heading && !OTHER_FAMILY.test(body))) {
        const ls = /letter-spacing\s*:\s*([^;"']+)/i.exec(body);
        if (ls ? !trackingRole(ls[1]) : !heading) {
          fail(`DISPLAY WEIGHT — ${where} sets display type ${ls ? `with letter-spacing ${ls[1].trim()}` : 'with no letter-spacing'}. Display tracking names a role: var(--tracking-display) for headlines and large numerals, var(--tracking-statement) for statement banners, slide titles and headings larger than a section title, var(--tracking-title) for section and card titles, subheads and wordmarks (GRAMMAR §2.1, DECISIONS 061).`);
          driftRows.push(`| \`${where}\` | display tracking | \`${ls ? ls[1].trim() : 'unset'}\` | \`a display tracking role\` |`);
        }
      }
      const w = /font-weight\s*:\s*([^;"']+)/i.exec(body);
      if (!w) return;
      const n = weightOf(w[1]);
      if (n === null && /^(inherit|unset|initial|revert)\b/i.test(w[1].trim())) return;
      if (n !== null && DISPLAY_WEIGHTS.has(n)) return;
      fail(`DISPLAY WEIGHT — ${where} sets display type to font-weight ${w[1].trim()}${n !== null ? ` (${n})` : ', which cannot be resolved'}. Display type is 800-900 only (GRAMMAR §2.1, DECISIONS 027).`);
      driftRows.push(`| \`${where}\` | display weight | \`${w[1].trim()}\` | \`800 or 900\` |`);
    };
    for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = m[1].split(/[;}]/).pop().replace(/^[\s\S]*<style[^>]*>/i, '').trim();
      if (!/^[^<]*$/.test(selector)) continue;
      if (!DISPLAY_FAMILY.test(m[2]) && !isHeadingSel(selector)) continue;
      // The base rules are (a)'s, and reported there once.
      if (file === stylesPath && selector.split(',').every((s) => /^h[1-6]$/i.test(s.trim()))) { displayUnits++; continue; }
      judge(`${rel(file)}:${text.slice(0, m.index + m[0].indexOf('{')).split('\n').length}`, m[2], isHeadingSel(selector));
    }
    for (const m of text.matchAll(/<([a-z][a-z0-9]*)\b[^>]*?\sstyle=(?:"([^"]*)"|'([^']*)')/gi)) {
      const body = m[2] !== undefined ? m[2] : m[3];
      if (!DISPLAY_FAMILY.test(body) && !/^h[1-6]$/i.test(m[1])) continue;
      judge(`${rel(file)}:${text.slice(0, m.index).split('\n').length} (style attribute)`, body, /^h[1-6]$/i.test(m[1]));
    }
  }
  if (displayUnits === 0) fail('DISPLAY WEIGHT — check 4w found no display-face rules or headings anywhere, so it held nothing to 800-900 (DECISIONS 006).');
  out.push(`Display weight (check 4w): h1-h6 in styles.css held to 800/900 and a display tracking role; ${displayUnits} display rule(s), heading(s) and style attribute(s) held to 800/900.\n`);
}


// 4x. Monospace is always uppercase (GRAMMAR §2.1), with two kinds of text that keep their
// literal case because uppercasing changes what they say: code and identifiers (`--space-4`,
// `.btn-pill`, `ArrowRight`) and units (`ms`, `dB`, `px`). Nothing read text-transform, and
// 126 mono elements rendered lowercase outside <code>. DECISIONS 030.
//
// Case is inherited, so the check reads where it is declared. (a) styles.css keeps the
// exceptions' case with one rule: code, kbd, samp, pre, .literal and .unit at
// text-transform: none !important, so an exception inside an uppercased label stays as
// written. (b) Every rule and style attribute that sets the mono family must declare
// text-transform: uppercase, unless it is itself an exception (code, kbd, samp, pre,
// .literal, .unit); a style attribute also passes if its element carries a class whose rule
// declares uppercase. The example runtimes are not read (vendored, DECISIONS 023), nor is the
// anti-patterns card.
{
  const EXCEPT_ELEMENTS = ['code', 'kbd', 'samp', 'pre'];
  const EXCEPT_CLASSES = ['literal', 'unit'];
  const MONO = /font-family\s*:\s*(?:var\(\s*--font-mono\s*\)|['"]?JetBrains\b)/i;
  const UPPER = /text-transform\s*:\s*uppercase/i;
  const keep = (s) => s.replace(/[^\n]/g, '');
  const lastPart = (sel) => sel.trim().split(/[\s>+~]+/).pop() || '';
  const isException = (sel) => sel.split(',').every((part) => {
    const c = lastPart(part.replace(/::?[a-z-]+(\([^)]*\))?/gi, ''));
    return EXCEPT_ELEMENTS.some((e) => new RegExp(`^${e}(?![\\w-])`, 'i').test(c)) ||
      EXCEPT_CLASSES.some((k) => new RegExp(`\\.${k}(?![\\w-])`).test(c));
  });
  const strip = (file) => fs.readFileSync(file, 'utf8')
    .replace(/GENERATED:TOKENS:START[\s\S]*?GENERATED:TOKENS:END/g, keep)
    .replace(/\/\*[\s\S]*?\*\//g, keep);
  const rulesOf = (text) => [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    m, selector: m[1].split(/[;}]/).pop().replace(/^[\s\S]*<style[^>]*>/i, '').trim(), body: m[2],
  })).filter((r) => /^[^<]*$/.test(r.selector));
  // Classes whose own rule declares uppercase, per file (styles.css counts for every file).
  const upperClasses = (rules) => {
    const s = new Set();
    for (const r of rules) {
      if (!UPPER.test(r.body)) continue;
      for (const part of r.selector.split(',')) for (const k of lastPart(part).matchAll(/\.([\w-]+)/g)) s.add(k[1]);
    }
    return s;
  };
  const baseText = strip(stylesPath);
  const baseRules = rulesOf(baseText);
  const baseUpper = upperClasses(baseRules);

  // (a)
  const keeper = baseRules.find((r) => {
    const parts = r.selector.split(',').map((s) => s.trim());
    return EXCEPT_ELEMENTS.every((e) => parts.includes(e)) && EXCEPT_CLASSES.every((k) => parts.includes(`.${k}`)) &&
      /text-transform\s*:\s*none\s*!important/i.test(r.body);
  });
  if (!keeper) fail(`MONO CASE — styles.css has no rule giving ${EXCEPT_ELEMENTS.join(', ')}, ${EXCEPT_CLASSES.map((k) => '.' + k).join(', ')} text-transform: none !important together, so code and units inside an uppercased label inherit the uppercase (GRAMMAR §2.1, DECISIONS 030).`);

  // (b)
  let monoUnits = 0;
  for (const file of styleFiles) {
    if (/antipatterns\.html$/.test(file)) continue;
    const text = strip(file);
    const rules = rulesOf(text);
    const upper = new Set([...baseUpper, ...(file === stylesPath ? [] : upperClasses(rules))]);
    const lineOf = (i) => text.slice(0, i).split('\n').length;
    const flag = (where, what) => {
      fail(`MONO CASE — ${where} sets monospace without text-transform: uppercase. Monospace is always uppercase (GRAMMAR §2.1): declare it, or, for code and identifiers, use <code> or class="literal", and for units class="unit" (DECISIONS 030).`);
      driftRows.push(`| \`${where}\` | mono case | \`${what}\` | \`uppercase, or an exception\` |`);
    };
    for (const r of rules) {
      if (!MONO.test(r.body)) continue;
      monoUnits++;
      if (UPPER.test(r.body) || isException(r.selector)) continue;
      flag(`${rel(file)}:${lineOf(r.m.index + r.m[0].indexOf('{'))}`, r.selector.slice(0, 60));
    }
    for (const a of text.matchAll(/<([a-z][a-z0-9]*)\b([^>]*?)\sstyle=(?:"([^"]*)"|'([^']*)')/gi)) {
      const body = a[3] !== undefined ? a[3] : a[4];
      if (!MONO.test(body)) continue;
      monoUnits++;
      if (UPPER.test(body) || EXCEPT_ELEMENTS.includes(a[1].toLowerCase())) continue;
      const cls = (/\sclass=["']([^"']*)["']/i.exec(a[0]) || [, ''])[1].split(/\s+/).filter(Boolean);
      if (cls.some((k) => EXCEPT_CLASSES.includes(k) || upper.has(k))) continue;
      flag(`${rel(file)}:${lineOf(a.index)} (style attribute)`, `<${a[1]}${cls.length ? ' .' + cls.join('.') : ''}>`);
    }
  }
  if (monoUnits === 0) fail('MONO CASE — check 4x found no rule or style attribute setting the mono family, so it held nothing to uppercase (DECISIONS 006).');
  out.push(`Mono case (check 4x): ${monoUnits} mono rule(s) and style attribute(s) read; exceptions ${EXCEPT_ELEMENTS.join(', ')}, ${EXCEPT_CLASSES.map((k) => '.' + k).join(', ')}.\n`);
}


// 4y. The case exceptions are honest. 4x lets an element marked class="literal" or
// class="unit" stay lowercase, so a label marked `literal` would slip through it. This reads
// what each marker holds: a unit is a unit of measurement and nothing else; a literal looks
// like code (a token, a class, a var(), a hex, a version, one identifier, or a "token · value"
// pair). A marker whose text is written by the page's own script (`${...}`, or a placeholder
// the script fills) cannot be read here; those are counted and reported, and each one prints
// token names or values by construction. DECISIONS 032.
{
  const UNIT_TEXT = /^(ms|s|k\/s|dB|px|em|rem|nm|%|vw|vh|pt|fps|Hz|kHz|kB|MB|GB|x)$/;
  const LITERAL_TEXT = [
    /^--[a-z0-9-]+$/,                          // a custom property
    /^(\.[a-z][\w-]*)+( \([\w]+\))?$/,          // a class chain, optionally with a size note
    /^var\(--[a-z0-9-]+\)$/,                    // a var()
    /^#[0-9a-f]{3,8}$/i,                        // a hex
    /^v\d[\w.-]*$/,                             // a version
    /^[A-Z][a-z]+(?:[A-Z][a-z0-9]*)*$/,         // one PascalCase identifier (a component or glyph name)
    /^[a-z]+(?:[A-Z][a-z0-9]*)+$/,              // one camelCase identifier
    /^--[a-z0-9-]+ · [\w.%-]+$/,                // a token and its value
  ];
  const scripted = (t) => /\$\{/.test(t) || /^[\s…]*$/.test(t);
  let markers = 0;
  let generated = 0;
  for (const file of styleFiles.filter((f) => f.endsWith('.html'))) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/<([a-z][a-z0-9]*)\b[^>]*\sclass=["']([^"']*)["'][^>]*>([^<]*)<\/\1>/gi)) {
      const classes = m[2].split(/\s+/);
      const kind = classes.includes('unit') ? 'unit' : classes.includes('literal') ? 'literal' : null;
      if (!kind) continue;
      markers++;
      const t = m[3].replace(/\s+/g, ' ').trim();
      if (scripted(t)) { generated++; continue; }
      const ok = kind === 'unit' ? UNIT_TEXT.test(t) : LITERAL_TEXT.some((re) => re.test(t));
      if (ok) continue;
      const line = text.slice(0, m.index).split('\n').length;
      fail(`MONO CASE — ${rel(file)}:${line} marks "${t.slice(0, 40)}" as class="${kind}", but it is not ${kind === 'unit' ? 'a unit of measurement' : 'code or an identifier'}, so it keeps a case 4x would otherwise uppercase. Mark only ${kind === 'unit' ? 'the unit itself' : 'the code'} (GRAMMAR §2.1, DECISIONS 032).`);
      driftRows.push(`| \`${rel(file)}:${line}\` | ${kind} marker | \`${t.slice(0, 40)}\` | \`${kind === 'unit' ? 'a unit' : 'code'}\` |`);
    }
  }
  if (markers === 0) fail('MONO CASE — check 4y found no class="literal" or class="unit" markers, so it checked nothing. The system carries dozens, so the scan has stopped matching (DECISIONS 006).');
  out.push(`Case exceptions (check 4y): ${markers} literal/unit marker(s) read; ${generated} written by the page's own script and not readable here.\n`);
}


// 4z. Radius and blur come from their scales. GRAMMAR §2.8: radius says what a thing is,
// so a radius chosen by eye breaks the grammar even when it looks fine. §2.2: the blur ladder
// may not be extended with a new value. Nothing read either, and 34 radii and 9 blurs were
// typed by hand, most of them equal to a step. DECISIONS 035.
//
// Every border-radius (and corner longhand) must be a --radius-* role, 0, a circle (50%),
// or inherited. Every backdrop-filter must be none or blur(var(--blur-*)). Paper (@media
// print) has its own rules (§2.11), and an @supports test is a query, not a declaration.
// Letters: this is the last single letter. The next check needs a new scheme, not 4k.
{
  const RADIUS_OK = /^(0|0px|50%|inherit|initial|unset)$|^(var\(\s*--radius-[a-z0-9-]+\s*\)\s*)+$|\$\{/;
  const BLUR_OK = /^(none|blur\(\s*var\(\s*--blur-[a-z0-9-]+\s*\)\s*\))$/;
  const keep = (s) => s.replace(/[^\n]/g, '');
  const withoutPrint = (text) => {
    // Blank every @media print block, braces balanced, lines kept.
    let t = text;
    for (let i = t.search(/@media\s+print\b/); i !== -1; i = t.slice(i + 1).search(/@media\s+print\b/) === -1 ? -1 : i + 1 + t.slice(i + 1).search(/@media\s+print\b/)) {
      let depth = 0, j = t.indexOf('{', i);
      for (; j < t.length; j++) { if (t[j] === '{') depth++; else if (t[j] === '}' && --depth === 0) break; }
      t = t.slice(0, i) + keep(t.slice(i, j + 1)) + t.slice(j + 1);
    }
    return t;
  };
  let radii = 0;
  let blurs = 0;
  for (const file of styleFiles) {
    const text = withoutPrint(fs.readFileSync(file, 'utf8')
      .replace(/GENERATED:TOKENS:START[\s\S]*?GENERATED:TOKENS:END/g, keep)
      .replace(/\/\*[\s\S]*?\*\//g, keep)
      .replace(/@supports[^{]*/g, keep));
    const lineOf = (i) => text.slice(0, i).split('\n').length;
    for (const m of text.matchAll(/(border(?:-(?:top|bottom)-(?:left|right))?-radius)\s*:\s*([^;"'}\n]+)/g)) {
      radii++;
      const v = m[2].replace(/!important/i, '').trim();
      if (RADIUS_OK.test(v)) continue;
      fail(`SCALE — ${rel(file)}:${lineOf(m.index)} sets ${m[1]} ${v}. Radius says what a thing is (GRAMMAR §2.8): use the --radius-* role for what this element is; a fully rounded end is --radius-pill, a circle is 50% (DECISIONS 035).`);
      driftRows.push(`| \`${rel(file)}:${lineOf(m.index)}\` | radius | \`${v}\` | \`a --radius-* role\` |`);
    }
    for (const m of text.matchAll(/(?:-webkit-)?backdrop-filter\s*:\s*([^;"'}\n]+)/g)) {
      blurs++;
      const v = m[1].replace(/!important/i, '').trim();
      if (BLUR_OK.test(v)) continue;
      fail(`SCALE — ${rel(file)}:${lineOf(m.index)} sets backdrop-filter ${v}. The blur ladder may not be extended (GRAMMAR §2.2): use blur(var(--blur-*)) for this rung (DECISIONS 035).`);
      driftRows.push(`| \`${rel(file)}:${lineOf(m.index)}\` | blur | \`${v}\` | \`blur(var(--blur-*))\` |`);
    }
  }
  if (radii === 0 || blurs === 0) fail(`SCALE — check 4z read ${radii} radius and ${blurs} blur declaration(s). The system sets dozens of each, so the scan has stopped matching (DECISIONS 006).`);
  // The ladder's order, from the furthest back and most diffuse down (GRAMMAR §2.2). The
  // rungs may be skipped, never reordered (DECISIONS 037).
  const LADDER = ['stage', 'drawer', 'nav', 'raised', 'field'];
  const rung = LADDER.map((k) => {
    const p = `semantic.blur.${k}`;
    const v = flat[p] ? String(resolve(flat[p].$value)) : '';
    return { k, px: /^([\d.]+)px$/.test(v) ? parseFloat(v) : NaN, v };
  });
  for (const r of rung) if (!Number.isFinite(r.px)) fail(`SCALE — semantic.blur.${r.k} is ${JSON.stringify(r.v)}, not a px value, so the blur ladder's order cannot be checked (DECISIONS 037).`);
  for (let i = 1; i < rung.length; i++) {
    if (Number.isFinite(rung[i].px) && Number.isFinite(rung[i - 1].px) && !(rung[i].px < rung[i - 1].px)) {
      fail(`SCALE — the blur ladder is out of order: ${rung[i].k} (${rung[i].px}px) is not below ${rung[i - 1].k} (${rung[i - 1].px}px). The order is ${LADDER.join(' > ')} (GRAMMAR §2.2, DECISIONS 037).`);
    }
  }
  /*
   * Breakpoints (DECISIONS 054). An @media query cannot read a custom property, so the
   * scale's five widths were reference values that nothing compared: thirteen queries used
   * six widths that were not on it. Every width in a media query, and in a matchMedia string,
   * has to be a semantic.breakpoint value. min-width, max-width and the range form are all
   * read; em and rem are taken at 16px.
   *
   * BREAKPOINT_EXCEPTIONS is the written list of queries that are allowed off the scale, one
   * line each with a reason. It is empty. An entry that no longer matches a query fails, so
   * the list cannot go stale.
   */
  const BREAKPOINT_EXCEPTIONS = [
    // { file: 'examples/deck/Deck.dc.html', width: 1920, reason: 'why this one stays off the scale' },
  ];
  const stepPx = Object.keys(flat).filter((p) => p.startsWith('semantic.breakpoint.'))
    .map((p) => ({ k: p.split('.').pop(), px: parseFloat(String(resolve(flat[p].$value))) }))
    .filter((s) => Number.isFinite(s.px));
  const onScale = new Set(stepPx.map((s) => s.px));
  const unit = (n, u) => parseFloat(n) * (u === 'px' ? 1 : 16);
  const widthsIn = (query) => {
    const found = [];
    for (const m of query.matchAll(/(?:min|max)-width\s*:\s*([\d.]+)(px|rem|em)/g)) found.push(unit(m[1], m[2]));
    for (const m of query.matchAll(/\bwidth\s*(?:<=|>=|<|>)\s*([\d.]+)(px|rem|em)/g)) found.push(unit(m[1], m[2]));
    for (const m of query.matchAll(/([\d.]+)(px|rem|em)\s*(?:<=|>=|<|>)\s*width\b/g)) found.push(unit(m[1], m[2]));
    return found;
  };
  let queries = 0;
  const excepted = new Set();
  for (const file of styleFiles) {
    const text = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, keep);
    const lineOf = (i) => text.slice(0, i).split('\n').length;
    const seen = [];
    for (const m of text.matchAll(/@media\b([^{]*)\{/g)) seen.push({ at: m.index, query: m[1] });
    for (const m of text.matchAll(/matchMedia\(\s*(['"`])([^'"`]*)\1/g)) seen.push({ at: m.index, query: m[2] });
    for (const q of seen) {
      for (const px of widthsIn(q.query)) {
        queries++;
        if (onScale.has(px)) continue;
        const ex = BREAKPOINT_EXCEPTIONS.findIndex((e) => e.width === px && rel(file) === e.file);
        if (ex !== -1) { excepted.add(ex); continue; }
        const near = stepPx.slice().sort((a, b) => Math.abs(a.px - px) - Math.abs(b.px - px))[0];
        fail(`SCALE — ${rel(file)}:${lineOf(q.at)} queries a width of ${px}px, which is not a breakpoint. The scale is ${stepPx.map((s) => `${s.k} ${s.px}`).join(', ')} (semantic.breakpoint), and the nearest step is ${near.k} ${near.px}px. Use a step, or write the exception down in BREAKPOINT_EXCEPTIONS with a reason (DECISIONS 054).`);
        driftRows.push(`| \`${rel(file)}:${lineOf(q.at)}\` | breakpoint | \`${px}px\` | \`${stepPx.map((s) => s.px).join(' / ')}\` |`);
      }
    }
  }
  BREAKPOINT_EXCEPTIONS.forEach((e, i) => {
    if (!excepted.has(i)) fail(`SCALE — BREAKPOINT_EXCEPTIONS lists ${e.width}px in ${e.file}, but no query there uses it. Remove the entry (DECISIONS 054).`);
  });
  if (queries === 0 || stepPx.length === 0) fail(`SCALE — check 4z read ${queries} media-query width(s) against ${stepPx.length} breakpoint(s). The system sets dozens of queries, so the scan has stopped matching (DECISIONS 023).`);
  out.push(`Scales (check 4z): ${radii} radius and ${blurs} blur declaration(s) held to the --radius-* and --blur-* roles; ${queries} media-query width(s) held to the ${stepPx.length} breakpoints.\n`);
}


// Page values: the tail of check 4h. Values written as page text do not follow the tokens, and nothing compared them.
// theme.json drifted that way for a release (4r now holds it), and two shipped pages still
// did: the document example's token table showed RC10's dark ground, surface, cavity and
// green after RC12. theme.html also retyped theme.json's fonts by hand and disagreed with it,
// until the card was removed (DECISIONS 057).
// This is deliberately NOT a sweep of every hex in prose: DESIGN.md cites the pre-lift ground
// as history, antipatterns.html is wrong on purpose, and DECISIONS.md is an append-only log.
// It reads only the pages whose job is to display the system's values, and only the
// positions where a value is a claim:
//   - document/spec.html (4h): every <code> colour literal must equal a token's value in either
//     mode; and in a row whose first cell names a --color-* token, its light cell must be
//     that token's light value and its dark cell the dark value (a hit on some OTHER token
//     is still a lie about this one).
// The spec.html part is 4h's, which exempts that page's <code> from its brand-leak scan.
// Letters ran out at 4z (DECISIONS 035), so this is added to the checks it serves, not given a new one.
{
  const modeOf = (p, mode) => {
    const t = flat[p];
    if (!t) return null;
    const ext = t.$extensions && t.$extensions[MODE_EXT];
    const raw = mode === 'dark' && ext && ext.dark !== undefined ? ext.dark : t.$value;
    return String(resolve(raw));
  };
  const nv = (v) => String(v).replace(/\s+/g, '').toLowerCase().replace(/(^|[^0-9])\.([0-9])/g, (m, a, b) => `${a}0.${b}`);
  const COLOUR = /#[0-9a-f]{6}\b|#[0-9a-f]{3}\b|rgba?\([^)]*\)/gi;
  const shipped = new Map(); // normalised value -> a role that carries it
  for (const p of Object.keys(flat)) {
    if (!/^(primitive|semantic)\.(color|elevation)\./.test(p)) continue;
    for (const mode of ['light', 'dark']) {
      const v = modeOf(p, mode);
      if (v) for (const m of v.matchAll(COLOUR)) if (!shipped.has(nv(m[0]))) shipped.set(nv(m[0]), p);
    }
  }

  let compared = 0;
  const specPath = DOC_PAGES[0];
  const spec = fs.readFileSync(specPath, 'utf8');
  const specLine = (idx) => spec.slice(0, idx).split('\n').length;
  for (const m of spec.matchAll(/<code>([^<]*)<\/code>/g)) {
    for (const c of m[1].matchAll(COLOUR)) {
      compared++;
      if (!shipped.has(nv(c[0]))) {
        fail(`STALE VALUE — ${rel(specPath)}:${specLine(m.index)} shows \`${c[0]}\`, which no token carries in either mode. This page displays the system's values, so it must follow the tokens (check 4h).`);
        driftRows.push(`| \`${rel(specPath)}:${specLine(m.index)}\` | stale value | \`${c[0]}\` | \`(no token carries it)\` |`);
      }
    }
  }
  for (const row of spec.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const cells = [...row[1].matchAll(/<td>([\s\S]*?)<\/td>/g)].map((x) => x[1]);
    const name = cells[0] && /<code>(--color-[a-z0-9-]+)<\/code>/.exec(cells[0]);
    if (!name || cells.length < 3) continue;
    const role = `semantic.color.${name[1].slice('--color-'.length)}`;
    for (const [i, mode] of [[1, 'light'], [2, 'dark']]) {
      const want = modeOf(role, mode);
      const got = /<code>([^<]*)<\/code>/.exec(cells[i]);
      if (want === null) {
        fail(`STALE VALUE — ${rel(specPath)}:${specLine(row.index)} names \`${name[1]}\`, which is not a token (check 4h).`);
        driftRows.push(`| \`${rel(specPath)}:${specLine(row.index)}\` | stale value | \`${name[1]}\` | \`(no such token)\` |`);
        break;
      }
      if (!got) continue;
      compared++;
      if (nv(got[1]) !== nv(want)) {
        fail(`STALE VALUE — ${rel(specPath)}:${specLine(row.index)} shows \`${got[1]}\` as ${name[1]} in ${mode}, but the token is \`${want}\` (check 4h).`);
        driftRows.push(`| \`${rel(specPath)}:${specLine(row.index)}\` | stale value | \`${got[1]}\` | \`${want}\` |`);
      }
    }
  }
  if (compared === 0) fail('STALE VALUE — check 4h compared 0 values on document/spec.html, so it read nothing. The token table is made of <code> cells; the pattern has stopped matching (DECISIONS 006).');

  out.push(`Page values (check 4h): ${compared} value(s) on document/spec.html held to the tokens.
`);
}


if (driftRows.length === 0) {
  out.push('`tokens.json` -> `styles.css` -> `_ds_manifest.json` -> `@dsCard` -> workbench sidebar: no drift.\n');
} else {
  out.push('| File | Field | Card / source | Manifest / sidebar |');
  out.push('| :--- | :--- | :--- | :--- |');
  out.push(...driftRows);
  out.push('');
}
out.push(...themeReport);

/* ============================================ 5. NAMING =================== */

const RETIRED = [
  ['Universal Frosted', 'pre-Vellum working title'],
  ['UniversalFrosted', 'pre-Vellum namespace'],
  ['FROSTED HARDWARE', 'pre-Vellum wordmark'],
  ['frosted-hardware', 'pre-Vellum slug'],
  ['STUDIO.MATRIX', 'placeholder brand'],
  ['Studio.Matrix', 'placeholder brand'],
  ['Claude DS', 'placeholder system name'],
  ['claude-design-system', 'pre-rename folder'],
  ['Ice Studio', 'pre-RC4 mode name — modes are "light" and "dark" from RC8'],
  ['Aurora Obsidian', 'pre-RC4 mode name — modes are "light" and "dark" from RC8'],
  ['Obsidian', 'RC7 mode name — use "dark"'],
  ['--color-ice', 'RC7 primitive — use --color-ground-light'],
  ['--color-obsidian', 'RC7 primitive — use --color-ground-dark'],
  ["'design.vellum.mode'].obsidian", 'RC7 mode key — use .dark'],
  ['primitive.color.obsidian', 'RC7 primitive path — use primitive.color.ground-dark'],
  ['primitive.color.ice', 'RC7 primitive path — use primitive.color.ground-light'],
  ['VellumTokens.ICE', 'RC7 generated export — use LIGHT'],
  ['VellumTokens.OBSIDIAN', 'RC7 generated export — use DARK'],
  ['Swiss Frost', 'previous brand — renamed to Vellum at 1.0.0-RC3'],
  ['--print-ink-strong', 'retired in DECISIONS 045 — --print-ink is pure black now; use it'],
  ['--print-rule-strong', 'retired in DECISIONS 045 — --print-rule is pure black now; use it'],
  ['--radius-card', 'retired in DECISIONS 048 — same 20px as the stage, and cards never used it; use --radius-stage'],
  ['--duration-normal', 'retired in DECISIONS 049 — same 350ms as --duration-smooth; use it'],
  ['SWISS FROST', 'previous brand — renamed to Vellum at 1.0.0-RC3'],
  ['SwissFrost', 'previous brand namespace'],
  ['swiss-frost', 'previous brand slug'],
  ['swissfrost', 'previous brand key'],
  ['--color-glass-', 'RC3 token name — surfaces are --color-surface* from RC4'],
  ['--mesh-orb-', 'RC3 token name — the backlights are --lamp-* from RC4'],
  ['--blur-orb-', 'RC3 token name — became the lamp blurs, which DECISIONS 064 retired'],
  ['lamp lamp-', 'retired in DECISIONS 064 — the light table paints the lamps itself; write an empty <div class="light-table"></div>'],
  ['--lamp-a:', 'retired in DECISIONS 064 — a lamp is repointed with --lamp-a-color and --lamp-a-opacity, per mode'],
  ['--lamp-b:', 'retired in DECISIONS 064 — a lamp is repointed with --lamp-b-color and --lamp-b-opacity, per mode'],
  ['--lamp-c:', 'retired in DECISIONS 064 — a lamp is repointed with --lamp-c-color and --lamp-c-opacity, per mode'],
  ['--blur-lamp-', 'retired in DECISIONS 064 (proposed, not yet ruled) — no filter draws the lamps; the blur is baked into the generated stops'],
  ['--lamp-soft', 'retired in DECISIONS 064 (proposed, not yet ruled) — softness is baked into the generated stops, per mode'],
  ['glass-card', 'RC3 class name — now .card'],
  ['glass-console', 'RC3 class name — now .tray'],
  ['glass-nav', 'RC3 class name — now .nav'],
  ['--radius-console', 'RC3 token name - the inner tray radius is --radius-tray from RC6'],
  ['mesh-container', 'RC3 class name — now .light-table'],
  ['TOGGLE OBSIDIAN', 'RC7 toggle label — use "TOGGLE DARK MODE"'],
  ['STUDIO_ARCHIVE', 'placeholder brand in a sample value'],
  ['@template', 'pre-RC11 marker — the marker is @dsExample (DECISIONS 014)'],
  ['templates/', 'pre-RC11 folder — the folder is examples/ (DECISIONS 014)'],
  ['"templates"', 'pre-RC11 manifest key — the key is "examples" (DECISIONS 014)'],
  ['Landing Template', 'pre-RC11 name — it is an example, not a template (DECISIONS 014)'],
  ['landing template', 'pre-RC11 name — it is an example, not a template (DECISIONS 014)'],
  ['example template', 'pre-RC11 name — an example is not a template (DECISIONS 014)'],
];

out.push('## 5. Naming\n');

/*
 * The change log below records what was renamed and where it was found, at the
 * line numbers it occupied in v1.0.0-RC2. The scan that follows re-checks every
 * retired string against the current tree, so the log is self-verifying: if a
 * retired name came back, the scan fails and this section stops agreeing with
 * itself.
 */
const RENAME_LOG = [
  ['systems/claude-design-system/', '(directory)', 'systems/vellum/', 'Working title as a path'],
  ['_ds_manifest.json', '2', '"namespace": "UniversalFrostedHardware" → "Vellum"', ''],
  ['_builtin.json', '2', '"slug": "frosted-hardware" → "vellum"', ''],
  ['theme.json', '5', '"scheme": "frosted-hardware" → "vellum"', ''],
  ['foundations/antipatterns.html', '182', 'UNIVERSAL / FROSTED HARDWARE → VELLUM / DESIGN LANGUAGE', 'DO specimen'],
  ['foundations/antipatterns.html', '198', 'UNIVERSAL / FROSTED HARDWARE → VELLUM / DESIGN LANGUAGE', "DON'T specimen"],
  ['examples/deck/Deck.dc.html', '190', 'STUDIO.MATRIX → VELLUM', 'Slide stage wordmark'],
  ['examples/deck/example-deck.html', '139', '[ SWISS TYPOGRAPHY & FROSTED HARDWARE ] → [ SWISS TYPOGRAPHY & FROSTED GLASS ]', 'Cover kicker'],
  ['examples/landing/index.html', '7', '<title>Universal Frosted Design System — Landing Starter</title> → Vellum — Landing Starter', 'Page title'],
  ['styles.css', '5', 'Default Light Mode (light mode) → generated light mode token block', 'Mode name'],
  ['foundations/cmf.html', '116, 123', 'light mode → light mode', 'Mode name'],
  ['foundations/cmf.html', '142, 149', 'dark mode → dark mode', 'Mode name'],
  ['readme.md', '62', 'light mode → light mode', 'Mode name'],
  ['examples/deck/example-deck.html', '238', 'Light & Dark Engine → light mode & dark mode Engine', 'Mode name'],
  ['examples/document/spec.html', '252', 'Light Value (light mode) → Light Value (light mode)', 'Mode name'],
  ['examples/landing/index.html', '435', 'light mode (Light) → light mode (Light)', 'Mode name'],
  ['examples/landing/index.html', '571', 'light mode / dark mode → light / dark', 'Mode name'],
  ['../spec/DESIGN.md', '104, 295', 'light mode / dark mode → light / dark', 'Rewritten'],
  ['../spec/PROMPT_TEMPLATE.md', '42', 'light mode / dark mode → light / dark', 'Rewritten'],
];

out.push('### Change log — retired names found and replaced\n');
out.push('Line numbers are the positions these occupied in v1.0.0-RC2.\n');
out.push('| Location | Line | Change | Context |');
out.push('| :--- | ---: | :--- | :--- |');
for (const [file, line, change, ctx] of RENAME_LOG) out.push(`| \`${file}\` | ${line} | ${change} | ${ctx} |`);
out.push(`\n${RENAME_LOG.length} instances across ${new Set(RENAME_LOG.map((r) => r[0])).size} files.\n`);

out.push('### Scan — do any survive?\n');
const nameHits = [];
for (const file of sourceFiles) {
  if (path.basename(file) === 'VERIFICATION.md' || path.basename(file) === 'validate_system.js') continue;
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    // Also test the line with tags removed. A retired name split by markup --
    // STUDIO<br />.MATRIX -- is still the retired name on screen, and matching
    // only the raw line let exactly that ship in the landing hero for eight
    // releases while this check reported clean.
    const stripped = line.replace(/<[^>]*>/g, '');
    for (const [needle, why] of RETIRED) {
      if (line.includes(needle) || stripped.includes(needle)) {
        fail(`Retired name "${needle}" at ${rel(file)}:${i + 1}`);
        nameHits.push(`| \`${rel(file)}:${i + 1}\` | \`${needle}\` | ${why} |`);
      }
    }
  });
}
if (nameHits.length === 0) {
  out.push(`No retired name appears anywhere in the system. Scanned ${sourceFiles.length} files for ${RETIRED.length} patterns.\n`);
} else {
  out.push('| Location | Retired name | Reason |');
  out.push('| :--- | :--- | :--- |');
  out.push(...nameHits);
  out.push('');
}

/*
 * 5b. The word "template" itself (DECISIONS 014).
 *
 * The RETIRED table above catches the old structural spellings, and it can only
 * ever catch spellings someone thought of. The examples were called templates
 * from the first release, and the name told a generating agent to copy them. The
 * name is what mattered, so this pass looks for the word rather than for the
 * phrases it used to appear in.
 *
 * It is a plain substring test after an explicit allowlist is removed, not a
 * regex, so there is no escape to get wrong. Every allowed phrase is a
 * different thing that happens to share the word:
 *   grid-template      the CSS property
 *   PROMPT_TEMPLATE    the prompt-scaffold file, a genuinely different thing
 *   not a template     the system's thesis (GRAMMAR §1) -- the *rejected* sense
 *   built a template   the same thesis, stated as the failure mode
 *   your template or   the reader's own framework, not ours
 *   component templates / fixed templates / EXPLORE TEMPLATES
 *                      sample copy inside the demo pages, about a fictional product
 * Vendored canvas runtimes use <template> elements and template literals legitimately.
 */
const TEMPLATE_ALLOWED = [
  'grid-template', 'PROMPT_TEMPLATE', 'PROMPT TEMPLATE', 'Prompt Templates',
  'not a template', 'Not a template', 'built a template',
  'your template or component framework',
  'component templates', 'fixed templates', 'EXPLORE TEMPLATES',
];
// The generated or vendored runtimes the examples load: the design-canvas runtime and
// the component-bundle loaders. Exempt from the vocabulary checks and from colour;
// the weight ladder (4s) still reads them. One list, tested on the repo-relative
// path, so every check skips the same files on every platform. DECISIONS 023.
const VENDOR_RUNTIME = /^examples\/(deck|landing)\/(support|ds-base)\.js$/;
const templateHits = [];
for (const file of sourceFiles) {
  const name = path.basename(file);
  if (name === 'VERIFICATION.md' || name === 'validate_system.js') continue;
  if (VENDOR_RUNTIME.test(rel(file))) continue;
  fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    let rest = line;
    for (const ok of TEMPLATE_ALLOWED) rest = rest.split(ok).join('');
    if (rest.toLowerCase().includes('template')) {
      fail(`The word "template" at ${rel(file)}:${i + 1} — these are examples (DECISIONS 014)`);
      templateHits.push(`| \`${rel(file)}:${i + 1}\` | ${line.trim().slice(0, 90).replace(/\|/g, '/')} |`);
    }
  });
}
out.push('### Scan — the word "template"\n');
if (templateHits.length === 0) {
  out.push(`The word does not appear in the system outside ${TEMPLATE_ALLOWED.length} allowed phrases and the vendored runtimes.\n`);
} else {
  out.push('| Location | Line |');
  out.push('| :--- | :--- |');
  out.push(...templateHits);
  out.push('');
}


/*
 * Retired VOCABULARY, as opposed to retired names.
 *
 * RETIRED above matches exact token and class spellings. Nothing was scanning
 * ordinary prose, which is how a foundation card stayed titled "Glassmorphism"
 * through both the Vellum rename and the role-token rename, along with twelve
 * token descriptions and every "Ambient Background Mesh Orbs" comment.
 *
 * The words are only wrong where they describe THIS system. Files that record
 * history, and the one contract with host tooling, are exempt by path; the few
 * remaining legitimate uses are listed verbatim.
 */
const VOCAB = [
  [/\bglass(morphism|y)?\b/i, 'a surface is a sheet'],
  [/\bmesh\b/i, 'the backdrop is the light table'],
  [/\borbs?\b/i, 'the lights are lamps'],
  [/\bspecular\b/i, 'vellum diffuses; it has an edge, not a specular highlight'],
];
// Records of what the system used to be, and one host-tooling contract.
// theme.json was exempt while it still said glassmorphism and specular-glass.
// It was cleaned at RC6, so it is scanned like everything else now.
const VOCAB_EXEMPT_FILES = new Set(['DECISIONS.md', 'validate_system.js', 'VERIFICATION.md']);
// Legitimate uses, quoted in full so a near-miss still fails.
const VOCAB_ALLOW = [
  'not on glass. Vellum scatters light',
  'not because the paper imitates glass',
];

const vocabHits = [];
for (const file of sourceFiles) {
  if (VOCAB_EXEMPT_FILES.has(path.basename(file))) continue;
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (VOCAB_ALLOW.some((ok) => line.includes(ok))) return;
    for (const [re, why] of VOCAB) {
      const m = line.match(re);
      if (m) {
        fail(`Retired vocabulary "${m[0]}" at ${rel(file)}:${i + 1} — ${why}`);
        vocabHits.push(`| \`${rel(file)}:${i + 1}\` | \`${m[0]}\` | ${why} |`);
        break;
      }
    }
  });
}
if (vocabHits.length === 0) {
  out.push(`No retired vocabulary appears in prose either. ${VOCAB.length} patterns, ${VOCAB_EXEMPT_FILES.size} files exempt as historical record or host contract.\n`);
} else {
  out.push('| Location | Retired word | Why |');
  out.push('| :--- | :--- | :--- |');
  out.push(...vocabHits);
  out.push('');
}


/* ============================================ 6. GRAMMAR ================== */

/*
 * Invariants from GRAMMAR.md that can be checked mechanically. These are rules
 * about the artifacts themselves rather than about the tokens, and the system's
 * own doc cards are just as capable of breaking them as anything built from it —
 * twelve of them shipped sheets with no light table behind them before this check existed.
 */
out.push('## 6. Grammar invariants\n');

const grammarRows = [];

// §2.3 — a sheet needs the light table. It is what the sheet diffuses; without it every
// surface flattens to a grey rectangle.
const usesSheet = (t) => /class="[^"]*(?<![-\w])(card|tray)(?![-\w])|--color-surface(?![-\w])/.test(t);
const lampsMissing = [];
let sheetPages = 0;
for (const file of styleFiles.filter((p) => p.endsWith('.html'))) {
  const text = fs.readFileSync(file, 'utf8');
  // Examples hosted inside a canvas runtime supply their own backdrop.
  if (/\.dc\.html$/.test(file)) continue;
  if (usesSheet(text)) sheetPages++;
  if (usesSheet(text) && !text.includes('light-table')) lampsMissing.push(rel(file));
}
if (sheetPages === 0) fail('GRAMMAR §2.3 — found 0 pages using a sheet, so the light-table check inspected nothing. Nearly every card uses one, so the pattern has stopped matching (DECISIONS 006).');
for (const f of lampsMissing) fail(`GRAMMAR §2.3 — ${f} uses a translucent sheet but has no light table behind it`);
grammarRows.push(
  `| §2.3 | Sheet pages carry a light table | ${lampsMissing.length === 0 ? 'pass' : '**' + lampsMissing.length + ' pages flat**'} | ${lampsMissing.map((f) => '`' + f + '`').join(', ') || '—'} |`
);

/*
 * §2.3 corollary — the light table must sit BEHIND content, not over it.
 *
 * .light-table is position:fixed with z-index:0, which makes it a stacking
 * context painted at step 8 of the CSS painting order. Static content paints at
 * steps 3 and 5, i.e. underneath. A page that adds the light table without lifting its
 * content wrapper gets lamps washing over its own text — which is subtle enough
 * to survive review and shipped in RC2 on five cards.
 */
const lampsOverContent = [];
let lightTablePages = 0;
for (const file of styleFiles.filter((p) => p.endsWith('.html'))) {
  if (/\.dc\.html$/.test(file)) continue;
  const text = fs.readFileSync(file, 'utf8');
  if (!text.includes('light-table')) continue;
  lightTablePages++;
  // The wrapper is whichever rule the page uses for its main content column.
  const lifted = /\{[^{}]*position:\s*relative[^{}]*z-index:\s*[1-9]|\{[^{}]*z-index:\s*[1-9][^{}]*position:\s*relative/s.test(text);
  if (!lifted) lampsOverContent.push(rel(file));
}
if (lightTablePages === 0) fail('GRAMMAR §2.3 — found 0 pages with a light table, so the content-above-lamps check inspected nothing (DECISIONS 006).');
for (const f of lampsOverContent) fail(`GRAMMAR §2.3 — ${f} has a light table but no positioned, z-indexed content wrapper: the lamps paint over the content`);
grammarRows.push(
  `| §2.3 | Content sits above the light table, not under it | ${lampsOverContent.length === 0 ? 'pass' : '**' + lampsOverContent.length + ' washed**'} | ${lampsOverContent.map((f) => '`' + f + '`').join(', ') || '—'} |`
);

/*
 * §3.6 — persistent top chrome carries the nav density.
 *
 * Detected structurally rather than by selector name: any rule that pins itself
 * to the top of the viewport (position fixed/sticky at top:0) and paints a
 * background IS a nav sheet, whatever it is called. The store calls it
 * .site-header, the portfolio calls it .rail, the dashboard calls it .app-topbar,
 * and all three have the same unbounded backdrop — a page may scroll a black
 * photograph beneath any of them.
 *
 * That backdrop is why the density is a contrast floor and not a taste call. At
 * --color-surface (0.65 white) nav links measure 3.41:1 over --color-surface-sunken
 * and 3.11:1 over pure black; at --color-surface-nav (0.85) they measure 5.13:1 and
 * 4.96:1 in situ. A literal fill or a borrowed card token both land under AA — the
 * landing example shipped its own literal for two releases, which was the only
 * reason its nav passed while every page using the shared token did not.
 */
//
// It also reads the pinned element's other rules. A header is often pinned in one
// rule and filled in another (`.site-header.scrolled`), and that state rule is
// where the landing example's literal sat. It reads pinned chrome declared inside
// a style="..." attribute too. DECISIONS 023.
const NAV_FILL_OK = /var\(\s*--color-surface-nav\s*\)|transparent|none|inherit/i;
const navFillHits = [];
let navPinned = 0;
const isPinned = (body) => /position\s*:\s*(fixed|sticky)/i.test(body) &&
  /(^|[;{\s"'])top\s*:\s*0(px|%|rem|em)?\s*(;|$|["'])/i.test(body);
// The last compound selector of a selector: `.a .b.c:hover` -> `.b.c:hover`.
const lastCompound = (sel) => sel.trim().split(/[\s>+~]+/).pop();
// The first opening tag in a page that a compound selector matches, by tag, classes and id.
// States and attributes are dropped: `.site-header` finds `<header class="site-header">`.
const openTagFor = (text, compound) => {
  const c = compound.replace(/::?[\w-]+(\([^)]*\))?|\[[^\]]*\]/g, '');
  const tag = (c.match(/^[a-z][\w-]*/i) || [])[0];
  const classes = [...c.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
  const id = (c.match(/#([\w-]+)/) || [])[1];
  if (!tag && !classes.length && !id) return null;
  for (const m of text.matchAll(/<([a-z][\w-]*)\b[^>]*>/gi)) {
    if (tag && m[1].toLowerCase() !== tag.toLowerCase()) continue;
    const cls = ((m[0].match(/\sclass="([^"]*)"/) || [])[1] || '').split(/\s+/);
    if (!classes.every((k) => cls.includes(k))) continue;
    if (id && (m[0].match(/\sid="([^"]*)"/) || [])[1] !== id) continue;
    return m[0];
  }
  return null;
};
const headerHits = [];
let headersPinned = 0;
for (const file of styleFiles) {
  let text = fs.readFileSync(file, 'utf8');
  // The generated token block legitimately contains the literal it defines.
  // Blanked to their newlines, so a line number reported below still holds.
  // The lamp block too: .light-table is pinned at top 0, but it is the lamps, not
  // chrome, and its fill is the generated lamp layers (DECISIONS 064).
  const keepLines = (s) => s.replace(/[^\n]/g, '');
  text = text.replace(/GENERATED:TOKENS:START[\s\S]*?GENERATED:TOKENS:END/g, keepLines);
  text = text.replace(/GENERATED:LAMPS:START[\s\S]*?GENERATED:LAMPS:END/g, keepLines);
  // Comments would otherwise land in the reported selector, and a commented-out
  // background would read as a live one.
  text = text.replace(/\/\*[\s\S]*?\*\//g, keepLines);
  // A blur fallback (`@supports not (backdrop-filter…)`) is another medium: there the nav is
  // opaque on purpose (GRAMMAR §5.5, DECISIONS 039), so its fill is not the nav density's.
  for (let i = text.search(/@supports\s+not\s*\(/); i !== -1; i = text.search(/@supports\s+not\s*\(/)) {
    let d = 0, j = text.indexOf('{', i);
    for (; j < text.length; j++) { if (text[j] === '{') d++; else if (text[j] === '}' && --d === 0) break; }
    text = text.slice(0, i) + keepLines(text.slice(i, j + 1)) + text.slice(j + 1);
  }
  const rules = [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    // The first rule in a page's <style> would otherwise carry the page head with it.
    .map((m) => ({ selector: m[1].split(/[;}]/).pop().replace(/^[\s\S]*<style[^>]*>/i, '').trim().replace(/\s+/g, ' '), body: m[2] }));
  const pinned = new Set();
  for (const r of rules) {
    if (!isPinned(r.body)) continue;
    navPinned++;
    for (const part of r.selector.split(',')) pinned.add(lastCompound(part));
  }
  // A rule styles pinned chrome if one of its selectors ends in the pinned compound,
  // or in that compound plus a state: `.site-header`, `.site-header.scrolled`,
  // `[data-theme="dark"] .site-header:hover`.
  const onPinned = (sel) => sel.split(',').some((part) => {
    const c = lastCompound(part);
    return [...pinned].some((p) => c === p || (c.startsWith(p) && /^[.:[]/.test(c.slice(p.length))));
  });
  for (const r of rules) {
    if (!isPinned(r.body) && !onPinned(r.selector)) continue;
    const bg = r.body.match(/background(?:-color)?\s*:\s*([^;]+)/i);
    if (!bg) continue;
    const value = bg[1].trim();
    if (NAV_FILL_OK.test(value)) continue;
    navFillHits.push({ file: rel(file), selector: r.selector, value });
  }
  // The coupling (DECISIONS 041): pinned top chrome says which variant it is, with
  // data-header="retracting" or "persistent" on the element, and only a retracting header may
  // be absent at rest. Absent at rest means no fill, or a transparent one, in any mode. A
  // retracting header must also have a rule that takes it off the board. The light table is
  // pinned too, but it is the ground, not chrome.
  for (const p of pinned) {
    if (p === '.light-table' || !/\.html$/.test(file)) continue;
    headersPinned++;
    const tag = openTagFor(text, p);
    if (!tag) { headerHits.push(`${rel(file)}: \`${p}\` is pinned, but no element in the page carries it, so its variant could not be read`); continue; }
    const kind = (tag.match(/\sdata-header="([^"]*)"/) || [])[1];
    if (kind !== 'retracting' && kind !== 'persistent') {
      headerHits.push(`${rel(file)}: \`${p}\` is pinned top chrome with ${kind === undefined ? 'no data-header' : `data-header="${kind}"`}; declare "retracting" or "persistent"`);
      continue;
    }
    const fills = rules.filter((r) => r.selector.split(',').some((part) => lastCompound(part) === p))
      .map((r) => (r.body.match(/background(?:-color)?\s*:\s*([^;]+)/i) || [])[1]).filter(Boolean).map((v) => v.trim());
    const absent = fills.length === 0 || fills.some((v) => /^(transparent|none)$/i.test(v));
    if (kind === 'persistent' && absent) {
      headerHits.push(`${rel(file)}: \`${p}\` is persistent but ${fills.length ? 'fills with ' + fills.find((v) => /^(transparent|none)$/i.test(v)) : 'has no fill'} at rest; a persistent header is always a sheet`);
    }
    if (kind === 'retracting' && !rules.some((r) => onPinned(r.selector) && /translateY\(\s*-100%\s*\)|(^|[;\s])top\s*:\s*-/i.test(r.body))) {
      headerHits.push(`${rel(file)}: \`${p}\` says it retracts, but no rule on it moves it off the board (translateY(-100%) or a negative top)`);
    }
  }
  for (const a of text.matchAll(/\sstyle=(?:"([^"]*)"|'([^']*)')/g)) {
    const body = a[1] !== undefined ? a[1] : a[2];
    if (!isPinned(body)) continue;
    navPinned++;
    const tag = text.slice(text.lastIndexOf('<', a.index), text.indexOf('>', a.index) + 1);
    const line = text.slice(0, a.index).split('\n').length;
    if (/\.html$/.test(file) && !/class="[^"]*\blight-table\b/.test(tag)) {
      headersPinned++;
      const kind = (tag.match(/\sdata-header="([^"]*)"/) || [])[1];
      const bgAttr = (body.match(/background(?:-color)?\s*:\s*([^;]+)/i) || [])[1];
      if (kind !== 'retracting' && kind !== 'persistent') headerHits.push(`${rel(file)}:${line}: pinned top chrome with ${kind === undefined ? 'no data-header' : `data-header="${kind}"`}; declare "retracting" or "persistent"`);
      else if (kind === 'persistent' && (!bgAttr || /^(transparent|none)$/i.test(bgAttr.trim()))) headerHits.push(`${rel(file)}:${line}: persistent but absent at rest; a persistent header is always a sheet`);
    }
    const bg = body.match(/background(?:-color)?\s*:\s*([^;]+)/i);
    if (!bg || NAV_FILL_OK.test(bg[1].trim())) continue;
    navFillHits.push({ file: rel(file), selector: `style="…" at line ${line}`, value: bg[1].trim() });
  }
}
if (headersPinned === 0) fail('GRAMMAR §3.6 — found 0 pinned headers across every page, so the header-variant check inspected nothing. The landing example pins one (DECISIONS 006, 041).');
for (const h of headerHits) fail(`GRAMMAR §3.6 — ${h} (DECISIONS 041)`);
grammarRows.push(
  `| §3.3 | A site's brand steps regenerate from its --brand-<n> hexes | ${siteRamps ? 'checked on ' + siteRamps + ' site' + (siteRamps === 1 ? '' : 's') : 'no site steps'} | — |`
);

/*
 * §2.9 — the mode toggle stays reachable (DECISIONS 041).
 *
 * Reachability is a rendered fact, and verify.html measures it: a [data-mode-toggle] on the first
 * screen at 1280 and 375. What source can hold is that the attribute is there to measure. So a
 * control that switches the mode must carry data-mode-toggle, found by what it does: an onclick
 * that writes data-theme or calls a *Theme() function, or a theme-toggle id. And a page that
 * writes data-theme on its own document must have at least one.
 */
const unmarkedToggles = [];
let togglesMarked = 0;
const TOGGLE_HINT = /\sonclick="[^"]*(?:data-theme|Theme\s*\()[^"]*"|\sid="[^"]*(?:theme|mode)-?toggle[^"]*"|\sid="[^"]*ThemeBtn"/i;
for (const file of styleFiles) {
  if (!/\.html$/.test(file)) continue;
  const text = fs.readFileSync(file, 'utf8').replace(/<!--[\s\S]*?-->/g, (s) => s.replace(/[^\n]/g, ''));
  let marked = 0;
  for (const m of text.matchAll(/<(button|a|input|div|span)\b[^>]*>/gi)) {
    if (/\sdata-mode-toggle\b/.test(m[0])) { marked++; continue; }
    if (TOGGLE_HINT.test(m[0])) unmarkedToggles.push(`${rel(file)}:${text.slice(0, m.index).split('\n').length} <${m[1]}>`);
  }
  togglesMarked += marked;
  if (!marked && /\bdocument\.documentElement\.(?:setAttribute|removeAttribute|toggleAttribute)\(\s*['"]data-theme|\bdocument\.documentElement\.dataset\.theme\s*=/.test(text)) {
    unmarkedToggles.push(`${rel(file)} switches the mode but marks no toggle`);
  }
}
if (togglesMarked === 0) fail('GRAMMAR §2.9 — found 0 elements carrying data-mode-toggle, so the toggle check inspected nothing (DECISIONS 006, 041).');
for (const t of unmarkedToggles) fail(`GRAMMAR §2.9 — ${t}: a mode toggle carries data-mode-toggle, so verify.html can measure that it is reachable without scrolling (DECISIONS 041)`);
/*
 * §2.11 — paper is light, whatever mode the reader printed from (DECISIONS 042).
 *
 * Printed from dark mode, the dark roles gave white paper dark translucent sheets and pale
 * grey text. Dark is a screen mode, so every [data-theme="dark"] rule sits inside
 * @media screen: the generated token block, styles.css's own, and any page's or site's.
 */
const darkOnPaper = [];
let darkRulesSeen = 0;
for (const file of styleFiles) {
  const keepLines = (s) => s.replace(/[^\n]/g, '');
  const text = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, keepLines).replace(/<!--[\s\S]*?-->/g, keepLines);
  const screens = [];
  for (const m of text.matchAll(/@media\s+screen\b[^{]*\{/g)) {
    let d = 0, j = m.index + m[0].length - 1;
    for (; j < text.length; j++) { if (text[j] === '{') d++; else if (text[j] === '}' && --d === 0) break; }
    screens.push([m.index, j]);
  }
  for (const m of text.matchAll(/\[data-theme=["']?dark["']?\][^{};]*\{/g)) {
    darkRulesSeen++;
    if (!screens.some(([a, b]) => m.index > a && m.index < b)) {
      darkOnPaper.push(`${rel(file)}:${text.slice(0, m.index).split('\n').length}`);
    }
  }
}
if (darkRulesSeen === 0) fail('GRAMMAR §2.11 — found 0 [data-theme="dark"] rules, so the paper check inspected nothing. The generated token block has one (DECISIONS 006, 042).');
for (const d of darkOnPaper) fail(`GRAMMAR §2.11 — ${d} is a dark-mode rule outside @media screen, so it prints: paper takes the light values whatever mode the reader printed from (DECISIONS 042)`);
grammarRows.push(
  `| §2.11 | Dark is a screen mode; paper prints light | ${darkOnPaper.length === 0 ? 'pass (' + darkRulesSeen + ' dark rules)' : '**' + darkOnPaper.length + ' print dark**'} | ${darkOnPaper.map((d) => '`' + d + '`').join(', ') || '—'} |`
);

/*
 * §2.11 — paper is K only (DECISIONS 045).
 *
 * The screen's text is slate blue (#0F172A), and paper used to carry it across: the spec sheet
 * printed in slate, two blue-greys and some pure black at once. Paper has two inks, 100% K for
 * text and rules and 60% K for secondary text, so every print colour must be a neutral grey,
 * ink and rule must be pure black, and the print block must repoint the screen's text roles
 * to the inks so any rule that names one prints in K.
 */
const paperFaults = [];
const printPaths = Object.keys(flat).filter((p) => /\.print\.[a-z-]+$/.test(p) && flat[p].$type === 'color');
for (const p of printPaths) {
  const v = String(resolve(flat[p].$value)).trim().toUpperCase();
  const m = /^#([0-9A-F]{2})([0-9A-F]{2})([0-9A-F]{2})$/.exec(v);
  if (!m) paperFaults.push(`${cssName(p)} is ${v}, which cannot be read as a grey`);
  else if (!(m[1] === m[2] && m[2] === m[3])) paperFaults.push(`${cssName(p)} is ${v}, which carries a hue; paper is K only`);
}
for (const role of ['ink', 'rule']) {
  const p = printPaths.find((x) => x.endsWith(`.print.${role}`));
  const v = p && String(resolve(flat[p].$value)).trim().toUpperCase();
  if (v !== '#000000') paperFaults.push(`--print-${role} is ${v || 'missing'}; text and rules print 100% K`);
}
let printBlockText = '';
for (const m of css.matchAll(/@media\s+print\b[^{]*\{/g)) {
  let d = 0, j = m.index + m[0].length - 1;
  for (; j < css.length; j++) { if (css[j] === '{') d++; else if (css[j] === '}' && --d === 0) break; }
  printBlockText += css.slice(m.index, j + 1);
}
for (const [role, ink] of [['primary', 'ink'], ['document', 'ink'], ['secondary', 'ink-secondary'], ['muted', 'ink-secondary']]) {
  if (!new RegExp(`--color-text-${role}\\s*:\\s*var\\(\\s*--print-${ink}\\s*\\)`).test(printBlockText)) {
    paperFaults.push(`styles.css's print block does not repoint --color-text-${role} to --print-${ink}, so text in that role prints in its screen colour`);
  }
}
if (printPaths.length === 0) fail('GRAMMAR §2.11 — found 0 print colour tokens, so the paper-ink check inspected nothing (DECISIONS 006, 045).');
for (const f of paperFaults) fail(`GRAMMAR §2.11 — ${f} (DECISIONS 045)`);
grammarRows.push(
  `| §2.11 | Paper is K only: black text and rules, 60% K secondary | ${paperFaults.length === 0 ? 'pass (' + printPaths.length + ' print colours)' : '**' + paperFaults.length + ' off K**'} | ${paperFaults.map((f) => '`' + f.split(' ')[0] + '`').join(', ') || '—'} |`
);

/*
 * §3.5 — the lamps are the brand's light (DECISIONS 046).
 *
 * Each lamp, in each mode, takes its colour from the brand palette: a brand colour, a step of
 * one, or a neutral grey, or it is off. The system's own lamps name semantic.brand in the
 * token file; a page or site that repoints a lamp's colour (--lamp-a-color, DECISIONS 064)
 * names a var() from its palette. A literal colour in a lamp is a hue nobody declared, which
 * is how a site ends up lit by someone else's palette. And a site lights only its OWN
 * palette: a lamp it leaves on the system's default still names Vellum's brand colour for
 * that mode, so a site that declares brand 1 and repoints only light mode is lit in dark by
 * Vellum's cyan, and fails.
 */
const lampFaults = [];
let lampsHeld = 0;
const LITERAL_COLOUR = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i;
const systemBrand = Object.keys(flat).filter((p) => /^semantic\.brand\.\d+$/.test(p)).map((p) => p.split('.').pop());
// The system's lamps, from the token file. A colour is one whole reference.
for (const k of LAMP_KEYS) {
  for (const mode of ['light', 'dark']) {
    const decl = systemLamp(k, 'color', mode);
    if (typeof decl !== 'string') continue;
    lampsHeld++;
    const where = `semantic.lamp.${k}-color (${mode})`;
    if (LITERAL_COLOUR.test(decl)) { lampFaults.push(`${where} is a literal colour; name a brand colour, {semantic.brand.<n>}, or a neutral`); continue; }
    const ref = /^\{([a-z0-9.-]+)\}$/i.exec(decl.trim());
    if (!ref) lampFaults.push(`${where} names no colour from the palette`);
    else if (!/^semantic\.brand\.\d+$|^primitive\.color\.neutral\.\d+$/.test(ref[1])) lampFaults.push(`${where} names {${ref[1]}}, which is not a brand colour or a neutral`);
  }
}
// Pages and sites that repoint a lamp's colour, and every lamp a site shows, repointed or not.
const defaultLampColour = (k, mode) => String(systemLamp(k, 'color', mode)).replace(/\{([a-z0-9.-]+)\}/gi, (w, ref) => `var(${cssName(ref)})`);
for (const file of styleFiles) {
  if (/styles\.css$/.test(file)) continue;
  const text = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, (s) => s.replace(/[^\n]/g, ''));
  const isSite = implFiles.includes(file);
  const decls = lampDeclsIn(text).filter((d) => d.prop === 'color');
  if (!isSite && !decls.length) continue;
  const brands = new Set([...text.matchAll(/--brand-(\d+)\s*:/g)].map((m) => m[1]));
  const steps = new Set([...text.matchAll(/--color-brand-(\d+-\d{3})\s*:/g)].map((m) => m[1]));
  if (isSite && !brands.size) continue; // a site with no palette of its own is not a branded site
  const palette = isSite ? brands : new Set([...brands, ...systemBrand]);
  const shown = lampsShown(decls);
  for (const mode of ['light', 'dark']) for (const k of LAMP_KEYS) {
    const own = shown[mode][k].color.own;
    if (!own && !isSite) continue;
    const decl = own ? shown[mode][k].color.value : defaultLampColour(k, mode);
    lampsHeld++;
    const where = `${rel(file)} lamp ${k.toUpperCase()} in ${mode}${own ? '' : ' (left on the system default)'}`;
    if (LITERAL_COLOUR.test(decl)) { lampFaults.push(`${where} is a literal colour; name one from the palette, var(--brand-<n>), a step, or a neutral`); continue; }
    const vars = [...decl.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)];
    if (!vars.length) lampFaults.push(`${where} names no colour from the palette`);
    for (const v of vars) {
      const name = v[1];
      let m;
      if ((m = /^--brand-(\d+)$/.exec(name))) { if (!palette.has(m[1])) lampFaults.push(`${where} names ${name}, which ${isSite ? 'this site does not declare: it would show Vellum\'s own brand colour' : 'the palette does not declare'}`); }
      else if ((m = /^--color-brand-(\d+-\d{3})$/.exec(name))) { if (!steps.has(m[1])) lampFaults.push(`${where} names ${name}, a step this page does not declare`); }
      else if (!/^--color-neutral-\d+$/.test(name)) lampFaults.push(`${where} names ${name}, which is not a brand colour, a step, or a neutral`);
    }
  }
}
if (lampsHeld === 0) fail('GRAMMAR §3.5 — found 0 lamps to hold to the palette, so the check inspected nothing (DECISIONS 006, 046).');
for (const f of lampFaults) fail(`GRAMMAR §3.5 — ${f} (DECISIONS 046)`);
grammarRows.push(
  `| §3.5 | Every lamp takes its colour from the brand palette, per mode | ${lampFaults.length === 0 ? 'pass (' + lampsHeld + ' lamps)' : '**' + lampFaults.length + ' off the palette**'} | ${[...new Set(lampFaults.map((f) => f.split(' ')[0]))].map((f) => '`' + f + '`').join(', ') || '—'} |`
);

grammarRows.push(
  `| §2.9 | Mode toggles are marked for the reach check | ${unmarkedToggles.length === 0 ? 'pass (' + togglesMarked + ' marked)' : '**' + unmarkedToggles.length + ' unmarked**'} | ${unmarkedToggles.map((t) => '`' + t.split(/[: ]/)[0] + '`').join(', ') || '—'} |`
);
grammarRows.push(
  `| §3.6 | A header is absent at rest only if it retracts | ${headerHits.length === 0 ? 'pass (' + headersPinned + ' pinned)' : '**' + headerHits.length + ' undeclared or unpaid**'} | ${headerHits.map((h) => '`' + h.split(':')[0] + '`').join(', ') || '—'} |`
);
if (navPinned === 0) fail('GRAMMAR §3.6 — found 0 pinned rules across every page, so the nav-density check inspected nothing. styles.css alone pins .light-table, so the scan has stopped matching (DECISIONS 006).');
for (const h of navFillHits) {
  fail(`GRAMMAR §3.6 — ${h.file}: \`${h.selector}\` is pinned top chrome but fills with ${h.value}; use var(--color-surface-nav)`);
}
grammarRows.push(
  `| §3.6 | Pinned top chrome uses the nav density | ${navFillHits.length === 0 ? 'pass' : '**' + navFillHits.length + ' underweight**'} | ${navFillHits.map((h) => '`' + h.file + '`').join(', ') || '—'} |`
);


// §2.1 — headlines are monochrome. A hex or accent token as a colour on display
// type is the single most-violated rule in the system.
//
// It used to read only `style="..."` on <h1>/<h2>, and only `#` or an accent/status
// token. GRAMMAR §2.1 says "--color-text-primary or nothing. No tint, no gradient
// fill". So it now reads h1/h2 rules in stylesheets too, either quote style, any
// literal colour, and gradient text. DECISIONS 023.
//
// Widened again in DECISIONS 036: every heading h1-h6, and every rule or style attribute that
// sets the display face, not only h1/h2, and "--color-text-primary or nothing" read as it is
// written. A colour on display type must be one of the display roles: text-primary; the
// cavity's text-on-sunken; the document sheet's own text-document; the statement banner's
// text-ghost, which §2.1 names; or paper ink (--print-ink*, §2.11). Anything else fails, a
// neutral grey included. A span that inherits the display face without setting it is
// invisible here; verify.html reads those rendered.
const tintedHeadlines = [];
let headlinesInspected = 0;
const DISPLAY_COLOUR_OK = /^(var\(\s*--(?:color-text-(?:primary|on-sunken|document|ghost)|print-ink[a-z-]*)\s*\)|inherit|currentcolor|transparent)(\s*!important)?$/i;
const headlineFault = (body) => {
  if (/background-clip\s*:\s*text/i.test(body)) return 'gradient text (background-clip: text)';
  for (const c of body.matchAll(/(?:^|[;{\s"'])((?:-webkit-text-fill-)?color)\s*:\s*([^;"'}]+)/gi)) {
    if (!DISPLAY_COLOUR_OK.test(c[2].trim())) return `${c[1]}: ${c[2].trim()}`;
  }
  return null;
};
const DISPLAY_FACE = /font-family\s*:\s*(?:var\(\s*--font-display\s*\)|['"]?Geist\b)/i;
const isHeadlineSelector = (sel) => sel.split(',').some((part) => /^h[1-6](?![\w-])/i.test(lastCompound(part)));
for (const file of styleFiles) {
  if (/antipatterns\.html$/.test(file)) continue; // depicts the violation on purpose
  // Blanked to their newlines, not removed, so a reported line number is the real one.
  const keepLines = (s) => s.replace(/[^\n]/g, '');
  const text = fs.readFileSync(file, 'utf8')
    .replace(/GENERATED:TOKENS:START[\s\S]*?GENERATED:TOKENS:END/g, keepLines)
    .replace(/\/\*[\s\S]*?\*\//g, keepLines);
  for (const m of text.matchAll(/<([a-z][a-z0-9]*)\b[^>]*\sstyle=(?:"([^"]*)"|'([^']*)')/gi)) {
    const body = m[2] !== undefined ? m[2] : m[3];
    if (!/^h[1-6]$/i.test(m[1]) && !DISPLAY_FACE.test(body)) continue;
    headlinesInspected++;
    const fault = headlineFault(';' + body);
    if (fault) tintedHeadlines.push(`${rel(file)}:${text.slice(0, m.index).split('\n').length} — ${fault}`);
  }
  for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].split(/[;}>]/).pop().trim().replace(/\s+/g, ' ');
    if (!isHeadlineSelector(selector) && !DISPLAY_FACE.test(m[2])) continue;
    headlinesInspected++;
    const fault = headlineFault(';' + m[2]);
    if (fault) tintedHeadlines.push(`${rel(file)} — \`${selector.slice(0, 60)}\` ${fault}`);
  }
}
if (headlinesInspected === 0) fail('GRAMMAR §2.1 — inspected 0 h1/h2 rules or styled headlines, so the headline check matched nothing (DECISIONS 006).');
for (const h of tintedHeadlines) fail(`GRAMMAR §2.1 — tinted headline: ${h}`);
grammarRows.push(
  `| §2.1 | Headlines are monochrome | ${tintedHeadlines.length === 0 ? 'pass' : '**' + tintedHeadlines.length + ' tinted**'} | ${tintedHeadlines.join(', ') || '—'} |`
);

/*
 * §2.7 — a capsule never wraps.
 *
 * A pill is a shape carrying meaning. The dashboard status pill wrapped to four
 * lines inside a 64px header, at which point it is not a capsule at all. If a
 * label does not fit on one line it is not pill content.
 */
const wrappablePills = [];
const pillsNotFound = [];
for (const sel of ['.btn', '.tag-pill', '.tag']) {
  // The rule itself, at the start of a line. Unanchored, `.btn {` also matched inside
  // `.modal-actions .btn {`, and once the rule was written `.btn{` that was the one it
  // read. A selector not found at all used to pass without checking anything.
  const re = new RegExp('^' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}', 'm');
  const m = re.exec(css);
  if (!m) pillsNotFound.push(sel);
  else if (!/white-space:\s*nowrap/.test(m[1])) wrappablePills.push(sel);
}
for (const p of wrappablePills) fail(`GRAMMAR §2.7 — ${p} can wrap; a capsule that wraps is no longer a capsule`);
for (const p of pillsNotFound) fail(`GRAMMAR §2.7 — no \`${p} {\` rule at the start of a line in styles.css, so whether ${p} can wrap was not checked`);
grammarRows.push(
  `| §2.7 | Capsules never wrap | ${wrappablePills.length + pillsNotFound.length === 0 ? 'pass' : '**' + wrappablePills.length + ' can wrap, ' + pillsNotFound.length + ' not found**'} | ${wrappablePills.concat(pillsNotFound).map((p) => '`' + p + '`').join(', ') || '—'} |`
);

/*
 * §2.5 — accents report state, never brand.
 *
 * The headline check below only sees <h1>/<h2>. A wordmark is usually a div or
 * span, and the dashboard shipped one tinted with --color-status-emerald for
 * exactly that reason.
 */
const tintedBrand = [];
let brandTags = 0;
for (const file of styleFiles.filter((p) => p.endsWith('.html'))) {
  if (/antipatterns\.html$/.test(file)) continue;
  const text = fs.readFileSync(file, 'utf8');
  for (const m of text.matchAll(/<[^>]*(?:wordmark|brand|logo|rail-name)[^>]*>/gi)) {
    brandTags++;
    if (/--color-(?:status|accent)/.test(m[0])) tintedBrand.push(`${rel(file)} — ${m[0].slice(0, 70)}`);
  }
}
if (brandTags === 0) fail('GRAMMAR §2.5 — found 0 wordmark/brand/logo elements, so the brand-tint check inspected nothing. Every example and site has a wordmark, so the pattern has stopped matching (DECISIONS 006).');
for (const b of tintedBrand) fail(`GRAMMAR §2.5 — accent used as brand: ${b}`);
grammarRows.push(
  `| §2.5 | Accents never colour a brand mark | ${tintedBrand.length === 0 ? 'pass' : '**' + tintedBrand.length + ' tinted**'} | ${tintedBrand.join(', ') || '—'} |`
);

// §2.4 — hover is quiet. A colour-changing or glowing hover is prohibited.
// It read only styles.css. Every page, example and site can declare its own :hover,
// so it now reads all of them (DECISIONS 023).
const loudHover = [];
let hoverRules = 0;
for (const file of styleFiles) {
  // Depicts the violation on purpose (.anti-neon-card), as §2.1 and §2.5 also allow.
  if (/antipatterns\.html$/.test(file)) continue;
  const text = fs.readFileSync(file, 'utf8')
    .replace(/GENERATED:TOKENS:START[\s\S]*?GENERATED:TOKENS:END/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  // Widened in DECISIONS 036 to everything §2.4 names, and to the simulated hover states
  // (.is-hover, sim-hover-*) the states card renders at rest: no scale-up or tilt, never a
  // fade, and no hue on an edge, an outline, text, a fill or a shadow. A glow through a
  // colour role is also a literal shadow layer, which 4u fails.
  for (const m of text.matchAll(/([^{}]*(?::hover|\.is-hover|sim-hover)[^{}]*)\{([^}]*)\}/g)) {
    const [, selector, body] = m;
    hoverRules++;
    const where = `${rel(file)} ${selector.split(/[;}>]/).pop().trim().slice(0, 50)}`;
    if (/box-shadow:[^;]*(#|rgba\((?!0,\s*0,\s*0)(?!255,\s*255,\s*255))/.test(body) && !/elevation/.test(body)) {
      loudHover.push(`${where}: a coloured shadow`);
    }
    const t = /transform\s*:[^;]*\b(scale|rotate|skew|matrix|perspective)/i.exec(body);
    if (t) loudHover.push(`${where}: ${t[1]} (no scale-up, no tilt)`);
    if (/(^|[;\s])opacity\s*:/i.test(body)) loudHover.push(`${where}: opacity (never a fade)`);
    for (const c of body.matchAll(/(border(?:-[a-z]+)*-color|border(?:-(?:top|right|bottom|left))?|outline(?:-color)?|color|background(?:-color)?|text-shadow)\s*:\s*([^;]*)/gi)) {
      if (/var\(\s*--(?:color-(?:status|accent|amber|emerald|cyan|blue|purple|red|doc-)|status\b)|#[0-9a-f]{3,8}\b|rgba?\((?!\s*0,\s*0,\s*0)(?!\s*255,\s*255,\s*255)/i.test(c[2])) {
        loudHover.push(`${where}: a hue on ${c[1]} (${c[2].trim().slice(0, 40)})`);
      }
    }
  }
}
if (hoverRules === 0) fail('GRAMMAR §2.4 — inspected 0 :hover rules, so the hover check matched nothing (DECISIONS 006).');
for (const h of loudHover) fail(`GRAMMAR §2.4 — a loud hover, ${h}. Hover is a rise toward the light and nothing else (DECISIONS 036).`);
grammarRows.push(
  `| §2.4 | Hover uses elevation, never a glow | ${loudHover.length === 0 ? 'pass' : '**' + loudHover.length + ' loud**'} | ${loudHover.join(', ') || '—'} |`
);

// §2.10 — focus is always visible. Removing the outline is allowed only where the same
// element shows focus another way: a :focus-visible rule for that selector in the same file
// that draws an outline, a ring (box-shadow) or an edge. A :focus or :focus-visible rule that
// removes the outline must itself draw the replacement. DECISIONS 037.
const hiddenFocus = [];
let outlinesRemoved = 0;
for (const file of styleFiles) {
  if (/antipatterns\.html$/.test(file)) continue;
  const keepLines = (s) => s.replace(/[^\n]/g, '');
  const text = fs.readFileSync(file, 'utf8')
    .replace(/GENERATED:TOKENS:START[\s\S]*?GENERATED:TOKENS:END/g, keepLines)
    .replace(/\/\*[\s\S]*?\*\//g, keepLines);
  const rules = [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ m, sel: m[1].split(/[;}]/).pop().trim().replace(/\s+/g, ' '), body: m[2] }));
  // The lookaheads sit after the optional space: with `\s*` before them, `outline: none`
  // matched by giving back the space, and a rule that removed focus passed as drawing it.
  const DRAWS = /outline\s*:(?!\s*(?:none|0)\b)[^;]+|box-shadow\s*:(?!\s*none\b)[^;]+|border(?:-color)?\s*:(?!\s*(?:none|0)\b)[^;]+/i;
  for (const r of rules) {
    if (!/outline\s*:\s*(none|0)\b|outline-style\s*:\s*none|outline-width\s*:\s*0/i.test(r.body)) continue;
    outlinesRemoved++;
    const where = `${rel(file)}:${text.slice(0, r.m.index + r.m[0].indexOf('{')).split('\n').length} \`${r.sel.slice(0, 50)}\``;
    for (const part of r.sel.split(',').map((s) => s.trim())) {
      if (/:focus/.test(part)) {
        if (!DRAWS.test(r.body)) hiddenFocus.push(`${where} removes the outline in its own focus state and draws nothing in its place`);
        continue;
      }
      const base = part.replace(/:[a-z-]+(\([^)]*\))?/gi, '');
      const esc = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const replaced = rules.some((o) => o.sel.split(',').some((p) => new RegExp('^' + esc + ':focus-visible\\b').test(p.trim())) && DRAWS.test(o.body));
      if (!replaced) hiddenFocus.push(`${where} removes the outline and ${base} has no :focus-visible rule that draws focus another way`);
    }
  }
}
for (const h of hiddenFocus) fail(`GRAMMAR §2.10 — ${h}. Focus is always visible (DECISIONS 037).`);
grammarRows.push(
  `| §2.10 | Focus is never removed without a replacement | ${hiddenFocus.length === 0 ? 'pass' : '**' + hiddenFocus.length + ' hidden**'} | ${outlinesRemoved} outline removal(s) read |`
);

// §2.5 — neither ground is pure: light is not #FFFFFF, dark is not #000000. Pure white is a
// raised surface, and pure black is only the label on a primary action in dark. DECISIONS 037.
{
  const pure = [];
  for (const [mode, isDark, bad] of [['light', false, 'ffffff'], ['dark', true, '000000']]) {
    const v = String(readRoleIn(isDark, '--color-bg-canvas') || '').trim().toLowerCase().replace('#', '');
    if (!/^[0-9a-f]{6}$/.test(v)) { fail(`GRAMMAR §2.5 — --color-bg-canvas in ${mode} is ${JSON.stringify(v)}, not a hex, so its purity cannot be checked (DECISIONS 037).`); continue; }
    if (v === bad) pure.push(`${mode} ground is #${bad.toUpperCase()}`);
  }
  for (const p of pure) fail(`GRAMMAR §2.5 — the ${p}; neither ground is pure (DECISIONS 037).`);
  grammarRows.push(`| §2.5 | Neither ground is pure white or black | ${pure.length === 0 ? 'pass' : '**' + pure.join(', ') + '**'} | — |`);
}

// §5.5 — a medium that cannot render backdrop blur (email, older engines) falls back to
// opaque surfaces. Every selector that blurs must also appear in an `@supports not
// (backdrop-filter…)` block that gives it --color-surface-solid, its own page's or the one in
// styles.css, which also hides the lamps. A blur set in a style="" attribute cannot be
// targeted by that block; those are counted and reported, not held. DECISIONS 039.
{
  const keep = (s) => s.replace(/[^\n]/g, '');
  const blockAt = (t, re) => {
    const spans = [];
    for (let from = 0; ;) {
      const i = t.slice(from).search(re); if (i === -1) break;
      const start = from + i; let d = 0, j = t.indexOf('{', start);
      for (; j < t.length; j++) { if (t[j] === '{') d++; else if (t[j] === '}' && --d === 0) break; }
      spans.push([start, j + 1]); from = j + 1;
    }
    return spans;
  };
  const selectorsOf = (s) => s.split(',').map((x) => x.trim().replace(/\s+/g, ' ')).filter(Boolean);
  const read = (file) => fs.readFileSync(file, 'utf8')
    .replace(/GENERATED:TOKENS:START[\s\S]*?GENERATED:TOKENS:END/g, keep)
    .replace(/\/\*[\s\S]*?\*\//g, keep)
    .replace(/<script\b[\s\S]*?<\/script>/gi, keep);
  const fallbackIn = (t) => {
    const covered = new Set();
    for (const [a, b] of blockAt(t, /@supports\s+not\s*\(/)) {
      for (const m of t.slice(a, b).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        if (!/background(?:-color)?\s*:\s*var\(\s*--color-surface-solid\s*\)/i.test(m[2])) continue;
        for (const s of selectorsOf(m[1].replace(/^[\s\S]*\{/, ''))) covered.add(s);
      }
    }
    return covered;
  };
  const baseText = read(stylesPath);
  const baseCovered = fallbackIn(baseText);
  const lampsHidden = blockAt(baseText, /@supports\s+not\s*\(/).some(([a, b]) => /\.light-table\s*\{[^}]*display\s*:\s*none/.test(baseText.slice(a, b)));
  if (!lampsHidden) fail('GRAMMAR §5.5 — styles.css has no @supports not (backdrop-filter…) block that hides the light table; without blur the lamps are dropped (DESIGN §4.3, DECISIONS 039).');
  const unfallen = [];
  let blurredSelectors = 0;
  let inlineBlurs = 0;
  for (const file of styleFiles) {
    if (/antipatterns\.html$/.test(file)) continue;
    const t = read(file);
    const skip = blockAt(t, /@supports\s+not\s*\(|@media\s+print\b/);
    const own = file === stylesPath ? baseCovered : new Set([...baseCovered, ...fallbackIn(t)]);
    for (const m of t.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (skip.some(([a, b]) => m.index > a && m.index < b)) continue;
      if (!/backdrop-filter\s*:\s*blur/i.test(m[2])) continue;
      const selector = m[1].split(/[;}]/).pop().replace(/^[\s\S]*<style[^>]*>/i, '');
      for (const s of selectorsOf(selector)) {
        blurredSelectors++;
        if (!own.has(s)) unfallen.push(`${rel(file)}:${t.slice(0, m.index + m[0].indexOf('{')).split('\n').length} \`${s}\``);
      }
    }
    inlineBlurs += (t.match(/\sstyle=["'][^"']*backdrop-filter\s*:\s*blur/gi) || []).length;
  }
  if (blurredSelectors === 0) fail('GRAMMAR §5.5 — found no blurred selectors to hold to a fallback, so the scan has stopped matching (DECISIONS 006).');
  for (const u of unfallen) fail(`GRAMMAR §5.5 — ${u} blurs but has no opaque fallback: add it to an @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) block with background: var(--color-surface-solid) (DECISIONS 039).`);
  grammarRows.push(`| §5.5 | Every blurred sheet falls back to opaque | ${unfallen.length === 0 ? 'pass' : '**' + unfallen.length + ' without a fallback**'} | ${blurredSelectors} blurred selector(s); ${inlineBlurs} inline blur(s) not held |`);
}

// §5.6 — no second accent. A project that wants a second state distinction declares a status (§3.9);
// a second free accent is how a system starts drifting. The tokens carry one accent role, and
// no site declares another. DECISIONS 039.
{
  const accents = Object.keys(flat).filter((p) => /^semantic\.color\.[a-z-]*accent[a-z0-9-]*$/.test(p));
  if (accents.length !== 1) fail(`GRAMMAR §5.6 — the tokens carry ${accents.length} accent role(s) (${accents.join(', ') || 'none'}); the system has exactly one, --color-accent (DECISIONS 039).`);
  const second = [];
  for (const file of implFiles.filter((f) => /\.(html|css)$/.test(f))) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/(--(?:color-)?accent-?[a-z0-9]+)\s*:/gi)) second.push(`${rel(file)}:${text.slice(0, m.index).split('\n').length} ${m[1]}`);
  }
  for (const s of second) fail(`GRAMMAR §5.6 — ${s} declares a second accent. A second state distinction is a status, from the core or added (GRAMMAR §3.9, DECISIONS 039, 058).`);
  grammarRows.push(`| §5.6 | One accent, no second | ${accents.length === 1 && second.length === 0 ? 'pass' : '**' + (second.length + Math.abs(accents.length - 1)) + '**'} | — |`);

  // §3.3 — the accent is one of the brand colours (DECISIONS 047). The token names
  // {semantic.brand.<n>} in both modes, and a site that repoints it names var(--brand-<n>) for a
  // brand colour it declares. A literal is a colour nobody declared; a status colour is a state.
  const accentFaults = [];
  let accentsRead = 0;
  const tok = flat['semantic.color.accent'];
  if (tok) {
    for (const v of [tok.$value, ((tok.$extensions || {})['design.vellum.mode'] || {}).dark]) {
      if (v === undefined) continue;
      accentsRead++;
      if (!/^\{semantic\.brand\.\d+\}$/.test(String(v).trim())) accentFaults.push(`semantic.color.accent is ${v}; it names a brand colour, {semantic.brand.<n>}`);
    }
  }
  for (const file of implFiles.filter((f) => /\.(html|css)$/.test(f))) {
    const text = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, (s) => s.replace(/[^\n]/g, ''));
    const brands = new Set([...text.matchAll(/--brand-(\d+)\s*:/g)].map((m) => m[1]));
    for (const m of text.matchAll(/--color-accent\s*:\s*([^;}"']+)/g)) {
      accentsRead++;
      const v = m[1].trim();
      const b = /^var\(\s*--brand-(\d+)\s*\)$/.exec(v);
      const where = `${rel(file)}:${text.slice(0, m.index).split('\n').length}`;
      if (!b) accentFaults.push(`${where} sets the accent to ${v}; it names a brand colour, var(--brand-<n>)`);
      else if (!brands.has(b[1])) accentFaults.push(`${where} points the accent at --brand-${b[1]}, which this site does not declare`);
    }
  }
  if (accentsRead === 0) fail('GRAMMAR §3.3 — read no accent, so the accent check inspected nothing (DECISIONS 006, 047).');
  for (const f of accentFaults) fail(`GRAMMAR §3.3 — ${f} (DECISIONS 047)`);
  grammarRows.push(`| §3.3 | The accent is one of the brand colours | ${accentFaults.length === 0 ? 'pass (' + accentsRead + ' read)' : '**' + accentFaults.length + ' off the palette**'} | — |`);
}

// §3.9 — the status set (DECISIONS 058). The core is five roles: three with fixed jobs, which a
// project may recolour only inside their family's hue range, and two free ones, which it may
// recolour with any hue outside the families, their margin, and the closed gaps. A project may
// also add statuses, which are free. Every recolour or addition names a seed, a hex or
// var(--brand-<n>), and its rungs are what derive_ramp.js makes of it: 500 for the colour, 700
// for light-mode text and 500 for dark-mode text. Any two statuses a site shows sit at least the
// separation apart. The numbers live in tokens.json: each role's range, and margin, separation
// and closed gaps on semantic.color.
{
  const faults = [];
  const rules = (tokens.semantic.color.$extensions || {})['design.vellum.status'];
  if (!rules || !(rules.margin >= 0) || !(rules.separation > 0) || !Array.isArray(rules.closed)) {
    fail('GRAMMAR §3.9 — semantic.color carries no design.vellum.status rules (margin, separation, closed), so the status set cannot be checked (DECISIONS 058).');
  }
  const R = rules || { margin: 0, separation: 0, closed: [] };
  const circ = (a, b) => { const x = Math.abs(a - b) % 360; return Math.min(x, 360 - x); };
  const within = (h, ranges) => ranges.some(([lo, hi]) => h >= lo && h <= hi);

  // The core, from the tokens. A role's hue is the hue its ramp records.
  const core = {};
  for (const p of Object.keys(flat).filter((k) => /^semantic\.color\.status-[a-z]+$/.test(k))) {
    const name = p.split('status-')[1];
    const st = (flat[p].$extensions || {})['design.vellum.status'];
    const ramp = (tokens.primitive.color[name] || {}).$extensions;
    const hue = ramp && ramp['design.vellum.ramp'] && ramp['design.vellum.ramp'].hue;
    if (!st || !['fixed', 'free'].includes(st.kind) || (st.kind === 'fixed' && !Array.isArray(st.range))) {
      faults.push(`${p} does not say whether it is a fixed status with a range or a free one ($extensions.design.vellum.status)`);
      continue;
    }
    if (typeof hue !== 'number') { faults.push(`${p} has no recorded hue on primitive.color.${name}`); continue; }
    core[name] = { kind: st.kind, range: st.range || null, hue };
  }
  const families = Object.values(core).filter((c) => c.kind === 'fixed').map((c) => c.range);
  const freeAllows = (h) => !families.some((rs) => rs.some(([lo, hi]) => h >= lo - R.margin && h <= hi + R.margin)) && !within(h, R.closed);
  const placed = (name, h) => {
    const c = core[name];
    if (c && c.kind === 'fixed') return within(h, c.range) ? null : `outside its family, ${c.range.map(([a, b]) => a + '–' + b + '°').join(' or ')}`;
    return freeAllows(h) ? null : `inside a family, its ${R.margin}° margin, or a closed gap (${R.closed.map(([a, b]) => a + '–' + b + '°').join(', ')}); a free status keeps out of them`;
  };
  const apart = (set, where) => {
    const names = Object.keys(set);
    for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
      const g = circ(set[names[i]], set[names[j]]);
      if (g < R.separation) faults.push(`${where}: ${names[i]} (${set[names[i]].toFixed(1)}°) and ${names[j]} (${set[names[j]].toFixed(1)}°) are ${g.toFixed(1)}° apart; any two statuses sit at least ${R.separation}° apart`);
    }
  };
  if (Object.keys(core).length === 0) faults.push('read no core status');
  for (const [name, c] of Object.entries(core)) {
    const why = placed(name, c.hue);
    if (why) faults.push(`the core status ${name} sits at ${c.hue.toFixed(1)}°, ${why}`);
  }
  apart(Object.fromEntries(Object.entries(core).map(([n, c]) => [n, c.hue])), 'the core');

  // Sites. Comments are blanked so a commented-out line is not read.
  let siteStatuses = 0;
  for (const file of implFiles.filter((f) => /\.(html|css)$/.test(f))) {
    const text = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, (s) => s.replace(/[^\n]/g, ''));
    const lineAt = (i) => text.slice(0, i).split('\n').length;
    const where = (i) => `${rel(file)}:${lineAt(i)}`;
    // Dark blocks, by brace matching from each [data-theme="dark"] selector.
    const dark = [];
    for (const m of text.matchAll(/\[data-theme=["']?dark["']?\][^{]*\{/g)) {
      let depth = 1, i = m.index + m[0].length;
      while (i < text.length && depth) { if (text[i] === '{') depth++; else if (text[i] === '}') depth--; i++; }
      dark.push([m.index, i]);
    }
    const inDark = (i) => dark.some(([a, b]) => i >= a && i < b);
    const brands = Object.fromEntries([...text.matchAll(/--brand-(\d+)\s*:\s*(#[0-9a-f]{6})\b/gi)].map((m) => [m[1], m[2]]));
    const seeds = {};
    for (const m of text.matchAll(/(?<![a-z-])--status-([a-z][a-z0-9-]*)\s*:\s*([^;}"']+)/gi)) {
      if (m[1] === 'fg') continue;   // --status-fg is the component-scoped property, not a seed
      seeds[m[1]] = { raw: m[2].trim(), at: m.index };
    }
    const rungs = {};
    for (const m of text.matchAll(/--color-status-([a-z][a-z0-9-]*?)(-fg)?\s*:\s*([^;}"']+)/gi)) {
      const r = (rungs[m[1]] = rungs[m[1]] || { colour: [], fg: [] });
      r[m[2] ? 'fg' : 'colour'].push({ v: m[3].trim().toUpperCase(), dark: inDark(m.index), at: m.index });
    }
    const site = Object.fromEntries(Object.entries(core).map(([n, c]) => [n, c.hue]));
    let touched = false;
    for (const name of new Set([...Object.keys(seeds), ...Object.keys(rungs)])) {
      siteStatuses++; touched = true;
      const seed = seeds[name];
      const r = rungs[name] || { colour: [], fg: [] };
      const at = seed ? seed.at : (r.colour[0] || r.fg[0]).at;
      if (!seed) { faults.push(`${where(at)} declares --color-status-${name} with no --status-${name} seed to derive it from; a status is a seed, a hex or var(--brand-<n>), and its rungs are derived`); continue; }
      let hex = seed.raw;
      const b = /^var\(\s*--brand-(\d+)\s*\)$/.exec(hex);
      if (b) hex = brands[b[1]];
      if (!/^#[0-9a-f]{6}$/i.test(hex || '')) { faults.push(`${where(seed.at)} seeds ${name} with ${seed.raw}; a seed is a 6-digit hex or var(--brand-<n>) for a brand colour this site declares`); continue; }
      if (!deriveTool) { faults.push(`derive_ramp.js is unavailable, so ${where(seed.at)}'s ${name} could not be derived`); continue; }
      const { hue, steps } = deriveTool.deriveRamp(hex);
      const s500 = steps[500].hex.toUpperCase(), s700 = steps[700].hex.toUpperCase();
      const how = `node systems/vellum/derive_ramp.js "${hex}" --status ${name}`;
      const lightColour = r.colour.filter((x) => !x.dark), lightFg = r.fg.filter((x) => !x.dark), darkFg = r.fg.filter((x) => x.dark);
      if (!lightColour.length || !lightFg.length || !darkFg.length) {
        faults.push(`${where(seed.at)} seeds ${name} but does not declare all three rungs: --color-status-${name}, its -fg, and its -fg again in dark (${how})`);
      }
      for (const x of r.colour) if (x.v !== s500) faults.push(`${where(x.at)} sets --color-status-${name} to ${x.v}, but ${hex} derives ${s500} at the 500 rung (${how})`);
      for (const x of lightFg) if (x.v !== s700) faults.push(`${where(x.at)} sets --color-status-${name}-fg to ${x.v}, but ${hex} derives ${s700} at the 700 rung (${how})`);
      for (const x of darkFg) if (x.v !== s500) faults.push(`${where(x.at)} sets --color-status-${name}-fg in dark to ${x.v}; dark-mode text is the 500 rung, ${s500} (${how})`);
      const why = placed(name, hue);
      if (why) faults.push(`${where(seed.at)} puts ${name} at ${hue.toFixed(1)}°, ${why}`);
      site[name] = hue;
    }
    if (touched) apart(site, rel(file));
  }
  if (siteStatuses === 0) fail('GRAMMAR §3.9 — no site declares a status, so the site status checks inspected nothing (DECISIONS 006, 058).');
  for (const f of faults) fail(`GRAMMAR §3.9 — ${f} (DECISIONS 058)`);
  grammarRows.push(`| §3.9 | The status set: families, margin, separation, derived rungs | ${faults.length === 0 ? 'pass (' + Object.keys(core).length + ' core, ' + siteStatuses + ' site)' : '**' + faults.length + ' fault(s)**'} | — |`);
}

// A stamped version is the first thing to go stale after a release is cut. Any
// version string that appears anywhere must be the one tokens.json declares.
const currentVersion = tokens.version;
const staleVersions = [];

/*
 * Match only a version presented TO A READER: one sitting alone in a text node
 * (`>v1.0.0-RC2<`) or introduced by the word "version". Anything looser catches
 * SVG path data, vendor CDN URLs, and cache-busting query params — all of which
 * are legitimately not this project's version.
 */
// A stamp does not have to be the whole element. "DESIGN SYSTEM V1.0.0-RC1"
// and "STABLE BASELINE V1.0.0-RC1" both read as version stamps to a human and
// both slipped past the older pattern, which required >...< around the version
// alone. Now: any version inside element text, or after the word "version".
const VISIBLE_VERSION = /(?:>[^<]*?\bv?(\d+\.\d+\.\d+(?:-[A-Za-z0-9.]+)?)\b[^<]*?<|version[:\s]+v?(\d+\.\d+\.\d+(?:-[A-Za-z0-9.]+)?))/gi;

for (const file of sourceFiles) {
  if (/VERIFICATION\.md|validate_system\.js|_ds_manifest\.json|tokens\.generated\.js/.test(file)) continue;
  // Tested on the absolute path, this skip never matched on Windows. DECISIONS 023.
  if (VENDOR_RUNTIME.test(rel(file))) continue; // vendor runtime
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    // Release history and changelog prose legitimately name older versions.
    // "baseline" was here and was hiding "STABLE BASELINE V1.0.0-RC1" -- a
    // real stamp, seven releases stale. Prose that legitimately names an old
    // version says so explicitly.
    if (/release|history|previous|changelog|superseded/i.test(line)) return;
    for (const m of line.matchAll(VISIBLE_VERSION)) {
      const found = m[1] || m[2];
      if (!found || found.toLowerCase() === currentVersion.toLowerCase()) continue;
      staleVersions.push(`${rel(file)}:${i + 1} — "${found}" (current is ${currentVersion})`);
    }
  });
}
for (const s of staleVersions) fail(`Stale version stamp: ${s}`);
grammarRows.push(
  `| — | Version stamps match \`tokens.json\` (${currentVersion}) | ${staleVersions.length === 0 ? 'pass' : '**' + staleVersions.length + ' stale**'} | ${staleVersions.join(', ') || '—'} |`
);

out.push('| Rule | Invariant | Result | Detail |');
out.push('| :--- | :--- | :--- | :--- |');
out.push(...grammarRows);
out.push('');

/* ============================================ 7. CONVENTION =============== */

out.push('## 7. Convention\n');
// Every declared name, collected permissively. definedProps only admits [a-z0-9-], so
// --colorPrimary and --color_primary were never collected and this check could not fail
// on the names it exists to reject. Same sources as definedProps.
const declaredNames = new Set();
for (const text of [css, ...implFiles.filter((f) => /\.(html|css)$/.test(f)).map((f) => fs.readFileSync(f, 'utf8'))]) {
  for (const m of text.matchAll(/^\s*(--[^\s:;{}()]+)\s*:/gm)) declaredNames.add(m[1]);
}
if (declaredNames.size === 0) fail('CONVENTION — the kebab-case check collected 0 custom property declarations, so it could not have failed on anything (DECISIONS 006)');
const badCase = [...declaredNames].filter((n) => !/^--[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(n));
for (const n of badCase) fail(`Custom property is not kebab-case: ${n}`);

// Every emitted property must be recoverable from a token path.
// Must mirror the emission filter in build.js, or a legitimately emitted token
// reads as an untracked one.
const derivable = new Set([...Object.keys(flat).filter((p) => p.startsWith('semantic.') || /^primitive\.color\./.test(p))].map(cssName));
const undeclared = [...definedProps].filter((n) => !derivable.has(n) && !RUNTIME_PROPS.has(n) && !consumerProps.has(n));
for (const n of undeclared) warn(`Custom property ${n} is defined in styles.css but has no token path in tokens.json`);

out.push(`| Check | Result |`);
out.push(`| :--- | :--- |`);
out.push(`| Custom properties are kebab-case | ${badCase.length === 0 ? 'pass' : '**' + badCase.length + ' violations**'} |`);
out.push(`| Every property maps to a token path | ${undeclared.length === 0 ? 'pass' : undeclared.length + ' unmapped'} |`);
out.push(`| Every semantic token is emitted to CSS | ${notEmitted.length === 0 ? 'pass' : '**' + notEmitted.length + ' not emitted**'} |`);
if (undeclared.length) out.push(`\nUnmapped: ${undeclared.map((n) => '`' + n + '`').join(', ')}\n`);
else out.push('');

/* ============================================ WRITE ======================= */

const stamp = new Date().toISOString().slice(0, 10);
const header = [
  '# Vellum — Verification Report',
  '',
  `Generated by \`validate_system.js\` on ${stamp}. Do not edit by hand.`,
  '',
  `**Result: ${errors.length === 0 ? 'PASS' : 'FAIL'}** — ${errors.length} error(s), ${warnings.length} warning(s).`,
  '',
];

if (errors.length) {
  header.push('### Errors', '');
  errors.forEach((e) => header.push(`- ${e}`));
  header.push('');
}
if (warnings.length) {
  header.push('### Warnings', '');
  warnings.forEach((w) => header.push(`- ${w}`));
  header.push('');
}
header.push('---', '');

const writeReport = !process.argv.includes('--no-report');
if (writeReport) fs.writeFileSync(reportPath, header.concat(out).join('\n'), 'utf8');

/* ============================================ CONSOLE ===================== */

console.log('=== Vellum: system validation ===');
console.log(`  cards            ${manifest.cards.length}`);
console.log(`  consumer sites   ${new Set(implFiles.map((f) => path.relative(IMPLEMENTATIONS, f).split(path.sep)[0])).size} (held to the same grammar)`);
console.log(`  examples         ${manifest.examples.length}`);
console.log(`  semantic roles   ${semanticPaths.length} (${dualCount} dual-mode)`);
console.log(`  properties       ${definedProps.size} defined, ${usedBy.size} referenced`);
console.log(`  undefined refs   ${missing.length}`);
console.log(`  orphaned roles   ${orphanRole.length + deadOnlyRoles.length}  (+${orphanScale.length} scale, ${orphanReference.length} reference, ${orphanSeed.length} seed — all expected)`);
console.log(`  manifest drift   ${driftRows.length}`);
console.log(`  retired names    ${nameHits.length}`);
console.log(`  -> ${rel(reportPath)}${writeReport ? '' : '  (not written: --no-report)'}`);
console.log('');

if (errors.length) {
  console.error(`\x1b[31m✖ VALIDATION FAILED — ${errors.length} error(s), ${warnings.length} warning(s)\x1b[0m`);
  errors.slice(0, 25).forEach((e) => console.error('  ' + e));
  if (errors.length > 25) console.error(`  ... and ${errors.length - 25} more (see VERIFICATION.md)`);
  process.exit(1);
}
console.log(`\x1b[32m✔ VALIDATION PASSED — 0 errors, ${warnings.length} warning(s)\x1b[0m`);
warnings.forEach((w) => console.log('  ⚠ ' + w));
