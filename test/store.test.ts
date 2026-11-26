import { describe, expect, it } from "vitest";
import { QuadStore } from "../src/store.js";
import { iri, literal, blank } from "../src/terms.js";

const s = iri("https://example.org/x");
const type = iri("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
const cls = iri("https://www.glossarist.org/ontologies/Concept");
const label = iri("http://www.w3.org/2004/02/skos/core#prefLabel");

describe("QuadStore", () => {
  it("set semantics: duplicate inserts are no-ops", () => {
    const st = new QuadStore();
    expect(st.insert({ s, p: type, o: cls })).toBe(true);
    expect(st.insert({ s, p: type, o: cls })).toBe(false);
    expect(st.size).toBe(1);
  });
  it("matches by binding pattern with term normalization", () => {
    const st = new QuadStore();
    st.insert({ s, p: label, o: literal("measurement", "ENG") }); // lang lowercased
    const hits = st.match(undefined, label, literal("measurement", { lang: "eng" }));
    expect(hits).toHaveLength(1);
  });
  it("two-term index lookups agree with full scans", () => {
    const st = new QuadStore();
    st.insert({ s, p: type, o: cls });
    st.insert({ s, p: label, o: literal("x") });
    st.insert({ s: blank("b"), p: type, o: cls });
    expect(st.match(s, type)).toHaveLength(1);
    expect(st.match(undefined, type, cls)).toHaveLength(2);
    expect(st.match()).toHaveLength(3);
  });
});
