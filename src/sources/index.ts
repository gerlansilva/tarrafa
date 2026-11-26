import type { Source } from "../types";
import { openalex } from "./openalex";
import { crossref } from "./crossref";
import { eric } from "./eric";
import { semanticscholar } from "./semanticscholar";
import { doaj } from "./doaj";
import { scielo } from "./scielo";
import { bdtd } from "./bdtd";

export const SOURCES: Source[] = [openalex, eric, crossref, semanticscholar, doaj, scielo, bdtd];

export const sourceById = (id: string) => SOURCES.find((s) => s.id === id);
