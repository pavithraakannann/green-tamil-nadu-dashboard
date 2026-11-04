import csv
import gzip
import os
import sys


DATA_DIR = os.path.join("public", "data")
SOURCE_FILES = ("merge", "palm")
PRIVATE_COLUMNS = {
    "address",
    "block",
    "contact name",
    "date",
    "farmer name",
    "id",
    "incharge name",
    "land address",
    "latitude",
    "longitude",
    "mobile",
    "officer mobile",
    "officer name",
    "owner",
    "owner name",
    "planted date",
    "range",
    "report id",
    "reported at",
    "stakeholder name",
    "survey no",
    "taluk",
    "time",
    "user email",
    "user mobile",
    "user name",
    "village",
}


def sanitize(source):
    input_path = os.path.join(DATA_DIR, f"{source}.csv")
    output_path = os.path.join(DATA_DIR, f"{source}.csv.gz")
    row_count = 0

    with open(input_path, "r", encoding="utf-8-sig", newline="") as source_file:
        reader = csv.DictReader(source_file)
        if not reader.fieldnames:
            raise ValueError(f"{input_path} has no header row")

        columns = [
            column
            for column in reader.fieldnames
            if column.strip().casefold() not in PRIVATE_COLUMNS
        ]
        if not columns:
            raise ValueError(f"No public columns remain in {input_path}")

        with gzip.open(
            output_path, "wt", encoding="utf-8", newline="", compresslevel=9
        ) as output_file:
            writer = csv.DictWriter(
                output_file,
                fieldnames=columns,
                extrasaction="ignore",
                lineterminator="\n",
            )
            writer.writeheader()
            for row in reader:
                if not row or all(not (value or "").strip() for value in row.values()):
                    continue
                writer.writerow(row)
                row_count += 1

    return output_path, row_count, columns


def validate_public(source):
    path = os.path.join(DATA_DIR, f"{source}.csv.gz")
    row_count = 0
    with gzip.open(path, "rt", encoding="utf-8", newline="") as public_file:
        reader = csv.DictReader(public_file)
        if not reader.fieldnames:
            raise ValueError(f"{path} has no header row")
        unsafe_columns = [
            column
            for column in reader.fieldnames
            if column.strip().casefold() in PRIVATE_COLUMNS
        ]
        if unsafe_columns:
            raise ValueError(
                f"{path} contains private columns: {', '.join(unsafe_columns)}"
            )
        for row in reader:
            if row is None:
                raise ValueError(f"{path} contains a malformed record")
            row_count += 1

    return path, row_count


if __name__ == "__main__":
    if sys.argv[1:] == ["--check"]:
        for source_name in SOURCE_FILES:
            path, count = validate_public(source_name)
            print(f"{path}: {count:,} sanitized records")
    elif not sys.argv[1:]:
        for source_name in SOURCE_FILES:
            path, count, columns = sanitize(source_name)
            print(
                f"{path}: {count:,} records, {len(columns)} columns, "
                f"{os.path.getsize(path):,} bytes"
            )
    else:
        raise SystemExit("Usage: python scripts/sanitize-data.py [--check]")
