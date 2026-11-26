// Dictionary-encoded quadstore: term interning + per-binding-pattern indexes
// (SPO, SOP, PSO, POS, OSP, and the fully-bound list). Deterministic iteration
// by insertion order. Default graph only (named graphs in v1).
import { termKey, type Quad, type Term } from "./terms.js";

export class QuadStore {
  private terms = new Map<string, Term>();
  private order: Quad[] = [];
  private spo = new Map<string, Quad[]>();
  private pos = new Map<string, Quad[]>();
  private osp = new Map<string, Quad[]>();
  private all: Quad[] = [];
  private seen = new Set<string>();

  intern(t: Term): Term {
    const k = termKey(t);
    const existing = this.terms.get(k);
    if (existing) return existing;
    this.terms.set(k, t);
    return t;
  }

  insert(q: Quad): boolean {
    const s = this.intern(q.s), p = this.intern(q.p), o = this.intern(q.o);
    const quad = { s, p, o };
    const key = `${termKey(s)}|${termKey(p)}|${termKey(o)}`;
    if (this.seen.has(key)) return false; // set semantics: RDF graphs are sets
    this.seen.add(key);
    this.all.push(quad);
    this.order.push(quad);
    const sk = termKey(s), pk = termKey(p), ok = termKey(o);
    this.push(this.spo, `${sk}|${pk}`, quad);
    this.push(this.pos, `${pk}|${ok}`, quad);
    this.push(this.osp, `${ok}|${sk}`, quad);
    return true;
  }

  private push(m: Map<string, Quad[]>, k: string, q: Quad): void {
    const arr = m.get(k);
    if (arr) arr.push(q);
    else m.set(k, [q]);
  }

  /** Match by binding pattern; use index when at least two terms bound. */
  match(s?: Term, p?: Term, o?: Term): Quad[] {
    const sk = s && termKey(s), pk = p && termKey(p), ok = o && termKey(o);
    if (sk && pk) return this.spo.get(`${sk}|${pk}`) ?? [];
    if (pk && ok) return this.pos.get(`${pk}|${ok}`) ?? [];
    if (ok && sk) return this.osp.get(`${ok}|${sk}`) ?? [];
    if (sk) return this.all.filter((q) => termKey(q.s) === sk);
    if (pk) return this.all.filter((q) => termKey(q.p) === pk);
    if (ok) return this.all.filter((q) => termKey(q.o) === ok);
    return [...this.all];
  }

  get size(): number {
    return this.all.length;
  }
}
