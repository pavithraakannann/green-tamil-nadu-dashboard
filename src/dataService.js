import Papa from "papaparse";

const DATA_FILES = {
  merge: `${import.meta.env.BASE_URL}data/merge.csv.gz`,
  palm: `${import.meta.env.BASE_URL}data/palm.csv.gz`,
};

function fetchCsv(source, onProgress) {
  return new Promise((resolve, reject) => {
    const rows = [];
    let headers;
    let parseError;

    fetch(new URL(DATA_FILES[source], window.location.href))
      .then((response) => {
        if (!response.ok) {
          throw new Error(
            `Unable to load public ${source} data: HTTP ${response.status}.`,
          );
        }
        const contentIsAlreadyDecompressed = response.headers
          .get("content-encoding")
          ?.toLowerCase()
          .includes("gzip");
        if (!contentIsAlreadyDecompressed && typeof DecompressionStream === "undefined") {
          throw new Error(
            "This browser does not support compressed public data. Please use a current version of Chrome, Edge, or Firefox.",
          );
        }
        const body = contentIsAlreadyDecompressed
          ? response.body
          : response.body.pipeThrough(new DecompressionStream("gzip"));
        return new Response(body).blob();
      })
      .then((csvBlob) => {
        Papa.parse(csvBlob, {
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
                  `Could not parse public ${source} data: ${parseError.message} (row ${parseError.row + 1}).`,
                ),
              );
              return;
            }
            if (!headers) {
              reject(new Error(`Public ${source} data is empty or has no header row.`));
              return;
            }

            for (let index = 0; index < rows.length; index += 1) {
              if (rows[index].length < headers.length) {
                rows[index] = rows[index].concat(Array(headers.length - rows[index].length).fill(""));
              }
            }

            resolve({
              source,
              fileName: `${source}.csv.gz`,
              headers,
              rows,
            });
          },
          error(error) {
            reject(new Error(`Unable to parse public ${source} data: ${error.message}`));
          },
        });
      })
      .catch((error) =>
        reject(new Error(error.message || `Unable to load public ${source} data.`)),
      );
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
