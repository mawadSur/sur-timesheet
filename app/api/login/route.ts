import { NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  createSessionToken,
  safeEqual,
} from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const secret = process.env.AUTH_SECRET;
  const passcode = process.env.TIMESHEET_PASSCODE;

  if (!secret || !passcode) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Login isn't configured yet. The admin needs to set AUTH_SECRET and TIMESHEET_PASSCODE (see README).",
      },
      { status: 503 }
    );
  }

  let body: { passcode?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  const entered = typeof body.passcode === "string" ? body.passcode : "";
  if (!entered || !safeEqual(entered, passcode)) {
    return NextResponse.json(
      { ok: false, error: "Incorrect passcode." },
      { status: 401 }
    );
  }

  const token = await createSessionToken(secret);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return res;
}
