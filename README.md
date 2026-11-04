# Green Tamil Nadu Dashboard

A React and Vite dashboard that reads the local `merge.csv` and `palm.csv` files. It does not use a GitHub API or send CSV data to a backend.

## Run locally

1. Keep the CSV files in `public/data/merge.csv` and `public/data/palm.csv`.
2. In Windows PowerShell, install dependencies with `npm.cmd install`.
3. Start the development server with `npm.cmd run dev`.
4. Open the local URL printed by Vite.

To create a production build, run `npm.cmd run build`; to serve that build locally, run `npm.cmd run preview`.

## GitHub Pages

Live dashboard: https://pavithraakannann.github.io/green-tamil-nadu-dashboard/

The GitHub Actions workflow builds the app with Vite and retries the Pages deployment if GitHub returns a transient deployment error. In the repository settings, set **Pages → Build and deployment → Source** to **GitHub Actions**. The build uses the repository subpath `/green-tamil-nadu-dashboard/`.

The source CSV files are intentionally excluded from Git. The public compressed CSV copies are generated with `python scripts/sanitize-data.py` and omit personal identifiers, contact details, addresses, fine-grained locations, coordinates, and exact timestamps. Review the sanitization before publishing updated data. Never commit the original CSV files.

## Data notes

- Both files are parsed by PapaParse in a web worker. CSV values and original columns are retained for tables and exports.
- The overview counts records across the two sources and sums `Seedlings`, falling back to `Number of Seedlings` only where `Seedlings` is blank. The supplied files have no target or achievement columns.
- Blank rows are skipped. Empty cells remain empty in tables and exports.
- District, division, year, species, and scheme filters apply across the overview, data tables, and reports. The reports can be grouped by any of these fields and exported as CSV.
- Refresh reloads both files from the local `public/data` directory.
