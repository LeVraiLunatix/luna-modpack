// Disponibilité des mods de pack.config.json pour plusieurs versions de Minecraft.
//   node tools/check-versions.mjs 26.3 26.2 26.1.2     (par défaut : les cibles du pack + la version suivante connue)
//   node tools/check-versions.mjs --missing ...        n'affiche que les mods absents d'au moins une version
// Sert à préparer une nouvelle version de Minecraft (Voxy disponible ?) et à repérer les trous d'une cible.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const config = JSON.parse(readFileSync(join(ROOT, "pack.config.json"), "utf8"));
const args = process.argv.slice(2);
const onlyMissing = args.includes("--missing");
const extra = args.filter((a) => !a.startsWith("--")).map((a) => a.split(",")).flat();
const versions = extra.length ? extra : Object.keys(config.targets ?? { [config.minecraft]: {} });
const UA = { headers: { "User-Agent": "LeVraiLunatix/luna-modpack (check-versions)" } };

async function available(slug, loaders, gv) {
  const q = `loaders=${encodeURIComponent(JSON.stringify(loaders))}&game_versions=${encodeURIComponent(JSON.stringify([gv]))}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`https://api.modrinth.com/v2/project/${slug}/version?${q}`, UA);
    if (res.status === 429) { await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); continue; }
    if (!res.ok) return `ERR${res.status}`;
    const list = await res.json();
    return list[0]?.version_number ?? null;
  }
  return "ERR429";
}

const entries = [
  ...config.mods.map((m) => ({ slug: m.slug, loaders: ["fabric"], kind: "mod" })),
  ...(config.extraMods ?? []).map((m) => ({ slug: m.slug, loaders: ["fabric"], kind: "mod" })),
  ...(config.resourcepacks ?? []).map((p) => ({ slug: p.slug, loaders: ["minecraft"], kind: "pack" })),
  ...(config.shaders ?? []).map((s) => ({ slug: s.slug, loaders: ["iris"], kind: "shader" })),
];
const slugs = [...new Set(entries.map((e) => e.slug))].map((s) => entries.find((e) => e.slug === s));
console.log(`${"".padEnd(34)}${versions.map((v) => v.padEnd(12)).join("")}`);
const missing = Object.fromEntries(versions.map((v) => [v, []]));
for (let i = 0; i < slugs.length; i += 8) {
  const batch = slugs.slice(i, i + 8);
  const rows = await Promise.all(batch.map(async (e) => [e, await Promise.all(versions.map((v) => available(e.slug, e.loaders, v)))]));
  for (const [e, res] of rows) {
    res.forEach((r, j) => !r && missing[versions[j]].push(e.slug));
    if (onlyMissing && res.every(Boolean)) continue;
    console.log(`${`${e.slug} (${e.kind})`.padEnd(34)}${res.map((r) => (r ? "✓" : "—").padEnd(12)).join("")}`);
  }
}
console.log();
for (const v of versions) console.log(`${v} : ${missing[v].length ? `${missing[v].length} absent(s) → ${missing[v].join(", ")}` : "tout est disponible"}`);
