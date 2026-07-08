// Shared useActionState state contracts for the admin "Assign people to projects"
// forms. These live in a PLAIN module (no "use server") because a file with the
// "use server" directive may only export async functions — the actions and the
// client components both import these types from here.

export type RateState = {
  ok: boolean;
  error?: string;
  savedAt?: number;
  bill_rate?: number | null;
  pay_rate?: number | null;
};

export type AssignState = {
  ok: boolean;
  error?: string;
  savedAt?: number;
};

export type UnassignState = {
  ok: boolean;
  error?: string;
};
