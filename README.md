# glossarist-sparql

Roll-our-own SPARQL engine for glossarist data — pure TypeScript, zero dependencies, runs in Workers / Node / browsers.

- **Quadstore** — dictionary-encoded, SPO/POS/OSP indexes
- **JSON-LD reader** — losslessly parses glossarist-js's deterministic compact JSON-LD projection back to quads
- **SPARQL subset v0** — SELECT/ASK/CONSTRUCT, BGP, OPTIONAL, UNION, VALUES, FILTER (=, regex, lang, datatype, bound), ORDER BY/LIMIT/OFFSET
- **Tests** — real VIM fixtures + curated W3C SPARQL 1.1 test-suite subset

No third-party engine anywhere — same philosophy as glossarist-js's quad-direct JSON-LD writer.
