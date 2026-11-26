/** Registro bibliográfico padronizado — todas as bases convertem para este formato. */
export interface Work {
  key: string;
  title: string;
  authors: string[];
  year?: number;
  venue?: string;
  issn?: string[];
  doi?: string;
  url?: string;
  oaUrl?: string;
  abstract?: string;
  keywords?: string[];
  citations?: number;
  type?: string;
  lang?: string;
  /** bases em que o registro foi encontrado */
  sources: string[];
  /** posição na lista da base (relevância) */
  rank?: number;
}

export type Scope = "title" | "tak" | "all";

export interface Query {
  /** blocos de conceito: termos de um bloco se somam com OU; os blocos se combinam com E */
  blocks: string[][];
  noneTerms: string[];
  scope: Scope;
  author: string;
  yearFrom?: number;
  yearTo?: number;
  issns: string[];
  journalListName?: string;
  /** país da revista (ISO-2, ex.: BR); OpenAlex e DOAJ filtram na fonte */
  sourceCountry?: string;
  onlyArticles: boolean;
  max: number;
  /** aplica a lógica booleana também localmente (útil em bases sem busca booleana) */
  localFilter: boolean;
}

export interface Settings {
  email: string;
  s2Key: string;
  openalexKey: string;
  maxPerSource: number;
  scieloCollection: string;
  enabledSources: string[];
}

export interface HttpResult {
  status: number;
  body: string;
}

export interface SearchContext {
  get(url: string, headers?: Record<string, string>): Promise<HttpResult>;
  getJson<T = any>(url: string, headers?: Record<string, string>): Promise<T>;
  progress(done: number, total?: number): void;
  cancelled(): boolean;
  settings: Settings;
}

export interface SourceResult {
  works: Work[];
  /** total informado pela base (antes do limite) */
  total?: number;
  /** a consulta efetivamente enviada, para o histórico/método */
  queryString: string;
  note?: string;
}

export interface Source {
  id: string;
  name: string;
  region: "int" | "br" | "latam";
  description: string;
  supportsTerms: boolean;
  supportsJournals: boolean;
  /** precisa de lista de revistas (ISSN) para funcionar */
  journalsOnly?: boolean;
  search(q: Query, ctx: SearchContext): Promise<SourceResult>;
}

export interface JournalList {
  id: string;
  name: string;
  journals: Journal[];
}

export interface Journal {
  title: string;
  issn: string;
  /** outros ISSNs da mesma revista (impresso/eletrônico) */
  alt?: string[];
  publisher?: string;
  country?: string;
  works?: number;
  /** null = não achada no OpenAlex */
  checked?: boolean | null;
}

export interface HistoryEntry {
  id: string;
  date: string;
  query: Query;
  runs: { source: string; queryString: string; retrieved: number; total?: number; error?: string; note?: string }[];
  unique: number;
}
