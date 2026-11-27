// SPARQL v0 evaluator over the QuadStore.
// Solutions = var→Term bindings. Filters apply at group end (proper scoping).
// Guards: wall-clock deadline + query cost ceiling (solution blow-up cap).
import type { Query, Group, Expr } from "./sparql-parser.js";
import { isVar, termKey, literal, iri, type Term, type PatternTerm, type TriplePattern, type Quad } from "./terms.js";

export class SparqlTimeoutError extends Error {}
export class SparqlCostError extends Error {}

export type Solution = Record<string, Term>;
export interface EvalOptions { deadlineMs?: number; maxSolutions?: number }

const MAX_SOLUTIONS_DEFAULT = 100_000;

class EvalCtx {
  constructor(readonly deadline: number, readonly maxSolutions: number) {}
  check(count: number): void {
    if (Date.now() > this.deadline) throw new SparqlTimeoutError("query exceeded wall-clock deadline");
    if (count > this.maxSolutions) throw new SparqlCostError("query exceeded solution ceiling");
  }
}

function substitute(patternTerm: PatternTerm, solution: Solution): Term | null {
  if (isVar(patternTerm)) return solution[patternTerm.name] ?? null;
  return patternTerm;
}

function compatible(a: Solution, b: Record<string, Term | null>): boolean {
  for (const k of Object.keys(b)) {
    const bv = b[k];
    const av = a[k];
    if (av === undefined || bv === null) continue;
    if (termKey(av) !== termKey(bv)) return false;
  }
  return true;
}

function merge(a: Solution, b: Solution): Solution {
  return { ...a, ...b };
}

function evalBgp(store: { match(s?: Term, p?: Term, o?: Term): Quad[] }, triples: TriplePattern[], input: Solution[], ctx: EvalCtx): Solution[] {
  let solutions = input;
  for (const tp of triples) {
    const next: Solution[] = [];
    for (const solution of solutions) {
      const s = substitute(tp.s, solution);
      const p = substitute(tp.p, solution);
      const o = substitute(tp.o, solution);
      for (const quad of store.match(s ?? undefined, p ?? undefined, o ?? undefined)) {
        const extended = { ...solution };
        if (s === null && isVar(tp.s)) extended[(tp.s as { name: string }).name] = quad.s;
        if (p === null && isVar(tp.p)) extended[(tp.p as { name: string }).name] = quad.p;
        if (o === null && isVar(tp.o)) extended[(tp.o as { name: string }).name] = quad.o;
        next.push(extended);
        ctx.check(next.length);
      }
    }
    solutions = next;
  }
  return solutions;
}

function evalGroup(group: Group, store: { match(s?: Term, p?: Term, o?: Term): Quad[] }, input: Solution[], ctx: EvalCtx): Solution[] {
  let solutions = input;
  const filters: Expr[] = [];
  for (const element of group) {
    if (element.type === "filter") { filters.push(element.expr); continue; }
    if (element.type === "bgp") {
      solutions = evalBgp(store, element.triples, solutions, ctx);
      continue;
    }
    if (element.type === "optional") {
      const inner = element.group;
      const next: Solution[] = [];
      for (const solution of solutions) {
        const extended = evalGroup(inner, store, [solution], ctx);
        if (extended.length > 0) next.push(...extended);
        else next.push(solution);
        ctx.check(next.length);
      }
      solutions = next;
      continue;
    }
    if (element.type === "union") {
      const next: Solution[] = [];
      for (const branch of element.groups) next.push(...evalGroup(branch, store, solutions, ctx));
      ctx.check(next.length);
      solutions = next;
      continue;
    }
    if (element.type === "values") {
      const next: Solution[] = [];
      for (const solution of solutions) {
        for (const binding of element.bindings) {
          if (compatible(solution, binding)) {
          const merged: Solution = { ...solution };
          for (const k of Object.keys(binding)) { const v = binding[k]; if (v !== null) merged[k] = v; }
          next.push(merged);
        }
        }
        ctx.check(next.length);
      }
      solutions = next;
    }
  }
  // filters apply at group end, over the group's final solutions
  if (filters.length > 0 && solutions.length > 0) {
    solutions = solutions.filter((solution) => filters.every((f) => effectiveBoolean(evalExpr(f, solution))));
    ctx.check(solutions.length);
  }
  return solutions;
}

function evalExpr(expr: Expr, solution: Solution): Term | null {
  switch (expr.type) {
    case "term": {
      if (isVar(expr.term)) return solution[expr.term.name] ?? null;
      return expr.term;
    }
    case "not": return effectiveBoolean(evalExpr(expr.inner, solution)) ? null : literal("true", { datatype: "http://www.w3.org/2001/XMLSchema#boolean" });
    case "and": {
      const l = effectiveBoolean(evalExpr(expr.left, solution));
      // error semantics simplified: false dominates
      if (l === false) return literal("false", { datatype: "http://www.w3.org/2001/XMLSchema#boolean" });
      const r = effectiveBoolean(evalExpr(expr.right, solution));
      if (r === false) return literal("false", { datatype: "http://www.w3.org/2001/XMLSchema#boolean" });
      if (l === true && r === true) return literal("true", { datatype: "http://www.w3.org/2001/XMLSchema#boolean" });
      return null;
    }
    case "or": {
      const l = effectiveBoolean(evalExpr(expr.left, solution));
      if (l === true) return literal("true", { datatype: "http://www.w3.org/2001/XMLSchema#boolean" });
      const r = effectiveBoolean(evalExpr(expr.right, solution));
      if (r === true) return literal("true", { datatype: "http://www.w3.org/2001/XMLSchema#boolean" });
      if (l === false && r === false) return literal("false", { datatype: "http://www.w3.org/2001/XMLSchema#boolean" });
      return null;
    }
    case "compare": {
      const l = evalExpr(expr.left, solution);
      const r = evalExpr(expr.right, solution);
      if (!l || !r) return null;
      const cmp = compareTerms(l, r);
      if (cmp === null) return null;
      const ok = expr.op === "=" ? cmp === 0 : expr.op === "!=" ? cmp !== 0 : expr.op === "<" ? cmp < 0 : expr.op === "<=" ? cmp <= 0 : expr.op === ">" ? cmp > 0 : cmp >= 0;
      return ok ? literal("true", { datatype: "http://www.w3.org/2001/XMLSchema#boolean" }) : literal("false", { datatype: "http://www.w3.org/2001/XMLSchema#boolean" });
    }
    case "call": {
      switch (expr.name) {
        case "bound": {
          const arg = expr.args[0];
          if (arg.type !== "term" || !isVar(arg.term)) throw new Error("BOUND requires a variable");
          return solution[arg.term.name] !== undefined ? literal("true", { datatype: "http://www.w3.org/2001/XMLSchema#boolean" }) : literal("false", { datatype: "http://www.w3.org/2001/XMLSchema#boolean" });
        }
        case "lang": {
          const t = evalExpr(expr.args[0], solution);
          if (!t || t.kind !== "literal") return null;
          return literal(t.lang ?? "");
        }
        case "datatype": {
          const t = evalExpr(expr.args[0], solution);
          if (!t || t.kind !== "literal") return null;
          const XSD = "http://www.w3.org/2001/XMLSchema#";
          const RL = "http://www.w3.org/1999/02/22-rdf-syntax-ns#langString";
          return iri(t.lang ? RL : (t.datatype ?? `${XSD}string`));
        }
        case "str": {
          const t = evalExpr(expr.args[0], solution);
          if (!t) return null;
          if (t.kind === "literal") return literal(t.value);
          if (t.kind === "iri") return literal(t.value);
          return null;
        }
        case "regex": {
          const text = evalExpr(expr.args[0], solution);
          const pattern = evalExpr(expr.args[1], solution);
          if (!text || !pattern || text.kind !== "literal" || pattern.kind !== "literal") return null;
          if (pattern.value.length > 256) throw new Error("regex pattern too long"); // ReDoS surface guard
          const flags = expr.args[2] ? (evalExpr(expr.args[2], solution) as Term | null)?.value ?? "" : "";
          if (!/^[imsux]*$/.test(flags)) throw new Error("unsupported regex flags");
          return new RegExp(pattern.value, flags).test(text.value)
            ? literal("true", { datatype: "http://www.w3.org/2001/XMLSchema#boolean" })
            : literal("false", { datatype: "http://www.w3.org/2001/XMLSchema#boolean" });
        }
      }
    }
  }
}

function numericValue(t: Term): number | null {
  if (t.kind !== "literal") return null;
  const dt = t.datatype;
  const numeric = dt === "http://www.w3.org/2001/XMLSchema#integer" || dt === "http://www.w3.org/2001/XMLSchema#decimal" || dt === "http://www.w3.org/2001/XMLSchema#double" || dt === "http://www.w3.org/2001/XMLSchema#float" || dt === undefined && /^\s*[-+]?\d+(\.\d+)?\s*$/.test(t.value) === false ? null : Number(t.value);
  if (numeric !== null && !Number.isNaN(numeric)) return numeric;
  return dt === undefined && Number.isNaN(Number(t.value)) ? null : Number.isNaN(Number(t.value)) ? null : Number(t.value);
}

function compareTerms(a: Term, b: Term): number | null {
  const an = numericValue(a), bn = numericValue(b);
  if (an !== null && bn !== null) return an < bn ? -1 : an > bn ? 1 : 0;
  if (a.kind === "literal" && b.kind === "literal") {
    if ((a.lang ?? "") !== (b.lang ?? "")) return null;
    const ad = a.datatype ?? "http://www.w3.org/2001/XMLSchema#string";
    const bd = b.datatype ?? "http://www.w3.org/2001/XMLSchema#string";
    if (ad !== bd) return null;
    return a.value < b.value ? -1 : a.value > b.value ? 1 : 0;
  }
  if (a.kind !== "literal" && b.kind !== "literal") {
    const ka = termKey(a), kb = termKey(b);
    return ka === kb ? 0 : ka < kb ? -1 : 1;
  }
  return null;
}

function effectiveBoolean(term: Term | null): boolean | null {
  if (!term || term.kind !== "literal") return null;
  const XSD = "http://www.w3.org/2001/XMLSchema#";
  const dt = term.datatype ?? `${XSD}string`;
  if (dt === `${XSD}boolean`) return term.value === "true";
  if (dt === `${XSD}string` && !term.lang) return term.value.length > 0;
  if ((dt === `${XSD}integer` || dt === `${XSD}decimal` || dt === `${XSD}double`)) return Number(term.value) !== 0 && !Number.isNaN(Number(term.value));
  return null; // type error
}

// ---- public entry ----------------------------------------------------------

export interface SelectResult { vars: string[]; bindings: Solution[] }
export interface ConstructResult { quads: Quad[] }

export function evaluate(store: { match(s?: Term, p?: Term, o?: Term): Quad[]; size: number }, query: Query, opts: EvalOptions = {}): SelectResult | boolean | ConstructResult {
  const ctx = new EvalCtx(opts.deadlineMs ?? Date.now() + 5_000, opts.maxSolutions ?? MAX_SOLUTIONS_DEFAULT);
  const input: Solution[] = [{}];

  if (query.form === "ask") {
    const solutions = evalGroup(query.where, store, input, ctx);
    return solutions.length > 0;
  }

  if (query.form === "construct") {
    const solutions = evalGroup(query.where, store, input, ctx);
    const quads: Quad[] = [];
    const seen = new Set<string>();
    for (const solution of solutions) {
      for (const tp of query.template) {
        const s = substitute(tp.s, solution);
        const p = substitute(tp.p, solution);
        const o = substitute(tp.o, solution);
        if (!s || !p || !o || isVar(s) || isVar(p) || isVar(o)) continue; // unbound → triple dropped
        const quad = { s, p, o };
        const key = `${termKey(s)}|${termKey(p)}|${termKey(o)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        quads.push(quad);
      }
      ctx.check(quads.length);
    }
    return { quads };
  }

  let solutions = evalGroup(query.where, store, input, ctx);
  const allVars = collectVars(query.where);
  const vars = query.vars ?? allVars;

  if (query.order.length > 0) {
    solutions = [...solutions].sort((a, b) => {
      for (const { name, desc } of query.order) {
        const ta = a[name], tb = b[name];
        if (ta === undefined && tb === undefined) continue;
        if (ta === undefined) return 1; // unbound sorts last
        if (tb === undefined) return -1;
        const cmp = compareTerms(ta, tb) ?? compareStrings(termKey(ta), termKey(tb));
        if (cmp !== 0) return desc ? -cmp : cmp;
      }
      return 0;
    });
  }

  let distinctKeys: Set<string> | null = null;
  if (query.distinct) {
    distinctKeys = new Set();
    const deduped: Solution[] = [];
    for (const solution of solutions) {
      const key = vars.map((v) => (solution[v] ? termKey(solution[v]) : "")).join("|");
      if (distinctKeys.has(key)) continue;
      distinctKeys.add(key);
      deduped.push(solution);
    }
    solutions = deduped;
  }

  if (query.offset > 0) solutions = solutions.slice(query.offset);
  if (query.limit !== null) solutions = solutions.slice(0, query.limit);

  return {
    vars: vars === null ? allVars : vars.filter((v) => allVars.includes(v)),
    bindings: solutions,
  };
}

function compareStrings(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }

function collectVars(group: Group): string[] {
  const out = new Set<string>();
  const walk = (elements: Group) => {
    for (const el of elements) {
      if (el.type === "bgp") for (const tp of el.triples) for (const t of [tp.s, tp.p, tp.o]) if (isVar(t)) out.add(t.name);
      if (el.type === "optional") walk(el.group);
      if (el.type === "union") for (const g of el.groups) walk(g);
      if (el.type === "values") for (const b of el.bindings) for (const k of Object.keys(b)) out.add(k);
    }
  };
  walk(group);
  return [...out];
}
