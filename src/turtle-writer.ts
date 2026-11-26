// Minimal valid Turtle serializer — full IRIs, no prefix elision.
// Grouped by subject; deterministic order (quads already sorted upstream).
import type { Quad, Term } from "./terms.js";

function escapeLiteral(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t");
}

function termToTurtle(t: Term): string {
  if (t.kind === "iri") return `<${t.value}>`;
  if (t.kind === "bnode") return `_:${t.value}`;
  if (t.lang) return `"${escapeLiteral(t.value)}"@${t.lang}`;
  const dt = t.datatype ?? "http://www.w3.org/2001/XMLSchema#string";
  if (dt === "http://www.w3.org/2001/XMLSchema#string") return `"${escapeLiteral(t.value)}"`;
  return `"${escapeLiteral(t.value)}"^^<${dt}>`;
}

export function serializeTurtle(quads: readonly Quad[]): string {
  const bySubject = new Map<string, { term: Term; pairs: { p: Term; o: Term }[] }>();
  for (const q of quads) {
    const key = termToTurtle(q.s) + "|" + termToTurtle(q.p);
    const entry = bySubject.get(termToTurtle(q.s));
    if (entry) {
      const subjectEntry = bySubject.get(termToTurtle(q.s))!;
      const list = subjectEntry.pairs;
      const existing = list.find((pair) => termToTurtle(pair.p) === termToTurtle(q.p));
      if (existing) existing.o = [existing.o].flat().concat(q.o) as unknown as Term;
      else list.push({ p: q.p, o: q.o });
    } else {
      bySubject.set(termToTurtle(q.s), { term: q.s, pairs: [{ p: q.p, o: q.o }] });
    }
    void key;
  }
  const out: string[] = [];
  for (const { term, pairs } of bySubject.values()) {
    const lines = pairs.map(({ p, o }) => `    ${termToTurtle(p)} ${[o].flat().map(termToTurtle).join(", ")}`);
    out.push(`${termToTurtle(term)}\n${lines.join(" ;\n")} .`);
  }
  return out.join("\n\n") + (out.length ? "\n" : "");
}
