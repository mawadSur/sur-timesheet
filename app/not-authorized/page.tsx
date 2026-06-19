import Link from "next/link";
import { BRAND } from "@/config/timesheet";

export default function NotAuthorized() {
  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-logo">{BRAND.name.charAt(0)}</div>
        <h1 className="auth-title">Not authorized</h1>
        <p className="auth-sub">
          Your Google account isn&apos;t on the access list for the {BRAND.name}{" "}
          Portal yet.
        </p>
        <p className="auth-note">
          Ask your manager to add your email, then try again.
        </p>
        <Link className="secondary" href="/login" style={{ display: "block", textAlign: "center" }}>
          Back to sign in
        </Link>
      </div>
      <p className="foot">{BRAND.name} Portal</p>
    </div>
  );
}
