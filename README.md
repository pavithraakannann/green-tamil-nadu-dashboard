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

In repository **Settings → Pages → Build and deployment**, set **Source** to **GitHub Actions**. This one-time repository setting cannot be changed by the workflow token. The GitHub Actions workflow builds the app with Vite, configures the Pages build, and retries deployment if GitHub returns a transient error. The build uses the repository subpath `/green-tamil-nadu-dashboard/`.

The source CSV files are intentionally excluded from Git. The public compressed CSV copies are generated with `python scripts/sanitize-data.py` and omit personal identifiers, contact details, addresses, fine-grained locations, coordinates, and time-of-day. The `Date` field is retained at calendar-day precision for period totals. Review the sanitization before publishing updated data. Never commit the original CSV files.

## Data notes

- Both files are parsed by PapaParse in a web worker. CSV values and original columns are retained for tables and exports.
- The overview counts records across the two sources and sums `Seedlings`, falling back to `Number of Seedlings` only where `Seedlings` is blank. The supplied files have no target or achievement columns.
- Overview seedling totals are split into Forest Department, all other geotagged departments, and palm data. Department groups use the `Department` field; blank and non-forest values are included with other geotagged departments.
- Select the Other departments overview card to see filtered seedling totals grouped by Department Type and Government Department Type.
- The Other departments detail page has a year selector that updates both department breakdowns using the selected reporting year.
- Select the Forest Department overview card to see seedling totals by Circle and District, with year, scheme, and species filters.
- Forest Department detail filters follow the Circle → District → Forest Division hierarchy, with each selection narrowing the next location filter and the seedling breakdowns.
- Select the Palm seedlings overview card to open the same location, year, scheme, and species filters and seedling table for palm data.
- Forest and Palm detail pages show Circle and District totals without a Division column. Target uploads require CSV or Excel (`.xlsx` or `.xls`) `District` and `Target` columns in the first worksheet; `Circle` is optional. Uploaded districts without seedlings are still listed with `-` in the seedlings column. District targets are saved in browser-local storage by selected year; uploading again replaces that year's targets without changing other years.
- Overview geotagged seedling cards exclude palm data. The current-year card uses the April–March reporting year in the `Year` column; current-month and today totals use the sanitized calendar-day `Date` field.
- Blank rows are skipped. Empty cells remain empty in tables and exports.
- District, division, year, species, and scheme filters apply across the overview, data tables, and reports. The reports can be grouped by any of these fields and exported as CSV.
- Circle values are derived from the supplied Division/Circle list and can be filtered, displayed in data tables, included in CSV exports, and used in reports.
- Refresh reloads both files from the local `public/data` directory.
