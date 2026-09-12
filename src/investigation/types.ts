export type Hypothesis = "consistent" | "suspected_violation" | "unknown";
export type Verdict = "regression" | "clean" | "insufficient";
export type EvidenceKey = "database_state" | "operation_contract" | "known_good_run";
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
  retrieve: (key: EvidenceKey) => Promise<Json>;
};
