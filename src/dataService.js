import Papa from "papaparse";

const DATA_FILES = {
  merge: "/data/merge.csv",
  palm: "/data/palm.csv",
};

function fetchCsv(source, onProgress) {
  return new Promise((resolve, reject) => {
    const rows = [];
    let headers;
    let parseError;

    Papa.parse(new URL(DATA_FILES[source], window.location.href).toString(), {
      download: true,
      worker: true,
      header: false,
      skipEmptyLines: "greedy",
      chunkSize: 1024 * 1024,
      chunk(result) {
        if (!headers && result.data.length) {
          headers = result.data[0].map((cell, index) =>
            index === 0 ? cell.replace(/^\uFEFF/, "").trim() : cell.trim(),
          );
          rows.push(...result.data.slice(1));
        } else {
          rows.push(...result.data);
        }

        if (result.errors.length && !parseError) {
          parseError = result.errors[0];
        }
        onProgress?.({ source, rows: rows.length });
      },
      complete() {
        if (parseError) {
          reject(
            new Error(
              `Could not parse ${source}.csv: ${parseError.message} (row ${parseError.row + 1}).`,
            ),
          );
          return;
        }
        if (!headers) {
          reject(new Error(`${source}.csv is empty or has no header row.`));
          return;
        }

        for (let index = 0; index < rows.length; index += 1) {
          if (rows[index].length < headers.length) {
            rows[index] = rows[index].concat(Array(headers.length - rows[index].length).fill(""));
          }
        }

        resolve({
          source,
          fileName: `${source}.csv`,
          headers,
          rows,
        });
      },
      error(error) {
        reject(new Error(`Unable to load ${source}.csv: ${error.message}`));
      },
    });
  });
}

export function fetchMergeData(onProgress) {
  return fetchCsv("merge", onProgress);
}

export function fetchPalmData(onProgress) {
  return fetchCsv("palm", onProgress);
}

export function refreshDashboardData(onProgress) {
  return Promise.all([
    fetchMergeData(onProgress),
    fetchPalmData(onProgress),
  ]);
}
