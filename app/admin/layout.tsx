import Sidebar from "@/components/Sidebar";

// Chrome for every /admin/* page: the shared sidebar + a content column. Pages
// render just their own <main className="page admin"> content — no per-page nav.
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="admin-shell">
      <Sidebar />
      <div className="admin-content">{children}</div>
    </div>
  );
}
