export type Hypothesis = "consistent" | "suspected_violation" | "unknown";
export type Verdict = "regression" | "clean" | "insufficient";
// Each application declares its own catalog, so this is an open key space rather
// than one benchmark's three sources.
export type EvidenceKey = string;
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type ChoiceQuestion = { type: "choice"; instructions: string; criteria: Record<string, string> };
export type ChoiceAnswer = { choice: string; confidence: number; probabilities: Record<string, number> };
export type Judgment = {
  model: string;
  answers: Record<string, ChoiceAnswer>;
  usage: { inputTokens: number; outputTokens: number };
  latencyMs: number;
};
export type Judge = (state: Json, questions: Record<string, ChoiceQuestion>) => Promise<Judgment>;
export type EvidenceSource = {
  initial: Json;
  catalog: Record<EvidenceKey, string>;
  // Sources that must be retrieved before any verdict may be issued. Confidence
  // never substitutes for them.
  required: readonly EvidenceKey[];
  retrieve: (key: EvidenceKey) => Promise<Json>;
};
