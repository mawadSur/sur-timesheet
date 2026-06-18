# Sur Timesheet

A simple, shareable timesheet for the Sur team. Share one link with your
employees — they pick their name, choose a date, and log hours across the
projects they worked on. Every submission is appended to a Google Sheet you own.

- **No passwords** — one shared link, employees pick their name.
- **Multiple projects** — each person logs hours across several projects at once.
- **Google Sheet storage** — one row per project: `Submitted At · Employee · Date · Project · Hours · Notes`.
- **Sur branding** — clean professional blue.

---

## Connect your Google Sheet (one-time, ~4 steps)

The app sends each submission to a tiny Google Apps Script attached to your
sheet. No API keys or service accounts needed.

1. **Create the sheet.** Go to [sheets.new](https://sheets.new) and name it
   e.g. _"Sur Timesheet"_.

2. **Add the script.** In that sheet: **Extensions ▸ Apps Script**. Delete any
   sample code, then paste the contents of
   [`google-apps-script/Code.gs`](./google-apps-script/Code.gs). Click the save
   icon.

3. **Deploy as a Web App.** Click **Deploy ▸ New deployment** → gear icon →
   **Web app**. Set:
   - **Execute as:** _Me_
   - **Who has access:** _Anyone_

   Click **Deploy**, authorize when prompted, and **copy the Web app URL**
   (looks like `https://script.google.com/macros/s/AKfy…/exec`).

4. **Give the URL to the app.** Add it as an environment variable on Vercel:

   ```bash
   vercel env add SHEETS_WEBHOOK_URL production
   # paste the Web app URL when prompted, then redeploy:
   vercel --prod
   ```

   (Or add it in the Vercel dashboard → Project → Settings → Environment
   Variables, then redeploy.)

That's it — submissions now land in your sheet.

### Optional: shared secret

To stop anyone who finds the URL from posting to your sheet:

- Set `SHARED_SECRET` in `Code.gs` to any string and re-deploy the script.
- Add the **same** string to Vercel as `SHEETS_SHARED_SECRET`, then redeploy.

---

## Manage your team & projects

Edit [`config/timesheet.ts`](./config/timesheet.ts):

- `BRAND` — name and tagline.
- `PROJECTS` — every project your company runs.
- `EMPLOYEES` — each person, and optionally the subset of projects they can log
  against (omit `projects` to allow all).

Then commit and push — Vercel redeploys automatically:

```bash
git add -A && git commit -m "Update team and projects" && git push
```

---

## Local development

```bash
npm install
npm run dev      # http://localhost:3000
```

To test saving locally, create a `.env.local` file:

```
SHEETS_WEBHOOK_URL=https://script.google.com/macros/s/AKfy…/exec
```

---

## Tech

Next.js (App Router) · TypeScript · deployed on Vercel. Submissions are proxied
through a serverless route (`app/api/submit/route.ts`) that validates the
employee, date, and project before forwarding to your Google Sheet.
