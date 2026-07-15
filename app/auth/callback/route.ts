import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Google redirects back here with a `code` we exchange for a session.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  // Only allow a same-origin relative path; reject any host change (open-redirect hardening).
  const rawNext = searchParams.get("next") ?? "/";
  let next = "/";
  try {
    const u = new URL(rawNext, origin);
    if (u.origin === origin) next = u.pathname + u.search + u.hash;
  } catch {}

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      const forwardedHost = request.headers.get("x-forwarded-host");
      const isLocal = process.env.NODE_ENV === "development";
      if (isLocal) {
        return NextResponse.redirect(`${origin}${next}`);
      } else if (forwardedHost) {
        return NextResponse.redirect(`https://${forwardedHost}${next}`);
      }
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // Allowlist trigger rejected the email, or the exchange failed.
  return NextResponse.redirect(`${origin}/not-authorized`);
}
