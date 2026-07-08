import { describe, it, expect } from "vitest";
import { bucketByRules, secToHours, secToHm, type Rule, type RtRow } from "../lib/rescuetime";

function row(document: string, seconds: number, activity = ""): RtRow {
  return { document, activity, seconds, category: "", productivity: 0 };
}

describe("bucketByRules — most-specific (longest keyword) wins", () => {
  const acme: Rule = { keyword: "acme", project_id: "p-acme", project_name: "Acme" };
  const acmeProd: Rule = { keyword: "acme-prod", project_id: "p-prod", project_name: "Acme Prod" };

  it("attributes a row matching two keywords to the longer one (regression)", () => {
    const rows = [row("acme-prod dashboard", 3600)];
    // Order must not matter — try both orderings.
    for (const rules of [[acme, acmeProd], [acmeProd, acme]]) {
      const { perProject, matchedSeconds } = bucketByRules(rows, rules);
      expect(matchedSeconds).toBe(3600);
      expect(perProject).toHaveLength(1);
      expect(perProject[0]).toMatchObject({ project_id: "p-prod", seconds: 3600 });
    }
  });

  it("still routes a generic hit to the short keyword", () => {
    const { perProject } = bucketByRules([row("acme corp intranet", 1800)], [acme, acmeProd]);
    expect(perProject[0]).toMatchObject({ project_id: "p-acme", seconds: 1800 });
  });

  it("matches case-insensitively across document and activity", () => {
    const { perProject } = bucketByRules([row("", 600, "Working on ACME-PROD")], [acme, acmeProd]);
    expect(perProject[0]).toMatchObject({ project_id: "p-prod", seconds: 600 });
  });

  it("sums seconds per project and sorts by seconds desc", () => {
    const beta: Rule = { keyword: "beta", project_id: "p-beta", project_name: "Beta" };
    const rows = [row("acme site", 100), row("acme app", 200), row("beta tool", 1000)];
    const { perProject, matchedSeconds } = bucketByRules(rows, [acme, beta]);
    expect(matchedSeconds).toBe(1300);
    expect(perProject.map((p) => p.project_id)).toEqual(["p-beta", "p-acme"]);
    expect(perProject.find((p) => p.project_id === "p-acme")!.seconds).toBe(300);
  });

  it("ignores unmatched rows and empty-keyword rules", () => {
    const empty: Rule = { keyword: "", project_id: "p-x", project_name: "X" };
    const { perProject, matchedSeconds } = bucketByRules(
      [row("unrelated window", 5000), row("acme thing", 400)],
      [acme, empty]
    );
    expect(matchedSeconds).toBe(400);
    expect(perProject).toHaveLength(1);
    expect(perProject[0].project_id).toBe("p-acme");
  });

  it("returns nothing for no rows or no rules", () => {
    expect(bucketByRules([], [acme])).toEqual({ perProject: [], matchedSeconds: 0 });
    expect(bucketByRules([row("acme", 100)], [])).toEqual({ perProject: [], matchedSeconds: 0 });
  });
});

describe("secToHours — nearest quarter hour", () => {
  it("converts exact and rounded values", () => {
    expect(secToHours(3600)).toBe(1);
    expect(secToHours(5400)).toBe(1.5);
    expect(secToHours(900)).toBe(0.25);
    expect(secToHours(0)).toBe(0);
    // 1000s ≈ 0.278h → nearest quarter = 0.25
    expect(secToHours(1000)).toBe(0.25);
    // 3200s ≈ 0.889h → nearest quarter = 1.0 (0.875 rounds up)
    expect(secToHours(3200)).toBe(1);
  });
});

describe("secToHm — human h/m formatting", () => {
  it("formats hours and minutes", () => {
    expect(secToHm(3600)).toBe("1h 0m");
    expect(secToHm(3720)).toBe("1h 2m");
    expect(secToHm(0)).toBe("0h 0m");
    expect(secToHm(90)).toBe("0h 2m"); // 1.5 min rounds to 2
  });
});
