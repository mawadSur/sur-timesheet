import { createClient } from "@/lib/supabase/server";

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") return new Response("Forbidden", { status: 403 });

  const { data: rows } = await supabase
    .from("timesheets")
    .select("work_date, hours, notes, profiles(full_name, email), projects(name)")
    .order("work_date", { ascending: false });

  const header = ["Date", "Employee", "Email", "Project", "Hours", "Notes"];
  const lines = [header.join(",")];
  for (const t of (rows ?? []) as any[]) {
    lines.push(
      [
        t.work_date,
        t.profiles?.full_name || "",
        t.profiles?.email || "",
        t.projects?.name || "",
        t.hours,
        t.notes || "",
      ]
        .map(csvCell)
        .join(",")
    );
  }

  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="sur-timesheets.csv"',
    },
  });
}
