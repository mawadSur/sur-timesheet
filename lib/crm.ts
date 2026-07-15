// Pure CRM / recruiting-pipeline helpers, shared by the pipeline board, dashboard
// cards and the project detail page. No DB or React here so the math stays testable.
//
// An "opportunity" is a project with a pipeline_stage set (we re-use the projects
// model — see supabase/schema.sql PHASE 9). The operational `status`
// (Active / On Hold / …) is separate from the recruiting `pipeline_stage` below.
//
// The pipeline tracks an incoming contractor from offer through to their start.
// `estimated_value_cents` on the project is the candidate's hourly rate (cents),
// and `pay_type` (C2C / W2 / 1099) is their employment type.

import type { CSSProperties } from "react";

export const PIPELINE_STAGES = ["Offer", "Background check", "Expected start"] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

// Every stage is an in-progress step toward a start — there's no terminal
// won/lost state, so all known stages count as "open".
export const OPEN_STAGES: readonly PipelineStage[] = PIPELINE_STAGES;

// Likelihood the candidate actually starts, ramping up as they advance. Used for
// the weighted "expected starts" headcount forecast. Deliberately simple,
// operational numbers — not a CRM science.
const STAGE_WEIGHT: Record<PipelineStage, number> = {
  Offer: 0.4,
  "Background check": 0.7,
  "Expected start": 0.9,
};

// Employment types a candidate can be engaged under.
export const PAY_TYPES = ["C2C", "W2", "1099"] as const;
export type PayType = (typeof PAY_TYPES)[number];

// Normalize an arbitrary string to a known stage, or null if it isn't one.
export function asPipelineStage(v: string | null | undefined): PipelineStage | null {
  return v != null && (PIPELINE_STAGES as readonly string[]).includes(v) ? (v as PipelineStage) : null;
}

// Normalize an arbitrary string to a known employment type, or null.
export function asPayType(v: string | null | undefined): PayType | null {
  return v != null && (PAY_TYPES as readonly string[]).includes(v) ? (v as PayType) : null;
}

export function isOpenStage(stage: string | null | undefined): boolean {
  return asPipelineStage(stage) != null;
}

export function stageWeight(stage: string | null | undefined): number {
  const s = asPipelineStage(stage);
  return s ? STAGE_WEIGHT[s] : 0;
}

export type Opportunity = {
  pipeline_stage?: string | null;
  estimated_value_cents?: number | string | null;
};

// Roll a set of opportunities up into the pipeline summary shown on the board.
//   count          — candidates currently in the pipeline (any known stage)
//   weightedStarts — expected number who actually start (sum of stage weights)
//   avgRateCents   — average hourly rate across candidates that have a rate set
//   byStage        — how many candidates sit in each stage
export function summarizePipeline(opps: Opportunity[] | null | undefined): {
  count: number;
  weightedStarts: number;
  avgRateCents: number;
  byStage: Record<PipelineStage, number>;
} {
  const byStage: Record<PipelineStage, number> = {
    Offer: 0,
    "Background check": 0,
    "Expected start": 0,
  };
  let count = 0, weightedStarts = 0, rateSum = 0, rated = 0;
  for (const o of opps ?? []) {
    const stage = asPipelineStage(o.pipeline_stage);
    if (!stage) continue;
    count += 1;
    byStage[stage] += 1;
    weightedStarts += stageWeight(stage);
    const rate = Number(o.estimated_value_cents) || 0;
    if (rate > 0) { rateSum += rate; rated += 1; }
  }
  return { count, weightedStarts, avgRateCents: rated ? Math.round(rateSum / rated) : 0, byStage };
}

// Inline badge colors per pipeline stage (matches the dashboard/status palette).
export function stageStyle(stage: string | null | undefined): CSSProperties {
  switch (asPipelineStage(stage)) {
    case "Offer":
      return { background: "#e7eefc", color: "#1d4ed8", border: "1px solid #bcd0f7" };
    case "Background check":
      return { background: "#fff5e0", color: "#a15c00", border: "1px solid #f3d8a0" };
    case "Expected start":
      return { background: "#e6f6ec", color: "#1a7f37", border: "1px solid #b7e3c4" };
    default:
      return { background: "#eef0f2", color: "#5b6470", border: "1px solid #d6dade" };
  }
}
