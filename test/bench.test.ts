// Bench suite: 8 representative read queries over a deterministic ~5k-quad
// fixture shaped like a glossarist concept register. Ceilings are deliberately
// loose (CI-stable, ~50x observed local times); exact result counts assert
// engine correctness so the benchmark cannot go vacuously green.
// Exports allow running the bench programmatically:
//   import { benchSummary } from "./test/bench.test.js";
import { describe, expect, it } from "vitest";
import { QuadStore } from "../src/store.js";
import { iri, literal, type Term } from "../src/terms.js";
import { parseQuery } from "../src/sparql-parser.js";
import { evaluate } from "../src/sparql-evaluator.js";

const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const SKOS = "http://www.w3.org/2004/02/skos/core#";
const GLOSS = "https://www.glossarist.org/ontologies/";
const BASE = "https://example.org/vocab/concept/";
const SCHEME = "https://example.org/vocab/scheme";
const CONCEPT_COUNT = 500; // 10 quads per concept → 5000 quads

/** Deterministic fixture: 500 concepts in a 10-wide tree with en/fr labels,
 * synonyms, definitions, identifiers, and a 1-in-20 superseded status. */
export function buildBenchStore(): QuadStore {
  const store = new QuadStore();
  const insert = (s: Term, p: string, o: Term) => store.insert({ s, p: iri(p), o });
  for (let i = 1; i <= CONCEPT_COUNT; i++) {
    const c = iri(`${BASE}${i}`);
    insert(c, RDF_TYPE, iri(`${SKOS}Concept`));
    insert(c, `${SKOS}prefLabel`, literal(`term ${i}`, "en"));
    insert(c, `${SKOS}prefLabel`, literal(`terme ${i}`, "fr"));
    insert(c, `${SKOS}altLabel`, literal(`syn ${i}.1`, "en"));
    insert(c, `${SKOS}altLabel`, literal(`syn ${i}.2`, "en"));
    insert(c, `${SKOS}definition`, literal(`Definition text for term ${i}.`, "en"));
    insert(c, `${SKOS}broader`, iri(i <= 10 ? SCHEME : `${BASE}${Math.floor(i / 10)}`));
    insert(c, `${SKOS}inScheme`, iri(SCHEME));
    insert(c, `${GLOSS}identifier`, literal(String(i)));
    insert(c, `${GLOSS}status`, literal(i % 20 === 0 ? "superseded" : "valid"));
  }
  return store;
}

const CEILING_MS = 2_000;

export interface BenchRow { name: string; query: string; results: number; expected: number; ms: number; ceilingMs: number }

const QUERIES: { name: string; sparql: string; expected: number }[] = [
  { name: "full-scan-bgp", sparql: `SELECT ?c WHERE { ?c a skos:Concept }`, expected: CONCEPT_COUNT },
  // ids starting with 4: 4, 40-49, 400-499 → 111 en labels
  { name: "label-regex-lang", sparql: `SELECT ?c ?l WHERE { ?c skos:prefLabel ?l . FILTER (regex(str(?l), "^term 4") && lang(?l) = "en") }`, expected: 111 },
  // concepts 11-500 have concept parents with en labels; the 10 root-parented rows drop out
  { name: "join-broader-label", sparql: `SELECT ?c ?bl WHERE { ?c skos:broader ?b . ?b skos:prefLabel ?bl . FILTER (lang(?bl) = "en") }`, expected: 490 },
  { name: "optional-status", sparql: `SELECT ?c ?status WHERE { ?c a skos:Concept . OPTIONAL { ?c gloss:status "superseded" . } }`, expected: CONCEPT_COUNT },
  { name: "union-labels", sparql: `SELECT ?c WHERE { { ?c skos:prefLabel ?l . FILTER (lang(?l) = "en") } UNION { ?c gloss:status "superseded" . ?c skos:prefLabel ?l2 } }`, expected: CONCEPT_COUNT + 50 },
  { name: "subquery-superseded", sparql: `SELECT ?c ?l WHERE { { SELECT ?c WHERE { ?c a skos:Concept . ?c gloss:status "superseded" . } } ?c skos:prefLabel ?l }`, expected: 50 },
  // ids with prefix 42: "42" + "420".."429" → 11
  { name: "bind-regex", sparql: `SELECT ?c ?s WHERE { ?c gloss:identifier ?id . BIND (str(?id) AS ?s) . FILTER (regex(?s, "^42")) }`, expected: 11 },
  { name: "minus-superseded", sparql: `SELECT ?c WHERE { ?c a skos:Concept . MINUS { ?c gloss:status "superseded" . } }`, expected: CONCEPT_COUNT - 25 },
];

export function runBench(store: QuadStore = buildBenchStore()): BenchRow[] {
  const rows: BenchRow[] = [];
  for (const { name, sparql, expected } of QUERIES) {
    const parsed = parseQuery(sparql);
    evaluate(store, parsed as never); // warmup (interning, branch prediction)
    const t0 = performance.now();
    const result = evaluate(store, parsed as never) as { bindings: unknown[] };
    const ms = performance.now() - t0;
    rows.push({ name, query: sparql, results: result.bindings.length, expected, ms, ceilingMs: CEILING_MS });
  }
  return rows;
}

export function formatBenchSummary(rows: BenchRow[], quadCount: number): string {
  const lines = [`glossarist-sparql bench — ${quadCount}-quad fixture, ${rows.length} queries (ceiling ${rows[0]?.ceilingMs ?? CEILING_MS} ms each)`];
  let total = 0;
  for (const r of rows) {
    total += r.ms;
    lines.push(`  ${r.name.padEnd(20)} ${String(r.results).padStart(5)} results ${r.ms.toFixed(2).padStart(9)} ms`);
  }
  lines.push(`  ${"total".padEnd(20)} ${"".padStart(5)}         ${total.toFixed(2).padStart(9)} ms`);
  return lines.join("\n");
}

export function benchSummary(store: QuadStore = buildBenchStore()): string {
  return formatBenchSummary(runBench(store), store.size);
}

describe("bench suite (5k-quad fixture)", () => {
  it("8 representative queries stay under loose ceilings and return exact counts", () => {
    const store = buildBenchStore();
    expect(store.size).toBe(5_000);
    const rows = runBench(store);
    for (const r of rows) {
      expect(r.results, r.name).toBe(r.expected);
      expect(r.ms, `${r.name} exceeded ${r.ceilingMs} ms`).toBeLessThan(r.ceilingMs);
    }
    // exported for programmatic runs; surfaced here so CI logs carry the numbers
    console.info(`\n${benchSummary(store)}\n`);
  }, 60_000);
});
