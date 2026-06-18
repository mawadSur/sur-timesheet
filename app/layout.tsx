import type { Metadata } from "next";
import { BRAND } from "@/config/timesheet";
import "./globals.css";

export const metadata: Metadata = {
  title: `${BRAND.name} · ${BRAND.tagline}`,
  description: `Log your hours for ${BRAND.name}.`,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
