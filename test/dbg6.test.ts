import { it } from "vitest";
import { parseQuery } from "../src/sparql-parser.js";
it("bisect", () => {
  const queries = [
    ['A', 'SELECT ?x WHERE { ?c skos:prefLabel ?x . FILTER (lang(?x) = "deu") }'],
    ['B', 'SELECT ?x WHERE { ?c skos:prefLabel ?x . FILTER (regex(?x, "m") ) }'],
    ['C', 'SELECT ?x WHERE { ?c skos:prefLabel ?x . FILTER (regex(str(?x), "m")) }'],
    ['D', 'SELECT ?x WHERE { ?c skos:prefLabel ?x . FILTER (lang(?x) = "deu" && regex(?x, "m")) }'],
    ['E', 'SELECT ?x WHERE { ?c skos:prefLabel ?x . FILTER (lang(?x) = "deu") . FILTER (regex(?x, "m")) }'],
  ];
  for (const [tag, q] of queries) {
    try { parseQuery(q); console.log(tag, "OK"); }
    catch (e) { console.log(tag, "ERR:", (e as Error).message, "|", (e as Error).stack?.split("\n")[1]?.trim().slice(0, 60)); }
  }
  expect(1).toBe(1);
});
import { expect } from "vitest";
