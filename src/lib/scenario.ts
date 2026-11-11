import scenarioFile from "../../services/scenario.json";

export type CatalogProduct = {
  id: string;
  name: string;
  sku: string;
};

export const scenario = scenarioFile as {
  id: string;
  name: string;
  summary: string;
  inspiration: string;
  workMs: number;
  load: { requests: number; concurrency: number; timeoutMs: number };
  outageLoad: { requests: number; concurrency: number; timeoutMs: number };
  products: CatalogProduct[];
};
