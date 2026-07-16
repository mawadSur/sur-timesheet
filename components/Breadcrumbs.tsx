import Link from "next/link";

// A small trail for detail pages (e.g. Payroll runs / #2026-07-2). The last item
// is the current page (no href); earlier items link back up the hierarchy.
export default function Breadcrumbs({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      {items.map((it, i) => (
        <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          {it.href ? (
            <Link href={it.href}>{it.label}</Link>
          ) : (
            <span aria-current="page">{it.label}</span>
          )}
          {i < items.length - 1 && <span className="breadcrumbs-sep">/</span>}
        </span>
      ))}
    </nav>
  );
}
