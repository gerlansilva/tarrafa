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

const j = (title: string, issn: string, ...alt: string[]) => ({ title, issn, ...(alt.length ? { alt } : {}) });

/** Modelos de listas de revistas, de várias áreas. ISSNs conferidos no OpenAlex. */
export const LIST_TEMPLATES: JournalList[] = [
  {
    id: "edmat-br",
    name: "Educação Matemática e Estatística (BR/LatAm)",
    journals: [
      j("Bolema: Boletim de Educação Matemática", "1980-4415", "0103-636X"),
      j("Zetetiké", "2176-1744", "0104-4877"),
      j("Educação Matemática Pesquisa", "1983-3156", "1516-5388"),
      j("REVEMAT", "1981-1322"),
      j("Acta Scientiae", "2178-7727"),
      j("RELIME", "1665-2436"),
    ],
  },
  {
    id: "stat-ed",
    name: "Statistics Education (internacional)",
    journals: [
      j("Statistics Education Research Journal", "1570-1824"),
      j("Journal of Statistics and Data Science Education", "2693-9169"),
      j("Teaching Statistics", "0141-982X"),
    ],
  },
  {
    id: "edu-br",
    name: "Educação (BR, SciELO)",
    journals: [
      j("Educação & Sociedade", "0101-7330", "1678-4626"),
      j("Revista Brasileira de Educação", "1413-2478", "1809-449X"),
      j("Educação e Pesquisa", "1517-9702", "1678-4634"),
      j("Cadernos de Pesquisa", "0100-1574", "1980-5314"),
      j("Educar em Revista", "0104-4060", "1984-0411"),
      j("Educação em Revista", "0102-4698", "1982-6621"),
      j("Pro-Posições", "0103-7307", "1980-6248"),
    ],
  },
  {
    id: "enscien-br",
    name: "Ensino de Ciências e Física (BR, SciELO)",
    journals: [
      j("Ciência & Educação (Bauru)", "1516-7313", "1980-850X"),
      j("Ensaio: Pesquisa em Educação em Ciências", "1415-2150", "1983-2117"),
      j("Revista Brasileira de Ensino de Física", "1806-1117", "1806-9126"),
    ],
  },
  {
    id: "saude-br",
    name: "Saúde Coletiva (BR, SciELO)",
    journals: [
      j("Cadernos de Saúde Pública", "0102-311X", "1678-4464"),
      j("Revista de Saúde Pública", "0034-8910", "1518-8787"),
      j("Ciência & Saúde Coletiva", "1413-8123", "1678-4561"),
      j("Saúde e Sociedade", "0104-1290", "1984-0470"),
    ],
  },
  {
    id: "soc-br",
    name: "Ciências Sociais (BR, SciELO)",
    journals: [
      j("Revista Brasileira de Ciências Sociais", "0102-6909", "1806-9053"),
      j("Dados", "0011-5258", "1678-4588"),
      j("Sociologias", "1517-4522", "1807-0337"),
      j("Novos Estudos CEBRAP", "0101-3300", "1980-5403"),
    ],
  },
  {
    id: "psi-br",
    name: "Psicologia (BR, SciELO)",
    journals: [
      j("Psicologia: Reflexão e Crítica", "0102-7972", "1678-7153"),
      j("Psicologia: Teoria e Pesquisa", "0102-3772", "1806-3446"),
      j("Psicologia & Sociedade", "0102-7182", "1807-0310"),
      j("Estudos de Psicologia (Natal)", "1413-294X", "1678-4669"),
    ],
  },
];

/** Na primeira abertura, todos os modelos ficam disponíveis; dá para apagar os que não usar. */
const PRESET_LISTS: JournalList[] = LIST_TEMPLATES;

export const store = {
  settings: (): Settings => ({ ...DEFAULT_SETTINGS, ...read<Partial<Settings>>("settings", {}) }),
  saveSettings: (s: Settings) => write("settings", s),
  lists: (): JournalList[] => read("lists", PRESET_LISTS),
  saveLists: (l: JournalList[]) => write("lists", l),
  history: (): HistoryEntry[] => read("history", []),
  saveHistory: (h: HistoryEntry[]) => write("history", h.slice(0, 200)),
};
