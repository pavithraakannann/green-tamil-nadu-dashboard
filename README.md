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

### Backend (Render)

1. Create a Render Web Service from this repository using `render.yaml` (or configure the service with `backend` as its root directory).
2. Set `GITHUB_OWNER`, `GITHUB_REPO`, and `GITHUB_TOKEN` in Render's environment settings. Use a fine-grained, read-only token scoped only to the source repository and required contents/releases access. Never put the token in a frontend variable.
3. Set `CORS_ORIGINS` to `https://pavithraakannann.github.io` and deploy. Verify `https://<your-service>.onrender.com/api/health`.
4. The backend caches the last successful pair of aggregates in process and synchronizes them together. Requests within `CACHE_TTL_SECONDS` use the cache; a failed refresh keeps serving the last successful cache with a warning. Manual refreshes are throttled to one GitHub synchronization per minute to limit API abuse.

### Frontend (GitHub Pages)

1. Set the repository Actions variable `VITE_API_BASE_URL` to the deployed backend origin, for example `https://<your-service>.onrender.com` (no trailing slash).
2. In **Settings → Pages → Build and deployment**, choose **GitHub Actions**.
3. Run the Pages workflow. It requires the API URL variable and fails instead of deploying a site configured to call the wrong origin.

The frontend loads cached dashboard data on startup. **Refresh data** requests an immediate paired refresh. The page shows the last successful synchronization time and a warning if an existing cache had to be retained. Health checks expose only API readiness and cache metadata.

## Dashboard features

- Overview summaries, charts, current reporting year/month/today counts, department breakdowns, and division details.
- District, circle, division, year, species, and scheme filters; searchable aggregate tables and CSV exports.
- Forest and Palm location details with district target uploads (CSV or Excel) saved locally in the browser by year.
- Circle values are derived from the existing division-to-circle mapping where the source CSV has no Circle field.
