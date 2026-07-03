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

## Weekly Upload Workflow

1. Export CSVs from Instagram/Meta Business Suite and Google Analytics 4
2. Go to `/upload`, select the company (Nyuuly or WORK JAPAN)
3. Upload each CSV file — type is auto-detected
4. Visit `/` to see updated charts and tables

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
| GET | `/api/upload-history` | Recent uploads |
| DELETE | `/api/data` | Clear data |

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
