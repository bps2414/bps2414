// Generates every image the profile README uses: the hero (Copacabana's wave pavement laid stone by
// stone, the name set in black stones like a Rio building entrance, and the project row doing
// Lineup's lift, carry and drop) and one tile per project. Text is outlined and animation is CSS
// inside the SVG, so it works inside GitHub's <img> without fonts or scripts.
//
//   cd scripts && pnpm install && pnpm make
//
// Stars come from the GitHub API at build time (GITHUB_TOKEN raises the rate limit). The random
// numbers are seeded, so a rebuild only changes the files when a number changed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import opentype from 'opentype.js';
import sharp from 'sharp';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..', 'assets');
const SHOTS = path.join(HERE, 'shots');
fs.mkdirSync(OUT, { recursive: true });

const C = {
  basalto: '#24221F', basalto2: '#2D2A27', basalto3: '#1C1A18',
  calcario: '#E8E3D8', calcario2: '#DCD5C7', calcario3: '#F1EEE7',
  rejunte: '#9C968B', mar: '#2E8C8F', areia: '#CDBB9B',
};

const PROJECTS = [
  { id: 'lineup', name: 'Lineup', repo: 'lineup', shot: 'lineup.png', band: [18, 500], lang: 'C · React', desc: 'Arrange your PS5 home screen with the controller' },
  { id: 'feathertune', name: 'Feathertune', repo: 'feathertune', shot: null, lang: 'Rust', desc: 'Your music, as a real 3 MB Windows app' },
  { id: 'beatloom', name: 'Beatloom', repo: 'beatloom', shot: 'beatloom.jpg', lang: 'Python', desc: 'Any song in, a playable Beat Saber map out' },
  { id: 'memcard', name: 'Memcard', repo: 'memcard', shot: 'memcard.png', lang: 'Python', desc: 'Versioned PS5 save backups on your server' },
  { id: 'visor', name: 'Visor', repo: 'visor-ps5', shot: 'visor.png', lang: 'C', desc: 'Your Quest 2 on the TV, straight from the PS5' },
];

/* ------------------------------------------------------------------ helpers */

const fontFile = (w) => {
  const b = fs.readFileSync(path.join(HERE, 'node_modules', '@fontsource', 'schibsted-grotesk', 'files', `schibsted-grotesk-latin-${w}-normal.woff`));
  return opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};
const F = { regular: fontFile(400), medium: fontFile(500), semi: fontFile(600), black: fontFile(900) };

const width = (f, s, size) => f.getAdvanceWidth(s, size);
const text = (f, s, x, y, size, fill, { anchor = 'start', cls = '' } = {}) => {
  const x0 = anchor === 'end' ? x - width(f, s, size) : anchor === 'middle' ? x - width(f, s, size) / 2 : x;
  return `<path${cls ? ` class="${cls}"` : ''} fill="${fill}" d="${f.getPath(s, x0, y, size).toPathData(1)}"/>`;
};
// Greedy wrap by measured width.
function wrap(f, s, size, max) {
  const lines = [];
  let line = '';
  for (const word of s.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (line && width(f, next, size) > max) { lines.push(line); line = word; } else line = next;
  }
  return [...lines, line];
}

function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// One cut stone: the cell's corners pulled in for the grout and nudged at random, as a short
// relative path so thousands of them stay small.
function stone(x, y, s, r, gap = s * 0.11) {
  const j = () => (r() - 0.5) * s * 0.26;
  const p = [[x + gap + j(), y + gap + j()], [x + s - gap + j(), y + gap + j()], [x + s - gap + j(), y + s - gap + j()], [x + gap + j(), y + s - gap + j()]];
  const q = p.map(([a, b]) => [Math.round(a * 2) / 2, Math.round(b * 2) / 2]);
  let d = `M${q[0][0]} ${q[0][1]}`;
  for (let i = 1; i < 4; i++) d += `l${+(q[i][0] - q[i - 1][0]).toFixed(1)} ${+(q[i][1] - q[i - 1][1]).toFixed(1)}`;
  return `${d}z`;
}

// Copacabana: dark and light bands that undulate along the beach.
const ONDA = { a: 30, l: 480, p: 50 };
const lift = (x) => ONDA.a * Math.sin((x / ONDA.l) * Math.PI * 2);
const onda = (x, y) => Math.floor((y - lift(x) + 1000) / ONDA.p) % 2 === 0;

// The same stone laid on a row that follows the wave, as the calçadão is set: corners move with
// the curve, so the bands come out smooth instead of stepped.
function stoneOnda(x, v, s, r) {
  const gap = s * 0.11;
  const j = () => (r() - 0.5) * s * 0.24;
  const c = [[x + gap, v + gap], [x + s - gap, v + gap], [x + s - gap, v + s - gap], [x + gap, v + s - gap]]
    .map(([a, b]) => [Math.round((a + j()) * 2) / 2, Math.round((b + lift(a) + j()) * 2) / 2]);
  let d = `M${c[0][0]} ${c[0][1]}`;
  for (let i = 1; i < 4; i++) d += `l${+(c[i][0] - c[i - 1][0]).toFixed(1)} ${+(c[i][1] - c[i - 1][1]).toFixed(1)}`;
  return `${d}z`;
}

// Keyframes on one clock; each call returns a class name. Stops are [seconds, {o, t, e}]. The
// intro plays once over T; the idle, if given, loops every L seconds from D on and, listed last,
// wins over the intro's held end, so its first stop must match that end.
function clock(T, D, L) {
  const rules = [];
  let n = 0;
  const body = (p) => [p.o !== undefined && `opacity:${p.o}`, p.t && `transform:${p.t}`, p.e && `animation-timing-function:${p.e}`].filter(Boolean).join(';');
  const frames = (stops, len) => {
    const f = stops.map(([t, p]) => `${+((t / len) * 100).toFixed(2)}%{${body(p)}}`);
    if (stops[0][0] > 0) f.unshift(`0%{${body({ ...stops[0][1], e: undefined })}}`);
    f.push(`100%{${body({ ...stops.at(-1)[1], e: undefined })}}`);
    return f.join('');
  };
  return {
    css: () => rules.join(''),
    anim(intro, idle) {
      const id = `k${n++}`;
      const runs = [];
      if (intro) { rules.push(`@keyframes ${id}{${frames(intro, T)}}`); runs.push(`${id} ${T}s linear both`); }
      if (idle) { rules.push(`@keyframes ${id}i{${frames(idle, L)}}`); runs.push(`${id}i ${L}s linear ${D}s infinite`); }
      rules.push(`.${id}{animation:${runs.join(',')}}`);
      return id;
    },
  };
}
const OUT_EASE = 'cubic-bezier(.2,.8,.2,1)';
const INOUT = 'cubic-bezier(.65,0,.35,1)';

async function dataUri(buf, w, h, q = 72) {
  const jpg = await sharp(buf).resize(w, h, { fit: 'cover', position: 'top' }).jpeg({ quality: q, mozjpeg: true }).toBuffer();
  return `data:image/jpeg;base64,${jpg.toString('base64')}`;
}

// Feathertune has no screenshot yet, so its picture is drawn here: its feather mark and a few
// made-up lyric lines lighting up word by word, which is what the app is known for.
function feathertuneArt(w, h) {
  const mark = fs.readFileSync(path.join(SHOTS, 'feathertune-logo.svg'), 'utf8').replace('<svg ', `<svg x="${w * 0.07}" y="${h * 0.12}" width="${h * 0.2}" height="${h * 0.2}" `);
  const size = h * 0.085;
  const lines = [['the city hums in blue', 1], ['and every window', 0.55], ['sings the line back', 0.28]];
  const words = lines.map(([s, o], i) => {
    const y = h * 0.52 + i * size * 1.55;
    const lit = i === 1 ? 'and every' : null;
    const base = text(F.semi, s, w * 0.07, y, size, '#FFFFFF').replace('<path', `<path opacity="${o}"`);
    return lit ? base + text(F.semi, lit, w * 0.07, y, size, '#FFFFFF') : base;
  });
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><radialGradient id="g" cx=".8" cy=".1" r="1"><stop offset="0" stop-color="#7B6CF0"/><stop offset=".55" stop-color="#3B2F9E"/><stop offset="1" stop-color="#17133F"/></radialGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/>${mark}${words.join('')}</svg>`);
}
// `band` keeps rows [top, top + height] of a screenshot whose bottom matters (Lineup's "13"), widened
// to 2:1 with its own black so nothing is cut.
async function shotBuffer(p, w, h) {
  if (!p.shot) return feathertuneArt(w, h);
  const file = path.join(SHOTS, p.shot);
  if (!p.band) return fs.readFileSync(file);
  const { width: sw } = await sharp(file).metadata();
  const [top, bh] = p.band, pad = Math.max(0, Math.round((2 * bh - sw) / 2));
  return sharp(file).extract({ left: 0, top, width: sw, height: bh }).extend({ left: pad, right: pad, background: '#000' }).toBuffer();
}

async function stars(repo) {
  const headers = { 'User-Agent': 'bps2414-profile', ...(process.env.GITHUB_TOKEN && { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }) };
  try {
    const r = await fetch(`https://api.github.com/repos/bps2414/${repo}`, { headers });
    return r.ok ? (await r.json()).stargazers_count : null;
  } catch { return null; }
}
const fmt = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : `${n}`);

/* ------------------------------------------------------------------ hero */

async function hero() {
  const W = 1200, H = 480, PAVE = 304, S = 10;
  // The intro lays the pavement and does Lineup's gesture once; then the idle loops: the focus
  // browses the row like the PS5 home screen, and the sun passes over the stones.
  const T = 7.6, LOOP = 14, DW = LOOP / PROJECTS.length;
  const k = clock(T, T, LOOP);
  const r = rng(2414);

  // The plaque: a limestone field framed in two rows of basalt, with "bps" in black stones.
  const P = { x: 60, y: 46, w: 444, h: 212, s: 6, f: 2 };
  const FR = P.f * P.s;
  // Pavement stones whose centre falls on the plaque are left out; the ones on its edge go under it.
  const inPlaque = (x, y) => x + S / 2 > P.x - FR && x + S / 2 < P.x + P.w + FR && y + S / 2 > P.y - FR && y + S / 2 < P.y + P.h + FR;

  // Pavement, laid in vertical bands from left to right, in three tones of each stone.
  const BANDS = 16;
  const pave = Array.from({ length: BANDS }, () => ({ dark: [[], [], []], light: [[], [], []] }));
  for (let v = -ONDA.a - S; v < PAVE + ONDA.a; v += S) {
    for (let x = 0; x < W; x += S) {
      const y = v + lift(x + S / 2);
      if (y > PAVE || y + S < 0 || inPlaque(x, y)) continue;
      const b = Math.min(BANDS - 1, Math.floor((x / W) * BANDS));
      const tone = Math.floor(r() * 3);
      pave[b][Math.floor((v + S / 2 + 1000) / ONDA.p) % 2 === 0 ? 'dark' : 'light'][tone].push(stoneOnda(x, v, S, r));
    }
  }
  const darkTones = [C.basalto, C.basalto2, C.basalto3];
  const lightTones = [C.calcario, C.calcario2, C.calcario3];
  const paveSvg = pave.map((band, i) => {
    const t0 = 0.1 + i * 0.09;
    const cls = k.anim([[t0, { o: 0, t: 'translateY(-5px)' }], [t0 + 0.55, { o: 1, t: 'translateY(0)', e: OUT_EASE }]]);
    const paths = [...band.dark.map((d, j) => d.length && `<path fill="${darkTones[j]}" d="${d.join('')}"/>`), ...band.light.map((d, j) => d.length && `<path fill="${lightTones[j]}" d="${d.join('')}"/>`)];
    return `<g class="${cls}">${paths.filter(Boolean).join('')}</g>`;
  }).join('');

  // The name fills the plaque by its real outline (ascender to descender), with a margin of
  // limestone all round. Stones on its edge are cut to the letter, as the calceteiros do: the
  // dark ones clipped inside it, the light ones masked outside it.
  const pad = 30;
  const bb = F.black.getPath('bps', 0, 0, 100).getBoundingBox();
  const nameSize = Math.min((P.h - 2 * pad) / (bb.y2 - bb.y1), (P.w - 3 * pad) / (bb.x2 - bb.x1)) * 100;
  const u = nameSize / 100, nameW = (bb.x2 - bb.x1) * u;
  const nx = P.x + (P.w - nameW) / 2 - bb.x1 * u, ny = P.y + (P.h - (bb.y2 - bb.y1) * u) / 2 - bb.y1 * u;
  const namePath = F.black.getPath('bps', nx, ny, nameSize).toPathData(2);
  const mask = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${PAVE}"><rect width="100%" height="100%"/><path fill="#fff" d="${namePath}"/></svg>`)).greyscale().raw().toBuffer();
  const cover = (x, y) => {
    let lo = 255, hi = 0;
    for (let j = 0; j < P.s; j++) for (let i = 0; i < P.s; i++) { const m = mask[(y + j) * W + x + i]; lo = Math.min(lo, m); hi = Math.max(hi, m); }
    return { ink: hi > 16, bare: lo < 240 };
  };
  const LETTER_BANDS = 10;
  const left = nx + bb.x1 * u;
  const field = [[], [], []], frame = [[], [], []];
  const letters = Array.from({ length: LETTER_BANDS }, () => []);
  for (let y = P.y - FR; y < P.y + P.h + FR; y += P.s) {
    for (let x = P.x - FR; x < P.x + P.w + FR; x += P.s) {
      const d = stone(x, y, P.s, r);
      if (x < P.x || y < P.y || x >= P.x + P.w || y >= P.y + P.h) { frame[Math.floor(r() * 3)].push(d); continue; }
      const c = cover(x, y);
      if (c.ink) letters[Math.max(0, Math.min(LETTER_BANDS - 1, Math.floor(((x - left) / nameW) * LETTER_BANDS)))].push(d);
      if (c.bare) field[Math.floor(r() * 3)].push(d);
    }
  }
  const plaqueIn = k.anim([[0.35, { o: 0 }], [0.9, { o: 1 }]]);
  // The outline goes down first as a line of grout, like the guide a mason draws, and the
  // letter stones fill it in.
  const plaqueSvg = `<g class="${plaqueIn}"><rect x="${P.x - FR}" y="${P.y - FR}" width="${P.w + 2 * FR}" height="${P.h + 2 * FR}" fill="${C.rejunte}"/>${frame.map((d, j) => `<path fill="${darkTones[j]}" d="${d.join('')}"/>`).join('')}<g mask="url(#fora)">${field.map((d, j) => `<path fill="${lightTones[j]}" d="${d.join('')}"/>`).join('')}</g><path fill="none" stroke="${C.rejunte}" stroke-width="2.4" d="${namePath}"/></g>`
    + `<g clip-path="url(#nome)">${letters.map((d, i) => {
      const t0 = 1.0 + i * 0.12;
      const cls = k.anim([[t0, { o: 0, t: 'scale(.6)' }], [t0 + 0.35, { o: 1, t: 'scale(1)', e: OUT_EASE }]]);
      return d.length ? `<path class="${cls} pop" fill="${C.basalto}" d="${d.join('')}"/>` : '';
    }).join('')}</g>`;

  // Sun on the stones, once a loop.
  const sun = k.anim(null, [[0, { t: 'translateX(0)' }], [3.0, { t: 'translateX(0)', e: INOUT }], [7.5, { t: `translateX(${W + 1000}px)` }], [LOOP, { t: `translateX(${W + 1000}px)` }]]);
  const sunSvg = `<g clip-path="url(#calcada)"><g transform="skewX(-22)"><rect class="${sun}" x="-560" y="-40" width="460" height="${PAVE + 80}" fill="url(#sol)"/></g></g>`;

  // The street below: who, where, what, and the row of projects.
  const textIn = k.anim([[2.4, { o: 0, t: 'translateY(6px)' }], [3.0, { o: 1, t: 'translateY(0)', e: OUT_EASE }]]);
  const head = wrap(F.semi, 'Rio de Janeiro.', 23, 400).map((l, i) => text(F.semi, l, 60, PAVE + 62 + i * 30, 23, C.calcario)).join('');
  const body = wrap(F.regular, 'I make the things I wanted to exist.', 18, 400)
    .map((l, i) => text(F.regular, l, 60, PAVE + 98 + i * 26, 18, C.areia)).join('');

  // Lineup's gesture: the focus walks to the last game, lifts it, carries it to the front and
  // drops it. Static positions are the final order, so reduced motion shows the end state.
  const TW = 116, TH = 66, GAP = 12, PITCH = TW + GAP;
  const X0 = W - 60 - 5 * TW - 4 * GAP, TY = PAVE + 58;
  const start = [...PROJECTS.slice(1).map((p) => p.id), PROJECTS[0].id];
  const REST = 'translate(0,0) scale(1)', UP = 'translate(0,-4px) scale(1.05)';
  const at = (j) => j * DW, HOLD = DW - 0.45;
  const tiles = [];
  for (const [slot, p] of PROJECTS.entries()) {
    const from = start.indexOf(p.id);
    const uri = await dataUri(await shotBuffer(p, TW * 2, TH * 2), TW * 2, TH * 2);
    const x = X0 + slot * PITCH;
    const dx = (from - slot) * PITCH;
    const fadeIn = [[2.6 + from * 0.08, { o: 0, t: `translate(${dx}px,8px)` }], [3.1 + from * 0.08, { o: 1, t: `translate(${dx}px,0)`, e: OUT_EASE }]];
    let stops;
    if (p.id === 'lineup') {
      stops = [...fadeIn, [4.7, { o: 1, t: `translate(${dx}px,0) scale(1)`, e: OUT_EASE }], [5.0, { o: 1, t: `translate(${dx}px,-12px) scale(1.08)`, e: INOUT }],
        [6.5, { o: 1, t: 'translate(0,-12px) scale(1.08)', e: OUT_EASE }], [6.85, { o: 1, t: REST }]];
    } else {
      const lag = (start.length - 1 - from) * 0.06;
      stops = [...fadeIn, [5.1 + lag, { o: 1, t: `translate(${dx}px,0)`, e: INOUT }], [6.3 + lag, { o: 1, t: 'translate(0,0)' }]];
    }
    // Idle: rises while the focus is on it.
    const a = at(slot);
    const idle = [[0, { t: REST }], [a, { t: REST, e: OUT_EASE }], [a + 0.3, { t: UP }], [a + HOLD, { t: UP, e: INOUT }], [a + HOLD + 0.3, { t: REST }], [LOOP, { t: REST }]];
    const cls = k.anim(stops, idle);
    tiles.push({ z: p.id === 'lineup' ? 1 : 0, svg: `<g class="${cls} pop"><rect x="${x - 1}" y="${TY - 1}" width="${TW + 2}" height="${TH + 2}" rx="9" fill="${C.basalto3}"/><image x="${x}" y="${TY}" width="${TW}" height="${TH}" href="${uri}" clip-path="url(#t${slot})" preserveAspectRatio="xMidYMin slice"/></g>` });
  }
  const clips = PROJECTS.map((_, slot) => `<clipPath id="t${slot}"><rect x="${X0 + slot * PITCH}" y="${TY}" width="${TW}" height="${TH}" rx="8"/></clipPath>`).join('');
  const far = 4 * PITCH;
  // The focus ring and the sea glow under it: in the intro they do the carry, in the idle they
  // step along the row, slot by slot, and slide back to the front.
  const ringIdle = [], glowIdle = [];
  for (let j = 0; j < PROJECTS.length; j++) {
    const a = at(j), x = j * PITCH;
    ringIdle.push([a, { t: `translate(${x}px,0) scale(1)`, e: OUT_EASE }], [a + 0.3, { t: `translate(${x}px,-4px) scale(1.05)` }], [a + HOLD, { t: `translate(${x}px,-4px) scale(1.05)`, e: INOUT }]);
    glowIdle.push([a, { t: `translate(${x}px,0)` }], [a + HOLD, { t: `translate(${x}px,0)`, e: INOUT }]);
  }
  ringIdle.push([LOOP, { t: REST }]);
  glowIdle.push([LOOP, { t: 'translate(0px,0)' }]);
  const ring = k.anim([[3.4, { o: 0, t: REST }], [3.6, { o: 1, t: REST, e: INOUT }], [4.5, { o: 1, t: `translate(${far}px,0) scale(1)`, e: OUT_EASE }],
    [4.7, { o: 1, t: `translate(${far}px,0) scale(1)`, e: OUT_EASE }], [5.0, { o: 1, t: `translate(${far}px,-12px) scale(1.08)`, e: INOUT }], [6.5, { o: 1, t: 'translate(0,-12px) scale(1.08)', e: OUT_EASE }], [6.85, { o: 1, t: REST }]], ringIdle);
  const ringSvg = `<rect class="${ring} pop" x="${X0 - 5}" y="${TY - 5}" width="${TW + 10}" height="${TH + 10}" rx="12" fill="none" stroke="${C.calcario}" stroke-width="3"/>`;
  const glow = k.anim([[3.4, { o: 0 }], [3.6, { o: 0.55 }]], glowIdle);

  // The caption names what has the focus: "Lineup moved to the front" after the carry, then each
  // project's line as the focus reaches it.
  const cy = TY + TH + 30;
  const line = (name, rest) => text(F.semi, name, X0, cy, 17, C.calcario) + text(F.regular, rest, X0 + width(F.semi, name, 17) + 8, cy, 17, C.rejunte);
  const captions = PROJECTS.map((p, j) => {
    if (j === 0) {
      const cls = k.anim([[6.9, { o: 0, t: 'translateY(4px)' }], [7.3, { o: 1, t: 'translateY(0)', e: OUT_EASE }]],
        [[0, { o: 1 }], [HOLD, { o: 1 }], [HOLD + 0.2, { o: 0 }], [LOOP - 0.2, { o: 0 }], [LOOP, { o: 1 }]]);
      return `<g class="${cls}">${line(p.name, 'moved to the front')}</g>`;
    }
    const a = at(j);
    const cls = k.anim(null, [[0, { o: 0 }], [a - 0.05, { o: 0, t: 'translateY(4px)', e: OUT_EASE }], [a + 0.25, { o: 1, t: 'translateY(0)' }], [a + HOLD, { o: 1, t: 'translateY(0)' }], [a + HOLD + 0.2, { o: 0, t: 'translateY(0)' }], [LOOP, { o: 0 }]]);
    return `<g class="${cls}" opacity="0">${line(p.name, p.desc)}</g>`;
  }).join('');

  const css = `${k.css()}.pop{transform-box:fill-box;transform-origin:center}@media (prefers-reduced-motion:reduce){*{animation:none!important}}`;
  const defs = `<clipPath id="frame"><rect width="${W}" height="${H}" rx="18"/></clipPath><clipPath id="calcada"><rect width="${W}" height="${PAVE}"/></clipPath><clipPath id="nome"><path d="${namePath}"/></clipPath><mask id="fora"><rect width="${W}" height="${PAVE}" fill="#fff"/><path fill="#000" d="${namePath}"/></mask>${clips}`
    + `<radialGradient id="mar" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="${C.mar}" stop-opacity=".9"/><stop offset="1" stop-color="${C.mar}" stop-opacity="0"/></radialGradient>`
    + `<linearGradient id="sol"><stop offset="0" stop-color="#FFF8E7" stop-opacity="0"/><stop offset=".5" stop-color="#FFF8E7" stop-opacity=".16"/><stop offset="1" stop-color="#FFF8E7" stop-opacity="0"/></linearGradient>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="bps: Rio de Janeiro. I make the things I wanted to exist."><style>${css}</style><defs>${defs}</defs><g clip-path="url(#frame)"><rect width="${W}" height="${PAVE}" fill="${C.rejunte}"/>${paveSvg}${plaqueSvg}${sunSvg}<rect y="${PAVE}" width="${W}" height="${H - PAVE}" fill="${C.basalto}"/><rect y="${PAVE}" width="${W}" height="3" fill="${C.basalto3}"/><ellipse class="${glow}" cx="${X0 + TW / 2}" cy="${TY + TH / 2}" rx="${TW}" ry="${TH}" fill="url(#mar)"/><g class="${textIn}">${head}${body}</g>${tiles.sort((a, b) => a.z - b.z).map((t) => t.svg).join('')}${ringSvg}${captions}</g></svg>`;
  fs.writeFileSync(path.join(OUT, 'hero.svg'), svg);
  return svg.length;
}

/* ------------------------------------------------------------------ tiles */

// A project card: the screenshot, a strip of the same wave pavement, and the name on basalt.
async function tile(p, size, count) {
  const big = size === 'big';
  const W = big ? 412 : 274, IH = big ? 206 : 140, STRIP = big ? 12 : 10, BAND = big ? 88 : 96;
  const H = IH + STRIP + BAND;
  const r = rng(p.id.length * 97 + 7);
  const uri = await dataUri(await shotBuffer(p, W * 2, IH * 2), W * 2, IH * 2, 76);
  const s = big ? 6 : 5;
  const strip = { dark: [], light: [] };
  for (let x = 0; x < W; x += s) for (let y = IH; y < IH + STRIP; y += s) strip[onda(x * 3.2, (y - IH) * 3.2 + 23) ? 'dark' : 'light'].push(stone(x, y, s, r));
  const pad = big ? 20 : 16;
  const nameSize = big ? 22 : 18, descSize = big ? 15 : 13;
  const yName = IH + STRIP + (big ? 36 : 31), yDesc = yName + (big ? 26 : 22);
  // The font has no star, so it is drawn: five points, left of the count.
  const shown = count !== null && count >= 10;
  const ms = big ? 14 : 13;
  const langW = width(F.medium, p.lang, ms);
  const countW = shown ? width(F.medium, fmt(count), ms) : 0;
  const sx = W - pad - langW - 18 - countW - 18;
  const star = shown ? `<path fill="${C.areia}" d="${Array.from({ length: 10 }, (_, i) => { const a = (Math.PI / 5) * i - Math.PI / 2, rr = i % 2 ? 2.6 : 6.4; return `${i ? 'L' : 'M'}${(sx + 6.4 + rr * Math.cos(a)).toFixed(1)} ${(yName - 5 + rr * Math.sin(a)).toFixed(1)}`; }).join('')}Z"/>` + text(F.medium, fmt(count), sx + 16, yName, ms, C.areia) : '';
  const metaSvg = star + text(F.medium, p.lang, W - pad, yName, ms, C.rejunte, { anchor: 'end' });
  const desc = wrap(F.regular, p.desc, descSize, W - 2 * pad).map((l, i) => text(F.regular, l, pad, yDesc + i * (descSize + 6), descSize, C.areia)).join('');
  const label = `${p.name}: ${p.desc}.${count !== null && count >= 10 ? ` ${count} stars.` : ''}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${label}"><defs><clipPath id="c"><rect width="${W}" height="${H}" rx="14"/></clipPath></defs><g clip-path="url(#c)"><rect width="${W}" height="${H}" fill="${C.basalto}"/><image width="${W}" height="${IH}" href="${uri}" preserveAspectRatio="xMidYMin slice"/><rect y="${IH}" width="${W}" height="${STRIP}" fill="${C.rejunte}"/><path fill="${C.basalto3}" d="${strip.dark.join('')}"/><path fill="${C.calcario}" d="${strip.light.join('')}"/>${text(F.semi, p.name, pad, yName, nameSize, C.calcario)}${metaSvg}${desc}</g></svg>`;
  fs.writeFileSync(path.join(OUT, `tile-${p.id}.svg`), svg);
  return svg.length;
}

/* ------------------------------------------------------------------ posters */

// The tile's material at a fixed size, as PNG: the README banner (1280×320) and the social preview
// GitHub shows when the repo link is shared (1280×640, uploaded by hand in Settings). Name and line
// on basalt at the left, the screenshot at the right, the wave pavement along the bottom.
async function poster(p, W, H, file) {
  const big = H >= 600;
  const s = big ? 10 : 8, STRIP = s * 4, IH = H - STRIP, split = Math.round(W * (big ? 0.47 : 0.5));
  const r = rng(p.id.length * 131 + H);
  // Lineup's screen is 16:9 on black, so it sits whole on black instead of being cropped to the slot.
  const SW = (W - split) * 2;
  const shot = p.band ? await sharp(path.join(SHOTS, p.shot)).resize(SW, IH * 2, { fit: 'contain', background: '#000' }).toBuffer() : await shotBuffer(p, SW, IH * 2);
  const uri = await dataUri(shot, SW, IH * 2, 82);
  const strip = { dark: [], light: [] };
  for (let x = 0; x < W; x += s) for (let y = IH; y < H; y += s) strip[onda(x * 2.2, (y - IH) * 2.2 + 23) ? 'dark' : 'light'].push(stone(x, y, s, r));
  const pad = big ? 64 : 40, nameSize = Math.min(big ? 84 : 52, (split - 2 * pad) / width(F.black, p.name, 1)), descSize = big ? 32 : 21, urlSize = big ? 22 : 15;
  const desc = wrap(F.regular, p.desc, descSize, split - 2 * pad);
  const block = nameSize + 18 + desc.length * descSize * 1.3;
  const top = (IH - block) / 2 + nameSize * 0.8 - (big ? 12 : 4);
  const name = text(F.black, p.name, pad, top, nameSize, C.calcario);
  const lines = desc.map((l, i) => text(F.regular, l, pad, top + 18 + descSize * 1.15 + i * descSize * 1.3, descSize, C.areia)).join('');
  const url = text(F.medium, `github.com/bps2414/${p.repo}`, pad, IH - (big ? 44 : 26), urlSize, C.rejunte);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="${C.basalto}"/><image x="${split}" width="${W - split}" height="${IH}" href="${uri}" preserveAspectRatio="xMidYMin slice"/><rect x="${split}" width="3" height="${IH}" fill="${C.basalto3}"/>${name}${lines}${url}<rect y="${IH}" width="${W}" height="${STRIP}" fill="${C.rejunte}"/><path fill="${C.basalto3}" d="${strip.dark.join('')}"/><path fill="${C.calcario}" d="${strip.light.join('')}"/></svg>`;
  const out = path.join(OUT, file);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await sharp(Buffer.from(svg)).png({ compressionLevel: 9, palette: false }).toFile(out);
  return fs.statSync(out).size;
}

const sizes = { hero: await hero() };
for (const [i, p] of PROJECTS.entries()) sizes[p.id] = await tile(p, i < 2 ? 'big' : 'small', await stars(p.repo));
for (const p of PROJECTS) sizes[`social ${p.id}`] = await poster(p, 1280, 640, `social/${p.id}.png`);
for (const p of PROJECTS.filter((q) => ['memcard', 'visor'].includes(q.id))) sizes[`banner ${p.id}`] = await poster(p, 1280, 320, `banner/${p.id}.png`);
for (const [name, n] of Object.entries(sizes)) console.log(`${name.padEnd(12)} ${(n / 1024).toFixed(0)} KB`);
