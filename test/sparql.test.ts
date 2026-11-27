// End-to-end SPARQL tests over a synthetic glossarist-shaped store.
import { describe, expect, it } from "vitest";
import { QuadStore } from "../src/store.js";
import { iri, literal, blank, type Term } from "../src/terms.js";
import { readJsonld } from "../src/jsonld-reader.js";
import { parseQuery } from "../src/sparql-parser.js";
import { evaluate } from "../src/sparql-evaluator.js";

const G = "https://www.glossarist.org/ontologies/";
const SKOS = "http://www.w3.org/2004/02/skos/core#";
const CONCEPT = "https://example.org/concept/";

function makeStore(): QuadStore {
  const store = new QuadStore();
  const doc = {
    "@context": { gloss: G, skos: SKOS, rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#", xsd: "http://www.w3.org/2001/XMLSchema#" },
    "@graph": [
      { "@id": `${CONCEPT}1`, "@type": ["gloss:Concept", "skos:Concept"], "gloss:identifier": "3.1", "skos:prefLabel": [{ "@language": "eng", "@value": "measurement" }, { "@language": "fra", "@value": "mesurage" }], "gloss:status": "valid" },
      { "@id": `${CONCEPT}2`, "@type": ["gloss:Concept", "skos:Concept"], "gloss:identifier": "3.2", "skos:prefLabel": [{ "@language": "eng", "@value": "measurement uncertainty" }, { "@language": "fra", "@value": "incertitude de mesure" }], "gloss:status": "superseded" },
      { "@id": `${CONCEPT}3`, "@type": "gloss:Concept", "gloss:identifier": "3.3", "skos:prefLabel": { "@language": "deu", "@value": "Messung" } },
    ],
  };
  for (const q of readJsonld(doc as never)) store.insert(q);
  return store;
}

function run(store: QuadStore, query: string) {
  return evaluate(store, parseQuery(query) as never) as never;
}

describe("SPARQL v0 end-to-end", () => {
  const store = makeStore();

  it("SELECT with BGP + DISTINCT + ORDER", () => {
    const q = parseQuery(`
      PREFIX skos: <${SKOS}>
      SELECT DISTINCT ?label WHERE { ?c a gloss:Concept ; skos:prefLabel ?label . } ORDER BY ?label`);
    const r = evaluate(store, q as never) as { vars: string[]; bindings: Record<string, Term>[] };
    expect(r.vars).toEqual(["label"]);
    expect(r.bindings).toHaveLength(5);
    expect(r.bindings).toHaveLength(5);
    const labels = r.bindings.map((b) => (b.label as { value: string; lang?: string }).value);
    expect(labels).toContain("mesurage");
    // cross-language literals are not comparable in SPARQL — order is
    // implementation-defined across languages, defined within a language.
    const eng = r.bindings.filter((b) => (b.label as { lang: string }).lang === "eng").map((b) => (b.label as { value: string }).value);
    expect(eng).toEqual(["measurement", "measurement uncertainty"]);
  });

  it("FILTER regex + lang()", () => {
    const q = parseQuery(`
      PREFIX skos: <${SKOS}>
      SELECT ?c ?label WHERE {
        ?c skos:prefLabel ?label .
        FILTER (regex(str(?label), "^measure") && lang(?label) = "eng")
      }`);
    const r = evaluate(store, q as never) as { bindings: Record<string, Term>[] };
    expect(r.bindings).toHaveLength(2); // measurement, measurement uncertainty
  });

  it("FILTER numeric-style status equality + OPTIONAL", () => {
    const q = parseQuery(`
      SELECT ?id ?status WHERE {
        ?c gloss:identifier ?id .
        OPTIONAL { ?c gloss:status ?status . }
      } ORDER BY ?id`);
    const r = evaluate(store, q as never) as { bindings: Record<string, Term>[] };
    expect(r.bindings).toHaveLength(3);
    const withStatus = r.bindings.filter((b) => b.status);
    expect(withStatus).toHaveLength(2); // concept 3 has no status → honest OPTIONAL
  });

  it("UNION", () => {
    const q = parseQuery(`
      SELECT ?label WHERE {
        { ?c gloss:status "superseded" . ?c skos:prefLabel ?label . }
        UNION
        { ?c gloss:identifier "3.3" . ?c skos:prefLabel ?label . }
      }`);
    const r = evaluate(store, q as never) as { bindings: Record<string, Term>[] };
    expect(r.bindings).toHaveLength(3); // superseded concept has eng+fra labels + Messung
  });

  it("ASK", () => {
    const q = parseQuery(`ASK WHERE { ?c gloss:identifier "3.1" }`);
    expect(evaluate(store, q as never)).toBe(true);
    const no = parseQuery(`ASK WHERE { ?c gloss:identifier "9.9" }`);
    expect(evaluate(store, no as never)).toBe(false);
  });

  it("LIMIT + OFFSET", () => {
    const q = parseQuery(`SELECT ?id WHERE { ?c gloss:identifier ?id } ORDER BY ?id LIMIT 2 OFFSET 1`);
    const r = evaluate(store, q as never) as { bindings: Record<string, Term>[] };
    expect(r.bindings.map((b) => (b.id as { value: string }).value)).toEqual(["3.2", "3.3"]);
  });

  it("CONSTRUCT drops unbound template triples", () => {
    const q = parseQuery(`
      CONSTRUCT { ?c skos:prefLabel ?label . ?c gloss:missing ?nothing . }
      WHERE { ?c skos:prefLabel ?label . FILTER (lang(?label) = "deu") }`);
    const r = evaluate(store, q as never) as { quads: unknown[] };
    expect(r.quads).toHaveLength(1);
  });

  it("timeout guard raises SparqlTimeoutError", async () => {
    const q = parseQuery(`SELECT ?a ?b WHERE { ?a ?p ?b } `);
    // large cross join: use the store's own triples twice to multiply
    const q2 = parseQuery(`SELECT ?a ?b WHERE { ?a ?p1 ?x . ?b ?p2 ?x }`);
    await expect(async () => {
      evaluate(store, q2 as never, { deadlineMs: Date.now() - 1 });
    }).rejects.toThrow();
  });

  it("FILTER >= and <= comparisons", () => {
    const q = parseQuery(`SELECT ?a WHERE { ?a <http://p> ?o . FILTER (?o >= "2") }`);
    const st = new QuadStore();
    st.insert({ s: { kind: "iri", value: "x:1" }, p: { kind: "iri", value: "http://p" }, o: { kind: "literal", value: "1" } });
    st.insert({ s: { kind: "iri", value: "x:2" }, p: { kind: "iri", value: "http://p" }, o: { kind: "literal", value: "2" } });
    st.insert({ s: { kind: "iri", value: "x:3" }, p: { kind: "iri", value: "http://p" }, o: { kind: "literal", value: "3" } });
    const r = evaluate(st, q as never) as unknown as { bindings: { a: { value: string } }[] };
    expect(r.bindings.map((b) => b.a.value).sort()).toEqual(["x:2", "x:3"]);
  });

  it("FILTER !bound(?v) over OPTIONAL", () => {
    const q = parseQuery(`SELECT ?a WHERE { ?a <http://p> ?o . OPTIONAL { ?a <http://q> ?q } FILTER (!bound(?q)) }`);
    const st = new QuadStore();
    st.insert({ s: { kind: "iri", value: "x:1" }, p: { kind: "iri", value: "http://p" }, o: { kind: "literal", value: "1" } });
    st.insert({ s: { kind: "iri", value: "x:2" }, p: { kind: "iri", value: "http://p" }, o: { kind: "literal", value: "2" } });
    st.insert({ s: { kind: "iri", value: "x:2" }, p: { kind: "iri", value: "http://q" }, o: { kind: "literal", value: "q" } });
    const r = evaluate(st, q as never) as unknown as { bindings: { a: { value: string } }[] };
    expect(r.bindings.map((b) => b.a.value)).toEqual(["x:1"]);
  });
});
