// Lance réellement le .mrpack dans une instance jetable (.test/) pour vérifier qu'il démarre :
// installe le client vanilla + Fabric Loader, prégénère un monde avec le serveur vanilla,
// puis ouvre ce monde en solo (compte hors ligne) et guette la connexion ou un crash.
//   node tools/test-launch.mjs [--mc 26.2] [--edition full|lite] [--keep]   (--keep : laisse le jeu ouvert)
//   node tools/test-launch.mjs --server [--mc 26.2]   démarre le pack serveur LUNA et attend « Done »
//   node tools/test-launch.mjs --menu     (s'arrête sur l'écran titre et le capture dans .test/screens/ ;
//                                          la fenêtre passe au premier plan le temps de la capture)
import { execFileSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { readZip } from "../lib/zip.mjs";

const ROOT = join(import.meta.dirname, "..");
const config = JSON.parse(readFileSync(join(ROOT, "pack.config.json"), "utf8"));
const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const MC = arg("mc", Object.keys(config.targets)[0]);
const EDITION = arg("edition", "full");
const LOADER = config.targets[MC]?.fabricLoader;
if (!LOADER) throw new Error(`version inconnue : ${MC}`);
const ROOT_TEST = join(ROOT, ".test");
const LIBS = join(ROOT_TEST, "libraries");
const ASSETS = join(ROOT_TEST, "assets");
const TEST = join(ROOT_TEST, MC); // une instance et un monde par version de Minecraft
const INSTANCE = join(TEST, `instance-${EDITION}`);
const JAVA = process.env.JAVA ?? "java";
const WORLD = "LunaTest";
const keep = process.argv.includes("--keep");
const menu = process.argv.includes("--menu");
// --panorama : active la capture panoramique native (Ctrl+F2 en jeu) et laisse le jeu ouvert.
const panorama = process.argv.includes("--panorama");
// --without <regex> : mods à ne pas installer pour ce test (ex. « essential », qui bloque l'écran titre avec un compte hors ligne).
const without = arg("without", null);
const UA = { headers: { "User-Agent": "LeVraiLunatix/luna-modpack (test launcher)" } };

async function fetchJson(url) {
  const res = await fetch(url, UA);
  if (!res.ok) throw new Error(`${res.status} sur ${url}`);
  return res.json();
}

async function download(url, dest) {
  if (existsSync(dest)) return;
  mkdirSync(dirname(dest), { recursive: true });
  const res = await fetch(url, UA);
  if (!res.ok) throw new Error(`${res.status} sur ${url}`);
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

function allowed(rules) {
  if (!rules) return true;
  let ok = false;
  for (const r of rules) if (!r.os || r.os.name === "windows") ok = r.action === "allow";
  return ok;
}

const mavenPath = (name) => {
  const [group, artifact, version, classifier] = name.split(":");
  return `${group.replaceAll(".", "/")}/${artifact}/${version}/${artifact}-${version}${classifier ? `-${classifier}` : ""}.jar`;
};

// ---------- Vanilla + Fabric ----------

// ---------- Mode serveur : démarre le pack serveur LUNA tel qu'un joueur le recevrait ----------

if (process.argv.includes("--server")) {
  const dir = join(TEST, "luna-server");
  rmSync(join(dir, "mods"), { recursive: true, force: true });
  const zip = readZip(readFileSync(join(ROOT, "dist", `${config.name}-Server-${config.version}+${MC}.zip`)));
  for (const [name, read] of zip) {
    if (name.endsWith("/")) continue;
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), read());
  }
  // Instance de test locale uniquement : on accepte le CLUF et on change de port pour ne gêner personne.
  writeFileSync(join(dir, "eula.txt"), "eula=true\n");
  writeFileSync(join(dir, "server.properties"), readFileSync(join(dir, "server.properties"), "utf8") + "server-port=25597\nonline-mode=false\n");
  console.log(`Démarrage du serveur LUNA ${MC}…`);
  const srv = spawn(JAVA, ["-Xmx3G", "-jar", "fabric-server-launch.jar", "nogui"], { cwd: dir });
  const out = [];
  const ok = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 8 * 60_000);
    const onData = (d) => {
      out.push(d.toString());
      if (/Done \(/.test(d)) { clearTimeout(timer); srv.stdin.write("stop\n"); resolve(true); }
    };
    srv.stdout.on("data", onData);
    srv.stderr.on("data", onData);
    srv.on("exit", () => { clearTimeout(timer); resolve(false); });
  });
  if (ok) await new Promise((r) => srv.on("exit", r));
  else srv.kill();
  const log = out.join("");
  writeFileSync(join(TEST, "server-run.log"), log);
  const errors = log.split("\n").filter((l) => /\/ERROR\]|Exception|FATAL/.test(l));
  for (const e of errors.slice(0, 15)) console.log(`  │ ${e}`);
  console.log(ok ? `\n✔ Le serveur LUNA ${MC} démarre (journal : .test/${MC}/server-run.log)` : `\n✖ Le serveur n'a pas fini de démarrer (journal : .test/${MC}/server-run.log)`);
  process.exit(ok ? 0 : 1);
}

console.log(`Préparation de Minecraft ${MC} + Fabric ${LOADER}…`);
const manifest = await fetchJson("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json");
const vanilla = await fetchJson(manifest.versions.find((v) => v.id === MC).url);
const clientJar = join(ROOT_TEST, "versions", `${MC}.jar`);
await download(vanilla.downloads.client.url, clientJar);

const classpath = [];
for (const lib of vanilla.libraries) {
  if (!allowed(lib.rules) || !lib.downloads?.artifact) continue;
  const dest = join(LIBS, lib.downloads.artifact.path);
  await download(lib.downloads.artifact.url, dest);
  classpath.push(dest);
}
const fabric = await fetchJson(`https://meta.fabricmc.net/v2/versions/loader/${MC}/${LOADER}/profile/json`);
for (const lib of fabric.libraries) {
  const path = mavenPath(lib.name);
  const dest = join(LIBS, path);
  await download(`${lib.url ?? "https://maven.fabricmc.net/"}${path}`, dest);
  // Fabric remplace l'ASM de Mojang : on retire les doublons du classpath vanilla.
  const [group, artifact] = lib.name.split(":");
  const prefix = join(LIBS, group.replaceAll(".", "/"), artifact) + "\\";
  for (let i = classpath.length - 1; i >= 0; i--) if (classpath[i].startsWith(prefix)) classpath.splice(i, 1);
  classpath.push(dest);
}
classpath.push(clientJar);

// Assets vanilla (textures, polices, langues…) sauf les sons, inutiles ici et très lourds.
const assetIndex = join(ASSETS, "indexes", `${vanilla.assetIndex.id}.json`);
await download(vanilla.assetIndex.url, assetIndex);
const objects = Object.entries(JSON.parse(readFileSync(assetIndex, "utf8")).objects).filter(([name]) => !/sounds?\//.test(name));
for (let i = 0; i < objects.length; i += 32)
  await Promise.all(
    objects.slice(i, i + 32).map(([, { hash }]) =>
      download(`https://resources.download.minecraft.net/${hash.slice(0, 2)}/${hash}`, join(ASSETS, "objects", hash.slice(0, 2), hash)),
    ),
  );

// ---------- Installation du pack ----------

const mrpack = readZip(readFileSync(join(ROOT, "dist", `${config.editions[EDITION].file}-${config.version}+${MC}.mrpack`)));
const index = JSON.parse(mrpack.get("modrinth.index.json")().toString("utf8"));
rmSync(join(INSTANCE, "mods"), { recursive: true, force: true });
for (const file of index.files) {
  if (file.env?.client === "unsupported") continue;
  // La capture panoramique rend 6 images dans la même frame, ce que la minimap Xaero ne supporte pas.
  if (panorama && /xaero/i.test(file.path)) continue;
  if (without && file.path.startsWith("mods/") && new RegExp(without, "i").test(file.path)) continue;
  const cached = join(ROOT, ".cache", `${file.hashes.sha1}${file.path.slice(file.path.lastIndexOf("."))}`);
  // writeFileSync plutôt que cpSync : cpSync échoue à écraser un fichier dont le nom contient « § ».
  if (existsSync(cached)) {
    mkdirSync(dirname(join(INSTANCE, file.path)), { recursive: true });
    writeFileSync(join(INSTANCE, file.path), readFileSync(cached));
  }
  else await download(file.downloads[0], join(INSTANCE, file.path));
}
for (const [name, read] of mrpack)
  if (name.startsWith("overrides/") && !name.endsWith("/")) {
    const dest = join(INSTANCE, name.slice("overrides/".length));
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, read());
  }
console.log(`${index.files.length} fichiers installés dans .test/instance`);

// ---------- Monde de test (serveur vanilla, une seule fois) ----------

const SERVER = join(TEST, "worldgen");
if (!existsSync(join(INSTANCE, "saves", WORLD))) {
  console.log("Génération d'un monde de test avec le serveur vanilla…");
  await download(vanilla.downloads.server.url, join(SERVER, "server.jar"));
  writeFileSync(join(SERVER, "eula.txt"), "eula=true\n");
  writeFileSync(join(SERVER, "server.properties"), `level-name=${WORLD}\nonline-mode=false\nserver-port=25599\n`);
  await new Promise((resolve, reject) => {
    const srv = spawn(JAVA, ["-Xmx2G", "-jar", "server.jar", "--nogui"], { cwd: SERVER });
    srv.stdout.on("data", (d) => {
      if (/Done \(/.test(d)) srv.stdin.write("stop\n");
    });
    srv.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`serveur vanilla : code ${code}`))));
  });
  cpSync(join(SERVER, WORLD), join(INSTANCE, "saves", WORLD), { recursive: true });
}

// Le monde vient du serveur vanilla, donc sans triches : on active les commandes dans level.dat
// (tag octet « allowCommands », modifié en place).
const levelDat = join(INSTANCE, "saves", WORLD, "level.dat");
if (existsSync(levelDat)) {
  const raw = gunzipSync(readFileSync(levelDat));
  const key = Buffer.concat([Buffer.from([1, 0, 13]), Buffer.from("allowCommands")]);
  const at = raw.indexOf(key);
  if (at >= 0 && raw[at + key.length] !== 1) {
    raw[at + key.length] = 1;
    writeFileSync(levelDat, gzipSync(raw));
  }
}

// Capture la fenêtre du jeu ; l'ancienne image est supprimée d'abord pour ne jamais relire une capture périmée.
function capture(path) {
  mkdirSync(dirname(path), { recursive: true });
  rmSync(path, { force: true });
  try {
    execFileSync("powershell", ["-NoProfile", "-File", join(ROOT, "tools", "capture-window.ps1"), "-ProcessId", String(game.pid), "-Out", path]);
    console.log(`Capture : ${path}`);
  } catch {
    console.log("⚠ Capture impossible : la fenêtre du jeu n'a pas pu passer au premier plan.");
  }
}

// ---------- Lancement ----------

rmSync(join(INSTANCE, "crash-reports"), { recursive: true, force: true });
// Sans ça, le premier lancement s'arrête sur l'écran d'accessibilité au lieu d'ouvrir le monde.
// Le jeu réécrit options.txt à chaque fermeture : on force nos réglages à chaque lancement.
const optionsFile = join(INSTANCE, "options.txt");
const forced = { onboardAccessibility: "false", lang: "en_us" };
// --bench : mesure les FPS (écran F3 lu par OCR). --api opengl|vulkan choisit le moteur de rendu,
// --force k=v,k=v impose des réglages (ex. la même distance de rendu pour comparer deux éditions), --tag nom du run.
const api = arg("api", null);
const bench = process.argv.includes("--bench");
if (api) forced.preferredGraphicsBackend = `"${api}"`;
if (bench) Object.assign(forced, { maxFps: "260", enableVsync: "false" });
for (const kv of (arg("force", "") || "").split(",").filter(Boolean)) { const [k, v] = kv.split("="); forced[k] = v; }
// Premier lancement : on part des réglages LUNA livrés pour Default Options, comme chez un joueur.
const defaults = join(INSTANCE, "config", "defaultoptions", "options.txt");
const base = existsSync(optionsFile) ? readFileSync(optionsFile, "utf8") : existsSync(defaults) ? readFileSync(defaults, "utf8") : "";
const options = base.split(/\r?\n/).filter((l) => l && !(l.split(":")[0] in forced));
writeFileSync(optionsFile, [...options, ...Object.entries(forced).map(([k, v]) => `${k}:${v}`)].join("\n") + "\n");
const args = [
  "-Xms2G", "-Xmx6G",
  ...(panorama ? ["-DMC_DEBUG_ENABLED=true", "-DMC_DEBUG_PANORAMA_SCREENSHOT=true"] : []),
  "-cp", classpath.join(";"),
  fabric.mainClass,
  "--username", "LunaTest", "--uuid", "00000000000000000000000000000001",
  "--accessToken", "0", "--userType", "legacy",
  "--version", MC, "--versionType", "release",
  "--gameDir", INSTANCE, "--assetsDir", ASSETS, "--assetIndex", vanilla.assetIndex.id,
  "--width", "1600", "--height", "900",
  ...(menu ? [] : ["--quickPlaySingleplayer", WORLD]),
];
console.log("Lancement du jeu…");
const game = spawn(JAVA, args, { cwd: INSTANCE });
const log = [];
const result = await new Promise((resolve) => {
  const timeout = setTimeout(() => resolve({ ok: false, reason: "délai dépassé (5 min)" }), 5 * 60_000);
  const onData = (d) => {
    const text = d.toString();
    log.push(text);
    process.stdout.write(text.split("\n").filter((l) => /ERROR|FATAL|Exception|joined the game|Loading Minecraft|mods/.test(l)).map((l) => `  │ ${l}\n`).join(""));
    if (!menu && /LunaTest\[.*logged in with entity id/.test(text)) { clearTimeout(timeout); resolve({ ok: true }); }
    // L'écran titre interroge Realms dès qu'il s'affiche : c'est notre signal.
    if (menu && /realms/i.test(text)) { clearTimeout(timeout); resolve({ ok: true }); }
  };
  game.stdout.on("data", onData);
  game.stderr.on("data", onData);
  game.on("exit", (code) => { clearTimeout(timeout); resolve({ ok: false, reason: `le jeu s'est fermé (code ${code})` }); });
});

if (result.ok && menu) {
  await new Promise((r) => setTimeout(r, 30_000));
  mkdirSync(join(TEST, "screens"), { recursive: true });
  const shot = join(TEST, "screens", "title.png");
  capture(shot);
  console.log(`Écran titre capturé : ${shot}`);
} else if (result.ok && panorama) {
  console.log("Monde chargé : place-toi, puis Ctrl+F2 (captures dans .test/instance/screenshots). Ferme le jeu pour finir.");
  await new Promise((r) => game.on("exit", r));
} else if (result.ok && bench) {
  await new Promise((r) => setTimeout(r, 60_000)); // chunks, Voxy et mods se stabilisent
  const ps = (file, ...a) => execFileSync("powershell", ["-NoProfile", "-File", join(ROOT, "tools", file), ...a]).toString();
  ps("game-input.ps1", "-ProcessId", String(game.pid), "-Keys", "F3");
  const tag = `${EDITION}-${api ?? "default"}${arg("tag", "") ? "-" + arg("tag", "") : ""}`;
  const shots = join(ROOT_TEST, "bench");
  mkdirSync(shots, { recursive: true });
  const samples = [];
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 2_000));
    const png = join(shots, `${tag}-${i}.png`);
    capture(png);
    if (!existsSync(png)) continue;
    const top = ps("ocr-text.ps1", "-Image", png, "-TopLeft");
    const fps = top.match(/(\d{2,4})\s*fps\s*T/i)?.[1];
    samples.push({ i, fps: fps ? +fps : null, top: top.split(/\r?\n/).slice(0, 3) });
  }
  writeFileSync(join(shots, `${tag}.json`), JSON.stringify({ edition: EDITION, api: api ?? "default", forced, samples }, null, 2));
  console.log(`Benchmark ${tag} : FPS lus = ${samples.map((x) => x.fps).join(", ")}`);
} else if (result.ok) {
  console.log("Monde chargé, le jeu tourne 45 s pour laisser Voxy et les mods travailler…");
  await new Promise((r) => setTimeout(r, 45_000));
  mkdirSync(join(TEST, "screens"), { recursive: true });
  capture(join(TEST, "screens", "world.png"));
}
const crashed = existsSync(join(INSTANCE, "crash-reports")) && readdirSync(join(INSTANCE, "crash-reports")).length > 0;
if (!keep || !result.ok) game.kill();
writeFileSync(join(TEST, "last-run.log"), log.join(""));

if (result.ok && !crashed)
  console.log(`\n✔ LUNA ${menu ? "atteint l'écran titre" : "démarre et charge un monde"} sans crash (journal : .test/last-run.log)`);
else {
  console.error(`\n✖ Échec : ${crashed ? "rapport de crash dans .test/instance/crash-reports" : result.reason} (journal : .test/last-run.log)`);
  process.exit(1);
}
