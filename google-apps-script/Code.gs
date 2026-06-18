/**
 * SUR TIMESHEET — Google Sheet receiver
 * ---------------------------------------------------------------------------
 * Paste this into the Apps Script editor of the Google Sheet you want hours
 * saved to (Extensions ▸ Apps Script), then deploy it as a Web App.
 * Full step-by-step instructions are in the project README.
 *
 * It appends ONE ROW PER PROJECT, with columns:
 *   Submitted At | Employee | Date | Project | Hours | Notes
 */

// Optional: set this to the SAME value you give Vercel as SHEETS_SHARED_SECRET.
// Leave as "" to disable the check (fine to start with).
var SHARED_SECRET = "";

var SHEET_NAME = "Timesheet";
var HEADERS = ["Submitted At", "Employee", "Date", "Project", "Hours", "Notes"];

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);

    if (SHARED_SECRET && body.secret !== SHARED_SECRET) {
      return json({ ok: false, error: "Unauthorized." });
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_NAME);
    }
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(HEADERS);
      sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight("bold");
      sheet.setFrozenRows(1);
    }

    var entries = body.entries || [];
    entries.forEach(function (en) {
      sheet.appendRow([
        body.submittedAt,
        body.employee,
        body.date,
        en.project,
        en.hours,
        en.notes || "",
      ]);
    });

    return json({ ok: true, rows: entries.length });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

// A GET handler so you can confirm the deployment is live in a browser.
function doGet() {
  return json({ ok: true, message: "Sur Timesheet endpoint is live." });
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}
