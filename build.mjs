// Construit les modpacks LUNA à partir de pack.config.json, pour chaque version de Minecraft
// (« targets ») et chaque édition (full, lite), plus un pack serveur par version :
//   dist/LUNA-<ver>+<mc>.mrpack, dist/LUNA-Lite-<ver>+<mc>.mrpack, dist/LUNA-Server-<ver>+<mc>.zip
//
//   node build.mjs                         tout
//   node build.mjs --mc 26.2 --edition full   une seule combinaison (options répétables / séparées par des virgules)
//   node build.mjs --no-server              sans les packs serveur
//
// Chaque mod est résolu sur Modrinth pour la version visée (release en priorité, ou version épinglée dans
// targets.<mc>.pin), les dépendances requises sont ajoutées, les jars téléchargés pour vérifier leurs hashs,
// et les « depends »/« breaks » de chaque fabric.mod.json (jars embarqués compris) sont contrôlés : les
// versions épinglées dans les métadonnées Modrinth ne sont que des indications, ce sont les fabric.mod.json
// qui font foi.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";
import { inflateRawSync } from "node:zlib";
import { compareVersions, parseVersion, satisfies } from "./lib/semver.mjs";
import { readZip, writeZip } from "./lib/zip.mjs";

const ROOT = import.meta.dirname;
const config = JSON.parse(readFileSync(join(ROOT, "pack.config.json"), "utf8"));
const CACHE = join(ROOT, ".cache");
const DIST = join(ROOT, "dist");
const API = "https://api.modrinth.com/v2";
const UA = { headers: { "User-Agent": "LeVraiLunatix/luna-modpack (build script)" } };
const JAVA_VERSION = "25";
const TYPE_RANK = { release: 0, beta: 1, alpha: 2 };

// ---------- Ligne de commande ----------

function option(name) {
  const values = [];
  process.argv.forEach((a, i) => a === `--${name}` && process.argv[i + 1] && values.push(...process.argv[i + 1].split(",")));
  return values;
}
const TARGETS = option("mc").length ? option("mc") : Object.keys(config.targets);
const EDITIONS = option("edition").length ? option("edition") : Object.keys(config.editions);
const WITH_SERVER = !process.argv.includes("--no-server");
const VERBOSE = process.argv.includes("--verbose");
for (const mc of TARGETS) if (!config.targets[mc]) throw new Error(`version inconnue : ${mc}`);

// ---------- Accès réseau (avec cache) ----------

const apiCache = new Map();
function api(path) {
  if (!apiCache.has(path))
    apiCache.set(path, (async () => {
      for (let attempt = 0; ; attempt++) {
        const res = await fetch(API + path, UA);
        if (res.status === 429 && attempt < 6) {
          await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
          continue;
        }
        if (!res.ok) throw new Error(`Modrinth ${res.status} sur ${path}`);
        return res.json();
      }
    })());
  return apiCache.get(path);
}

mkdirSync(CACHE, { recursive: true });

async function download(url, cacheName) {
  const cached = join(CACHE, cacheName);
  if (existsSync(cached)) return readFileSync(cached);
  const res = await fetch(url, UA);
  if (!res.ok) throw new Error(`téléchargement ${url} : ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(cached, buf);
  return buf;
}

// Télécharge (ou relit depuis le cache) le fichier principal d'une version et vérifie ses hashs.
async function fetchVerified(version) {
  const file = version.files.find((f) => f.primary) ?? version.files[0];
  const ext = file.filename.slice(file.filename.lastIndexOf("."));
  const buf = await download(file.url, `${file.hashes.sha1}${ext}`);
  const sha1 = createHash("sha1").update(buf).digest("hex");
  const sha512 = createHash("sha512").update(buf).digest("hex");
  if (sha1 !== file.hashes.sha1 || sha512 !== file.hashes.sha512) throw new Error(`hash invalide pour ${file.filename}`);
  return { file, buf, sha1, sha512 };
}

// ---------- Analyse des fabric.mod.json ----------

// side = "client" ou "server" : un jar déclaré pour l'autre côté n'est jamais chargé (ex. le faux « sodium »
// serveur embarqué dans Voxy), on l'ignore donc comme le fait Fabric Loader.
function newScan(side = "client") {
  return { side, provided: new Map(), requirements: [], environments: new Map() };
}

// Comme Fabric Loader : si plusieurs jars fournissent le même id, la version la plus haute gagne.
function provide(scan, id, version) {
  const current = scan.provided.get(id);
  const a = parseVersion(version), b = current === undefined ? null : parseVersion(current);
  if (current === undefined || (a && b && compareVersions(a, b) > 0)) scan.provided.set(id, version);
}

function scanJar(scan, buf, owner, depth = 0) {
  const zip = readZip(buf);
  const fmj = zip.get("fabric.mod.json");
  if (!fmj) return null;
  const meta = JSON.parse(fmj().toString("utf8").replace(/^﻿/, "").replace(/[\u0000-\u001f]+/g, " "));
  if (!depth) scan.environments.set(owner, meta.environment ?? "*");
  if (meta.environment && meta.environment !== "*" && meta.environment !== scan.side) return meta;
  provide(scan, meta.id, meta.version);
  for (const alias of meta.provides ?? []) provide(scan, alias, meta.version);
  const label = depth ? `${owner} (embarque ${meta.id})` : owner;
  for (const [kind, table] of [["depends", meta.depends], ["breaks", meta.breaks]])
    for (const [id, predicate] of Object.entries(table ?? {})) scan.requirements.push({ owner, from: label, kind, id, predicate });
  for (const nested of meta.jars ?? []) {
    const entry = zip.get(nested.file);
    if (entry) scanJar(scan, entry(), owner, depth + 1);
  }
  return meta;
}

function checkRequirements(scan, mc, loader, problems, warnings) {
  scan.provided.set("minecraft", mc);
  scan.provided.set("fabricloader", loader);
  scan.provided.set("java", JAVA_VERSION);
  for (const { from, kind, id, predicate } of scan.requirements) {
    const have = scan.provided.get(id);
    if (kind === "depends") {
      if (have === undefined) { problems.push(`${from} requiert ${id} ${JSON.stringify(predicate)} : absent`); continue; }
      const ok = satisfies(have, predicate);
      if (ok === false) problems.push(`${from} requiert ${id} ${JSON.stringify(predicate)} : présent en ${have}`);
      if (ok === null) warnings.push(`${from} → ${id} ${JSON.stringify(predicate)} : impossible de comparer avec ${have}`);
    } else if (have !== undefined) {
      const hit = satisfies(have, predicate);
      if (hit === true) problems.push(`${from} est incompatible avec ${id} ${have} (breaks ${JSON.stringify(predicate)})`);
      if (hit === null) warnings.push(`${from} breaks ${id} ${JSON.stringify(predicate)} : impossible de comparer avec ${have}`);
    }
  }
}

// ---------- Résolution des mods ----------

async function fabricVersions(projectId, mc) {
  const q = `loaders=${encodeURIComponent('["fabric"]')}&game_versions=${encodeURIComponent(JSON.stringify([mc]))}`;
  const list = [...(await api(`/project/${projectId}/version?${q}`))];
  return list.sort((a, b) => TYPE_RANK[a.version_type] - TYPE_RANK[b.version_type] || b.date_published.localeCompare(a.date_published));
}

async function resolveMods(mc, list, pins, problems, warnings) {
  const projects = new Map(), versions = new Map(), configured = new Map(), wanted = new Set();
  async function load(idOrSlug) {
    const p = await api(`/project/${idOrSlug}`);
    projects.set(p.id, p);
    if (!versions.has(p.id)) versions.set(p.id, await fabricVersions(p.id, mc));
    return p;
  }
  function pick(id) {
    const p = projects.get(id), list = versions.get(id);
    const pin = pins[p.slug];
    if (pin) {
      const v = list.find((x) => x.version_number === pin || x.id === pin);
      if (!v) throw new Error(`${p.slug} : version épinglée ${pin} introuvable pour ${mc}`);
      return v;
    }
    return list[0];
  }
  for (const mod of list) {
    const p = await load(mod.slug);
    if (!versions.get(p.id).length) { warnings.push(`${mod.slug} n'existe pas pour ${mc} : ignoré`); continue; }
    wanted.add(p.id);
    configured.set(p.id, mod);
  }
  for (let changed = true; changed; ) {
    changed = false;
    for (const id of [...wanted])
      for (const dep of pick(id).dependencies) {
        if (dep.dependency_type !== "required") continue;
        let depId = dep.project_id;
        if (!depId && dep.version_id) depId = (await api(`/version/${dep.version_id}`)).project_id;
        if (!depId || wanted.has(depId)) continue;
        await load(depId);
        if (!versions.get(depId).length) { problems.push(`${projects.get(id).slug} requiert ${projects.get(depId).slug}, absent pour ${mc}`); continue; }
        wanted.add(depId);
        changed = true;
      }
  }
  const chosen = [...wanted].map((id) => ({ project: projects.get(id), version: pick(id), mod: configured.get(id) }));
  chosen.sort((a, b) => a.project.slug.localeCompare(b.project.slug));
  for (const { project, version } of chosen) {
    for (const dep of version.dependencies)
      if (dep.dependency_type === "incompatible" && dep.project_id && wanted.has(dep.project_id))
        problems.push(`${project.slug} est déclaré incompatible avec ${projects.get(dep.project_id).slug}`);
    if (version.version_type !== "release") warnings.push(`${project.slug} ${version.version_number} est en ${version.version_type}`);
  }
  return chosen;
}

// Packs de ressources et shaders : version épinglée si elle couvre cette version de MC, sinon la plus récente
// qui la couvre, sinon la version épinglée quand même (le jeu la signale juste comme « faite pour une autre version »).
async function resolveAsset(entry, loaders, mc, warnings) {
  const project = await api(`/project/${entry.slug}`);
  const pinned = entry.version ? await api(`/version/${entry.version}`) : null;
  let version = pinned?.game_versions.includes(mc) ? pinned : null;
  if (!version) {
    const q = `loaders=${encodeURIComponent(JSON.stringify(loaders))}&game_versions=${encodeURIComponent(JSON.stringify([mc]))}`;
    const list = [...(await api(`/project/${project.id}/version?${q}`))];
    list.sort((a, b) => TYPE_RANK[a.version_type] - TYPE_RANK[b.version_type] || b.date_published.localeCompare(a.date_published));
    version = list[0] ?? pinned;
    if (!list[0] && pinned) warnings.push(`${entry.slug} : aucune version déclarée pour ${mc}, version ${pinned.version_number} gardée`);
    if (!version) { warnings.push(`${entry.slug} : aucune version pour ${mc}, ignoré`); return null; }
  }
  return { entry, project, version, ...(await fetchVerified(version)) };
}

// ---------- LUNA UI ----------

const walk = (dir) => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
const UI = join(ROOT, "luna-ui");
const uiAssets = walk(join(UI, "assets")).map((f) => ({ name: relative(UI, f).split(sep).join("/"), data: readFileSync(f) }));

function uiJar(mc) {
  const fmj = readFileSync(join(UI, "fabric.mod.json"), "utf8").replace("${version}", config.version).replace("${minecraft}", `~${mc}`);
  return writeZip([{ name: "fabric.mod.json", data: Buffer.from(fmj) }, ...uiAssets]);
}

// Le thème existe aussi en pack de ressources placé tout en haut de la liste : il passe ainsi devant
// les packs d'interface (Default Dark Mode…) là où ils se chevauchent.
const UI_PACK = "LUNA UI.zip";
function uiPack(info) {
  // Depuis la 1.21.9, pack.mcmeta décrit les formats avec min_format/max_format ; avant, avec pack_format.
  const formats = info.newPackFormat ? { min_format: info.packFormat, max_format: info.packFormat } : { pack_format: info.packFormat };
  return writeZip([
    { name: "pack.mcmeta", data: Buffer.from(JSON.stringify({ pack: { ...formats, description: `§dLUNA §7${config.version} — theme` } }, null, 2)) },
    { name: "pack.png", data: readFileSync(join(UI, "assets", "luna_ui", "icon.png")) },
    ...uiAssets,
  ]);
}

// Version de données (ligne « version » d'options.txt) et format des packs de ressources d'une version de
// Minecraft, lus dans le version.json du jar client. Grâce aux requêtes partielles (Range), on ne télécharge
// que la fin du jar (son sommaire) et ce seul fichier, pas les ~30 Mo du jar. Résultats mis en cache.
const VERSIONS_CACHE = join(CACHE, "minecraft-versions.json");
async function versionInfo(mc) {
  const cache = existsSync(VERSIONS_CACHE) ? JSON.parse(readFileSync(VERSIONS_CACHE, "utf8")) : {};
  if (cache[mc]) return cache[mc];
  const manifest = await (await fetch("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json", UA)).json();
  const meta = await (await fetch(manifest.versions.find((v) => v.id === mc).url, UA)).json();
  const { url, size } = meta.downloads.client;
  const range = async (from, to) => Buffer.from(await (await fetch(url, { headers: { ...UA.headers, Range: `bytes=${from}-${to}` } })).arrayBuffer());
  const tail = await range(Math.max(0, size - 65558), size - 1);
  let e = tail.length - 22;
  while (e >= 0 && tail.readUInt32LE(e) !== 0x06054b50) e--;
  const cdSize = tail.readUInt32LE(e + 12), cdOffset = tail.readUInt32LE(e + 16);
  const cd = await range(cdOffset, cdOffset + cdSize - 1);
  let entry = null;
  for (let p = 0; p < cd.length; ) {
    const nameLen = cd.readUInt16LE(p + 28), extra = cd.readUInt16LE(p + 30), comment = cd.readUInt16LE(p + 32);
    if (cd.toString("utf8", p + 46, p + 46 + nameLen) === "version.json") {
      entry = { method: cd.readUInt16LE(p + 10), size: cd.readUInt32LE(p + 20), offset: cd.readUInt32LE(p + 42) };
      break;
    }
    p += 46 + nameLen + extra + comment;
  }
  const local = await range(entry.offset, entry.offset + 30 + 1024 + entry.size);
  const start = 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
  const raw = local.subarray(start, start + entry.size);
  const json = JSON.parse((entry.method === 0 ? raw : inflateRawSync(raw)).toString("utf8"));
  const pv = json.pack_version;
  cache[mc] = {
    dataVersion: json.world_version,
    packFormat: typeof pv === "object" ? (pv.resource_major ?? pv.resource) : pv,
    newPackFormat: typeof pv === "object" && "resource_major" in pv,
  };
  writeFileSync(VERSIONS_CACHE, JSON.stringify(cache, null, 2));
  return cache[mc];
}

// ---------- Une édition pour une version ----------

// full = tout ; lite = éléments marqués lite ; une édition « inherit » reprend ceux d'une autre (moins « exclude »)
// et ajoute ses propres éléments (marqués du nom de l'édition, ex. perf: true).
// L'héritage est en chaîne (vulkan → perf → lite) : les exclusions, réglages et dossiers d'overrides s'accumulent
// de l'ancêtre vers l'édition, la plus proche l'emportant.
const lineage = (edition) => {
  const chain = [];
  for (let e = edition; e; e = config.editions[e]?.inherit) chain.unshift(e);
  return chain;
};
const inEdition = (edition) => (item) => {
  if (edition === "full") return true;
  const chain = lineage(edition);
  if (chain.some((e) => config.editions[e]?.exclude?.includes(item.slug))) return false;
  return chain.some((e) => item[e] === true);
};

async function buildEdition(mc, edition) {
  const target = config.targets[mc];
  const meta = config.editions[edition];
  const problems = [], warnings = [];
  const full = edition === "full";
  const chosen = await resolveMods(mc, config.mods.filter(inEdition(edition)), target.pin ?? {}, problems, warnings);

  const scan = newScan();
  const files = [];
  for (const { project, version } of chosen) {
    const { file, buf, sha1, sha512 } = await fetchVerified(version);
    scanJar(scan, buf, project.slug);
    const server = project.server_side === "unsupported" ? "unsupported" : project.server_side === "required" ? "required" : "optional";
    files.push({ path: `mods/${file.filename}`, hashes: { sha1, sha512 }, env: { client: "required", server }, downloads: [file.url], fileSize: buf.length });
  }

  const ui = uiJar(mc);
  scanJar(scan, ui, "luna-ui");
  const localMods = [];
  for (const m of (config.localMods ?? []).filter(inEdition(edition))) {
    const rel = m.files[mc];
    if (!rel) { warnings.push(`${m.name} n'a pas de build pour ${mc} : ignoré`); continue; }
    const buf = readFileSync(join(ROOT, rel));
    scanJar(scan, buf, m.name);
    localMods.push({ ...m, filename: basename(rel), buf });
  }

  const resourcepacks = [], shaders = [];
  if (full) {
    for (const e of config.resourcepacks ?? []) { const r = await resolveAsset(e, ["minecraft"], mc, warnings); if (r) resourcepacks.push(r); }
    for (const e of config.shaders ?? []) { const r = await resolveAsset(e, ["iris"], mc, warnings); if (r) shaders.push(r); }
    for (const [list, dir] of [[resourcepacks, "resourcepacks"], [shaders, "shaderpacks"]])
      for (const { file, buf, sha1, sha512 } of list)
        files.push({ path: `${dir}/${file.filename}`, hashes: { sha1, sha512 }, env: { client: "required", server: "unsupported" }, downloads: [file.url], fileSize: buf.length });
  }

  checkRequirements(scan, mc, target.fabricLoader, problems, warnings);

  const index = {
    formatVersion: 1,
    game: "minecraft",
    versionId: `${config.version}+${mc}`,
    name: meta.name,
    summary: meta.summary,
    files,
    dependencies: { minecraft: mc, "fabric-loader": target.fabricLoader },
  };
  const zipFiles = [
    { name: "modrinth.index.json", data: Buffer.from(JSON.stringify(index, null, 2)) },
    { name: `overrides/mods/luna-ui-${config.version}.jar`, data: ui },
    ...localMods.map((m) => ({ name: `overrides/mods/${m.filename}`, data: m.buf })),
  ];
  const info = await versionInfo(mc);
  if (full) zipFiles.push({ name: `overrides/resourcepacks/${UI_PACK}`, data: uiPack(info) });

  // Réglages appliqués par Default Options au tout premier lancement seulement (jamais écrasés ensuite).
  // La ligne « version » est indispensable : sans elle, Minecraft prend le fichier pour un très vieux format,
  // tente de le convertir, échoue (« Failed to load options ») et repart des réglages d'usine.
  const lines = [`version:${target.dataVersion ?? info.dataVersion}`, ...Object.entries(Object.assign({}, config.defaultOptions, ...lineage(edition).map((e) => config.editions[e]?.options))).map(([k, v]) => `${k}:${v}`)];
  if (full) {
    const enabled = ["vanilla", ...resourcepacks.filter((p) => p.entry.enabled !== false).map((p) => `file/${p.file.filename}`), `file/${UI_PACK}`];
    const incompatible = resourcepacks.filter((p) => p.entry.incompatible || !p.version.game_versions.includes(mc)).map((p) => `file/${p.file.filename}`);
    lines.push(`resourcePacks:${JSON.stringify(enabled)}`, `incompatibleResourcePacks:${JSON.stringify(incompatible)}`);
  }
  zipFiles.push({ name: "overrides/config/defaultoptions/options.txt", data: Buffer.from(lines.join("\n") + "\n") });

  const overrides = join(ROOT, "overrides");
  if (existsSync(overrides))
    for (const f of walk(overrides)) zipFiles.push({ name: relative(ROOT, f).split(sep).join("/"), data: readFileSync(f) });
  // Réglages propres à une édition (ex. overrides-perf/ → overrides/ du .mrpack), qui l'emportent sur les communs.
  for (const dir of lineage(edition).map((e) => config.editions[e]?.overrides).filter((d) => d && existsSync(join(ROOT, d))))
    for (const f of walk(join(ROOT, dir))) {
      const name = "overrides/" + relative(join(ROOT, dir), f).split(sep).join("/");
      const i = zipFiles.findIndex((z) => z.name === name);
      if (i >= 0) zipFiles.splice(i, 1);
      zipFiles.push({ name, data: readFileSync(f) });
    }

  const out = join(DIST, `${meta.file}-${config.version}+${mc}.mrpack`);
  if (!problems.length) {
    mkdirSync(DIST, { recursive: true });
    writeFileSync(out, writeZip(zipFiles));
  }
  return { mc, edition, chosen, localMods, resourcepacks, shaders, scan, out, problems, warnings };
}

// ---------- Pack serveur ----------

async function buildServer(mc, fullBuild) {
  const target = config.targets[mc];
  const problems = [], warnings = [];
  // Mods utiles côté serveur : déclarés compatibles serveur sur Modrinth ET pas « client » dans leur fabric.mod.json.
  let candidates = fullBuild.chosen.filter(({ project }) => project.server_side !== "unsupported" && fullBuild.scan.environments.get(project.slug) !== "client");
  // Mods réservés au serveur (absents des packs joueurs), ajoutés seulement ici.
  const extra = await resolveMods(mc, config.serverMods ?? [], target.pin ?? {}, problems, warnings);
  for (const e of extra) if (!candidates.some((c) => c.project.id === e.project.id)) candidates.push(e);
  // Retire ceux dont une dépendance n'est disponible que côté client, jusqu'à stabilisation.
  for (let changed = true; changed; ) {
    changed = false;
    const scan = newScan("server");
    const bufs = [];
    for (const c of candidates) bufs.push([c, (await fetchVerified(c.version)).buf]);
    for (const [c, buf] of bufs) scanJar(scan, buf, c.project.slug);
    scan.provided.set("minecraft", mc);
    scan.provided.set("fabricloader", target.fabricLoader);
    scan.provided.set("java", JAVA_VERSION);
    const broken = new Set(scan.requirements.filter((r) => r.kind === "depends" && scan.provided.get(r.id) === undefined).map((r) => r.owner));
    if (broken.size) {
      warnings.push(`retirés du serveur (dépendance client uniquement) : ${[...broken].join(", ")}`);
      candidates = candidates.filter((c) => !broken.has(c.project.slug));
      changed = true;
    } else checkRequirements(scan, mc, target.fabricLoader, problems, warnings);
  }

  const installers = await (await fetch("https://meta.fabricmc.net/v2/versions/installer", UA)).json();
  const installer = installers.find((i) => i.stable).version;
  const launcher = await download(
    `https://meta.fabricmc.net/v2/versions/loader/${mc}/${target.fabricLoader}/${installer}/server/jar`,
    `fabric-server-${mc}-${target.fabricLoader}-${installer}.jar`,
  );
  const s = config.server ?? {};
  const files = [{ name: "fabric-server-launch.jar", data: launcher }];
  for (const c of candidates) {
    const { file, buf } = await fetchVerified(c.version);
    files.push({ name: `mods/${file.filename}`, data: buf });
  }
  const java = `java -Xms${s.memory ?? "4G"} -Xmx${s.memory ?? "4G"} -jar fabric-server-launch.jar nogui`;
  files.push(
    { name: "start.bat", data: Buffer.from(`@echo off\r\n${java}\r\npause\r\n`) },
    { name: "start.sh", data: Buffer.from(`#!/bin/sh\ncd "$(dirname "$0")"\nexec ${java}\n`) },
    // server.properties est lu en ISO-8859-1 : les caractères hors ASCII (§ des couleurs…) sont échappés en \uXXXX.
    {
      name: "server.properties",
      data: Buffer.from(
        Object.entries(s.properties ?? {})
          .map(([k, v]) => `${k}=${String(v).replace(/[^\x20-\x7e]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`)}`)
          .join("\n") + "\n",
      ),
    },
    { name: "eula.txt", data: Buffer.from("# Lis https://aka.ms/MinecraftEULA puis passe la valeur à true pour lancer le serveur.\neula=false\n") },
    {
      name: "LISEZMOI.txt",
      data: Buffer.from(
        `Serveur ${config.name} ${config.version} — Minecraft ${mc}, Fabric Loader ${target.fabricLoader}\n\n` +
          `1. Installe Java ${JAVA_VERSION} ou plus récent.\n` +
          `2. Lis le CLUF de Minecraft (https://aka.ms/MinecraftEULA) et passe eula=true dans eula.txt.\n` +
          `3. Lance start.bat (Windows) ou start.sh (Linux). Le premier démarrage télécharge le serveur Minecraft.\n\n` +
          `Les joueurs se connectent avec le modpack LUNA ${mc} (ou un client vanilla : les mods serveur restent optionnels).\n` +
          `Mods inclus :\n${candidates.map((c) => `  - ${c.project.title} ${c.version.version_number}`).join("\n")}\n`,
      ),
    },
  );
  const out = join(DIST, `${config.name}-Server-${config.version}+${mc}.zip`);
  if (!problems.length) writeFileSync(out, writeZip(files));
  return { mc, edition: "server", chosen: candidates, out, problems, warnings };
}

// ---------- Exécution ----------

const results = [];
for (const mc of TARGETS)
  for (const edition of EDITIONS) {
    process.stdout.write(`${config.editions[edition].name} ${config.version} pour ${mc}… `);
    const r = await buildEdition(mc, edition);
    results.push(r);
    console.log(r.problems.length ? "✖" : "✔");
    if (WITH_SERVER && edition === "full" && !r.problems.length) {
      process.stdout.write(`${config.name} Server ${config.version} pour ${mc}… `);
      const s = await buildServer(mc, r);
      results.push(s);
      console.log(s.problems.length ? "✖" : "✔");
    }
  }

console.log();
let failed = false;
for (const r of results) {
  const label = `${r.edition.padEnd(6)} ${r.mc.padEnd(7)}`;
  if (r.problems.length) {
    failed = true;
    console.log(`✖ ${label} échec :`);
    for (const p of r.problems) console.log(`    ✖ ${p}`);
  } else {
    const extra = r.resourcepacks ? `, ${r.resourcepacks.length} packs, ${r.shaders.length} shaders` : "";
    console.log(`✔ ${label} ${relative(ROOT, r.out)} (${r.chosen.length + (r.localMods ? r.localMods.length + 1 : 0)} mods${extra})`);
  }
  for (const w of r.warnings) if (VERBOSE || !/ est en (beta|alpha)$/.test(w)) console.log(`    ⚠ ${w}`);
  if (VERBOSE) for (const { project, version } of r.chosen) console.log(`      ${project.slug.padEnd(30)} ${version.version_number}`);
}

// MODS.md : contenu de la version principale (première de targets), éditions et serveur.
const primary = Object.keys(config.targets)[0];
const main = results.find((r) => r.mc === primary && r.edition === "full" && !r.problems.length);
if (main) {
  const lite = results.find((r) => r.mc === primary && r.edition === "lite" && !r.problems.length);
  const server = results.find((r) => r.mc === primary && r.edition === "server" && !r.problems.length);
  const modRows = main.chosen
    .map(({ project, version, mod }) => `| [${project.title}](https://modrinth.com/mod/${project.slug}) | ${version.version_number} | ${mod?.why ?? "Dépendance"} | ${mod?.lite || lite?.chosen.some((c) => c.project.id === project.id) ? "✓" : ""} | ${server?.chosen.some((c) => c.project.id === project.id) ? "✓" : ""} |`)
    .concat(`| LUNA UI (maison) | ${config.version} | Thème visuel : logo, panorama, boutons et menus | ✓ |  |`)
    .concat(main.localMods.map((m) => `| ${m.name} (maison) | ${m.filename} | ${m.why} | ${m.lite ? "✓" : ""} |  |`));
  const assetRows = (list, kind) => list.map(({ project, version }) => `| [${project.title}](https://modrinth.com/${kind}/${project.slug}) | ${version.version_number} |`).join("\n");
  writeFileSync(
    join(ROOT, "MODS.md"),
    [
      `# Contenu de ${config.name} ${config.version}`,
      `Versions de Minecraft : ${Object.keys(config.targets).join(", ")}. Le détail ci-dessous est celui de ${primary} ; les autres versions ont les mêmes mods dès qu'ils existent pour elles.`,
      `**${config.editions.full.name}** : ${main.chosen.length + 1 + main.localMods.length} mods, ${main.resourcepacks.length} packs de ressources, ${main.shaders.length} shaders.  ` +
        (lite ? `\n**${config.editions.lite.name}** : ${lite.chosen.length + 1 + lite.localMods.length} mods (colonne Lite), sans packs de ressources ni shaders.  ` : "") +
        (server ? `\n**Serveur** : ${server.chosen.length} mods (colonne Serveur).` : ""),
      `## Mods\n\n| Mod | Version | Rôle | Lite | Serveur |\n|---|---|---|---|---|\n${modRows.join("\n")}`,
      `## Packs de ressources\n\nActivés par défaut au premier lancement, dans cet ordre (du bas vers le haut), avec LUNA UI tout en haut.\n\n| Pack | Version |\n|---|---|\n${assetRows(main.resourcepacks, "resourcepack")}`,
      `## Shaders\n\nDésactivés par défaut : Options › Video Settings › Shader Packs. Ceux qui affichent aussi le terrain lointain de Voxy : ${(config.shaders ?? []).filter((s) => s.voxy).map((s) => s.slug).join(", ") || "aucun"}.\n\n| Shader | Version |\n|---|---|\n${assetRows(main.shaders, "shader")}`,
    ].join("\n\n") + "\n",
  );
}
if (failed) process.exit(1);
