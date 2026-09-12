import assert from "node:assert/strict";
import test from "node:test";
import { estimateCostUsd, PUBLISHED_RATES, type ProviderRate } from "../src/cost.ts";

const billed: ProviderRate = { inputUsdPerMillionTokens: 1, outputUsdPerMillionTokens: 4, source: "test" };

test("a provider without a published rate has no cost rather than a zero cost", () => {
  assert.equal(estimateCostUsd({ inputTokens: 1000, outputTokens: 1000 }, undefined), null);
});

test("an unbilled output stream leaves cost driven entirely by input", () => {
  const rate = PUBLISHED_RATES.typesafe;
  const cheap = estimateCostUsd({ inputTokens: 12_950, outputTokens: 382 }, rate);
  const verbose = estimateCostUsd({ inputTokens: 12_950, outputTokens: 100_000 }, rate);
  assert.equal(cheap, verbose);
  assert.equal(cheap, 12_950 * 0.042 / 1_000_000);
});

test("a billed output stream adds to the estimate", () => {
  assert.equal(estimateCostUsd({ inputTokens: 1_000_000, outputTokens: 1_000_000 }, billed), 5);
});

test("zero usage costs nothing without becoming unavailable", () => {
  assert.equal(estimateCostUsd({ inputTokens: 0, outputTokens: 0 }, billed), 0);
});

test("the recorded TypeSafe study reproduces its published dashboard arithmetic", () => {
  // 77,703 input tokens across one six-case study, at the dashboard rate.
  const study = estimateCostUsd({ inputTokens: 77_703, outputTokens: 2_290 }, PUBLISHED_RATES.typesafe);
  assert.ok(study !== null);
  assert.ok(Math.abs(study - 0.003264) < 1e-6);
});

test("impossible usage or rates are rejected rather than silently priced", () => {
  assert.throws(() => estimateCostUsd({ inputTokens: -1, outputTokens: 0 }, billed), /Invalid token usage/);
  assert.throws(() => estimateCostUsd({ inputTokens: 1.5, outputTokens: 0 }, billed), /Invalid token usage/);
  assert.throws(() => estimateCostUsd({ inputTokens: 0, outputTokens: 0 },
    { ...billed, inputUsdPerMillionTokens: Number.NaN }), /Invalid provider rate/);
  assert.throws(() => estimateCostUsd({ inputTokens: 0, outputTokens: 0 },
    { ...billed, outputUsdPerMillionTokens: -1 }), /Invalid provider rate/);
});
