"use client";

// Tiny client button so the server-rendered invoice can trigger the browser's
// print dialog (Print → Save as PDF).
export default function PrintButton() {
  return (
    <button type="button" className="btn-sm" onClick={() => window.print()}>
      Print / Save PDF
    </button>
  );
}
