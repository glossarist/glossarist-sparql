// JSON-LD reader: parses glossarist-js's deterministic compact JSON-LD
// projection (writeJsonldDirect output) back into quads — losslessly.
// Handles the exact forms our writer emits:
//   { "@context": {prefix: ns}, "@graph": [nodes] }
//   { "@context": …, "@id": …, … }          (single-node document)
//   { "@context": … }                        (empty graph)
// Node values: plain string literal; {"@value","@language"}; {"@value","@type"};
// {"@id"} reference (IRI or "_:bnode"); arrays of any of these.
// Predicates/subjects may be CURIEs against the context or absolute IRIs.
// RDF 1.1 normalization lives in terms.ts (lang lowercase, simple = xsd:string).
import { iri, blank, literal, XSD_STRING, type Term, type Quad } from "./terms.js";

type Node = Record<string, unknown>;
type Doc = { "@context"?: Record<string, string>; "@graph"?: Node[] } & Node;

const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const BNODE_PREFIX = "_:";

function isAbsolute(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(value) && !value.startsWith(BNODE_PREFIX);
}

function expandTerm(value: string, context: Record<string, string>): string {
  if (value.startsWith(BNODE_PREFIX)) return value;
  if (isAbsolute(value)) return value;
  const colon = value.indexOf(":");
  if (colon > 0) {
    const prefix = value.slice(0, colon);
    const ns = context[prefix];
    if (ns !== undefined) return ns + value.slice(colon + 1);
  }
  return value;
}

function termFromId(id: string, context: Record<string, string>): Term {
  if (id.startsWith(BNODE_PREFIX)) return blank(id.slice(BNODE_PREFIX.length));
  return iri(expandTerm(id, context));
}

function valueToTerm(value: unknown, context: Record<string, string>): Term | null {
  if (typeof value === "string") return literal(value);
  if (value === null || value === undefined) return null;
  if (typeof value !== "object") return literal(String(value));
  const v = value as Record<string, unknown>;
  if ("@id" in v) {
    const id = String(v["@id"]);
    return id.startsWith(BNODE_PREFIX) ? blank(id.slice(BNODE_PREFIX.length)) : iri(expandTerm(id, context));
  }
  if ("@value" in v) {
    const text = String(v["@value"]);
    if (typeof v["@language"] === "string") return literal(text, { lang: v["@language"] });
    const datatype = typeof v["@type"] === "string" ? expandTerm(v["@type"], context) : undefined;
    if (datatype && datatype !== XSD_STRING) return literal(text, { datatype });
    return literal(text);
  }
  return null; // nested node objects never occur in our projection
}

/** Parse a compact JSON-LD document (our projection) into quads. */
export function readJsonld(doc: Doc): Quad[] {
  const context = doc["@context"] ?? {};
  const quads: Quad[] = [];
  const nodes: Node[] = Array.isArray(doc["@graph"]) ? (doc["@graph"] as Node[]) : [doc as Node];

  for (const node of nodes) {
    const id = typeof node["@id"] === "string" ? node["@id"] : null;
    if (!id) continue; // our writer always emits @id
    const subject = termFromId(id, context);

    for (const [key, raw] of Object.entries(node)) {
      if (key === "@id" || key === "@context") continue;
      const predicate = key === "@type"
        ? { ...iri(RDF_TYPE) }
        : iri(expandTerm(key, context));
      const values = Array.isArray(raw) ? raw : [raw];
      for (const value of values) {
        const object = key === "@type"
          ? (typeof value === "string" ? iri(expandTerm(value, context)) : null)
          : valueToTerm(value, context);
        if (!object) continue;
        quads.push({ s: subject, p: predicate, o: object });
      }
    }
  }
  return quads;
}

/** Parse and load into a QuadStore; returns the store. */
export function readJsonldIntoStore(doc: Doc, store: { insert(q: Quad): boolean }): number {
  let count = 0;
  for (const q of readJsonld(doc)) if (store.insert(q)) count++;
  return count;
}
