"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { BRAND } from "@/config/timesheet";
import { signOut } from "@/app/actions";

type Item = { href: string; label: string };
type Group = { label?: string; items: Item[] };

// One consistent, grouped nav for every admin page. Add a section here once and
// it appears everywhere (the old per-page hand-rolled navs had drifted apart).
const GROUPS: Group[] = [
  {
    items: [
      { href: "/admin", label: "Admin home" },
      { href: "/admin/dashboard", label: "Dashboard" },
      { href: "/admin/crm", label: "CRM" },
    ],
  },
  {
    label: "Money",
    items: [
      { href: "/admin/books", label: "Books" },
      { href: "/admin/payroll", label: "Payroll" },
      { href: "/admin/payroll/runs", label: "Payroll runs" },
      { href: "/admin/invoices", label: "Invoices" },
    ],
  },
  {
    label: "Ops",
    items: [
      { href: "/admin/rescuetime", label: "RescueTime" },
      { href: "/admin/audit", label: "Audit" },
      { href: "/admin/export", label: "Export CSV" },
    ],
  },
];

// The single active item = the one whose href is the longest prefix of the path,
// so /admin/payroll/runs/123 highlights "Payroll runs" (not "Payroll"), and
// "Admin home" (/admin) is active only on /admin exactly.
function activeHref(pathname: string): string {
  let best = "";
  for (const g of GROUPS) {
    for (const it of g.items) {
      const match =
        it.href === "/admin"
          ? pathname === "/admin"
          : pathname === it.href || pathname.startsWith(it.href + "/");
      if (match && it.href.length > best.length) best = it.href;
    }
  }
  return best;
}

export default function Sidebar() {
  const pathname = usePathname() || "";
  const active = activeHref(pathname);
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <>
      <div className="admin-mobilebar">
        <button
          type="button"
          className="admin-hamburger"
          aria-label="Open menu"
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          ☰
        </button>
        <span className="admin-mobilebrand">{BRAND.name}</span>
      </div>

      {open && <div className="admin-scrim" onClick={close} aria-hidden="true" />}

      <aside className={`admin-sidebar${open ? " open" : ""}`}>
        <Link href="/admin" className="admin-brand" onClick={close}>
          <span className="admin-brand-logo">{BRAND.name.charAt(0)}</span>
          <span className="admin-brand-name">
            {BRAND.name}
            <small>Admin</small>
          </span>
        </Link>

        <nav className="admin-nav" aria-label="Admin sections">
          {GROUPS.map((g, gi) => (
            <div className="admin-navgroup" key={gi}>
              {g.label && <div className="admin-navgroup-label">{g.label}</div>}
              {g.items.map((it) => (
                <Link
                  key={it.href}
                  href={it.href}
                  className={`admin-navlink${active === it.href ? " active" : ""}`}
                  aria-current={active === it.href ? "page" : undefined}
                  onClick={close}
                >
                  {it.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>

        <div className="admin-nav-foot">
          <Link href="/" className="admin-navlink" onClick={close}>
            My timesheet
          </Link>
          <form action={signOut}>
            <button type="submit" className="admin-navlink">
              Log out
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}
