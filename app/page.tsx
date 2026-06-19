import Link from "next/link";
import { redirect } from "next/navigation";
import { BRAND } from "@/config/timesheet";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/actions";
import TimesheetForm, { type ProjectOption } from "@/components/TimesheetForm";
import CredentialsPanel from "@/components/CredentialsPanel";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, email, role")
    .eq("id", user.id)
    .single();

  // RLS limits this to the projects the user is assigned to.
  const { data: projects } = await supabase
    .from("projects")
    .select("id, name")
    .order("name");

  const isAdmin = profile?.role === "admin";
  const firstName = (profile?.full_name || profile?.email || "there").split(" ")[0];

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="logo">{BRAND.name.charAt(0)}</div>
          <div className="wordmark">
            {BRAND.name}
            <small>{BRAND.tagline}</small>
          </div>
          <nav className="topnav">
            {isAdmin && (
              <Link className="navlink" href="/admin">
                Admin
              </Link>
            )}
            <form action={signOut}>
              <button type="submit" className="navlink navbtn">
                Log out
              </button>
            </form>
          </nav>
        </div>
      </header>

      <main className="page">
        <p className="greeting">Hi {firstName} — log your hours below.</p>
        {((projects as ProjectOption[]) ?? []).map((p) => (
          <CredentialsPanel key={p.id} projectId={p.id} projectName={p.name} />
        ))}
        <TimesheetForm projects={(projects as ProjectOption[]) ?? []} />
        <p className="foot">{BRAND.name} Portal · {profile?.email}</p>
      </main>
    </>
  );
}
