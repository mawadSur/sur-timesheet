import { describe, it, expect } from "vitest";
import {
  asPipelineStage,
  asPayType,
  isOpenStage,
  stageWeight,
  summarizePipeline,
} from "../lib/crm";

describe("asPipelineStage", () => {
  it("passes through known recruiting stages and rejects everything else", () => {
    expect(asPipelineStage("Offer")).toBe("Offer");
    expect(asPipelineStage("Background check")).toBe("Background check");
    expect(asPipelineStage("Expected start")).toBe("Expected start");
    // retired sales stages are no longer valid
    expect(asPipelineStage("Lead")).toBeNull();
    expect(asPipelineStage("Won")).toBeNull();
    expect(asPipelineStage("bogus")).toBeNull();
    expect(asPipelineStage("")).toBeNull();
    expect(asPipelineStage(null)).toBeNull();
    expect(asPipelineStage(undefined)).toBeNull();
  });
});

describe("asPayType", () => {
  it("passes through known employment types and rejects everything else", () => {
    expect(asPayType("W2")).toBe("W2");
    expect(asPayType("1099")).toBe("1099");
    expect(asPayType("C2C")).toBe("C2C");
    expect(asPayType("salary")).toBeNull();
    expect(asPayType("")).toBeNull();
    expect(asPayType(null)).toBeNull();
    expect(asPayType(undefined)).toBeNull();
  });
});

describe("isOpenStage", () => {
  it("treats every known recruiting stage as open", () => {
    expect(isOpenStage("Offer")).toBe(true);
    expect(isOpenStage("Background check")).toBe(true);
    expect(isOpenStage("Expected start")).toBe(true);
    expect(isOpenStage("Won")).toBe(false); // retired stage
    expect(isOpenStage("bogus")).toBe(false);
    expect(isOpenStage(null)).toBe(false);
  });
});

describe("stageWeight", () => {
  it("ramps the start-likelihood up as the candidate advances", () => {
    expect(stageWeight("Offer")).toBe(0.4);
    expect(stageWeight("Background check")).toBe(0.7);
    expect(stageWeight("Expected start")).toBe(0.9);
  });

  it("weights unknown / null stages at 0", () => {
    expect(stageWeight("bogus")).toBe(0);
    expect(stageWeight(null)).toBe(0);
  });
});

describe("summarizePipeline", () => {
  it("rolls count / weighted starts / avg rate / by-stage across a mixed pipeline", () => {
    const summary = summarizePipeline([
      { pipeline_stage: "Offer", estimated_value_cents: 8000 },
      { pipeline_stage: "Background check", estimated_value_cents: 10000 },
      { pipeline_stage: "Expected start", estimated_value_cents: null }, // no rate set
      { pipeline_stage: null, estimated_value_cents: 99999 }, // not an opportunity
      { pipeline_stage: "bogus", estimated_value_cents: 88888 }, // unknown stage
    ]);
    expect(summary.count).toBe(3);
    expect(summary.byStage).toEqual({
      Offer: 1,
      "Background check": 1,
      "Expected start": 1,
    });
    // weighted starts = 0.4 + 0.7 + 0.9 (float-safe compare)
    expect(summary.weightedStarts).toBeCloseTo(2.0, 10);
    // avg rate only across the two candidates that have a rate: (8000 + 10000) / 2
    expect(summary.avgRateCents).toBe(9000);
  });

  it("coerces string rates and treats missing rates as unset", () => {
    const summary = summarizePipeline([
      { pipeline_stage: "Offer", estimated_value_cents: "12000" },
      { pipeline_stage: "Offer", estimated_value_cents: null },
    ]);
    expect(summary.count).toBe(2);
    expect(summary.byStage.Offer).toBe(2);
    expect(summary.avgRateCents).toBe(12000); // only the rated one counts
    expect(summary.weightedStarts).toBeCloseTo(0.8, 10);
  });

  it("rounds a fractional average rate half-up (not floor/trunc)", () => {
    const summary = summarizePipeline([
      { pipeline_stage: "Offer", estimated_value_cents: 8000 },
      { pipeline_stage: "Offer", estimated_value_cents: 10001 }, // mean = 9000.5
    ]);
    expect(summary.avgRateCents).toBe(9001); // Math.round, not 9000
  });

  it("returns an all-zero summary for empty / null / undefined input", () => {
    const zero = {
      count: 0,
      weightedStarts: 0,
      avgRateCents: 0,
      byStage: { Offer: 0, "Background check": 0, "Expected start": 0 },
    };
    expect(summarizePipeline([])).toEqual(zero);
    expect(summarizePipeline(null)).toEqual(zero);
    expect(summarizePipeline(undefined)).toEqual(zero);
  });
});
