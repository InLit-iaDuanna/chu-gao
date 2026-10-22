// Constants shared by the API docs server module and client renderers.
export const MODELS_PLACEHOLDER = "{{models}}";
export const MAX_DOCS_LENGTH = 100_000;

export interface ApiDocsModel {
  id: string;
  displayName: string;
  available: boolean;
  sizes: string[];
  qualities: string[];
  maxN: number;
  maxReferenceImages: number;
  defaultSize: string;
  prices: Partial<Record<"1K" | "2K" | "4K", number>>;
}
