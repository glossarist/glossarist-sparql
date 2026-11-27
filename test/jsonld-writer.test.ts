import { describe, expect, it } from "vitest";
import { toJsonld } from "../src/jsonld-writer.js";
import { readJsonld } from "../src/jsonld-reader.js";
import { iri, blank, literal, termKey, type Quad } from "../src/terms.js";

const CONTEXT = {
  gloss: "https://www.glossarist.org/ontologies/",
  skos: "http://www.w3.org/2004/02/skos/core#",
  rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
  xsd: "http://www.w3.org/2001/XMLSchema#",
};

const quads: Quad[] = [
  { s: iri("https://example.org/concept/1"), p: iri("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"), o: iri("https://www.glossarist.org/ontologies/Concept") },
  { s: iri("https://example.org/concept/1"), p: iri("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"), o: iri("http://www.w3.org/2004/02/skos/core#Concept") },
  { s: iri("https://example.org/concept/1"), p: iri("http://www.w3.org/2004/02/skos/core#prefLabel"), o: literal("quantity", { lang: "eng" }) },
  { s: iri("https://example.org/concept/1"), p: iri("http://www.w3.org/2004/02/skos/core#prefLabel"), o: literal("grandeur", { lang: "fra" }) },
  { s: iri("https://example.org/concept/1"), p: iri("https://www.glossarist.org/ontologies/issued"), o: literal("2012-01-01", { datatype: "http://www.w3.org/2001/XMLSchema#date" }) },
  { s: iri("https://example.org/concept/1"), p: iri("https://www.glossarist.org/ontologies/hasRelated"), o: iri("https://example.org/concept/2") },
  { s: blank("b1"), p: iri("https://www.glossarist.org/ontologies/notation"), o: literal("r 1") },
];

describe("JSON-LD writer (compact, deterministic)", () => {
  const doc = toJsonld(quads, CONTEXT);
  const nodeOf = (id: string) => doc["@graph"].find(n => (n as Record<string, unknown>)["@id"] === id) as Record<string, unknown>;

  it("compresses IRIs to CURIEs against the context", () => {
    const node = nodeOf("https://example.org/concept/1");
    expect(node["@type"]).toEqual(["gloss:Concept", "skos:Concept"]);
    expect(node["gloss:hasRelated"]).toEqual({ "@id": "https://example.org/concept/2" });
    expect(node["gloss:issued"]).toEqual({ "@value": "2012-01-01", "@type": "xsd:date" });
    expect(nodeOf("_:b1")["gloss:notation"]).toBe("r 1");
  });

  it("emits language literals in reader shape", () => {
    const node = nodeOf("https://example.org/concept/1");
    expect(node["skos:prefLabel"]).toEqual([
      { "@value": "grandeur", "@language": "fra" },
      { "@value": "quantity", "@language": "eng" },
    ]);
  });

  it("round-trips through the reader", () => {
    const back = readJsonld(doc as never);
    const quadKey = (q: Quad) => `${termKey(q.s)} ${termKey(q.p)} ${termKey(q.o)}`;
    expect(back.map(quadKey).sort()).toEqual(quads.map(quadKey).sort());
    expect(back.find(q => q.o.kind === "literal" && q.o.datatype)?.o).toEqual(literal("2012-01-01", { datatype: "http://www.w3.org/2001/XMLSchema#date" }));
    expect(back.some(q => q.s.kind === "bnode")).toBe(true);
  });

  it("is deterministic (stable bytes)", () => {
    expect(JSON.stringify(toJsonld(quads, CONTEXT))).toBe(JSON.stringify(doc));
    const shuffled = [...quads].reverse();
    expect(JSON.stringify(toJsonld(shuffled, CONTEXT))).toBe(JSON.stringify(doc));
  });

  it("serializes an empty graph", () => {
    expect(toJsonld([], CONTEXT)).toEqual({ "@context": CONTEXT, "@graph": [] });
  });
});
