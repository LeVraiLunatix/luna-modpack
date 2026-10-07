// Comparaison de versions façon Fabric Loader (SemVer souple) et évaluation des prédicats de dépendance.

export function parseVersion(s) {
  const noBuild = String(s).split("+")[0];
  const dash = noBuild.indexOf("-");
  const core = dash === -1 ? noBuild : noBuild.slice(0, dash);
  const pre = dash === -1 ? null : noBuild.slice(dash + 1);
  if (!/^\d+(\.\d+)*$/.test(core)) return null;
  return { core: core.split(".").map(Number), pre };
}

export function compareVersions(a, b) {
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
export function satisfies(version, predicate) {
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
