#!/usr/bin/env node
/**
 * Derive a Vellum ramp from a brand colour.
 *
 *   node derive_ramp.js "#0F62FE"
 *   node derive_ramp.js "#0F62FE" --name brand --css
 *
 * The rule, stated in GRAMMAR.md §3.4: take the hue angle of the colour, walk
 * nine fixed CIELAB L* targets, and at each rung take chroma =
 * min(target, gamut maximum). A step number therefore means the same lightness
 * in every hue, which is what lets contrast be reasoned about without checking
 * each ramp.
 *
 * The brand colour itself is NOT rounded to a rung. It goes in exactly as given
 * and drives the accent and the lamps; this ramp supplies its tints and shades.
 *
 * `--verify` regenerates the five shipped ramps and diffs them against
 * tokens.json, so the tool and the token file cannot drift apart.
 */

const L_TARGET = { 100: 95, 200: 89, 300: 82, 400: 74, 500: 65, 600: 55, 700: 45, 800: 36, 900: 29 };
const C_TARGET = { 100: 0.030, 200: 0.062, 300: 0.098, 400: 0.126, 500: 0.145, 600: 0.138, 700: 0.120, 800: 0.100, 900: 0.082 };
const STEPS = Object.keys(L_TARGET);

/* ------------------------------------------------------------ colour maths */
const srgbToLin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const linToSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

function hexToRgb(h) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(h).trim());
  if (!m) throw new Error(`not a 6-digit hex colour: ${h}`);
  return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255);
}
const rgbToHex = (v) =>
  '#' + v.map((x) => Math.round(Math.min(1, Math.max(0, x)) * 255).toString(16).padStart(2, '0').toUpperCase()).join('');

function linToOklab([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
}
function oklabToLin([L, a, b]) {
  const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
  const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
  const s = Math.pow(L - 0.0894841775 * a - 1.2914855480 * b, 3);
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
}
const oklchToLin = (L, C, hDeg) => {
  const h = (hDeg * Math.PI) / 180;
  return oklabToLin([L, C * Math.cos(h), C * Math.sin(h)]);
};
const inGamut = (v) => v.every((x) => x >= -0.0005 && x <= 1.0005);
const maxChroma = (L, h) => {
  let lo = 0, hi = 0.4;
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (inGamut(oklchToLin(L, m, h))) lo = m; else hi = m; }
  return lo;
};
const labL = ([r, g, b]) => {
  const Y = 0.2126 * srgbToLin(r) + 0.7152 * srgbToLin(g) + 0.0722 * srgbToLin(b);
  return 116 * (Y > 0.008856 ? Math.cbrt(Y) : 7.787 * Y + 16 / 116) - 16;
};
const hueOf = (hex) => {
  const [, a, b] = linToOklab(hexToRgb(hex).map(srgbToLin));
  return ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
};

/* -------------------------------------------------------------- the ladder */
function deriveRamp(hex) {
  return { hue: hueOf(hex), steps: deriveRampAtHue(hueOf(hex)) };
}

function deriveRampAtHue(hue) {
  const out = {};
  for (const step of STEPS) {
    const target = L_TARGET[step];
    let best = null;
    for (let okL = 0.05; okL <= 1.0; okL += 0.0004) {
      const C = Math.min(C_TARGET[step], maxChroma(okL, hue));
      const rgb = oklchToLin(okL, C, hue).map(linToSrgb);
      const err = Math.abs(labL(rgb) - target);
      if (!best || err < best.err) best = { err, hex: rgbToHex(rgb), L: labL(rgb) };
    }
    out[step] = best;
  }
  return out;
}

// A status's three values (GRAMMAR §3.9): the colour is the 500 rung, light-mode text the 700,
// dark-mode text the 500 again.
function deriveStatus(hex) {
  const { hue, steps } = deriveRamp(hex);
  return { hue, colour: steps[500].hex, fg: steps[700].hex, fgDark: steps[500].hex };
}

// Node loads this with require(); a browser page with <script src="derive_ramp.js">, which
// exposes the same functions as window.VellumRamp. So an agent that cannot run Node can still
// derive a brand colour's steps or a status's rungs in a page (DECISIONS 063).
const api = { deriveRamp, deriveRampAtHue, deriveStatus, hueOf, labL, hexToRgb, L_TARGET, C_TARGET, STEPS };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.VellumRamp = api;

/* ---------------------------------------------------------------- the CLI */
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  const args = process.argv.slice(2);

  if (args.includes('--verify')) {
    const fs = require('fs');
    const path = require('path');
    const tokensPath = path.join(__dirname, '..', 'spec', 'tokens.json');
    const pc = JSON.parse(fs.readFileSync(tokensPath, 'utf8')).primitive.color;
    let bad = 0, checked = 0;
    for (const [name, ramp] of Object.entries(pc)) {
      if (typeof ramp !== 'object' || ramp.$value || name === 'neutral') continue;
      const rungs = Object.keys(ramp).filter((k) => !k.startsWith('$'));
      if (rungs.length !== STEPS.length) continue;
      // Re-deriving the hue from the stored 500 would inherit its 8-bit rounding,
      // so each ramp records the angle it was generated from.
      const ext = ramp.$extensions && ramp.$extensions['design.vellum.ramp'];
      if (!ext || typeof ext.hue !== 'number') {
        console.log(`  ${name}: no recorded hue — cannot verify`);
        bad++;
        continue;
      }
      const derived = deriveRampAtHue(ext.hue);
      for (const s of STEPS) {
        checked++;
        if (derived[s].hex.toUpperCase() !== ramp[s].$value.toUpperCase()) {
          console.log(`  DRIFT ${name}.${s}: tokens.json ${ramp[s].$value}, tool derives ${derived[s].hex}`);
          bad++;
        }
      }
    }
    console.log(bad === 0
      ? `✔ tool and tokens.json agree on all ${checked} rungs`
      : `✖ ${bad} of ${checked} rungs disagree`);
    process.exit(bad === 0 ? 0 : 1);
  }

  const hex = args.find((a) => !a.startsWith('--'));
  if (!hex) {
    console.log('usage: node derive_ramp.js "#0F62FE" [--name brand] [--css] [--json] [--status <name>]');
    console.log('       node derive_ramp.js --verify');
    process.exit(1);
  }
  const nameIdx = args.indexOf('--name');
  const name = nameIdx >= 0 ? args[nameIdx + 1] : 'brand';
  const { hue, steps } = deriveRamp(hex);

  const statusIdx = args.indexOf('--status');
  if (statusIdx >= 0) {
    // A project's status (GRAMMAR §3.9, DECISIONS 058): the seed, its two rungs, the dark-mode
    // text rung, and the class that paints a pill with them. The validator regenerates each one.
    const st = args[statusIdx + 1];
    if (!st || st.startsWith('--') || !/^[a-z][a-z0-9-]*$/.test(st)) {
      console.log('usage: node derive_ramp.js "#0F62FE" --status <name>   (name: lowercase, e.g. backordered)');
      process.exit(1);
    }
    const s500 = steps[500].hex, s700 = steps[700].hex;
    console.log(`/* status ${st}: derived from ${hex.toUpperCase()}, hue ${hue.toFixed(1)}deg (GRAMMAR 3.9).`);
    console.log(`   If the seed is one of your brand colours, write var(--brand-<n>) in place of the hex. */`);
    console.log(':root {');
    console.log(`  --status-${st}: ${hex.toUpperCase()};`);
    console.log(`  --color-status-${st}: ${s500};`);
    console.log(`  --color-status-${st}-fg: ${s700};`);
    console.log('}');
    console.log('@media screen {');
    console.log('  [data-theme="dark"] {');
    console.log(`    --color-status-${st}-fg: ${s500};`);
    console.log('  }');
    console.log('}');
    console.log(`.tag-${st} {`);
    console.log(`  --status: var(--color-status-${st});`);
    console.log(`  --status-fg: var(--color-status-${st}-fg);`);
    console.log('}');
    console.log(`/* use: <span class="tag-pill tag-status tag-${st}">...</span> */`);
  } else if (args.includes('--json')) {
    const obj = {};
    for (const s of STEPS) obj[s] = { $value: steps[s].hex };
    console.log(JSON.stringify({ [name]: obj }, null, 2));
  } else if (args.includes('--css')) {
    console.log(`/* ${name} — derived from ${hex.toUpperCase()}, hue ${hue.toFixed(1)}deg */`);
    for (const s of STEPS) console.log(`  --color-${name}-${s}: ${steps[s].hex};`);
  } else {
    console.log(`\n  brand colour   ${hex.toUpperCase()}   hue ${hue.toFixed(1)}°   L* ${labL(hexToRgb(hex)).toFixed(1)}`);
    console.log('  The brand colour is used as given. This ramp supplies its tints and shades.\n');
    console.log('  step   hex        L*     target');
    for (const s of STEPS) {
      console.log(`  ${s.padEnd(6)} ${steps[s].hex}   ${steps[s].L.toFixed(1).padStart(5)}   ${String(L_TARGET[s]).padStart(6)}`);
    }
    console.log('\n  --css for custom properties, --json for a tokens.json fragment\n');
  }
}
