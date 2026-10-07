// Génère toute l'identité visuelle de LUNA (aucune image externe, tout est procédural et déterministe) :
//   - luna-ui/assets/... : textures d'interface qui remplacent celles de Minecraft (embarquées dans le mod LUNA UI)
//   - branding/out/      : icône Modrinth et aperçus
//   node branding/generate.mjs
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Canvas, decodePng } from "../lib/png.mjs";

const ROOT = join(import.meta.dirname, "..");
const MC = join(ROOT, "luna-ui", "assets", "minecraft");
const OUT = join(ROOT, "branding", "out");

function save(path, canvas) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, canvas.toPng());
}
function saveText(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

// ---------- Outils ----------

function rng(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash3(x, y, z) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const smooth = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;
const mix = (c1, c2, t) => c1.map((v, i) => lerp(v, c2[i], t));
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const smoothstep = (a, b, v) => smooth(clamp((v - a) / (b - a)));
const shade = (c, f) => c.map((v, i) => (i < 3 ? v * f : v));

function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = smooth(x - xi), yf = smooth(y - yi), zf = smooth(z - zi);
  let v = 0;
  for (let dz = 0; dz < 2; dz++)
    for (let dy = 0; dy < 2; dy++)
      for (let dx = 0; dx < 2; dx++)
        v += hash3(xi + dx, yi + dy, zi + dz) * (dx ? xf : 1 - xf) * (dy ? yf : 1 - yf) * (dz ? zf : 1 - zf);
  return v;
}

function fbm(x, y, z, octaves = 4) {
  let v = 0, amp = 0.5, f = 1;
  for (let o = 0; o < octaves; o++) {
    v += amp * noise3(x * f, y * f, z * f);
    f *= 2.03;
    amp *= 0.5;
  }
  return v;
}

// Bruit 1D périodique sur 360° (somme de sinus à phases aléatoires) : pas de couture.
function ridge(seed, harmonics) {
  const r = rng(seed);
  const waves = harmonics.map(([freq, amp]) => ({ freq, amp, phase: r() * Math.PI * 2 }));
  return (azDeg) => {
    const a = (azDeg * Math.PI) / 180;
    return waves.reduce((s, w) => s + w.amp * Math.sin(a * w.freq + w.phase), 0);
  };
}

// ---------- Palette ----------

const INK = [9, 8, 28, 1];
const NIGHT = [12, 11, 34, 1];
const OUTLINE = [62, 54, 128, 1];
const LAVENDER = [178, 162, 255, 1];
const MOON = [242, 240, 255, 1];
const MOON_DIM = [176, 166, 238, 1];

// ---------- Polices pixel ----------

const BIG = {
  L: ["##....", "##....", "##....", "##....", "##....", "######", "######"],
  U: ["##..##", "##..##", "##..##", "##..##", "##..##", "######", ".####."],
  N: ["##..##", "###.##", "######", "##.###", "##..##", "##..##", "##..##"],
  A: [".####.", "######", "##..##", "######", "######", "##..##", "##..##"],
};

// Petite police « manuscrite » : minuscules sur 9 lignes (ligne de base = 6, jambages en 7-8).
// Chaque glyphe : [ligne de départ, ...rangées].
const SCRIPT = {
  B: [0, "####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
  b: [0, "#....", "#....", "####.", "#...#", "#...#", "#...#", "####."],
  d: [0, "....#", "....#", ".####", "#...#", "#...#", "#...#", ".####"],
  e: [2, ".###.", "#...#", "#####", "#....", ".###."],
  h: [0, "#....", "#....", "####.", "#...#", "#...#", "#...#", "#...#"],
  i: [0, "#", ".", "#", "#", "#", "#", "#"],
  n: [2, "####.", "#...#", "#...#", "#...#", "#...#"],
  o: [2, ".###.", "#...#", "#...#", "#...#", ".###."],
  r: [2, "#.##", "##..", "#...", "#...", "#..."],
  t: [0, ".#..", ".#..", "####", ".#..", ".#..", ".#..", "..##"],
  y: [2, "#...#", "#...#", "#...#", ".####", "....#", "#...#", ".###."],
  z: [2, "#####", "...#.", "..#..", ".#...", "#####"],
  " ": [0, "..."],
};

// Texte penché vers la droite (une colonne tous les 3 pixels de haut) pour un rendu plus « écrit à la main ».
function scriptTextMask(text) {
  const cells = [];
  let x = 0;
  for (const ch of text) {
    const [start, ...rows] = SCRIPT[ch];
    rows.forEach((row, ry) =>
      [...row].forEach((c, i) => {
        const y = start + ry;
        if (c === "#") cells.push([x + i + Math.floor((8 - y) / 3), y]);
      }),
    );
    x += rows[0].length + 1;
  }
  return { cells, width: x + 2, height: 9 };
}

// ---------- Logo (texture 1024×256, dessinée sur une grille 256×64 puis ×4) ----------

function crescentMask(cx, cy, r, cut, ox, oy) {
  const cells = [];
  for (let y = Math.floor(cy - r); y <= cy + r; y++)
    for (let x = Math.floor(cx - r); x <= cx + r; x++) {
      const inMain = (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r;
      const inCut = (x + 0.5 - cx - ox) ** 2 + (y + 0.5 - cy - oy) ** 2 <= cut * cut;
      if (inMain && !inCut) cells.push([x, y]);
    }
  return cells;
}

function sparkle(c, x, y, size, color) {
  c.blend(x, y, color);
  for (let i = 1; i <= size; i++) {
    const a = color[3] * (1 - i / (size + 1));
    const col = [color[0], color[1], color[2], a];
    c.blend(x + i, y, col); c.blend(x - i, y, col); c.blend(x, y + i, col); c.blend(x, y - i, col);
  }
}

// Dessine une forme « roche lunaire » extrudée : face dégradée, cratères, biseau, extrusion, contour.
function drawRockShape(c, mask, { depth = 3, seed = 7 } = {}) {
  const key = (x, y) => `${x},${y}`;
  const face = new Set(mask.map(([x, y]) => key(x, y)));
  const ys = mask.map(([, y]) => y);
  const top = Math.min(...ys), bottom = Math.max(...ys);
  const extrude = new Map();
  for (let d = 1; d <= depth; d++)
    for (const [x, y] of mask) {
      const k = key(x + d, y + d);
      if (!face.has(k) && !extrude.has(k)) extrude.set(k, d);
    }
  const solid = new Set([...face, ...extrude.keys()]);
  // Contour
  for (const k of solid) {
    const [x, y] = k.split(",").map(Number);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) if (!solid.has(key(x + dx, y + dy))) c.set(x + dx, y + dy, INK);
  }
  // Extrusion : violet profond, plus sombre vers l'arrière
  for (const [k, d] of extrude) {
    const [x, y] = k.split(",").map(Number);
    c.set(x, y, mix([92, 70, 180, 1], [40, 30, 92, 1], (d - 1) / Math.max(1, depth - 1)));
  }
  // Face
  const r = rng(seed);
  const craters = mask.filter(() => r() < 0.018).map(([x, y]) => [x, y, r() < 0.3 ? 2 : 1]);
  for (const [x, y] of mask) {
    const t = (y - top) / Math.max(1, bottom - top);
    let col = mix(MOON, [150, 132, 250, 1], smooth(t));
    col = shade(col, 0.94 + 0.12 * noise3(x * 0.45, y * 0.45, seed));
    for (const [cx, cy, cr] of craters) {
      const d = Math.hypot(x - cx, y - cy);
      if (d < cr) col = shade(col, 0.86);
      else if (d < cr + 1 && x <= cx && y <= cy) col = shade(col, 0.9);
    }
    const up = face.has(key(x, y - 1)), left = face.has(key(x - 1, y));
    const down = face.has(key(x, y + 1)), right = face.has(key(x + 1, y));
    if (!up || !left) col = mix(col, [255, 255, 255, 1], 0.45);
    else if (!down || !right) col = shade(col, 0.82);
    c.set(x, y, col);
  }
}

function makeLogo() {
  const c = new Canvas(256, 64);
  const s = 5, glyphW = 6 * s, gap = s;
  const textW = 4 * glyphW + 3 * gap;
  const moonR = 17, moonGap = 9;
  const total = moonR * 2 + moonGap + textW;
  const x0 = Math.round((256 - total) / 2), y0 = 3;
  const moon = crescentMask(x0 + moonR, y0 + 17.5, moonR, 14.5, 9, -5);
  const letters = [];
  [..."LUNA"].forEach((ch, i) => {
    const gx = x0 + moonR * 2 + moonGap + i * (glyphW + gap);
    BIG[ch].forEach((row, ry) =>
      [...row].forEach((cell, rx) => {
        if (cell !== "#") return;
        for (let yy = 0; yy < s; yy++) for (let xx = 0; xx < s; xx++) letters.push([gx + rx * s + xx, y0 + ry * s + yy]);
      }),
    );
  });
  drawRockShape(c, moon, { depth: 3, seed: 11 });
  drawRockShape(c, letters, { depth: 3, seed: 5 });
  sparkle(c, x0 + 40, y0 + 1, 2, [255, 255, 255, 1]);
  sparkle(c, x0 + total + 6, y0 + 4, 2, [214, 204, 255, 1]);
  sparkle(c, x0 + total + 12, y0 + 30, 1, [255, 255, 255, 0.9]);
  sparkle(c, x0 - 7, y0 + 33, 1, [214, 204, 255, 0.9]);
  return c;
}

function makeSubtitle(text) {
  const c = new Canvas(128, 16);
  const { cells, width } = scriptTextMask(text);
  const x0 = Math.round((128 - width) / 2), y0 = 3;
  for (const [x, y] of cells) c.set(x0 + x + 1, y0 + y + 1, [20, 14, 52, 1]);
  for (const [x, y] of cells) c.set(x0 + x, y0 + y, mix([246, 240, 255, 1], [196, 178, 255, 1], y / 8));
  sparkle(c, x0 + width + 3, y0 + 1, 1, [255, 236, 200, 1]);
  return c;
}

// ---------- Panorama (6 faces 1024×1024) ----------

// Repère : face 0 = devant (-Z), 1 = droite, 2 = derrière, 3 = gauche, 4 = haut, 5 = bas
// (même convention que la capture de panorama de Minecraft : yaw 0/90/180/270 puis pitch -90/+90).
function faceBasis(k) {
  if (k < 4) {
    const t = (k * Math.PI) / 2;
    return { f: [Math.sin(t), 0, -Math.cos(t)], r: [Math.cos(t), 0, Math.sin(t)], u: [0, 1, 0] };
  }
  if (k === 4) return { f: [0, 1, 0], r: [1, 0, 0], u: [0, 0, 1] };
  return { f: [0, -1, 0], r: [1, 0, 0], u: [0, 0, -1] };
}
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
const fromAngles = (azDeg, elDeg) => {
  const a = (azDeg * Math.PI) / 180, e = (elDeg * Math.PI) / 180;
  return [Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)];
};

const MOON_DIR = fromAngles(28, 23);
const MOON_R = 5.2; // degrés
const GALAXY_N = norm([0.42, 0.55, 0.72]);
const ridges = [
  { h: ridge(101, [[3, 1.6], [7, 1.1], [13, 0.8], [29, 0.45], [53, 0.25]]), base: 7.5, azStep: 0.7, hStep: 0.4, color: [54, 44, 112], haze: 0.55 },
  { h: ridge(202, [[2, 1.5], [5, 1.2], [11, 0.9], [23, 0.5], [41, 0.3]]), base: 3.6, azStep: 1.2, hStep: 0.8, color: [32, 26, 74], haze: 0.25 },
  { h: ridge(303, [[2, 4.5], [4, 2.5], [9, 1.4], [17, 0.7], [37, 0.35]]), base: -2.5, azStep: 2.0, hStep: 1.1, color: [16, 13, 40], haze: 0.05, shore: true },
];
const aurora = ridge(404, [[5, 1], [9, 0.7], [17, 0.5], [31, 0.3]]);

function skyColor(d) {
  const el = (Math.asin(clamp(d[1], -1, 1)) * 180) / Math.PI;
  const az = ((Math.atan2(d[0], -d[2]) * 180) / Math.PI + 360) % 360;
  const stops = [[-10, [40, 30, 86]], [0, [70, 50, 128]], [4, [48, 38, 108]], [14, [26, 24, 74]], [38, [12, 13, 42]], [90, [5, 6, 22]]];
  let col = stops[stops.length - 1][1];
  for (let i = 0; i < stops.length - 1; i++)
    if (el <= stops[i + 1][0]) { col = mix(stops[i][1], stops[i + 1][1], smooth(clamp((el - stops[i][0]) / (stops[i + 1][0] - stops[i][0])))); break; }
  // Lueur d'horizon côté lune
  const dAz = Math.min(Math.abs(az - 28), 360 - Math.abs(az - 28));
  const glow = Math.exp(-(dAz ** 2) / (2 * 45 ** 2)) * Math.exp(-Math.max(el, 0) / 9);
  col = col.map((v, i) => v + [70, 52, 110][i] * glow * 0.8);
  // Voie lactée
  const gd = (Math.asin(dot(d, GALAXY_N)) * 180) / Math.PI;
  const band = Math.exp(-(gd ** 2) / (2 * 7 ** 2)) * (0.35 + 0.65 * fbm(d[0] * 6 + 9, d[1] * 6, d[2] * 6, 5));
  const dust = Math.exp(-(gd ** 2) / (2 * 1.6 ** 2)) * fbm(d[0] * 14, d[1] * 14 + 3, d[2] * 14, 4);
  const milky = clamp(band - dust * 0.6) * smoothstep(-2, 14, el);
  col = col.map((v, i) => v + [64, 58, 128][i] * milky * 0.55);
  // Aurore (face opposée à la lune)
  const aDist = Math.min(Math.abs(az - 210), 360 - Math.abs(az - 210));
  if (aDist < 80 && el > 3) {
    const baseEl = 9 + 4 * aurora(az * 0.8);
    const band = smoothstep(-0.2, 0.9, aurora(az * 0.6 + 40));
    const folds = 0.6 + 0.4 * Math.sin(az * 0.35 + 2.2 * Math.sin(az * 0.07));
    const rise = el - baseEl;
    const vertical = rise < 0 ? Math.exp(rise / 0.8) : Math.exp(-rise / 11) + 0.6 * Math.exp(-rise / 1.4);
    const a = clamp(band * folds * vertical * smoothstep(80, 25, aDist) * 0.6);
    const aCol = mix([80, 235, 196], [168, 104, 255], smoothstep(0, 16, rise));
    col = col.map((v, i) => lerp(v, aCol[i], a * 0.6) + aCol[i] * a * 0.25);
  }
  // Lune et halo
  const ang = (Math.acos(clamp(dot(d, MOON_DIR), -1, 1)) * 180) / Math.PI;
  if (ang < MOON_R) {
    const right = norm([MOON_DIR[2] * -1, 0, MOON_DIR[0]]);
    const up = [
      right[1] * MOON_DIR[2] - right[2] * MOON_DIR[1],
      right[2] * MOON_DIR[0] - right[0] * MOON_DIR[2],
      right[0] * MOON_DIR[1] - right[1] * MOON_DIR[0],
    ];
    const lx = (dot(d, right) * 180) / Math.PI / MOON_R, ly = (dot(d, up) * 180) / Math.PI / MOON_R;
    const maria = fbm(lx * 2.2 + 5, ly * 2.2 + 5, 1.7, 5);
    let m = mix([246, 244, 255], [178, 174, 214], smoothstep(0.48, 0.66, maria));
    const craters = noise3(lx * 9, ly * 9, 4.2);
    if (craters > 0.78) m = shade(m, 0.9);
    const limb = Math.sqrt(1 - clamp((ang / MOON_R) ** 2));
    m = shade(m, 0.86 + 0.14 * limb);
    const edge = smoothstep(MOON_R, MOON_R - 0.15, ang);
    col = mix(col, m, edge);
  } else {
    const halo = 0.42 * Math.exp(-(ang - MOON_R) / 2.2) + 0.16 * Math.exp(-(ang - MOON_R) / 14);
    col = col.map((v, i) => v + [200, 192, 255][i] * halo * 0.5);
  }
  return { col, el, az };
}

// Silhouettes de montagnes « en blocs », comme des LOD vues de très loin. Renvoie null hors du relief.
function landColor(el, az, base) {
  let col = null;
  ridges.forEach((layer, idx) => {
    const qa = Math.floor(az / layer.azStep) * layer.azStep;
    const top = Math.floor((layer.base + layer.h(qa)) / layer.hStep) * layer.hStep;
    if (el > top || el < (layer.shore ? -0.8 : 0)) return;
    const depth = clamp((top - el) / 25);
    let c = mix(layer.color, [6, 5, 16], depth * (idx === 2 ? 1 : 0.5));
    c = mix(c, base, layer.haze * smoothstep(-4, top, el) * 0.6);
    const dAz = Math.min(Math.abs(az - 28), 360 - Math.abs(az - 28));
    const lit = Math.max(0, Math.cos((dAz * Math.PI) / 180));
    if (top - el < layer.hStep * 0.35) c = mix(c, [150, 136, 240], 0.22 + 0.3 * lit);
    col = c;
  });
  return col;
}

// Lac : reflet ondulé du ciel et des montagnes, plus une traînée de lune scintillante.
function waterColor(el, az, x, y, k) {
  const depth = -el;
  const ripple = (noise3(az * 0.9, depth * 2.5, 7) - 0.5) * (0.15 + depth * 0.12);
  const elR = Math.max(0.05, depth + ripple);
  const azR = az + (noise3(az * 0.5, depth * 4, 3) - 0.5) * 0.8;
  const sky = skyColor(fromAngles(azR, elR)).col;
  const refl = landColor(elR, azR, sky) ?? sky;
  const fresnel = 0.45 + 0.4 * Math.exp(-depth / 6);
  let col = mix([7, 6, 20], refl, fresnel);
  const dAz = Math.min(Math.abs(az - 28), 360 - Math.abs(az - 28));
  const width = 1.4 + depth * 0.1;
  const streak = Math.exp(-((dAz / width) ** 2)) * Math.exp(-depth / 40);
  if (streak > 0.002) {
    const sparkle = smoothstep(0.5, 0.78, noise3(azR * 2.2, depth * 10, 5));
    col = col.map((v, i) => v + [220, 214, 255][i] * streak * (0.12 + 0.75 * sparkle));
  }
  return col;
}

function makePanorama(size) {
  const faces = [];
  for (let k = 0; k < 6; k++) {
    const { f, r, u } = faceBasis(k);
    const c = new Canvas(size, size);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const px = ((x + 0.5) / size) * 2 - 1, py = ((y + 0.5) / size) * 2 - 1;
        const d = norm([0, 1, 2].map((i) => f[i] + px * r[i] - py * u[i]));
        const { col, el, az } = skyColor(d);
        const dither = (hash3(x, y, k + 31) - 0.5) * 2;
        c.set(x, y, [col[0] + dither, col[1] + dither, col[2] + dither, 1]);
        c.data[(y * size + x) * 4 + 3] = 1;
        // l'élévation et l'azimut sont stockés pour le passage terrain
        c.meta ??= new Float32Array(size * size * 2);
        c.meta[(y * size + x) * 2] = el;
        c.meta[(y * size + x) * 2 + 1] = az;
      }
    faces.push(c);
  }
  // Étoiles : positions aléatoires sur la sphère, projetées sur la bonne face.
  const r = rng(2026);
  const stars = [];
  for (let i = 0; i < 14000; i++) {
    const z = r() * 2 - 1, t = r() * Math.PI * 2;
    const d = [Math.sqrt(1 - z * z) * Math.cos(t), z, Math.sqrt(1 - z * z) * Math.sin(t)];
    const inBand = Math.abs((Math.asin(dot(d, GALAXY_N)) * 180) / Math.PI) < 9;
    if (!inBand && r() < 0.45) continue;
    stars.push({ d, mag: r() ** 3.2, tint: r() });
  }
  for (const s of stars) {
    const el = (Math.asin(s.d[1]) * 180) / Math.PI;
    if (el < -1) continue;
    const ang = (Math.acos(clamp(dot(s.d, MOON_DIR), -1, 1)) * 180) / Math.PI;
    if (ang < MOON_R * 3) continue;
    const vis = smoothstep(-1, 16, el) * (0.25 + 0.75 * s.mag);
    const color = s.tint < 0.15 ? [255, 214, 190] : s.tint < 0.35 ? [190, 210, 255] : [245, 242, 255];
    for (let k = 0; k < 6; k++) {
      const { f, r: rt, u } = faceBasis(k);
      const fd = dot(s.d, f);
      if (fd <= 0) continue;
      const px = dot(s.d, rt) / fd, py = -dot(s.d, u) / fd;
      if (Math.abs(px) > 1 || Math.abs(py) > 1) continue;
      const x = Math.floor(((px + 1) / 2) * size), y = Math.floor(((py + 1) / 2) * size);
      const c = faces[k];
      c.blend(x, y, [...color, vis]);
      if (s.mag > 0.55) {
        const a = vis * 0.45;
        c.blend(x + 1, y, [...color, a]); c.blend(x - 1, y, [...color, a]);
        c.blend(x, y + 1, [...color, a]); c.blend(x, y - 1, [...color, a]);
      }
      if (s.mag > 0.93) sparkle(c, x, y, 3, [...color, vis * 0.8]);
    }
  }
  // Relief et lac par-dessus les étoiles
  faces.forEach((c, k) => {
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        const el = c.meta[i * 2], az = c.meta[i * 2 + 1];
        if (el > 16) continue;
        const land = landColor(el, az, c.get(x, y).slice(0, 3));
        const col = land ?? (el < 0 ? waterColor(el, az, x, y, k) : null);
        if (col) {
          const dither = (hash3(x, y, k + 57) - 0.5) * 2;
          c.set(x, y, [col[0] + dither, col[1] + dither, col[2] + dither, 1]);
        }
      }
  });
  return faces;
}

// ---------- Widgets (sprites d'interface) ----------

// Rectangle « verre de nuit » : contour, coins adoucis, liseré lumineux en haut, ombre en bas.
function panel(w, h, { fill, fill2 = fill, outline, top = [255, 255, 255, 0.1], bottom = [0, 0, 0, 0.3], rounded = true, seed = 1 }) {
  const c = new Canvas(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1;
      const corner = (x === 0 || x === w - 1) && (y === 0 || y === h - 1);
      if (corner && rounded) continue;
      if (edge) { c.set(x, y, outline); continue; }
      const t = h > 2 ? (y - 1) / (h - 3) : 0;
      const n = (hash3(x, y, seed) - 0.5) * 6;
      const col = mix(fill, fill2, t);
      c.set(x, y, [col[0] + n, col[1] + n, col[2] + n, col[3]]);
    }
  if (h > 4) {
    for (let x = 1; x < w - 1; x++) { c.blend(x, 1, top); c.blend(x, h - 2, bottom); }
    if (rounded) { c.blend(1, 1, outline); c.blend(w - 2, 1, outline); c.blend(1, h - 2, outline); c.blend(w - 2, h - 2, outline); }
  }
  return c;
}

const nineSlice = (w, h, border) => JSON.stringify({ gui: { scaling: { type: "nine_slice", width: w, height: h, border } } }, null, 2);

function makeWidgets() {
  const W = join(MC, "textures", "gui", "sprites", "widget");
  const btn = { fill: [34, 32, 80, 0.92], fill2: [18, 17, 46, 0.92], outline: OUTLINE };
  const btnHi = { fill: [74, 60, 160, 0.96], fill2: [40, 32, 100, 0.96], outline: LAVENDER, top: [255, 255, 255, 0.25] };
  const btnOff = { fill: [16, 16, 34, 0.7], fill2: [12, 12, 26, 0.7], outline: [40, 38, 72, 0.9], top: [255, 255, 255, 0.03] };
  const sprites = {
    button: panel(200, 20, btn),
    button_highlighted: panel(200, 20, btnHi),
    button_disabled: panel(200, 20, btnOff),
    slider: panel(200, 20, { fill: [8, 8, 24, 0.88], fill2: [14, 13, 36, 0.88], outline: [44, 40, 96, 1], top: [0, 0, 0, 0.35], bottom: [255, 255, 255, 0.05] }),
    slider_highlighted: panel(200, 20, { fill: [12, 11, 32, 0.92], fill2: [20, 18, 50, 0.92], outline: [122, 110, 220, 1], top: [0, 0, 0, 0.35], bottom: [255, 255, 255, 0.06] }),
    slider_handle: panel(8, 20, { fill: [240, 238, 255, 1], fill2: [170, 162, 228, 1], outline: INK, top: [255, 255, 255, 0.5], bottom: [90, 80, 170, 0.6] }),
    slider_handle_highlighted: panel(8, 20, { fill: [222, 212, 255, 1], fill2: [150, 128, 255, 1], outline: [255, 255, 255, 1], top: [255, 255, 255, 0.6], bottom: [80, 60, 190, 0.6] }),
    text_field: panel(200, 20, { fill: [6, 6, 18, 0.92], outline: [70, 64, 140, 1], top: [0, 0, 0, 0], bottom: [0, 0, 0, 0], rounded: false }),
    text_field_highlighted: panel(200, 20, { fill: [8, 8, 24, 0.95], outline: LAVENDER, top: [0, 0, 0, 0], bottom: [0, 0, 0, 0], rounded: false }),
    scroller: panel(6, 32, { fill: [170, 160, 240, 1], fill2: [120, 108, 210, 1], outline: [52, 44, 120, 1], rounded: false, top: [255, 255, 255, 0.3], bottom: [0, 0, 0, 0.2] }),
    scroller_background: panel(6, 32, { fill: [8, 8, 22, 0.7], outline: [30, 28, 66, 0.9], rounded: false, top: [0, 0, 0, 0], bottom: [0, 0, 0, 0] }),
  };
  // Onglets : pas de bordure basse (ils se collent au contenu)
  const tab = (fill, outline, accent) => {
    const c = panel(130, 25, { fill, fill2: shade(fill, 0.8), outline, top: [255, 255, 255, 0.08], bottom: [0, 0, 0, 0] });
    const out = new Canvas(130, 24);
    for (let y = 0; y < 24; y++) for (let x = 0; x < 130; x++) out.set(x, y, c.get(x, y));
    if (accent) for (let x = 2; x < 128; x++) out.set(x, 1, accent);
    return out;
  };
  sprites.tab = tab([24, 22, 58, 0.85], OUTLINE);
  sprites.tab_highlighted = tab([40, 34, 92, 0.9], [120, 108, 220, 1]);
  sprites.tab_selected = tab([52, 44, 118, 0.95], LAVENDER, MOON_DIM);
  sprites.tab_selected_highlighted = tab([66, 56, 146, 0.97], [220, 212, 255, 1], MOON);

  // Cases à cocher : coche en forme de croissant de lune
  const check = (hi, selected) => {
    const c = panel(20, 20, { fill: hi ? [44, 38, 104, 0.95] : [16, 15, 40, 0.92], outline: hi ? LAVENDER : OUTLINE });
    if (selected)
      for (const [x, y] of crescentMask(10, 10, 6, 5, 3, -2)) c.set(x, y, mix(MOON, MOON_DIM, (y - 4) / 12));
    return c;
  };
  sprites.checkbox = check(false, false);
  sprites.checkbox_highlighted = check(true, false);
  sprites.checkbox_selected = check(false, true);
  sprites.checkbox_selected_highlighted = check(true, true);

  for (const [name, c] of Object.entries(sprites)) save(join(W, `${name}.png`), c);
  const meta = {
    button: nineSlice(200, 20, 3), button_highlighted: nineSlice(200, 20, 3), button_disabled: nineSlice(200, 20, 3),
    slider: nineSlice(200, 20, 3), slider_highlighted: nineSlice(200, 20, 3),
    slider_handle: nineSlice(8, 20, { left: 2, top: 2, right: 2, bottom: 3 }),
    slider_handle_highlighted: nineSlice(8, 20, { left: 2, top: 2, right: 2, bottom: 3 }),
    text_field: nineSlice(200, 20, 1), text_field_highlighted: nineSlice(200, 20, 1),
    scroller: nineSlice(6, 32, 1), scroller_background: nineSlice(6, 32, 1),
    tab: nineSlice(130, 24, { left: 2, top: 2, right: 2, bottom: 0 }),
    tab_highlighted: nineSlice(130, 24, { left: 2, top: 2, right: 2, bottom: 0 }),
    tab_selected: nineSlice(130, 24, { left: 2, top: 2, right: 2, bottom: 0 }),
    tab_selected_highlighted: nineSlice(130, 24, { left: 2, top: 2, right: 2, bottom: 0 }),
  };
  for (const [name, json] of Object.entries(meta)) saveText(join(W, `${name}.png.mcmeta`), json + "\n");
  return sprites;
}

function makeBackgrounds() {
  const G = join(MC, "textures", "gui");
  const flat = (rgba) => new Canvas(16, 16, rgba);
  save(join(G, "menu_background.png"), flat([14, 10, 40, 0.5]));
  save(join(G, "menu_list_background.png"), flat([6, 5, 22, 0.62]));
  save(join(G, "inworld_menu_background.png"), flat([10, 8, 30, 0.4]));
  save(join(G, "inworld_menu_list_background.png"), flat([6, 5, 22, 0.55]));
  const sep = (first, second) => {
    const c = new Canvas(32, 2);
    for (let x = 0; x < 32; x++) { c.set(x, 0, first); c.set(x, 1, second); }
    return c;
  };
  // Voile posé sur le panorama : assombrit le haut (lisibilité du logo) et le bas (boutons).
  const overlay = new Canvas(16, 256);
  for (let y = 0; y < 256; y++) {
    const t = y / 255;
    const a = 0.3 * (1 - smoothstep(0, 0.3, t)) + 0.45 * smoothstep(0.65, 1, t);
    for (let x = 0; x < 16; x++) overlay.set(x, y, [6, 4, 20, a]);
  }
  save(join(G, "title", "background", "panorama_overlay.png"), overlay);
  const glow = [178, 162, 255, 0.55], shadow = [0, 0, 0, 0.7];
  save(join(G, "header_separator.png"), sep(glow, shadow));
  save(join(G, "footer_separator.png"), sep(shadow, glow));
  save(join(G, "inworld_header_separator.png"), sep(glow, shadow));
  save(join(G, "inworld_footer_separator.png"), sep(shadow, glow));
}

// ---------- Icône (512×512, grille 128×128 ×4) ----------

function makeIcon() {
  const n = 128, c = new Canvas(n, n);
  const r = rng(77);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      // coins arrondis (rayon 18)
      const cx = Math.max(18 - x, 0, x - (n - 19)), cy = Math.max(18 - y, 0, y - (n - 19));
      if (Math.hypot(cx, cy) > 18) continue;
      let col = mix([40, 30, 96], [6, 6, 22], smooth(1 - y / n));
      col = mix(col, [74, 54, 140], Math.exp(-(((x - 50) ** 2 + (y - 52) ** 2) / (2 * 30 ** 2))) * 0.6);
      c.set(x, y, [...col, 1]);
    }
  for (let i = 0; i < 70; i++) {
    const x = Math.floor(r() * n), y = Math.floor(r() * 80);
    if (c.get(x, y)[3] > 0) c.blend(x, y, [235, 230, 255, 0.3 + r() * 0.6]);
  }
  sparkle(c, 98, 22, 3, [255, 255, 255, 1]);
  sparkle(c, 108, 50, 2, [214, 204, 255, 1]);
  sparkle(c, 22, 30, 2, [214, 204, 255, 0.9]);
  // Halo + croissant
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const d = Math.hypot(x - 56, y - 52);
      if (d > 30 && d < 50 && c.get(x, y)[3] > 0) c.blend(x, y, [190, 176, 255, 0.22 * (1 - (d - 30) / 20)]);
    }
  drawRockShape(c, crescentMask(56, 52, 30, 25, 15, -9), { depth: 4, seed: 3 });
  // Montagnes en blocs
  const h = ridge(9, [[2, 4], [5, 3], [11, 2]]);
  for (let x = 0; x < n; x++) {
    const qa = Math.floor(x / 4) * 4;
    const top = Math.floor((100 - h((qa / n) * 360) * 1.2) / 2) * 2;
    for (let y = top; y < n; y++) if (c.get(x, y)[3] > 0) c.set(x, y, y === top ? [120, 104, 220, 1] : mix([30, 24, 72, 1], [10, 8, 26, 1], (y - top) / 28));
  }
  return c;
}

// ---------- Splashs ----------

const SPLASHES = `Look how far you can see!
Voxy sees everything!
More FPS than stars!
Moonlight included!
Now with 100% more horizon!
Best played at night!
Go touch the moon!
Render distance: yes!
Chunks? We have plenty!
Made under a full moon!
The mountains are real, I promise!
Your GPU says thanks!
Lag is a myth here!
Pregen before you dream!
Try /voxy import world!
Somewhere out there, a creeper is sleeping!
The far lands send their regards!
Smoother than a fresh ice road!
Press C to zoom!
Press M for the map!
The moon is made of glowstone!
Bring snacks, it's a long view!
One small step for Steve!
Night mode: always on!
Built by a human, tested by a cat!
Have you looked up lately?
Lithium, Sodium, Lunium!
Ninety FPS before breakfast!
Don't stare at the moon too long!
Fresh animations, finally fixed!
Hear that? That's a cave!
Sounds better with headphones!
Your inventory is sorted now!
Graves keep your stuff safe!
Day one, again!
Coordinates? Top left!
Sleep is for the phantoms!
Brighter than a beacon!
From here to the world border!
Somebody turn the stars down!
Ninety-six chunks and counting!
Wake up, the sun is rising!
Pixel by pixel, all the way out!
Clouds got an upgrade!
Leaves fall, frames don't!
Footsteps that actually sound like footsteps!
Hello from the other side of the map!
It runs on a potato!
Now playing: your adventure!
Big world, tiny lag!
Still loading? Nope!
The view is the reward!
Every sunset is a screenshot!
Lunar approved!
Built for explorers!
Ready when you are!
`;

// ---------- Génération ----------

console.log("Logo et sous-titre…");
const logo = makeLogo();
save(join(MC, "textures", "gui", "title", "minecraft.png"), logo.upscale(4));
save(join(MC, "textures", "gui", "title", "minceraft.png"), logo.upscale(4));
save(join(MC, "textures", "gui", "title", "edition.png"), makeSubtitle("Beyond the horizon").upscale(4));
save(join(OUT, "logo.png"), logo.upscale(4));

console.log("Widgets et fonds de menus…");
const sprites = makeWidgets();
makeBackgrounds();

console.log("Icône…");
const icon = makeIcon();
save(join(OUT, "icon.png"), icon.upscale(4));
save(join(ROOT, "luna-ui", "assets", "luna_ui", "icon.png"), icon);

console.log("Splashs…");
saveText(join(MC, "texts", "splashes.txt"), SPLASHES);

// Panorama : de préférence le vrai panorama 3D capturé en jeu (branding/panorama/, voir README),
// sinon le décor procédural.
const PANO = join(ROOT, "branding", "panorama");
const panoOut = (i) => join(MC, "textures", "gui", "title", "background", `panorama_${i}.png`);
let faces;
if ([0, 1, 2, 3, 4, 5].every((i) => existsSync(join(PANO, `panorama_${i}.png`)))) {
  console.log("Panorama 3D capturé en jeu…");
  faces = [0, 1, 2, 3, 4, 5].map((i) => {
    copyFileSync(join(PANO, `panorama_${i}.png`), panoOut(i));
    return decodePng(readFileSync(join(PANO, `panorama_${i}.png`)));
  });
} else {
  console.log("Panorama procédural (6 × 1024², quelques secondes)…");
  faces = makePanorama(1024);
  faces.forEach((f, i) => save(panoOut(i), f));
}

// Aperçu des boutons pour vérification visuelle
const preview = new Canvas(220, 110, [20, 18, 46, 1]);
const blit = (src, ox, oy) => { for (let y = 0; y < src.height; y++) for (let x = 0; x < src.width; x++) preview.blend(ox + x, oy + y, src.get(x, y)); };
blit(sprites.button, 10, 6); blit(sprites.button_highlighted, 10, 30); blit(sprites.button_disabled, 10, 54);
blit(sprites.slider, 10, 80); blit(sprites.slider_handle, 70, 80);
save(join(OUT, "widgets-preview.png"), preview.upscale(4));
// Panorama déplié (croix) pour vérifier les raccords
const s = 256, cross = new Canvas(s * 4, s * 3, [0, 0, 0, 1]);
const place = (face, ox, oy) => { for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) cross.set(ox + x, oy + y, face.get(x * 4, y * 4)); };
[3, 0, 1, 2].forEach((k, i) => place(faces[k], i * s, s));
place(faces[4], s, 0);
place(faces[5], s, 2 * s);
save(join(OUT, "panorama-cross.png"), cross);
console.log("✔ Identité visuelle générée");
