# Green Tamil Nadu Dashboard

The existing React/Vite dashboard is deployed on GitHub Pages and reads privacy-safe aggregated data from a separate Node.js API. The API reads `merge.csv` and `palm.csv` release assets from a configurable private GitHub repository. The GitHub token stays on the backend.

## Local development

1. Copy `backend/.env.example` to `backend/.env`. Set `GITHUB_OWNER`, `GITHUB_REPO`, and a read-only `GITHUB_TOKEN` for the private source repository. Do not commit `backend/.env`.
2. Install frontend packages with `npm.cmd install` and API packages with `npm.cmd install --prefix backend`.
3. Start the API with `npm.cmd run backend:dev`.
4. In another terminal, start Vite with `npm.cmd run dev`. Vite proxies `/api` requests to `http://localhost:3001` by default; set `API_PROXY_TARGET` only if your backend uses another address.
5. Open the local URL printed by Vite.

Test the backend with `npm.cmd run backend:test`. Build the frontend with `npm.cmd run build`.

## Data privacy

The backend finds the latest release assets by exact filename (`merge.csv` or `merged.csv.gz`, and `palm.csv` or `palm_trees.csv`) and downloads them by release asset ID. Gzipped CSV assets are decompressed as a stream before parsing. It returns aggregated groups only; it never sends source rows, original headers beyond the public allowlist, release asset URLs, or the GitHub token to the browser. The allowlist is limited to the dimensions used by the current public dashboard: District, Circle, Division, Year, Species, Species (English), Scheme, calendar-day Date, Department, Department Type, Gov Department Type, and summed seedling counts. Identifiers, names, addresses, contact fields, coordinates, village/taluk/range, and other columns are discarded before data is cached or returned. The browser's tables and CSV exports contain these aggregate groups, not individual records.

Review the allowlist and confirm the source repository owner authorizes these grouped dimensions for public display before deploying. Avoid adding new source columns without an explicit privacy review.

## Deployment

### Vercel deployment

The Vercel project serves both the Vite dashboard and the backend API from the repository root. This is separate from the existing GitHub Pages deployment.

1. Import this repository into Vercel and leave **Root Directory** set to the repository root (`./`). Vercel builds the Vite frontend and deploys `api/[...route].js` as the backend function. The function configuration allows up to 300 seconds for release downloads and parsing.
2. In the Vercel project, create a **private Vercel Blob** store and connect it to this project. Keep the Blob store private; connect the store so the Blob SDK can use Vercel's managed credentials, or enable its read-write token environment variable. The cache contains dashboard aggregates, not raw CSV rows.
3. Add these Vercel project environment variables:
   - `GITHUB_OWNER=greentamilnadumission`
   - `GITHUB_REPO=gtm-data`
   - `GITHUB_TOKEN=<read-only PAT for the private source repository>`
   - `CORS_ORIGINS=https://pavithraakannann.github.io`
   - `CACHE_TTL_SECONDS=300`

   Keep the PAT only in Vercel's backend environment variables. Never add it to GitHub Actions variables, frontend configuration, or committed files.
4. Deploy and verify `https://<your-vercel-project>.vercel.app/api/health`. Confirm it reports `configured: true`. On Vercel, the dashboard uses the same-origin API automatically; do not set `VITE_API_BASE_URL` unless the API is on another host.
5. The backend stores the last successful pair of aggregates in private Blob storage so the cache survives Vercel function cold starts. It synchronizes both assets together, keeps serving the prior cache after a failed refresh, and throttles manual refreshes to one GitHub synchronization per minute. GitHub API requests bypass HTTP caches so replacement assets in an existing release are detected.

### Frontend (GitHub Pages)

1. Set the repository Actions variable `VITE_API_BASE_URL` to the Vercel project origin, for example `https://<your-vercel-project>.vercel.app` (no trailing slash). GitHub Pages uses this Vercel API; the Vercel-hosted frontend uses its same-origin API.
2. In **Settings → Pages → Build and deployment**, choose **GitHub Actions**.
3. Run the Pages workflow. It requires the API URL variable and fails instead of deploying a site configured to call the wrong origin.

The frontend loads cached dashboard data on startup, checks for updates every 5 minutes, and checks again when a background tab becomes visible. **Refresh data** requests an immediate paired refresh. The page shows the last successful synchronization time, the latest source-asset update time, and a warning if an existing cache had to be retained. Health checks expose only API readiness and cache metadata.

## Dashboard features

- Overview summaries, charts, current reporting year/month/today counts, department breakdowns, and division details.
- District, circle, division, year, species, and scheme filters; searchable aggregate tables and CSV exports.
- Forest and Palm location details with district target uploads (CSV or Excel) saved locally in the browser by year.
- Circle values are derived from the existing division-to-circle mapping where the source CSV has no Circle field.
