// Lance réellement le .mrpack dans une instance jetable (.test/) pour vérifier qu'il démarre :
// installe le client vanilla + Fabric Loader, prégénère un monde avec le serveur vanilla,
// puis ouvre ce monde en solo (compte hors ligne) et guette la connexion ou un crash.
//   node tools/test-launch.mjs [--keep]   (--keep : laisse le jeu ouvert)
//   node tools/test-launch.mjs --menu     (s'arrête sur l'écran titre et le capture dans .test/screens/ ;
//                                          la fenêtre passe au premier plan le temps de la capture)
import { execFileSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { readZip } from "../lib/zip.mjs";

const ROOT = join(import.meta.dirname, "..");
const config = JSON.parse(readFileSync(join(ROOT, "pack.config.json"), "utf8"));
const TEST = join(ROOT, ".test");
const LIBS = join(TEST, "libraries");
const ASSETS = join(TEST, "assets");
const INSTANCE = join(TEST, "instance");
const JAVA = process.env.JAVA ?? "java";
const WORLD = "LunaTest";
const keep = process.argv.includes("--keep");
const menu = process.argv.includes("--menu");
// --panorama : active la capture panoramique native (Ctrl+F2 en jeu) et laisse le jeu ouvert.
const panorama = process.argv.includes("--panorama");
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

console.log(`Préparation de Minecraft ${config.minecraft} + Fabric ${config.fabricLoader}…`);
const manifest = await fetchJson("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json");
const vanilla = await fetchJson(manifest.versions.find((v) => v.id === config.minecraft).url);
const clientJar = join(TEST, "versions", `${config.minecraft}.jar`);
await download(vanilla.downloads.client.url, clientJar);

const classpath = [];
for (const lib of vanilla.libraries) {
  if (!allowed(lib.rules) || !lib.downloads?.artifact) continue;
  const dest = join(LIBS, lib.downloads.artifact.path);
  await download(lib.downloads.artifact.url, dest);
  classpath.push(dest);
}
const fabric = await fetchJson(`https://meta.fabricmc.net/v2/versions/loader/${config.minecraft}/${config.fabricLoader}/profile/json`);
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

const mrpack = readZip(readFileSync(join(ROOT, "dist", `${config.name}-${config.version}.mrpack`)));
const index = JSON.parse(mrpack.get("modrinth.index.json")().toString("utf8"));
rmSync(join(INSTANCE, "mods"), { recursive: true, force: true });
for (const file of index.files) {
  if (file.env?.client === "unsupported") continue;
  // La capture panoramique rend 6 images dans la même frame, ce que la minimap Xaero ne supporte pas.
  if (panorama && /xaero/i.test(file.path)) continue;
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

const SERVER = join(TEST, "server");
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

// ---------- Lancement ----------

rmSync(join(INSTANCE, "crash-reports"), { recursive: true, force: true });
// Sans ça, le premier lancement s'arrête sur l'écran d'accessibilité au lieu d'ouvrir le monde.
// Le jeu réécrit options.txt à chaque fermeture : on force nos réglages à chaque lancement.
const optionsFile = join(INSTANCE, "options.txt");
const forced = { onboardAccessibility: "false", lang: "en_us" };
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
  "--version", config.minecraft, "--versionType", "release",
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
  execFileSync("powershell", ["-NoProfile", "-File", join(ROOT, "tools", "capture-window.ps1"), "-ProcessId", String(game.pid), "-Out", shot]);
  console.log(`Écran titre capturé : ${shot}`);
} else if (result.ok && panorama) {
  console.log("Monde chargé : place-toi, puis Ctrl+F2 (captures dans .test/instance/screenshots). Ferme le jeu pour finir.");
  await new Promise((r) => game.on("exit", r));
} else if (result.ok) {
  console.log("Monde chargé, le jeu tourne 45 s pour laisser Voxy et les mods travailler…");
  await new Promise((r) => setTimeout(r, 45_000));
  mkdirSync(join(TEST, "screens"), { recursive: true });
  execFileSync("powershell", ["-NoProfile", "-File", join(ROOT, "tools", "capture-window.ps1"), "-ProcessId", String(game.pid), "-Out", join(TEST, "screens", "world.png")]);
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
