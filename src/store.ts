import type { HistoryEntry, JournalList, Settings } from "./types";

const read = <T>(k: string, d: T): T => {
  try {
    const v = localStorage.getItem(`tarrafa:${k}`);
    return v ? (JSON.parse(v) as T) : d;
  } catch {
    return d;
  }
};
const write = (k: string, v: unknown) => {
  try {
    localStorage.setItem(`tarrafa:${k}`, JSON.stringify(v));
  } catch {
    /* armazenamento indisponível */
  }
};

export const DEFAULT_SETTINGS: Settings = {
  email: "",
  s2Key: "",
  openalexKey: "",
  maxPerSource: 500,
  scieloCollection: "scl",
  enabledSources: ["openalex", "eric", "crossref", "scielo", "bdtd"],
};

/** Lista inicial de exemplo — confira os ISSNs com o botão "Verificar". */
const PRESET_LISTS: JournalList[] = [
  {
    id: "edmat-br",
    name: "Educação Matemática e Estatística (BR/LatAm)",
    journals: [
      { title: "Bolema: Boletim de Educação Matemática", issn: "1980-4415", alt: ["0103-636X"] },
      { title: "Zetetiké", issn: "2176-1744", alt: ["0104-4877"] },
      { title: "Educação Matemática Pesquisa", issn: "1983-3156", alt: ["1516-5388"] },
      { title: "REVEMAT", issn: "1981-1322" },
      { title: "Acta Scientiae", issn: "2178-7727" },
      { title: "RELIME", issn: "1665-2436" },
    ],
  },
  {
    id: "stat-ed",
    name: "Statistics Education (internacional)",
    journals: [
      { title: "Statistics Education Research Journal", issn: "1570-1824" },
      { title: "Journal of Statistics and Data Science Education", issn: "2693-9169" },
      { title: "Teaching Statistics", issn: "0141-982X" },
    ],
  },
];

export const store = {
  settings: (): Settings => ({ ...DEFAULT_SETTINGS, ...read<Partial<Settings>>("settings", {}) }),
  saveSettings: (s: Settings) => write("settings", s),
  lists: (): JournalList[] => read("lists", PRESET_LISTS),
  saveLists: (l: JournalList[]) => write("lists", l),
  history: (): HistoryEntry[] => read("history", []),
  saveHistory: (h: HistoryEntry[]) => write("history", h.slice(0, 200)),
};
