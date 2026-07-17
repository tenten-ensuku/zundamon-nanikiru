#!/usr/bin/env python
"""Match a YouTube playlist's opening problem screens against saved question images.

The tool downloads only the first five seconds of each authorized playlist video,
keeps timestamped stills, removes temporary clips, and resumes from saved stills.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PLAYLIST = "https://youtube.com/playlist?list=PLsPI0JcKZ3E7QqaFQpJsLkmkS7dZlPXRv"
FRAME_TIMESTAMPS = (1.0, 3.0)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--playlist-url", default=DEFAULT_PLAYLIST)
    parser.add_argument("--output-dir", type=Path, default=ROOT / "artifacts" / "video-matcher")
    parser.add_argument("--workers", type=int, default=2, help="Concurrent downloads; keep this low for YouTube.")
    parser.add_argument("--limit", type=int, default=0, help="Process only the first N videos (0 means all).")
    return parser.parse_args()


def run(command: list[str], *, cwd: Path | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, cwd=cwd, text=True, encoding="utf-8", errors="replace", capture_output=True, check=True)


def find_ffmpeg() -> str:
    from_path = shutil.which("ffmpeg")
    if from_path:
        return from_path
    local_app_data = Path(os.environ.get("LOCALAPPDATA", ""))
    candidates = sorted(local_app_data.glob("Microsoft/WinGet/Packages/Gyan.FFmpeg_*/ffmpeg-*/bin/ffmpeg.exe"), reverse=True)
    if candidates:
        return str(candidates[0])
    raise FileNotFoundError("ffmpeg が見つかりません。ffmpegをインストールしてから再実行してください。")


def video_id(url: str | None) -> str | None:
    if not url:
        return None
    match = re.search(r"(?:youtu\.be/|[?&]v=)([\w-]{11})", url)
    return match.group(1) if match else None


def load_playlist(url: str) -> dict[str, Any]:
    result = run([
        sys.executable, "-m", "yt_dlp", "--flat-playlist", "--dump-single-json", "--no-warnings", url,
    ])
    return json.loads(result.stdout)


def image_feature(path: Path) -> np.ndarray:
    """Return a normalized image of the left-hand tile strip.

    Question screenshots and Zundamon videos use different surrounding layouts,
    but the tile row itself is visually comparable.  Detecting the bright tile
    area avoids ranking by captions, characters, or the green background.
    """
    image = Image.open(path).convert("L")
    pixels = np.asarray(image, dtype=np.uint8)
    height, width = pixels.shape
    bright = pixels > 180

    # Tiles live in the upper-middle area in both the old compact screenshots
    # and the newer 16:9 video frames. This intentionally ignores round text.
    top = int(height * 0.12)
    bottom = max(top + 1, int(height * 0.62))
    row_counts = bright.sum(axis=1)
    peak_y = top + int(np.argmax(row_counts[top:bottom]))
    row_threshold = max(20, int(row_counts[peak_y] * 0.45))
    y0 = peak_y
    while y0 > top and row_counts[y0 - 1] >= row_threshold:
        y0 -= 1
    y1 = peak_y
    while y1 < bottom - 1 and row_counts[y1 + 1] >= row_threshold:
        y1 += 1

    col_counts = bright[y0:y1 + 1].sum(axis=0)
    col_threshold = max(2, int((y1 - y0 + 1) * 0.35))
    columns = np.flatnonzero(col_counts >= col_threshold)
    if len(columns) == 0:
        crop = image.crop((int(width * 0.08), top, int(width * 0.92), bottom))
    else:
        # Combine adjacent tile runs, but stop at the wide tsumohai/dora gap.
        runs: list[tuple[int, int]] = []
        start = previous = int(columns[0])
        for column in columns[1:]:
            column = int(column)
            if column - previous > 3:
                runs.append((start, previous))
                start = column
            previous = column
        runs.append((start, previous))
        x0, x1 = runs[0]
        for start, end in runs[1:]:
            if start - x1 < 28:
                x1 = end
            else:
                break
        crop = image.crop((max(0, x0 - 5), max(0, y0 - 6), min(width, x1 + 6), min(height, y1 + 8)))
    return np.asarray(crop.resize((384, 64), Image.Resampling.LANCZOS), dtype=np.float32) / 255.0


def extract_frames(entry: dict[str, Any], work_dir: Path, ffmpeg: str) -> dict[str, Any]:
    entry_id = entry["id"]
    frames_dir = work_dir / "frames"
    clips_dir = work_dir / "clips"
    frames_dir.mkdir(parents=True, exist_ok=True)
    clips_dir.mkdir(parents=True, exist_ok=True)
    target_frames = [frames_dir / f"{entry_id}-{timestamp:g}s.png" for timestamp in FRAME_TIMESTAMPS]
    if all(path.exists() for path in target_frames):
        return {"id": entry_id, "status": "cached", "frames": [str(path) for path in target_frames]}

    clip_template = clips_dir / f"{entry_id}.%(ext)s"
    clip_path = clips_dir / f"{entry_id}.mp4"
    last_error = ""
    try:
        for attempt in range(2):
            try:
                run([
                    sys.executable, "-m", "yt_dlp", "--no-playlist", "--no-warnings",
                    "--download-sections", "*0-5", "--force-keyframes-at-cuts",
                    "-f", "bv*[height<=480]+ba/b[height<=480]",
                    "--merge-output-format", "mp4", "-o", str(clip_template),
                    f"https://www.youtube.com/watch?v={entry_id}",
                ])
                if clip_path.exists():
                    break
                last_error = f"一時動画が見つかりません: {clip_path}"
            except subprocess.CalledProcessError as error:
                last_error = error.stderr[-500:]
            if attempt == 0:
                time.sleep(1)
        if not clip_path.exists():
            return {"id": entry_id, "status": "error", "error": last_error or "動画を取得できませんでした。"}
        for timestamp, frame_path in zip(FRAME_TIMESTAMPS, target_frames):
            run([
                ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(clip_path),
                "-ss", f"00:00:{timestamp:06.3f}", "-frames:v", "1", str(frame_path),
            ])
        return {"id": entry_id, "status": "extracted", "frames": [str(path) for path in target_frames]}
    except subprocess.CalledProcessError as error:
        return {"id": entry_id, "status": "error", "error": error.stderr[-500:]}
    except Exception as error:  # Keep the batch resumable after a single bad video.
        return {"id": entry_id, "status": "error", "error": str(error)}
    finally:
        for path in clips_dir.glob(f"{entry_id}.*"):
            try:
                path.unlink(missing_ok=True)
            except PermissionError:
                # Windows can briefly retain an ffmpeg/yt-dlp handle. Leaving a
                # tiny temporary clip is preferable to aborting the full batch.
                pass


def candidate_rows(entries: list[dict[str, Any]], output_dir: Path, question_features: dict[int, np.ndarray], known_ids: dict[str, int], extraction_results: dict[str, dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, list[dict[str, Any]]]]:
    rows: list[dict[str, Any]] = []
    rankings: dict[int, list[dict[str, Any]]] = {question_id: [] for question_id in question_features}
    for index, entry in enumerate(entries, start=1):
        entry_id = entry["id"]
        frame_paths = [output_dir / "frames" / f"{entry_id}-{timestamp:g}s.png" for timestamp in FRAME_TIMESTAMPS]
        extraction = extraction_results.get(entry_id, {})
        if not all(path.exists() for path in frame_paths):
            rows.append({
                "playlistIndex": int(entry.get("playlist_index") or index),
                "videoId": entry_id,
                "title": entry.get("title") or "（タイトル未取得）",
                "url": f"https://www.youtube.com/watch?v={entry_id}",
                "status": "frame_missing",
                "error": extraction.get("error"),
                "candidates": [],
            })
            continue
        frame_features = [image_feature(path) for path in frame_paths]
        scores = []
        for question_id, question_feature in question_features.items():
            score = min(float(np.mean((frame_feature - question_feature) ** 2)) for frame_feature in frame_features)
            scores.append((score, question_id))
        scores.sort()
        for score, question_id in scores:
            rankings[question_id].append({
                "playlistIndex": int(entry.get("playlist_index") or index),
                "videoId": entry_id,
                "score": round(score, 6),
            })
        top = scores[:3]
        best_score, best_question = top[0]
        second_score = top[1][0] if len(top) > 1 else None
        gap = None if second_score is None else second_score - best_score
        confidence = "high" if best_score < 0.03 and (gap is None or gap > 0.03) else "medium" if best_score < 0.12 else "review"
        rows.append({
            "playlistIndex": int(entry.get("playlist_index") or index),
            "videoId": entry_id,
            "title": entry.get("title") or "（タイトル未取得）",
            "url": f"https://www.youtube.com/watch?v={entry_id}",
            "status": "matched",
            "knownQuestionId": known_ids.get(entry_id),
            "bestQuestionId": best_question,
            "bestScore": round(best_score, 6),
            "secondScore": round(second_score, 6) if second_score is not None else None,
            "scoreGap": round(gap, 6) if gap is not None else None,
            "confidence": confidence,
            "candidates": [{"questionId": question_id, "score": round(score, 6)} for score, question_id in top],
            "frames": [str(path.relative_to(output_dir)).replace("\\", "/") for path in frame_paths],
        })
    return rows, {
        str(question_id): sorted(candidates, key=lambda candidate: candidate["score"])[:12]
        for question_id, candidates in rankings.items()
    }


def main() -> None:
    args = parse_args()
    output_dir: Path = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    ffmpeg = find_ffmpeg()
    playlist = load_playlist(args.playlist_url)
    entries = [entry for entry in playlist.get("entries", []) if entry and entry.get("id")]
    if args.limit:
        entries = entries[:args.limit]
    if not entries:
        raise RuntimeError("プレイリストから動画を取得できませんでした。")

    questions = json.loads((ROOT / "public" / "questions.json").read_text(encoding="utf-8"))
    question_features: dict[int, np.ndarray] = {}
    known_ids: dict[str, int] = {}
    for question in questions:
        question_id = int(question["id"])
        image_path = ROOT / "public" / "questions" / f"question-{question_id:03}.png"
        if image_path.exists():
            question_features[question_id] = image_feature(image_path)
        source_id = video_id(question.get("sourceUrl"))
        if source_id:
            known_ids[source_id] = question_id

    if not question_features:
        raise RuntimeError("比較用の問題画像が見つかりません。")

    manifest = {
        "playlistTitle": playlist.get("title"),
        "playlistUrl": args.playlist_url,
        "videoCount": len(entries),
        "frameTimestamps": FRAME_TIMESTAMPS,
    }
    (output_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    extraction_results: dict[str, dict[str, Any]] = {}
    with ThreadPoolExecutor(max_workers=max(1, min(args.workers, 3))) as executor:
        futures = {executor.submit(extract_frames, entry, output_dir, ffmpeg): entry for entry in entries}
        completed = 0
        for future in as_completed(futures):
            completed += 1
            result = future.result()
            extraction_results[result["id"]] = result
            print(f"[{completed}/{len(entries)}] {result['id']}: {result['status']}", flush=True)

    (output_dir / "extraction-results.json").write_text(json.dumps(extraction_results, ensure_ascii=False, indent=2), encoding="utf-8")
    rows, question_candidates = candidate_rows(entries, output_dir, question_features, known_ids, extraction_results)
    report = {**manifest, "questionCount": len(question_features), "matches": rows, "questionCandidates": question_candidates}
    (output_dir / "matches.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    matched = [row for row in rows if row["status"] == "matched"]
    high = sum(row.get("confidence") == "high" for row in matched)
    print(json.dumps({"processed": len(rows), "matched": len(matched), "highConfidence": high, "output": str(output_dir / 'matches.json')}, ensure_ascii=False))


if __name__ == "__main__":
    main()
