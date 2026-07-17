#!/usr/bin/env python3
"""Fetch metadata and Japanese captions for the user-confirmed video mappings.

No media is downloaded. The job is resumable: a per-video result is written
after every attempt, so re-running it only retries incomplete entries.
"""

from __future__ import annotations

import argparse
import csv
import json
import subprocess
import sys
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MAPPING = Path.home() / "Downloads" / "nanikiru-video-mapping (2).csv"
DEFAULT_OUTPUT = ROOT / "artifacts" / "video" / "matched-captions"


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mapping", type=Path, default=DEFAULT_MAPPING)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--limit", type=int, default=0, help="Process only the first N pending entries.")
    parser.add_argument("--retry-errors", action="store_true", help="Retry entries previously marked as errors.")
    return parser.parse_args()


def read_mapping(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def load_results(path: Path) -> dict[str, dict[str, str]]:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def write_results(path: Path, results: dict[str, dict[str, str]]) -> None:
    path.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")


def files_for(output_dir: Path, video_id: str) -> tuple[Path, list[Path]]:
    info = output_dir / f"{video_id}.info.json"
    captions = sorted(output_dir.glob(f"{video_id}*.vtt"))
    return info, captions


def extract_video_id(url: str) -> str:
    return url.split("v=")[-1].split("&")[0].strip()


def download(row: dict[str, str], output_dir: Path) -> tuple[str, str]:
    url = row["動画URL"]
    process = subprocess.run(
        [
            sys.executable, "-m", "yt_dlp", "--no-playlist", "--no-warnings",
            "--skip-download", "--write-info-json", "--write-subs", "--write-auto-subs",
            "--sub-langs", "ja.*,ja", "--convert-subs", "vtt",
            "--output", str(output_dir / "%(id)s.%(ext)s"), url,
        ],
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=True,
        check=False,
    )
    detail = (process.stderr or process.stdout).strip()[-1000:]
    return ("ok" if process.returncode == 0 else "error"), detail


def main() -> None:
    args = arguments()
    mapping = args.mapping.resolve()
    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    results_path = output_dir / "results.json"
    results = load_results(results_path)
    rows = read_mapping(mapping)
    pending = []
    for row in rows:
        question_id = row["問題No."]
        old = results.get(question_id, {})
        if old.get("status") == "ok" or (old.get("status") == "error" and not args.retry_errors):
            continue
        pending.append(row)
    if args.limit:
        pending = pending[:args.limit]

    print(json.dumps({"total": len(rows), "pending": len(pending), "output": str(output_dir)}, ensure_ascii=False))
    for index, row in enumerate(pending, start=1):
        question_id = row["問題No."]
        video_id = extract_video_id(row["動画URL"])
        status, detail = download(row, output_dir)
        info_path, captions = files_for(output_dir, video_id)
        if status == "ok" and not info_path.exists():
            status = "error"
            detail = "動画情報ファイルが取得できませんでした。"
        results[question_id] = {
            "status": status,
            "questionId": question_id,
            "videoId": video_id,
            "url": row["動画URL"],
            "title": row["動画タイトル"],
            "captions": [path.name for path in captions],
            "detail": detail,
        }
        write_results(results_path, results)
        print(f"[{index}/{len(pending)}] Q{question_id} {video_id}: {status} captions={len(captions)}", flush=True)
        # Keep batch requests gentle and predictable for YouTube.
        time.sleep(0.6)


if __name__ == "__main__":
    main()
