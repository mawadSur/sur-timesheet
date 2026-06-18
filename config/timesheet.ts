// ─────────────────────────────────────────────────────────────────────────────
//  SUR TIMESHEET — CONFIGURATION
//  This is the only file you normally need to edit. After changing it, commit and
//  push (`git add -A && git commit -m "update team" && git push`) and Vercel will
//  redeploy automatically within ~1 minute.
// ─────────────────────────────────────────────────────────────────────────────

export const BRAND = {
  /** Shown in the header and browser tab. */
  name: "Sur",
  /** Subtitle under the wordmark. */
  tagline: "Employee Timesheet",
};

/** The full list of projects your company runs. */
export const PROJECTS: string[] = [
  "Website Redesign",
  "Mobile App",
  "Client Onboarding",
  "Internal Tools",
  "General / Admin",
];

export type Employee = {
  /** The name shown in the picker and saved to the sheet. */
  name: string;
  /**
   * Optional: restrict which projects this person can log against.
   * Omit (or leave empty) to let them log against ALL projects above.
   */
  projects?: string[];
};

/**
 * Your team. Each person can be assigned to multiple projects.
 * Edit these to match your real employees and project assignments.
 */
export const EMPLOYEES: Employee[] = [
  {
    name: "Alex Johnson",
    projects: ["Website Redesign", "Mobile App", "General / Admin"],
  },
  {
    name: "Maria Garcia",
    projects: ["Client Onboarding", "Internal Tools", "General / Admin"],
  },
  {
    name: "Sam Lee",
    // no `projects` → can log against every project
  },
];

/** Returns the projects a given employee is allowed to log against. */
export function projectsForEmployee(name: string): string[] {
  const emp = EMPLOYEES.find((e) => e.name === name);
  if (emp && emp.projects && emp.projects.length > 0) return emp.projects;
  return PROJECTS;
}
