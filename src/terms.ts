// RDF terms (RDF 1.1): simple literals ARE xsd:string; lang tags normalize to lowercase.
export type Iri = { kind: "iri"; value: string };
export type Blank = { kind: "bnode"; value: string };
export type Literal = { kind: "literal"; value: string; lang?: string; datatype?: string };
export type Term = Iri | Blank | Literal;

export const XSD_STRING = "http://www.w3.org/2001/XMLSchema#string";
const LANG_STRING = "http://www.w3.org/1999/02/22-rdf-syntax-ns#langString";

export function iri(value: string): Iri {
  return { kind: "iri", value };
}
export function blank(value: string): Blank {
  return { kind: "bnode", value };
}
export function literal(value: string, langOrDatatype?: string | { lang?: string; datatype?: string }): Literal {
  if (typeof langOrDatatype === "string") return { kind: "literal", value, lang: langOrDatatype.toLowerCase() };
  if (langOrDatatype?.lang) return { kind: "literal", value, lang: langOrDatatype.lang.toLowerCase() };
  const dt = langOrDatatype?.datatype;
  if (dt && dt !== XSD_STRING) return { kind: "literal", value, datatype: dt };
  return { kind: "literal", value };
}

export function termKey(t: Term): string {
  if (t.kind === "iri") return `i:${t.value}`;
  if (t.kind === "bnode") return `b:${t.value}`;
  const dt = t.lang ? LANG_STRING : (t.datatype ?? XSD_STRING);
  return `l:${dt}:${t.lang ?? ""}:${t.value}`;
}

export type Quad = { s: Term; p: Term; o: Term };
