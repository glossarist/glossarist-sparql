// Compact JSON-LD writer: quads → our compact projection — the mirror of
// jsonld-reader.ts. Flat prefix-map context only; deterministic output
// (nodes ordered by subject key, predicates sorted) so identical graphs
// serialize to identical bytes.
import { type Term, type Quad, XSD_STRING } from "./terms.js";

const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

function compress(value: string, context: Record<string, string>): string {
  const entries = Object.entries(context).sort((a, b) => b[1].length - a[1].length);
  for (const [prefix, ns] of entries) {
    if (ns !== "" && value.startsWith(ns) && value.length > ns.length) {
      return `${prefix}:${value.slice(ns.length)}`;
    }
  }
  return value;
}

function idValue(t: Term, context: Record<string, string>): string {
  return t.kind === "bnode" ? `_:${t.value}` : compress(t.value, context);
}

function objectValue(t: Term, context: Record<string, string>): unknown {
  if (t.kind === "iri") return { "@id": compress(t.value, context) };
  if (t.kind === "bnode") return { "@id": `_:${t.value}` };
  if (t.lang !== undefined) return { "@value": t.value, "@language": t.lang };
  if (t.datatype !== undefined && t.datatype !== XSD_STRING) {
    return { "@value": t.value, "@type": compress(t.datatype, context) };
  }
  return t.value;
}

export type JsonldDoc = { "@context": Record<string, string>; "@graph": unknown[] };

/** Serialize quads as a compact JSON-LD document (deterministic). */
export function toJsonld(quads: readonly Quad[], context: Record<string, string> = {}): JsonldDoc {
  const nodes = new Map<string, { node: Record<string, unknown>; key: string }>();

  for (const q of quads) {
    const id = idValue(q.s, context);
    const pred = q.p.kind === "iri" && q.p.value === RDF_TYPE ? "@type" : compress(q.p.value, context);
    const raw = q.p.kind === "iri" && q.p.value === RDF_TYPE && q.o.kind === "iri"
      ? compress(q.o.value, context)
      : objectValue(q.o, context);

    let entry = nodes.get(id);
    if (!entry) {
      entry = { node: { "@id": id }, key: id };
      nodes.set(id, entry);
    }
    if (pred === "@type" && !("@type" in entry.node)) entry.node["@type"] = [];
    const slot = entry.node[pred] as unknown[];
    if (slot === undefined) entry.node[pred] = [raw];
    else slot.push(raw);
  }

  const graph = [...nodes.values()]
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map(({ node }) => {
      const out: Record<string, unknown> = { "@id": node["@id"] };
      if (Array.isArray(node["@type"])) out["@type"] = node["@type"].length === 1 ? node["@type"][0] : [...node["@type"] as unknown[]].sort();
      for (const k of Object.keys(node).sort()) {
        if (k === "@id" || k === "@type") continue;
        const vals = node[k] as unknown[];
        vals.sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : JSON.stringify(a) > JSON.stringify(b) ? 1 : 0));
        out[k] = vals.length === 1 ? vals[0] : vals;
      }
      return out;
    });

  return { "@context": context, "@graph": graph };
}
