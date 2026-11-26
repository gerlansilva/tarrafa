import type { Work } from "./types";
import { cleanDoi, toYear } from "./sources/util";

/** Importa RIS exportado do Google Scholar, Portal CAPES, Scopus etc. (sem raspagem). */
export function parseRIS(text: string, label: string): Work[] {
  const out: Work[] = [];
  let cur: Record<string, string[]> = {};
  const flush = () => {
    if (!Object.keys(cur).length) return;
    const g = (...k: string[]) => k.flatMap((x) => cur[x] ?? []);
    out.push({
      key: "",
      title: g("TI", "T1")[0] ?? "(sem título)",
      authors: g("AU", "A1"),
      year: toYear(g("PY", "Y1", "DA")[0]),
      venue: g("T2", "JO", "JF", "SO")[0],
      issn: g("SN"),
      doi: cleanDoi(g("DO")[0]),
      url: g("UR")[0],
      abstract: g("AB", "N2")[0],
      keywords: g("KW"),
      lang: g("LA")[0],
      type: g("TY")[0],
      sources: [label],
    });
    cur = {};
  };
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Z][A-Z0-9])  - ?(.*)$/);
    if (!m) continue;
    if (m[1] === "ER") flush();
    else (cur[m[1]] ??= []).push(m[2].trim());
  }
  flush();
  return out;
}

export function parseBibTeX(text: string, label: string): Work[] {
  const out: Work[] = [];
  const entries = text.split(/\n\s*@/).map((e, i) => (i ? "@" + e : e));
  for (const e of entries) {
    const head = e.match(/@(\w+)\s*\{/);
    if (!head) continue;
    const field = (name: string) => {
      const m = e.match(new RegExp(`\\b${name}\\s*=\\s*(\\{((?:[^{}]|\\{[^{}]*\\})*)\\}|"([^"]*)"|(\\d+))`, "i"));
      return (m?.[2] ?? m?.[3] ?? m?.[4])?.replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
    };
    out.push({
      key: "",
      title: field("title") ?? "(sem título)",
      authors: (field("author") ?? "").split(/\s+and\s+/).filter(Boolean),
      year: toYear(field("year")),
      venue: field("journal") ?? field("booktitle") ?? field("school"),
      doi: cleanDoi(field("doi")),
      url: field("url"),
      abstract: field("abstract"),
      keywords: field("keywords")?.split(/[;,]\s*/),
      type: head[1].toLowerCase(),
      sources: [label],
    });
  }
  return out;
}
