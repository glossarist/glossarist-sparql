// Minimal valid Turtle serializer — grouped by subject, deterministic order.
// Optional prefix map: emits @prefix directives and compresses matching IRIs
// (longest namespace wins). Without a map, full IRIs are emitted.
import type { Quad, Term } from "./terms.js";

function escapeLiteral(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t");
}

function compress(value: string, prefixes?: Record<string, string>): string {
  if (!prefixes) return value;
  const entries = Object.entries(prefixes).sort((a, b) => b[1].length - a[1].length);
  for (const [prefix, ns] of entries) {
    if (ns !== "" && value.startsWith(ns) && value.length > ns.length) return `${prefix}:${value.slice(ns.length)}`;
  }
  return value;
}

function makeTermToTurtle(prefixes?: Record<string, string>) {
  return (t: Term): string => {
    if (t.kind === "iri") {
      const c = compress(t.value, prefixes);
      return c === t.value ? `<${t.value}>` : c;
    }
    if (t.kind === "bnode") return `_:${t.value}`;
    if (t.lang) return `"${escapeLiteral(t.value)}"@${t.lang}`;
    const dt = t.datatype ?? "http://www.w3.org/2001/XMLSchema#string";
    if (dt === "http://www.w3.org/2001/XMLSchema#string") return `"${escapeLiteral(t.value)}"`;
    const dc = compress(dt, prefixes);
    return `"${escapeLiteral(t.value)}"^^${dc === dt ? `<${dt}>` : dc}`;
  };
}

export function serializeTurtle(quads: readonly Quad[], prefixes?: Record<string, string>): string {
  const T = makeTermToTurtle(prefixes);
  const bySubject = new Map<string, { term: Term; pairs: Map<string, { p: Term; o: Term[] }> }>();
  for (const q of quads) {
    const sKey = T(q.s);
    const pKey = T(q.p);
    let entry = bySubject.get(sKey);
    if (!entry) {
      entry = { term: q.s, pairs: new Map() };
      bySubject.set(sKey, entry);
    }
    let pair = entry.pairs.get(pKey);
    if (!pair) {
      pair = { p: q.p, o: [] };
      entry.pairs.set(pKey, pair);
    }
    pair.o.push(q.o);
  }

  const out: string[] = [];
  if (prefixes && Object.keys(prefixes).length > 0) {
    for (const [prefix, ns] of Object.entries(prefixes).sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      out.push(`@prefix ${prefix}: <${ns}> .`);
    }
  }
  for (const sKey of [...bySubject.keys()].sort()) {
    const { term, pairs } = bySubject.get(sKey)!;
    const lines = [...pairs.keys()].sort().map((pKey) => {
      const { p, o } = pairs.get(pKey)!;
      return `    ${T(p)} ${o.map(T).join(", ")}`;
    });
    out.push(`${T(term)}\n${lines.join(" ;\n")} .`);
  }
  return out.join("\n\n") + (out.length ? "\n" : "");
}
