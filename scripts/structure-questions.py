from __future__ import annotations

import json
import re
import time
from collections import Counter
from pathlib import Path

import cv2
import numpy as np


ROOT = Path(__file__).resolve().parent.parent
QUESTIONS_PATH = ROOT / "public" / "questions.json"
QUESTIONS_DIR = ROOT / "public" / "questions"
OCR_PATH = ROOT / "data" / "ocr-results.json"
REPORT_PATH = ROOT / "data" / "structure-report.json"
TILES_DIR = ROOT / "tiles"

WIND_CODES = {"東": "east", "南": "south", "西": "west", "北": "north"}
KANJI_NUMBERS = {"〇": 0, "零": 0, "一": 1, "二": 2, "三": 3, "四": 4,
                 "五": 5, "六": 6, "七": 7, "八": 8, "九": 9}

# 黄色帯を持つ旧画像は6枚だけで、圧縮により画素照合が不安定なため目視確認済み値を固定する。
MANUAL_IMAGE_OVERRIDES = {
    1: {
        "hand": ["7m", "8m", "1p", "2p", "4p", "0p", "6p", "7p", "9p",
                 "2s", "3s", "6s", "6s", "9m"],
        "dora": "8m",
    },
    161: {
        "hand": ["7m", "8m", "1p", "2p", "4p", "5p", "6p", "7p", "9p",
                 "2s", "3s", "6s", "8s", "9m"],
        "dora": "8m",
    },
    162: {
        "hand": ["7m", "8m", "9m", "2p", "2p", "4p", "6p", "2s", "3s",
                 "5s", "6s", "7s", "8s", "2p"],
        "dora": "9m",
    },
    163: {
        "hand": ["1m", "2m", "3m", "3m", "5m", "4p", "4p", "6p", "6p",
                 "8p", "8p", "7s", "8s", "4m"],
        "dora": "3z",
    },
    164: {
        "hand": ["3m", "3m", "5m", "1p", "2p", "8p", "8p", "8p", "7s",
                 "7s", "8s", "3z", "3z", "3p"],
        "dora": "2p",
    },
    165: {
        "hand": ["9m", "9m", "2p", "2p", "4p", "5p", "6p", "7p", "5s",
                 "6s", "7s", "8s", "9s", "4p"],
        "dora": "6s",
    },
    166: {
        "hand": ["2m", "3m", "4m", "3s", "4s", "4s", "5s", "5s", "6s",
                 "7s", "8s", "4z", "4z", "4z"],
        "dora": "4z",
    },
    167: {
        "hand": ["5m", "0m", "6m", "7m", "7m", "7m", "7z", "7z"],
        "dora": "6s",
        "meldCount": 2,
    },
    168: {
        "hand": ["3m", "4m", "8m", "9m", "9m", "2p", "3p", "4p", "6p", "7p",
                 "5s", "6s", "7s", "7s"],
        "dora": "4m",
    },
    169: {
        "hand": ["2m", "4m", "4m", "5m", "6m", "7m", "7m", "8m", "5p", "7p", "9p",
                 "7s", "8s", "9s"],
        "dora": "6s",
    },
    170: {
        "hand": ["2m", "3m", "4m", "5m", "7m", "7m", "7m", "9p", "9p", "2s", "3s",
                 "3s", "3s", "9p"],
        "dora": "8s",
    },
    171: {
        "hand": ["0m", "4m", "2p", "3p", "3p", "4p", "4p", "5p", "6p", "8s", "8s"],
        "dora": "9m",
        "meldCount": 1,
    },
    6: {
        "hand": ["2m", "3m", "4m", "7m", "0p", "9p", "9p", "4s", "4s",
                 "5s", "6s", "7s", "7s", "9p"],
        "dora": "9p",
    },
    117: {
        "hand": ["2m", "3m", "4m", "7m", "0p", "9p", "9p", "4s", "4s",
                 "5s", "6s", "7s", "7s", "9p"],
        "dora": "9p",
    },
    136: {
        "hand": ["5m", "6m", "1p", "3p", "4p", "5p", "6p", "7s", "7s",
                 "8s", "8s", "8s", "9s", "7p"],
        "dora": "2p",
    },
    141: {
        "hand": ["2m", "3m", "4m", "6m", "6m", "6m", "7p", "7p", "8p",
                 "3s", "3s", "4s", "7s", "7s"],
        "dora": "3m",
    },
    142: {
        "hand": ["1m", "2m", "3m", "2p", "3p", "4p", "5p", "5p", "6p",
                 "5s", "5s", "6s", "2z", "2z"],
        "dora": "2z",
    },
    143: {
        "hand": ["3m", "4m", "0m", "9m", "1p", "1p", "1p", "6p", "7p",
                 "9p", "2s", "3s", "4s", "6s"],
        "dora": "5m",
    },
    145: {
        "hand": ["4m", "5m", "6m", "8m", "1p", "1p", "1p", "4p", "5p",
                 "1s", "2s", "8s", "4z", "4z"],
        "dora": "4z",
    },
}


SITUATION_OVERRIDES = {
    104: {"round": "east1", "seat": "west", "turn": 6, "honba": None, "points": 25000},
    116: {"round": "east1", "seat": "west", "turn": 6, "honba": None, "points": 25000},
    126: {"round": "east1", "seat": "west", "turn": 6, "honba": None, "points": 25000},
    166: {"round": "east1", "seat": "west", "turn": 8, "honba": 0, "points": 25000},
    167: {"round": "east1", "seat": "west", "turn": 6, "honba": 0, "points": 25000},
    168: {"round": "east1", "seat": "west", "turn": 6, "honba": 0, "points": 25000},
    169: {"round": "east1", "seat": "west", "turn": 6, "honba": 0, "points": 25000},
    170: {"round": "east1", "seat": "west", "turn": 6, "honba": 0, "points": 25000},
    171: {"round": "east1", "seat": "west", "turn": 6, "honba": 0, "points": 25000},
}


# 副露は16問のみ。横向き牌を含むため、元画像を目視確認した確定値を使用します。
MELD_OVERRIDES = {
    3: [{"type": "pon", "open": True, "calledIndex": 0, "tiles": ["6z", "6z", "6z"]}],
    5: [{"type": "pon", "open": True, "calledIndex": 0, "tiles": ["3z", "3z", "3z"]}],
    13: [{"type": "pon", "open": True, "calledIndex": 0, "tiles": ["5z", "5z", "5z"]}],
    31: [{"type": "pon", "open": True, "calledIndex": 1, "tiles": ["2s", "2s", "2s"]}],
    33: [{"type": "pon", "open": True, "calledIndex": 1, "tiles": ["6z", "6z", "6z"]}],
    59: [{"type": "chi", "open": True, "calledIndex": 0, "tiles": ["7m", "8m", "9m"]}],
    65: [{"type": "pon", "open": True, "calledIndex": 0, "tiles": ["3z", "3z", "3z"]}],
    68: [{"type": "pon", "open": True, "calledIndex": 0, "tiles": ["6z", "6z", "6z"]}],
    87: [{"type": "pon", "open": True, "calledIndex": 0, "tiles": ["7m", "7m", "7m"]}],
    93: [{"type": "pon", "open": True, "calledIndex": 0, "tiles": ["6z", "6z", "6z"]}],
    107: [{"type": "pon", "open": True, "calledIndex": 0, "tiles": ["6z", "6z", "6z"]}],
    123: [{"type": "pon", "open": True, "calledIndex": 0, "tiles": ["6z", "6z", "6z"]}],
    137: [{"type": "chi", "open": True, "calledIndex": 1, "tiles": ["6m", "7m", "8m"]}],
    139: [{"type": "chi", "open": True, "calledIndex": 1, "tiles": ["4s", "0s", "6s"]}],
    149: [{"type": "pon", "open": True, "calledIndex": 0, "tiles": ["8s", "8s", "8s"]}],
    167: [
        {"type": "chi", "open": True, "calledIndex": 0, "tiles": ["6s", "4s", "0s"]},
        {"type": "chi", "open": True, "calledIndex": 0, "tiles": ["3p", "4p", "5p"]},
    ],
    171: [
        {"type": "pon", "open": True, "calledIndex": 0, "tiles": ["6z", "6z", "6z"]},
    ],
}


def read_json(path: Path):
    with path.open("r", encoding="utf-8") as file:
        return json.load(file)


def read_image(path: Path) -> np.ndarray:
    # cv2.imread はWindowsの日本語パスを開けない場合があるためバイト列経由で読む。
    encoded = np.fromfile(path, dtype=np.uint8)
    image = cv2.imdecode(encoded, cv2.IMREAD_COLOR)
    if image is None:
        raise RuntimeError(f"画像を読めません: {path}")
    return image


def write_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + f".{id(value)}.tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    for attempt in range(1, 9):
        try:
            temporary.replace(path)
            return
        except PermissionError:
            if attempt == 8:
                raise
            time.sleep(0.15 * attempt)


def tile_code_from_asset(stem: str) -> str:
    prefix = stem.split("-")[0]
    red_five_map = {"aka1": "0p", "aka2": "0s", "aka3": "0m"}
    if prefix in red_five_map:
        return red_five_map[prefix]
    suit, number = re.fullmatch(r"(man|pin|sou|ji)(\d)", prefix).groups()
    if suit == "man":
        return number + "m"
    if suit == "pin":
        return number + "p"
    if suit == "sou":
        return number + "s"
    # 承認済み画像は ji5=發, ji6=白。一般的な牌コードは 5z=白, 6z=發。
    honor_map = {"1": "1z", "2": "2z", "3": "3z", "4": "4z",
                 "5": "6z", "6": "5z", "7": "7z"}
    return honor_map[number]


def sort_hand(hand: list[str]) -> list[str]:
    """萬子・筒子・索子・字牌の順で理牌し、赤5は通常5の直後へ置く。"""
    suit_order = {"m": 0, "p": 1, "s": 2, "z": 3}

    def sort_key(code: str):
        number = 5 if code[0] == "0" else int(code[0])
        red_order = 1 if code[0] == "0" else 0
        return suit_order[code[1]], number, red_order

    return sorted(hand, key=sort_key)


def has_kan_choice(hand: list[str]) -> bool:
    """Return true when the concealed hand contains four tiles of one kind."""
    counts = Counter("5" + code[1] if code.startswith("0") else code for code in hand)
    return any(count == 4 for count in counts.values())


def tile_features(image: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    normalized = cv2.resize(image, (66, 90), interpolation=cv2.INTER_AREA)
    hsv = cv2.cvtColor(normalized, cv2.COLOR_BGR2HSV)
    foreground = (hsv[:, :, 2] < 220) | (hsv[:, :, 1] > 35)
    color = np.full_like(normalized, 255)
    color[foreground] = normalized[foreground]
    shape = ((hsv[:, :, 2] < 210) | (hsv[:, :, 1] > 40)).astype(np.float32)
    return color.astype(np.float32) / 255.0, shape


def load_templates():
    templates = {}
    for path in sorted(TILES_DIR.glob("*-66-90-l.png")):
        image = read_image(path)
        templates[tile_code_from_asset(path.stem)] = tile_features(image)
    if len(templates) != 37:
        raise RuntimeError(f"牌テンプレートは赤5を含む37種必要です（現在 {len(templates)}種）。")
    return templates


def classify_tile(crop: np.ndarray, templates) -> tuple[str, float, float]:
    color, shape = tile_features(crop)
    if float(shape[5:-5, 5:-5].mean()) < 0.01:
        return "5z", 0.0, 1.0
    scores = []
    for code, (template_color, template_shape) in templates.items():
        if code == "5z":
            continue
        color_error = float(np.mean((color - template_color) ** 2))
        shape_error = float(np.mean(np.abs(shape - template_shape)))
        scores.append((color_error + shape_error * 0.5, code))
    scores.sort()
    best_score, best_code = scores[0]
    second_score = scores[1][0]
    return best_code, best_score, second_score - best_score


def white_mask(image: np.ndarray) -> np.ndarray:
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    return ((hsv[:, :, 2] > 145) & (hsv[:, :, 1] < 150)).astype(np.uint8)


def main_row(image: np.ndarray, mask: np.ndarray) -> tuple[int, int]:
    score = mask.sum(axis=1).astype(float)
    smooth = np.convolve(score, np.ones(3) / 3, mode="same")
    peak = int(np.argmax(smooth))
    threshold = max(30.0, smooth[peak] * 0.24)
    y0 = peak
    while y0 > 0 and smooth[y0 - 1] > threshold:
        y0 -= 1
    y1 = peak
    while y1 + 1 < len(smooth) and smooth[y1 + 1] > threshold:
        y1 += 1
    return y0, y1 + 1


def tile_geometry(image: np.ndarray, mask: np.ndarray, y0: int, y1: int):
    component_mask = (mask * 255).astype(np.uint8)
    _, _, stats, _ = cv2.connectedComponentsWithStats(component_mask)
    components = [
        (int(x), int(y), int(w), int(h), int(area))
        for x, y, w, h, area in stats[1:]
        if 35 <= w <= 105 and 45 <= h <= 115 and area >= 450
        and h > w * 1.08 and abs(y - y0) <= 10
    ]
    widths = [box[2] for box in components]
    width = round(float(np.median(widths))) if widths else max(42, round((y1 - y0) * 66 / 90))
    starts = sorted(box[0] for box in components)
    differences = [
        b - a for a, b in zip(starts, starts[1:])
        if width * 0.75 <= b - a <= width * 1.3
    ]
    step = round(float(np.median(differences))) if differences else width + 1

    top_columns = mask[y0:min(y1, y0 + 12)].mean(axis=0) > 0.55
    runs = []
    start = None
    for index, enabled in enumerate(np.r_[top_columns, False]):
        if enabled and start is None:
            start = index
        elif not enabled and start is not None:
            if index - start >= 20:
                runs.append((start, index))
            start = None
    early = [run for run in runs if run[0] < 100]
    if not early:
        raise RuntimeError("手牌の開始位置を検出できません。")
    x0 = early[0][0]
    return x0, width, step, components


def top_tile_groups(mask: np.ndarray, y0: int, y1: int):
    enabled = mask[y0:min(y1, y0 + 12)].mean(axis=0) > 0.55
    runs = []
    start = None
    for index, value in enumerate(np.r_[enabled, False]):
        if value and start is None:
            start = index
        elif not value and start is not None:
            if index - start >= 20:
                runs.append((start, index))
            start = None
    groups = []
    for start, end in runs:
        if groups and start - groups[-1][1] <= 3:
            groups[-1] = (groups[-1][0], end)
        else:
            groups.append((start, end))
    return groups


def rotated_tile_count(mask: np.ndarray, y0: int, y1: int) -> int:
    component_mask = (mask * 255).astype(np.uint8)
    _, _, stats, _ = cv2.connectedComponentsWithStats(component_mask)
    rotated = []
    for x, y, w, h, area in stats[1:]:
        x, y, w, h, area = map(int, (x, y, w, h, area))
        center_y = y + h / 2
        if not (y0 - 10 <= center_y <= y1 + 10):
            continue
        if 45 <= w <= 115 and 30 <= h <= 90 and area >= 500 and w > h * 1.08:
            rotated.append((x, y, w, h))
    return len(rotated)


def choose_hand_group_end(groups, x0: int, width: int, expected_count: int) -> int:
    candidates = [end for start, end in groups if start >= x0 and end > x0]
    if not candidates:
        raise RuntimeError("手牌上端の終端を検出できません。")
    target = expected_count * width
    return min(candidates, key=lambda end: abs((end - x0) - target))


def infer_concealed_count(groups, x0: int, width: int, separate_draw: bool):
    valid_counts = (13, 10, 7, 4) if separate_draw else (14, 11, 8, 5)
    largest = valid_counts[0]
    candidates = []
    for _, end in groups:
        if end <= x0:
            continue
        estimated = (end - x0) / max(1, width)
        for count in valid_counts:
            # 同程度なら、赤牌ラベルによる途中分断より大きい手牌数を優先する。
            penalty = (largest - count) * 0.02
            candidates.append((abs(estimated - count) + penalty, count, end, estimated))
    if not candidates:
        raise RuntimeError("手牌枚数を推定できません。")
    _, count, end, _ = min(candidates)
    return count, end


def yellow_labels(image: np.ndarray):
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    mask = cv2.inRange(hsv, (12, 75, 80), (55, 255, 255))
    _, _, stats, _ = cv2.connectedComponentsWithStats(mask)
    return [
        (int(x), int(y), int(w), int(h), int(area))
        for x, y, w, h, area in stats[1:]
        if w >= 35 and h >= 20 and area >= 450
    ]


def crop_at(image: np.ndarray, x: int, y0: int, width: int, y1: int) -> np.ndarray:
    x = max(0, min(x, image.shape[1] - width))
    return image[y0:y1, x:x + width]


def grid_boundaries(x0: int, step: float, count: int, group_end: int):
    boundaries = [round(x0 + index * step) for index in range(count + 1)]
    boundaries[0] = x0
    boundaries[-1] = group_end
    return boundaries


def find_draw_crop(image: np.ndarray, mask: np.ndarray, label, y0: int, y1: int, width: int):
    lx, ly, lw, lh, _ = label
    search_start = min(image.shape[1] - width, lx + lw)
    search_end = min(image.shape[1] - width, search_start + width * 3)
    best = None
    for x in range(search_start, max(search_start + 1, search_end + 1)):
        overlap_y0 = max(y0, ly - 30)
        overlap_y1 = min(y1, ly + lh + 40)
        score = float(mask[overlap_y0:overlap_y1, x:x + width].mean())
        if best is None or score > best[0]:
            best = (score, x)
    if not best or best[0] < 0.30:
        raise RuntimeError("ツモ牌を検出できません。")
    return crop_at(image, best[1], y0, width, y1)


def find_top_dora_crop(image: np.ndarray, mask: np.ndarray, y0: int, width: int):
    component_mask = (mask * 255).astype(np.uint8)
    _, _, stats, _ = cv2.connectedComponentsWithStats(component_mask)
    candidates = []
    for x, y, w, h, area in stats[1:]:
        x, y, w, h, area = map(int, (x, y, w, h, area))
        if y + h >= y0 - 3:
            continue
        if 30 <= w <= width + 15 and 40 <= h <= 110 and area >= 500 and h > w:
            candidates.append((area, x, y, w, h))
    if not candidates:
        return None
    _, x, y, w, h = max(candidates)
    return image[y:y + h, x:x + w]


def find_right_dora_crop(image: np.ndarray, mask: np.ndarray, hand_end: int,
                         y0: int, y1: int, width: int):
    start = min(image.shape[1] - width, hand_end + max(15, width // 2))
    best = None
    for x in range(start, max(start + 1, image.shape[1] - width + 1)):
        score = float(mask[y0:y1, x:x + width].mean())
        if best is None or score > best[0]:
            best = (score, x)
    if not best or best[0] < 0.30:
        return None
    return crop_at(image, best[1], y0, width, y1)


def normalize_ocr(text: str) -> str:
    return re.sub(r"\s+", "", text or "").replace("，", ",")


def parse_number(value: str):
    if not value:
        return None
    value = value.replace(",", "")
    if value.isdigit():
        return int(value)
    if len(value) == 1:
        return KANJI_NUMBERS.get(value)
    return None


def parse_situation(text: str):
    normalized = normalize_ocr(text)
    round_match = re.search(r"([東南西北])([0-9一二三四五六七八九])局", normalized)
    seat_match = re.search(r"([東南西北])家", normalized)
    turn_match = re.search(r"([0-9一二三四五六七八九]+)巡目", normalized)
    honba_match = re.search(r"([0-9一二三四五六七八九]+)本場", normalized)
    points_match = re.search(r"([0-9][0-9,]*)点", normalized)

    round_code = None
    if round_match:
        number = parse_number(round_match.group(2))
        if number is not None:
            round_code = WIND_CODES[round_match.group(1)] + str(number)
    return {
        "round": round_code,
        "seat": WIND_CODES.get(seat_match.group(1)) if seat_match else None,
        "turn": parse_number(turn_match.group(1)) if turn_match else None,
        "honba": parse_number(honba_match.group(1)) if honba_match else None,
        "points": parse_number(points_match.group(1)) if points_match else None,
    }


def structure_image(question_id: int, image: np.ndarray, templates):
    if question_id in MANUAL_IMAGE_OVERRIDES:
        value = MANUAL_IMAGE_OVERRIDES[question_id]
        return value["hand"], value["dora"], value.get("meldCount", 0), []

    mask = white_mask(image)
    y0, y1 = main_row(image, mask)
    _, width, _, _ = tile_geometry(image, mask, y0, y1)
    groups = top_tile_groups(mask, y0, y1)
    hand_groups = [group for group in groups if group[0] < 100]
    if not hand_groups:
        raise RuntimeError("手牌上端の連続帯を検出できません。")
    x0 = hand_groups[0][0]
    labels = yellow_labels(image)
    labels = [label for label in labels if label[1] < y1 and label[1] + label[3] > y0 - 20]

    separate_draw = bool(labels)
    concealed_count, group_end = infer_concealed_count(groups, x0, width, separate_draw)
    base_count = 13 if separate_draw else 14
    meld_count = (base_count - concealed_count) // 3

    step = (group_end - x0) / concealed_count

    boundaries = grid_boundaries(x0, step, concealed_count, group_end)
    crops = [image[y0:y1, boundaries[index]:max(boundaries[index] + 1, boundaries[index + 1] - 1)]
             for index in range(concealed_count)]
    if separate_draw:
        draw_label = max(labels, key=lambda item: item[4])
        crops.append(find_draw_crop(image, mask, draw_label, y0, y1, width))

    hand = []
    confidence = []
    for crop in crops:
        code, score, margin = classify_tile(crop, templates)
        hand.append(code)
        confidence.append({"score": round(score, 4), "margin": round(margin, 4)})

    dora_crop = find_top_dora_crop(image, mask, y0, width)
    if dora_crop is None:
        hand_end = group_end
        dora_crop = find_right_dora_crop(image, mask, hand_end, y0, y1, width)
    dora = classify_tile(dora_crop, templates)[0] if dora_crop is not None else None
    return hand, dora, meld_count, confidence


def main():
    questions = read_json(QUESTIONS_PATH)
    ocr_by_id = {int(item["id"]): item.get("text", "") for item in read_json(OCR_PATH)}
    templates = load_templates()
    report = []

    for question in questions:
        question_id = int(question["id"])
        image_path = ROOT / "public" / question["image"].lstrip("/")
        image = read_image(image_path)

        hand, dora, meld_count, confidence = structure_image(question_id, image, templates)
        hand = sort_hand(hand)
        situation = parse_situation(ocr_by_id.get(question_id, ""))
        situation.update(SITUATION_OVERRIDES.get(question_id, {}))
        question["hand"] = hand
        question["draw"] = None
        question.setdefault("correctDiscards", [])
        if has_kan_choice(hand):
            question["kanChoice"] = True
        else:
            question.pop("kanChoice", None)
        question["meldCount"] = meld_count
        question["melds"] = MELD_OVERRIDES.get(question_id, [])
        question.update(situation)
        question["dora"] = dora

        # 赤5（0m/0p/0s）は通常5と合わせて同一牌4枚以内かを検査します。
        all_tiles = hand + [code for meld in question["melds"] for code in meld["tiles"]]
        counts = Counter("5" + code[1] if code.startswith("0") else code for code in all_tiles)
        issues = []
        expected_length = 14 - meld_count * 3
        if len(hand) != expected_length:
            issues.append(f"hand_length={len(hand)} expected={expected_length}")
        if hand != sort_hand(hand):
            issues.append("hand_unsorted")
        over_four = sorted(code for code, count in counts.items() if count > 4)
        if over_four:
            issues.append("over_four=" + ",".join(over_four))
        if dora is None:
            issues.append("dora_missing")
        if len(question["melds"]) != meld_count:
            issues.append(f"meld_count={len(question['melds'])} expected={meld_count}")
        for key in ("round", "seat", "turn"):
            if question[key] is None:
                issues.append(key + "_missing")
        low_confidence = [index for index, value in enumerate(confidence)
                          if value["score"] > 0.20 or value["margin"] < 0.005]
        if low_confidence:
            issues.append("low_confidence=" + ",".join(map(str, low_confidence)))

        report.append({
            "id": question_id,
            "handLength": len(hand),
            "meldCount": meld_count,
            "melds": question["melds"],
            "dora": dora,
            "issues": issues,
            "confidence": confidence,
        })

    write_json(QUESTIONS_PATH, questions)
    summary = {
        "questions": len(questions),
        "structured": sum(bool(item.get("hand")) for item in questions),
        "withDora": sum(item.get("dora") is not None for item in questions),
        "withRound": sum(item.get("round") is not None for item in questions),
        "withSeat": sum(item.get("seat") is not None for item in questions),
        "withTurn": sum(item.get("turn") is not None for item in questions),
        "needsReview": sum(bool(item["issues"]) for item in report),
        "items": report,
    }
    write_json(REPORT_PATH, summary)
    print(json.dumps({key: value for key, value in summary.items() if key != "items"}, ensure_ascii=False))


if __name__ == "__main__":
    main()
