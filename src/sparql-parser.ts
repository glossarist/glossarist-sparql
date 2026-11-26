// SPARQL v0 subset: tokenizer -> recursive-descent parser -> AST.
// SELECT (DISTINCT) / ASK / CONSTRUCT; BGPs (a, prefixed names, literals);
// OPTIONAL; UNION; VALUES; FILTER (comparisons, regex/lang/datatype/bound,
// &&, ||, !); ORDER BY / LIMIT / OFFSET; PREFIX / BASE.
// Deliberately out of scope v0: property paths, subqueries, aggregates,
// named graphs, SERVICE, UPDATE.
import { iri, blank, literal, isVar, type Term, type PatternTerm, type TriplePattern } from "./terms.js";

export class SparqlSyntaxError extends Error {}

export type Expr =
  | { type: "or" | "and"; left: Expr; right: Expr }
  | { type: "not"; inner: Expr }
  | { type: "compare"; op: "=" | "!=" | "<" | ">"; left: Expr; right: Expr }
  | { type: "call"; name: "regex" | "lang" | "datatype" | "bound" | "str"; args: Expr[] }
  | { type: "term"; term: PatternTerm };

export type GroupElement =
  | { type: "bgp"; triples: TriplePattern[] }
  | { type: "optional"; group: Group }
  | { type: "union"; groups: Group[] }
  | { type: "values"; bindings: Record<string, Term | null>[] }
  | { type: "filter"; expr: Expr };
export type Group = GroupElement[];

export type { TriplePattern };

export type Query =
  | { form: "select"; distinct: boolean; vars: string[] | null; where: Group; order: { name: string; desc: boolean }[]; limit: number | null; offset: number }
  | { form: "ask"; where: Group }
  | { form: "construct"; template: TriplePattern[]; where: Group };

const RESERVED = new Set(["SELECT", "ASK", "CONSTRUCT", "WHERE", "DISTINCT", "OPTIONAL", "UNION", "FILTER", "ORDER", "BY", "ASC", "DESC", "LIMIT", "OFFSET", "PREFIX", "BASE", "REGEX", "LANG", "DATATYPE", "BOUND", "A", "VALUES", "TRUE", "FALSE", "STR"]);

type Token =
  | { kind: "kw"; text: string }
  | { kind: "var"; text: string }
  | { kind: "iri"; text: string }
  | { kind: "pname"; text: string }
  | { kind: "bnode"; text: string }
  | { kind: "string"; text: string; tag?: string }
  | { kind: "number"; text: string }
  | { kind: "punct"; text: string };

export function tokenize(input: string): Token[] {
  const toks: Token[] = [];
  let i = 0;
  const nameChar = (c: string) => /[A-Za-z0-9_À-ǿ%\\.-]/.test(c);
  while (i < input.length) {
    const c = input[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "#") { while (i < input.length && input[i] !== "\n") i++; continue; }
    if (c === '"') {
      let j = i + 1, out = "";
      while (j < input.length && input[j] !== '"') {
        if (input[j] === "\\") { out += input[j + 1]; j += 2; continue; }
        out += input[j]; j++;
      }
      let tag: string | undefined;
      if (input[j + 1] === "@") {
        let k = j + 2; while (k < input.length && /[A-Za-z-]/.test(input[k])) k++;
        tag = input.slice(j + 2, k).toLowerCase(); j = k;
      } else if (input[j + 1] === "^" && input[j + 2] === "^") {
        let k = j + 3, dt = "";
        if (input[k] === "<") { k++; while (input[k] !== ">") { dt += input[k]; k++; } }
        else { k++; while (k < input.length && nameChar(input[k])) { dt += input[k]; k++; } }
        tag = dt; j = k - 1;
      }
      toks.push({ kind: "string", text: out, tag });
      i = j + 1; continue;
    }
    if (c === "$" || c === "?") {
      let j = i + 1, out = "";
      while (j < input.length && /[A-Za-z0-9_]/.test(input[j])) { out += input[j]; j++; }
      toks.push({ kind: "var", text: out }); i = j; continue;
    }
    if (c === "<") {
      let j = i + 1, out = "";
      while (j < input.length && input[j] !== ">") { out += input[j]; j++; }
      toks.push({ kind: "iri", text: out }); i = j + 1; continue;
    }
    if (c === "_" && input[i + 1] === ":") {
      let j = i + 2, out = "";
      while (j < input.length && nameChar(input[j])) { out += input[j]; j++; }
      toks.push({ kind: "bnode", text: out }); i = j; continue;
    }
    if (/[A-Za-z]/.test(c)) {
      let j = i, out = "";
      while (j < input.length && (nameChar(input[j]) || input[j] === ":")) { out += input[j]; j++; }
      if (out.includes(":")) toks.push({ kind: "pname", text: out });
      else if (RESERVED.has(out.toUpperCase()) && out === out.toUpperCase() && RESERVED.has(out)) toks.push({ kind: "kw", text: out.toUpperCase() });
      else toks.push({ kind: "kw", text: out }); // plain word (function names, TRUE/FALSE, or IRI-local leftovers)
      i = j; continue;
    }
    if (/[0-9]/.test(c) || (c === "-" && /[0-9]/.test(input[i + 1] ?? "")) || (c === "+" && /[0-9]/.test(input[i + 1] ?? ""))) {
      let j = i, out = "";
      while (j < input.length && /[0-9.eE+-]/.test(input[j])) { out += input[j]; j++; }
      toks.push({ kind: "number", text: out }); i = j; continue;
    }
    if (c === "&" && input[i + 1] === "&") { toks.push({ kind: "punct", text: "&&" }); i += 2; continue; }
    if (c === "|" && input[i + 1] === "|") { toks.push({ kind: "punct", text: "||" }); i += 2; continue; }
    if (c === "!" && input[i + 1] === "=") { toks.push({ kind: "punct", text: "!=" }); i += 2; continue; }
    if (c === "<" && input[i + 1] === "=") { toks.push({ kind: "punct", text: "<=" }); i += 2; continue; }
    if (c === ">" && input[i + 1] === "=") { toks.push({ kind: "punct", text: ">=" }); i += 2; continue; }
    toks.push({ kind: "punct", text: c }); i++;
  }
  return toks;
}

type St = { toks: Token[]; i: number; prefixes: Record<string, string>; base: string };

function peek(st: St): Token | undefined { return st.toks[st.i]; }
function isKw(st: St, ...words: string[]): boolean { const t = peek(st); return !!t && t.kind === "kw" && words.includes(t.text); }
function eatKw(st: St, word: string): void { if (!isKw(st, word)) throw new SparqlSyntaxError(`expected ${word}, got ${peek(st)?.text ?? "end"}`); next(st); }
function next(st: St): Token { const t = st.toks[st.i++]; if (!t) throw new SparqlSyntaxError("unexpected end of query"); return t; }
function punct(st: St, p: string): void { const t = next(st); if (t.kind !== "punct" || t.text !== p) throw new SparqlSyntaxError(`expected "${p}", got ${t.text}`); }

function resolvePname(st: St, pname: string): string {
  const colon = pname.indexOf(":");
  const ns = st.prefixes[pname.slice(0, colon)];
  if (ns === undefined) throw new SparqlSyntaxError(`unknown prefix: ${pname}`);
  return ns + pname.slice(colon + 1);
}

function patternTermToken(st: St, t: Token): PatternTerm {
  if (t.kind === "var") return { kind: "var", name: t.text };
  if (t.kind === "kw" && t.text === "a") return iri("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
  if (t.kind === "iri") return iri(t.text);
  if (t.kind === "pname") return iri(resolvePname(st, t.text));
  if (t.kind === "bnode") return blank(t.text);
  if (t.kind === "string") return literal(t.text, t.tag);
  if (t.kind === "number") return literal(t.text, { datatype: t.text.includes(".") ? "http://www.w3.org/2001/XMLSchema#decimal" : "http://www.w3.org/2001/XMLSchema#integer" });
  if (t.kind === "kw" && (t.text === "true" || t.text === "false")) return literal(t.text, { datatype: "http://www.w3.org/2001/XMLSchema#boolean" });
  throw new SparqlSyntaxError(`unexpected token in pattern: ${t.text}`);
}

function patternTerm(st: St): PatternTerm {
  return patternTermToken(st, next(st));
}

function parseTriplesSameSubject(st: St): TriplePattern[] {
  const triples: TriplePattern[] = [];
  const s = patternTerm(st);
  for (;;) {
    const p = patternTerm(st);
    for (;;) {
      const o = patternTerm(st);
      triples.push({ s, p, o });
      if (peek(st)?.kind === "punct" && peek(st)!.text === ",") { next(st); continue; }
      break;
    }
    if (peek(st)?.kind === "punct" && peek(st)!.text === ";") {
      next(st);
      if (peek(st)?.kind === "punct" && (peek(st)!.text === "." || peek(st)!.text === "}")) break;
      continue;
    }
    break;
  }
  if (peek(st)?.kind === "punct" && peek(st)!.text === ".") next(st);
  return triples;
}

function parseGroup(st: St): Group {
  punct(st, "{");
  const group: Group = [];
  for (;;) {
    const t = peek(st);
    if (!t) throw new SparqlSyntaxError("unexpected end inside group");
    if (t.kind === "punct" && t.text === "}") { next(st); return group; }
    if (t.kind === "punct" && t.text === ".") { next(st); continue; }
    if (t.kind === "kw" && t.text === "FILTER") {
      next(st);
      group.push({ type: "filter", expr: parseConstraint(st) });
      continue;
    }
    if (t.kind === "kw" && t.text === "OPTIONAL") {
      next(st);
      group.push({ type: "optional", group: parseGroup(st) });
      continue;
    }
    if (t.kind === "punct" && t.text === "{") {
      const groups: Group[] = [parseGroup(st)];
      while (isKw(st, "UNION")) { next(st); groups.push(parseGroup(st)); }
      group.push(groups.length === 1 ? { type: "union", groups } : { type: "union", groups });
      continue;
    }
    if (t.kind === "kw" && t.text === "VALUES") {
      next(st);
      group.push(parseValues(st));
      continue;
    }
    // triples block (one or more subjects)
    const triples = parseTriplesSameSubject(st);
    group.push({ type: "bgp", triples });
  }
}

function parseValues(st: St): { type: "values"; bindings: Record<string, Term | null>[] } {
  const vars: string[] = [];
  if (peek(st)?.kind === "var") {
    vars.push(next(st).text);
  } else {
    punct(st, "(");
    while (peek(st)?.kind === "var") vars.push(next(st).text);
    punct(st, ")");
  }
  punct(st, "{");
  const bindings: Record<string, Term | null>[] = [];
  for (;;) {
    if (peek(st)?.kind === "punct" && peek(st)!.text === "}") { next(st); break; }
    const binding: Record<string, Term | null> = {};
    if (vars.length === 1) {
      const t = peek(st)!;
      if (t.kind === "punct" && t.text === "UNDEF") { next(st); binding[vars[0]] = null; }
      else { const term = patternTerm(st); if (isVar(term)) throw new SparqlSyntaxError("variable not allowed in VALUES data block"); binding[vars[0]] = term; }
      bindings.push(binding);
      continue;
    }
    punct(st, "(");
    for (const v of vars) {
      const t = peek(st)!;
      if (t.kind === "punct" && t.text === "UNDEF") { next(st); binding[v] = null; continue; }
      const term = patternTerm(st);
      if (isVar(term)) throw new SparqlSyntaxError("variable not allowed in VALUES data block");
      binding[v] = term;
    }
    punct(st, ")");
    bindings.push(binding);
  }
  return { type: "values", bindings };
}

const BUILTINS = new Set(["REGEX", "LANG", "DATATYPE", "BOUND", "STR"]);

function parseConstraint(st: St): Expr {
  const t = peek(st)!;
  if (t.kind === "punct" && t.text === "(") return parseBracketted(st);
  if (t.kind === "kw" && BUILTINS.has(t.text.toUpperCase())) return parseBuiltIn(st);
  throw new SparqlSyntaxError(`expected constraint, got ${t.text}`);
}

function parseBracketted(st: St): Expr {
  punct(st, "(");
  const e = parseOr(st);
  punct(st, ")");
  return e;
}

function parseBuiltIn(st: St): Expr {
  const name = next(st).text.toLowerCase() as "regex" | "lang" | "datatype" | "bound";
  punct(st, "(");
  const args: Expr[] = [parseExpr(st)];
  while (peek(st)?.kind === "punct" && peek(st)!.text === ",") { next(st); args.push(parseExpr(st)); }
  punct(st, ")");
  return { type: "call", name, args };
}

function parsePrimary(st: St): Expr {
  const t = peek(st)!;
  if (t.kind === "punct" && t.text === "(") return parseBracketted(st);
  if (t.kind === "kw" && t.text === "!") { next(st); return { type: "not", inner: parsePrimary(st) }; }
  if (t.kind === "kw" && BUILTINS.has(t.text.toUpperCase())) return parseBuiltIn(st);
  next(st);
  return { type: "term", term: patternTermToken(st, t) };
}

function parseCompare(st: St): Expr {
  let left = parsePrimary(st);
  for (;;) {
    const t = peek(st);
    if (t?.kind === "punct" && ["=", "!="].includes(t.text)) { next(st); left = { type: "compare", op: t.text as "=" | "!=", left, right: parsePrimary(st) }; continue; }
    if (t?.kind === "punct" && t.text === "<" && !(st.toks[st.i + 1]?.kind === "iri")) { next(st); left = { type: "compare", op: "<", left, right: parsePrimary(st) }; continue; }
    if (t?.kind === "punct" && t.text === ">") { next(st); left = { type: "compare", op: ">", left, right: parsePrimary(st) }; continue; }
    break;
  }
  return left;
}

function parseAnd(st: St): Expr {
  let left = parseCompare(st);
  while (peek(st)?.kind === "punct" && peek(st)!.text === "&&") { next(st); left = { type: "and", left, right: parseCompare(st) }; }
  return left;
}

function parseOr(st: St): Expr {
  let left = parseAnd(st);
  while (peek(st)?.kind === "punct" && peek(st)!.text === "||") { next(st); left = { type: "or", left, right: parseAnd(st) }; }
  return left;
}

function parseExpr(st: St): Expr { return parseOr(st); }

function parseSolutionModifier(st: St, q: Extract<Query, { form: "select" }>): void {
  if (isKw(st, "ORDER")) {
    next(st); eatKw(st, "BY");
    for (;;) {
      const t = peek(st);
      if (!t) break;
      if (t.kind === "kw" && (t.text === "ASC" || t.text === "DESC")) { const desc = t.text === "DESC"; next(st); const v = next(st); if (v.kind !== "var") throw new SparqlSyntaxError("expected variable after ASC/DESC"); q.order.push({ name: v.text, desc }); continue; }
      if (t.kind === "var") { next(st); q.order.push({ name: t.text, desc: false }); continue; }
      break;
    }
  }
  if (isKw(st, "LIMIT")) { next(st); const t = next(st); if (t.kind !== "number") throw new SparqlSyntaxError("expected number after LIMIT"); q.limit = Number(t.text); }
  if (isKw(st, "OFFSET")) { next(st); const t = next(st); if (t.kind !== "number") throw new SparqlSyntaxError("expected number after OFFSET"); q.offset = Number(t.text); }
}

export function parseQuery(input: string): Query {
  const st: St = {
    toks: tokenize(input), i: 0, base: "",
    prefixes: {
      gloss: "https://www.glossarist.org/ontologies/",
      skos: "http://www.w3.org/2004/02/skos/core#",
      skosxl: "http://www.w3.org/2008/05/skos-xl#",
      isothes: "http://purl.org/iso25964/skos-thes#",
      dcterms: "http://purl.org/dc/terms/", prov: "http://www.w3.org/ns/prov#",
      owl: "http://www.w3.org/2002/07/owl#", rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
      rdfs: "http://www.w3.org/2000/01/rdf-schema#", xsd: "http://www.w3.org/2001/XMLSchema#",
    },
  };
  while (isKw(st, "PREFIX")) {
    next(st);
    const pname = next(st);
    if (pname.kind !== "pname" || !pname.text.endsWith(":")) throw new SparqlSyntaxError("expected prefix name ending in ':'");
    const ns = next(st);
    if (ns.kind !== "iri") throw new SparqlSyntaxError("expected namespace IRIREF");
    st.prefixes[pname.text.slice(0, -1)] = ns.text;
  }
  if (isKw(st, "BASE")) { next(st); const t = next(st); if (t.kind !== "iri") throw new SparqlSyntaxError("expected base IRIREF"); st.base = t.text; }

  const form = next(st);
  if (form.kind !== "kw") throw new SparqlSyntaxError("expected SELECT, ASK or CONSTRUCT");

  if (form.text === "ASK") {
    if (isKw(st, "WHERE")) next(st);
    const where = parseGroup(st);
    return { form: "ask", where };
  }

  if (form.text === "CONSTRUCT") {
    const template = parseConstructTemplate(st);
    if (isKw(st, "WHERE")) next(st);
    const where = parseGroup(st);
    return { form: "construct", template, where };
  }

  if (form.text !== "SELECT") throw new SparqlSyntaxError(`unsupported form: ${form.text}`);
  const distinct = isKw(st, "DISTINCT");
  if (distinct) next(st);
  let vars: string[] | null = null;
  if (peek(st)?.kind === "punct" && peek(st)!.text === "*") { next(st); }
  else {
    vars = [];
    while (peek(st)?.kind === "var") vars.push(next(st).text);
    if (vars.length === 0) throw new SparqlSyntaxError("expected variables or * after SELECT");
  }
  if (isKw(st, "WHERE")) next(st);
  const where = parseGroup(st);
  const q: Query = { form: "select", distinct, vars, where, order: [], limit: null, offset: 0 };
  parseSolutionModifier(st, q);
  return q;
}

export function parseConstructTemplate(st: St): TriplePattern[] {
  punct(st, "{");
  const triples: TriplePattern[] = [];
  for (;;) {
    const t = peek(st);
    if (t?.kind === "punct" && t.text === "}") { next(st); return triples; }
    if (t?.kind === "punct" && t.text === ".") { next(st); continue; }
    triples.push(...parseTriplesSameSubject(st));
  }
}
