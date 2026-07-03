# Nyuuly & WORK JAPAN Analytics Dashboard

A full-stack analytics dashboard for **Nyuuly** and **WORK JAPAN** that supports weekly manual CSV uploads and displays interactive charts and tables.

## Tech Stack

- **Backend:** Node.js + Express
- **Database:** SQLite via Node.js built-in `node:sqlite` (Node 22+)
- **Frontend:** Vanilla HTML + CSS + JavaScript
- **Charts:** Chart.js (CDN)
- **Deployment:** Railway (free tier)

## Local Development

### 1. Install dependencies

```bash
npm install
```

### 2. Set environment variables (optional)

```bash
export DATABASE_PATH=./database/analytics.db
export PORT=3000
```

### 3. Start the server

```bash
npm start
# or for development with auto-reload:
npm run dev
```

### 4. Open the app

- **Dashboard:** http://localhost:3000/
- **Upload page:** http://localhost:3000/upload

## Monthly Upload Workflow

1. In GA4, set the report date range to a single calendar month and export the User Acquisition, Pages & Screens, and Funnel CSVs. Repeat for each month (e.g. Jan–Jun 2026).
2. Go to `/upload`, select the company (Nyuuly or WORK JAPAN)
3. For each GA4 slot, **pick the month the file covers** and upload it. The selected month overrides whatever date range is in the CSV header, so the data is stored as that whole calendar month. Upload one file per month.
4. Social Media exports are dated automatically by each post's publish time — no month picker needed.
5. Visit `/` to see updated charts and tables; use **Monthly** mode to compare months.

Supported CSV types:
- **Social Media Posts** — Instagram/Meta export
- **Funnel Data** — GA4 Funnel Exploration export
- **User Acquisition** — GA4 User Acquisition export (First user primary channel group)
- **Pages & Screens** — GA4 Pages & Screens export

## Railway Deployment

### 1. Push to GitHub

```bash
git add .
git commit -m "Initial analytics dashboard"
git push -u origin main
```

### 2. Connect to Railway

1. Create a new project on [Railway](https://railway.app)
2. Connect your GitHub repository
3. Railway will auto-detect the Node.js project

### 3. Add a Volume

1. In Railway project settings, add a **Volume**
2. Mount it at `/data`

### 4. Set environment variables

| Variable | Value |
|---|---|
| `DATABASE_PATH` | `/data/analytics.db` |
| `PORT` | (Railway sets this automatically) |

### 5. Deploy

Railway runs `node server.js` automatically. Visit your deployed URL:
- `/` — public dashboard
- `/upload` — CSV upload page

## API Routes

| Method | Route | Description |
|---|---|---|
| POST | `/api/upload` | Upload CSV |
| GET | `/api/social` | Social media data |
| GET | `/api/funnel` | Funnel data |
| GET | `/api/users` | User acquisition data |
| GET | `/api/pages` | Pages & screens data |
| GET | `/api/summary` | KPI summary |
| GET | `/api/available-months` | Months (YYYY-MM) that have data |
| GET | `/api/monthly` | Per-KPI totals for a month + change vs previous month |
| GET | `/api/upload-history` | Recent uploads |
| DELETE | `/api/data` | Clear data |

## Monthly comparison mode

The dashboard has two filter modes (top controls):

- **Day Range** — Last 7 / 30 / 90 days or a custom range. GA4 aggregates are prorated (estimated) across the selected range.
- **Monthly** — pick a calendar month; every KPI shows that month's exact totals with a percentage-change badge versus the previous month (no proration).

For Monthly mode to be accurate, upload **one export per whole calendar month** for every GA4 file (User Acquisition, Pages, Funnel) and Social. Each upload's date range is grouped into a `YYYY-MM` month key. Manual monthly stats (registrations, applications, etc.) already align on the same month axis.

## Project Structure

```
├── server.js              # Express server + API routes
├── package.json
├── railway.toml           # Railway config
├── database/
│   └── db.js              # SQLite setup + schema
├── public/
│   ├── index.html         # Dashboard page
│   ├── upload.html        # CSV upload page
│   ├── style.css
│   └── dashboard.js
└── uploads/               # Temp folder (gitignored)
```

## License

Private — Nyuuly & WORK JAPAN internal use.
