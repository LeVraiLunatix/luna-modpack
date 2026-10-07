// Construit dist/<name>-<version>.mrpack à partir de pack.config.json.
// Résout chaque mod sur Modrinth pour la version de MC visée, suit les dépendances
// (les versions épinglées sur Modrinth ne sont que des indications : ce sont les
// fabric.mod.json qui font foi), télécharge les jars pour vérifier les hashs
// et contrôle les "depends"/"breaks" de chaque fabric.mod.json avant d'emballer.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { readZip, writeZip } from "./lib/zip.mjs";

const ROOT = import.meta.dirname;
const config = JSON.parse(readFileSync(join(ROOT, "pack.config.json"), "utf8"));
const CACHE = join(ROOT, ".cache");
const DIST = join(ROOT, "dist");
const API = "https://api.modrinth.com/v2";
const UA = { headers: { "User-Agent": "LeVraiLunatix/luna-modpack (build script)" } };
const JAVA_VERSION = "25";

async function api(path) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(API + path, UA);
    if (res.status === 429 && attempt < 5) {
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      continue;
    }
    if (!res.ok) throw new Error(`Modrinth ${res.status} sur ${path}`);
    return res.json();
  }
}

// ---------- Versions façon Fabric (SemVer souple) ----------

function parseVersion(s) {
  const noBuild = String(s).split("+")[0];
  const dash = noBuild.indexOf("-");
  const core = dash === -1 ? noBuild : noBuild.slice(0, dash);
  const pre = dash === -1 ? null : noBuild.slice(dash + 1);
  if (!/^\d+(\.\d+)*$/.test(core)) return null;
  return { core: core.split(".").map(Number), pre };
}

function compareVersions(a, b) {
  const len = Math.max(a.core.length, b.core.length);
  for (let i = 0; i < len; i++) {
    const d = (a.core[i] ?? 0) - (b.core[i] ?? 0);
    if (d) return Math.sign(d);
  }
  if (a.pre === b.pre) return 0;
  if (a.pre === null) return 1;
  if (b.pre === null) return -1;
  const pa = a.pre.split("."), pb = b.pre.split(".");
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if (pa[i] === undefined) return -1;
    if (pb[i] === undefined) return 1;
    const na = /^\d+$/.test(pa[i]), nb = /^\d+$/.test(pb[i]);
    if (na && nb && +pa[i] !== +pb[i]) return Math.sign(pa[i] - pb[i]);
    if (na !== nb) return na ? -1 : 1;
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

// Renvoie true/false, ou null si la version ou le prédicat ne sont pas analysables.
function satisfies(version, predicate) {
  if (Array.isArray(predicate)) {
    const results = predicate.map((p) => satisfies(version, p));
    if (results.includes(true)) return true;
    return results.includes(null) ? null : false;
  }
  const v = parseVersion(version);
  for (let term of String(predicate).trim().split(/\s+/)) {
    if (term === "*" || term === "") continue;
    const m = term.match(/^(>=|<=|>|<|=|~|\^)?(.*)$/);
    let op = m[1] ?? "=", target = m[2];
    if (/\.(x|X|\*)$/.test(target)) { op = "~"; target = target.replace(/\.(x|X|\*)$/, ""); }
    const t = parseVersion(target);
    if (!v || !t) {
      if (op === "=" && String(version) === target) continue;
      return null;
    }
    const c = compareVersions(v, t);
    let ok;
    switch (op) {
      case ">=": ok = c >= 0; break;
      case "<=": ok = c <= 0; break;
      case ">": ok = c > 0; break;
      case "<": ok = c < 0; break;
      case "=": ok = c === 0 || (t.core.length < v.core.length && !t.pre && t.core.every((n, i) => n === v.core[i])); break;
      case "~": ok = c >= 0 && t.core.slice(0, Math.min(2, t.core.length)).every((n, i) => n === v.core[i]); break;
      case "^": ok = c >= 0 && v.core[0] === t.core[0]; break;
    }
    if (!ok) return false;
  }
  return true;
}

// ---------- Résolution Modrinth ----------

const TYPE_RANK = { release: 0, beta: 1, alpha: 2 };
const projects = new Map(); // id -> projet Modrinth
const candidates = new Map(); // id -> versions compatibles triées
const wanted = new Set(); // ids à inclure

async function loadProject(idOrSlug) {
  const p = await api(`/project/${idOrSlug}`);
  projects.set(p.id, p);
  if (!candidates.has(p.id)) {
    const q = `loaders=${encodeURIComponent('["fabric"]')}&game_versions=${encodeURIComponent(JSON.stringify([config.minecraft]))}`;
    const versions = await api(`/project/${p.id}/version?${q}`);
    versions.sort((a, b) => TYPE_RANK[a.version_type] - TYPE_RANK[b.version_type] || b.date_published.localeCompare(a.date_published));
    candidates.set(p.id, versions);
  }
  return p;
}

function pick(id) {
  const list = candidates.get(id);
  if (!list.length) throw new Error(`${projects.get(id).slug} : aucune version Fabric pour ${config.minecraft}`);
  return list[0];
}

const configured = new Map();
for (const mod of config.mods) {
  const p = await loadProject(mod.slug);
  wanted.add(p.id);
  configured.set(p.id, mod);
}

// Ajoute les dépendances requises jusqu'à stabilisation.
for (let changed = true; changed; ) {
  changed = false;
  for (const id of [...wanted]) {
    for (const dep of pick(id).dependencies) {
      if (dep.dependency_type === "incompatible") continue;
      if (dep.dependency_type !== "required") continue;
      let depId = dep.project_id;
      if (!depId && dep.version_id) depId = (await api(`/version/${dep.version_id}`)).project_id;
      if (!depId) continue;
      if (!projects.has(depId)) await loadProject(depId);
      if (!wanted.has(depId)) { wanted.add(depId); changed = true; }
    }
  }
}

const chosen = [...wanted].map((id) => ({ project: projects.get(id), version: pick(id), mod: configured.get(id) }));
chosen.sort((a, b) => a.project.slug.localeCompare(b.project.slug));

const problems = [];
const warnings = [];
for (const { project, version } of chosen) {
  for (const dep of version.dependencies) {
    if (dep.dependency_type === "incompatible" && dep.project_id && wanted.has(dep.project_id))
      problems.push(`${project.slug} est déclaré incompatible avec ${projects.get(dep.project_id).slug}`);
  }
  if (version.version_type !== "release") warnings.push(`${project.slug} ${version.version_number} est en ${version.version_type}`);
}

// ---------- Téléchargement + vérification des jars ----------

mkdirSync(CACHE, { recursive: true });
const provided = new Map(); // modid -> version
const requirements = []; // { from, kind, id, predicate }

// Comme Fabric Loader : si plusieurs jars fournissent le même id, la version la plus haute gagne.
function provide(id, version) {
  const current = provided.get(id);
  const a = parseVersion(version), b = current === undefined ? null : parseVersion(current);
  if (current === undefined || (a && b && compareVersions(a, b) > 0)) provided.set(id, version);
}

function scanJar(buf, owner, depth = 0) {
  const zip = readZip(buf);
  const fmj = zip.get("fabric.mod.json");
  if (!fmj) return;
  const meta = JSON.parse(fmj().toString("utf8").replace(/^﻿/, "").replace(/[\u0000-\u001f]+/g, " "));
  provide(meta.id, meta.version);
  for (const alias of meta.provides ?? []) provide(alias, meta.version);
  const label = depth ? `${owner} (embarque ${meta.id})` : owner;
  for (const [kind, table] of [["depends", meta.depends], ["breaks", meta.breaks]])
    for (const [id, predicate] of Object.entries(table ?? {})) requirements.push({ from: label, kind, id, predicate });
  for (const nested of meta.jars ?? []) {
    const entry = zip.get(nested.file);
    if (entry) scanJar(entry(), owner, depth + 1);
  }
}

const files = [];
for (const { project, version } of chosen) {
  const file = version.files.find((f) => f.primary) ?? version.files[0];
  const cached = join(CACHE, `${file.hashes.sha1}.jar`);
  let buf;
  if (existsSync(cached)) buf = readFileSync(cached);
  else {
    const res = await fetch(file.url, UA);
    if (!res.ok) throw new Error(`téléchargement ${file.url} : ${res.status}`);
    buf = Buffer.from(await res.arrayBuffer());
  }
  const sha1 = createHash("sha1").update(buf).digest("hex");
  const sha512 = createHash("sha512").update(buf).digest("hex");
  if (sha1 !== file.hashes.sha1 || sha512 !== file.hashes.sha512) throw new Error(`hash invalide pour ${file.filename}`);
  if (!existsSync(cached)) writeFileSync(cached, buf);
  scanJar(buf, project.slug);

  const server = project.server_side === "unsupported" ? "unsupported" : project.server_side === "required" ? "required" : "optional";
  files.push({
    path: `mods/${file.filename}`,
    hashes: { sha1, sha512 },
    env: { client: "required", server },
    downloads: [file.url],
    fileSize: buf.length,
  });
}

provided.set("minecraft", config.minecraft);
provided.set("fabricloader", config.fabricLoader);
provided.set("java", JAVA_VERSION);

for (const { from, kind, id, predicate } of requirements) {
  const have = provided.get(id);
  if (kind === "depends") {
    if (have === undefined) { problems.push(`${from} requiert ${id} ${JSON.stringify(predicate)} : absent`); continue; }
    const ok = satisfies(have, predicate);
    if (ok === false) problems.push(`${from} requiert ${id} ${JSON.stringify(predicate)} : présent en ${have}`);
    if (ok === null) warnings.push(`${from} → ${id} ${JSON.stringify(predicate)} : impossible de comparer avec ${have}, à vérifier en jeu`);
  } else if (have !== undefined) {
    const hit = satisfies(have, predicate);
    if (hit === true) problems.push(`${from} est incompatible avec ${id} ${have} (breaks ${JSON.stringify(predicate)})`);
    if (hit === null) warnings.push(`${from} breaks ${id} ${JSON.stringify(predicate)} : impossible de comparer avec ${have}`);
  }
}

// ---------- Rapport ----------

console.log(`\n${config.name} ${config.version} — Minecraft ${config.minecraft}, Fabric Loader ${config.fabricLoader}\n`);
for (const { project, version, mod } of chosen)
  console.log(`  ${project.slug.padEnd(26)} ${version.version_number.padEnd(36)} ${mod ? "" : "(dépendance)"}`);
for (const w of warnings) console.log(`  ⚠ ${w}`);
if (problems.length) {
  console.error("\nÉchec :");
  for (const p of problems) console.error(`  ✖ ${p}`);
  process.exit(1);
}

// ---------- Emballage ----------

const index = {
  formatVersion: 1,
  game: "minecraft",
  versionId: config.version,
  name: config.name,
  summary: config.summary,
  files,
  dependencies: { minecraft: config.minecraft, "fabric-loader": config.fabricLoader },
};

const zipFiles = [{ name: "modrinth.index.json", data: Buffer.from(JSON.stringify(index, null, 2)) }];
const overrides = join(ROOT, "overrides");
const walk = (dir) => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
if (existsSync(overrides))
  for (const f of walk(overrides)) zipFiles.push({ name: relative(ROOT, f).split(sep).join("/"), data: readFileSync(f) });

mkdirSync(DIST, { recursive: true });
const out = join(DIST, `${config.name}-${config.version}.mrpack`);
writeFileSync(out, writeZip(zipFiles));

const table = chosen
  .map(({ project, version, mod }) => `| [${project.title}](https://modrinth.com/mod/${project.slug}) | ${version.version_number} | ${mod?.why ?? "Dépendance"} |`)
  .join("\n");
writeFileSync(
  join(ROOT, "MODS.md"),
  `# Mods de ${config.name} ${config.version}\n\nMinecraft ${config.minecraft} · Fabric Loader ${config.fabricLoader} · ${chosen.length} mods\n\n| Mod | Version | Rôle |\n|---|---|---|\n${table}\n`,
);
console.log(`\n✔ ${relative(ROOT, out)} (${chosen.length} mods)`);
