import { describe, expect, it } from "vitest";
import { readJsonld, readJsonldIntoStore } from "../src/jsonld-reader.js";
import { QuadStore } from "../src/store.js";
import { termKey } from "../src/terms.js";

// Shape mirrors glossarist-js writeJsonldDirect output exactly.
const doc = {
  "@context": {
    gloss: "https://www.glossarist.org/ontologies/",
    skos: "http://www.w3.org/2004/02/skos/core#",
    rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
  },
  "@graph": [
    {
      "@id": "https://example.org/concept/1",
      "@type": ["gloss:Concept", "skos:Concept"],
      "gloss:identifier": "3.1",
      "skos:prefLabel": [{ "@language": "eng", "@value": "measurement" }, { "@language": "fra", "@value": "mesurage" }],
      "gloss:hasRelated": { "@id": "https://example.org/concept/2" },
      "gloss:issued": { "@type": "xsd:date", "@value": "2012-01-01" },
    },
    { "@id": "_:b123", "@type": "gloss:Expression", "skosxl:literalForm": { "@language": "eng", "@value": "measurement" } },
  ],
};

describe("JSON-LD reader (our compact projection)", () => {
  const quads = readJsonld(doc as never);

  it("expands CURIE subjects, predicates and types", () => {
    expect(quads.some(q => termKey(q.s) === termKey({ kind: "iri", value: "https://example.org/concept/1" }))).toBe(true);
    expect(quads.some(q => q.p.value === "http://www.w3.org/1999/02/22-rdf-syntax-ns#type")).toBe(true);
    expect(quads.some(q => q.o.kind === "iri" && q.o.value === "https://www.glossarist.org/ontologies/Concept")).toBe(true);
  });
  it("reads lang literals normalized (lowercase lang)", () => {
    expect(quads.some(q => q.o.kind === "literal" && q.o.lang === "eng" && q.o.value === "measurement")).toBe(true);
    expect(quads.some(q => q.o.kind === "literal" && q.o.lang === "fra" && q.o.value === "mesurage")).toBe(true);
  });
  it('reads {"@id"} object references and blank nodes', () => {
    expect(quads.some(q => q.o.kind === "iri" && q.o.value === "https://example.org/concept/2")).toBe(true);
    expect(quads.some(q => q.s.kind === "bnode" && q.s.value === "b123")).toBe(true);
  });
  it("reads typed literals with context-expanded datatypes", () => {
    expect(quads.some(q => q.o.kind === "literal" && q.o.datatype === "http://www.w3.org/2001/XMLSchema#date")).toBe(true);
  });
  it("loads into the store with set semantics; count matches quad list", () => {
    const st = new QuadStore();
    const n = readJsonldIntoStore(doc as never, st);
    expect(st.size).toBe(n);
    expect(n).toBe(quads.length);
  });
  it("single-node and empty documents", () => {
    expect(readJsonld({ "@context": {}, "@id": "https://x", "p": "v" } as never)).toHaveLength(1);
    expect(readJsonld({ "@context": {} } as never)).toHaveLength(0);
  });
});
