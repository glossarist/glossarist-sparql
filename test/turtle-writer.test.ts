import { describe, expect, it } from "vitest";
import { serializeTurtle } from "../src/turtle-writer.js";
import { iri, literal, blank } from "../src/terms.js";

describe("serializeTurtle", () => {
  it("groups by subject with predicate-object lists", () => {
    const s = iri("https://example.org/concept/1");
    const ttl = serializeTurtle([
      { s, p: iri("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"), o: iri("https://www.glossarist.org/ontologies/Concept") },
      { s, p: iri("http://www.w3.org/2004/02/skos/core#prefLabel"), o: literal("measurement", "eng") },
    ]);
    expect(ttl).toContain("<https://example.org/concept/1>");
    expect(ttl).toContain('"measurement"@eng');
    expect(ttl).toMatch(/;\s/);
    expect(ttl.trim().endsWith(".")).toBe(true);
  });
  it("escapes literals and serializes blank nodes and typed literals", () => {
    const ttl = serializeTurtle([
      { s: blank("b1"), p: iri("http://p"), o: literal('say "hi"\n', { datatype: "http://www.w3.org/2001/XMLSchema#date" }) },
    ]);
    expect(ttl).toContain('_:b1');
    expect(ttl).toContain('"say \\"hi\\"\\n"');
    expect(ttl).toContain("^^<http://www.w3.org/2001/XMLSchema#date>");
  });
});
