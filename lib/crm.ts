// Pure CRM / sales-pipeline helpers, shared by the CRM board, dashboard cards
// and the project detail page. No DB or React here so the math stays testable.
//
// An "opportunity" is just a project with a pipeline_stage set (we re-use the
// projects model — see supabase/schema.sql PHASE 9). The operational `status`
// (Active / On Hold / …) is separate from the sales `pipeline_stage` below.

import type { CSSProperties } from "react";

export const PIPELINE_STAGES = ["Lead", "Qualified", "Proposal", "Won", "Lost"] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

// Stages still in play (contribute to open pipeline + weighted forecast).
export const OPEN_STAGES: readonly PipelineStage[] = ["Lead", "Qualified", "Proposal"];

// Probability weight per stage, used for the weighted forecast (expected value =
// deal value × weight). Won = 1 (booked), Lost = 0 (dead), open stages ramp up as
// the deal advances. Deliberately simple, operational numbers — not a CRM science.
const STAGE_WEIGHT: Record<PipelineStage, number> = {
  Lead: 0.1,
  Qualified: 0.3,
  Proposal: 0.6,
  Won: 1,
  Lost: 0,
};

// Normalize an arbitrary string to a known stage, or null if it isn't one.
export function asPipelineStage(v: string | null | undefined): PipelineStage | null {
  return v != null && (PIPELINE_STAGES as readonly string[]).includes(v) ? (v as PipelineStage) : null;
}

export function isOpenStage(stage: string | null | undefined): boolean {
  const s = asPipelineStage(stage);
  return s != null && (OPEN_STAGES as readonly string[]).includes(s);
}

export function isWonStage(stage: string | null | undefined): boolean {
  return asPipelineStage(stage) === "Won";
}

export function stageWeight(stage: string | null | undefined): number {
  const s = asPipelineStage(stage);
  return s ? STAGE_WEIGHT[s] : 0;
}

export type Opportunity = {
  pipeline_stage?: string | null;
  estimated_value_cents?: number | string | null;
};

// Roll a set of opportunities up into the pipeline summary shown on the CRM board.
//   open      — total value of Lead/Qualified/Proposal deals
//   weighted  — expected value across ALL stages (value × stageWeight)
//   won       — total value of Won deals
//   lost      — total value of Lost deals
//   openCount — how many deals are still open
export function summarizePipeline(opps: Opportunity[] | null | undefined): {
  open: number;
  weighted: number;
  won: number;
  lost: number;
  openCount: number;
} {
  let open = 0, weighted = 0, won = 0, lost = 0, openCount = 0;
  for (const o of opps ?? []) {
    const stage = asPipelineStage(o.pipeline_stage);
    if (!stage) continue;
    const value = Number(o.estimated_value_cents) || 0;
    weighted += Math.round(value * stageWeight(stage));
    if (isOpenStage(stage)) { open += value; openCount += 1; }
    else if (stage === "Won") won += value;
    else if (stage === "Lost") lost += value;
  }
  return { open, weighted, won, lost, openCount };
}

// Inline badge colors per pipeline stage (matches the dashboard/status palette).
export function stageStyle(stage: string | null | undefined): CSSProperties {
  switch (asPipelineStage(stage)) {
    case "Lead":
      return { background: "#eef2f7", color: "#475467", border: "1px solid #d6dade" };
    case "Qualified":
      return { background: "#e7eefc", color: "#1d4ed8", border: "1px solid #bcd0f7" };
    case "Proposal":
      return { background: "#fff5e0", color: "#a15c00", border: "1px solid #f3d8a0" };
    case "Won":
      return { background: "#e6f6ec", color: "#1a7f37", border: "1px solid #b7e3c4" };
    case "Lost":
      return { background: "#fdecec", color: "#b42318", border: "1px solid #f3c2c2" };
    default:
      return { background: "#eef0f2", color: "#5b6470", border: "1px solid #d6dade" };
  }
}
