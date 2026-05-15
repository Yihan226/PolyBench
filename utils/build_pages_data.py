#!/usr/bin/env python3
"""Build the static data bundle used by the GitHub Pages site."""

from __future__ import annotations

import csv
import json
import re
import shutil
import ast
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
DOCS_DIR = ROOT / "docs"
OUT_DIR = DOCS_DIR / "assets" / "data"
OUT_IMAGES_DIR = OUT_DIR / "images"
EXAMPLE_LIMIT_PER_TYPE = 100
AGGREGATE_RESULTS_CSV = DATA_DIR / "textbook" / "runs" / "all_models_answers_v1.csv"
TOPIC_COUNTS_CSV = ROOT / "results" / "distribution_stats" / "topic_counts.csv"
TOPIC_SUBTOPIC_COUNTS_CSV = ROOT / "results" / "distribution_stats" / "topic_subtopic_counts.csv"

DATASET_LABELS = {
    "itpsc": "ITPSC Certification",
    "pop": "Polymer Open Problems",
    "pppd": "Polymer Processing Problems",
    "pst": "Polymer Science Textbook",
    "renzheng": "Certification Review",
    "web1": "Web MCQ Set 1",
    "web2": "Web MCQ Set 2",
}

MAIN_TOPICS = [
    "Basic Polymer Knowledge",
    "Polymer Chain Structure and Polymer Morphology",
    "Polymerization Synthesis",
    "Polymerization Techniques",
    "Polymer Properties",
    "Polymer Processing",
    "Thermodynamics of Binary Polymer Mixtures",
    "Commercial Polymer",
    "Practical Application and Technology",
]

ABILITY_PATTERN_COUNTS = [
    (["knowledge"], 681),
    (["reasoning", "knowledge"], 219),
    (["calculation", "reasoning"], 191),
    (["calculation", "reasoning", "knowledge"], 109),
    (["calculation"], 78),
    (["reasoning"], 36),
    (["calculation", "knowledge"], 29),
]

FIXED_LEADERBOARD_RESULTS = [
    {"model": "GPT-5.4", "provider": "OpenAI", "overall": 0.752},
    {"model": "GPT-5", "provider": "OpenAI", "overall": 0.665},
    {"model": "mistral-small-4", "provider": "Mistral", "overall": 0.589},
    {"model": "grok-4.1-fast", "provider": "xAI", "overall": 0.656},
    {"model": "GPT-4.1-mini", "provider": "OpenAI", "overall": 0.607},
    {"model": "Qwen3-vl-235b-a22b-thinking", "provider": "Qwen", "overall": 0.721},
]

MODEL_LABELS = {
    "gpt-4o-2024-08-06_medium": ("GPT-4o 2024-08-06", "OpenAI"),
    "gpt-5.4_high": ("GPT-5.4", "OpenAI"),
    "gpt-5_medium": ("GPT-5", "OpenAI"),
    "minimax-m2.7": ("MiniMax M2.7", "MiniMax"),
    "mistral-small-2603": ("Mistral Small 2603", "Mistral"),
    "x-ai_grok-4.1-fast": ("Grok 4.1 Fast", "xAI"),
}

SCORE_SOURCES = [
    {
        "path": ROOT
        / "v1"
        / "answer"
        / "nvidia_nemotron-3-super-120b-a12b_free"
        / "mcq_score.csv",
        "model": "NVIDIA Nemotron 3 Super 120B A12B",
        "provider": "OpenRouter",
        "type": "MCQ",
        "score_column": "score",
    },
    {
        "path": ROOT
        / "v1"
        / "answer"
        / "intermediate"
        / "mcq"
        / "nvidia_nemotron-3-super-120b-a12b-20230311_free"
        / "score.csv",
        "model": "NVIDIA Nemotron 3 Super 120B A12B 20230311",
        "provider": "OpenRouter",
        "type": "MCQ",
        "score_column": "score",
    },
    {
        "path": ROOT / "v1" / "qa" / "5" / "score.csv",
        "model": "QA Run 5",
        "provider": "Local evaluation",
        "type": "QA",
        "score_column": "correct_percent",
    },
]


def read_jsonl(path: Path) -> list[dict]:
    records = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line:
                records.append(json.loads(line))
    return records


def clean_text(value):
    if value is None:
        return ""
    if isinstance(value, str):
        return re.sub(r"\s+", " ", value).strip()
    return value


def normalize_main_topic(topic: str, subtopic: str = "") -> str:
    text = f"{topic or ''} {subtopic or ''}".lower().replace("_", " ")

    if "commercial polymer" in text:
        return "Commercial Polymer"
    if "practical" in text or "application" in text or "technology" in text or "recycling" in text:
        return "Practical Application and Technology"
    if (
        "thermodynamic" in text
        or "binary polymer mixture" in text
        or "flory" in text
        or "dilute polymer solution" in text
        or "molecular weight determination" in text
    ):
        return "Thermodynamics of Binary Polymer Mixtures"
    if "processing" in text or "extrusion" in text or "injection molding" in text:
        return "Polymer Processing"
    if (
        "chain structure" in text
        or "morphology" in text
        or "stereo" in text
        or "conformation" in text
        or "crystallinity" in text
        or "chain architecture" in text
    ):
        return "Polymer Chain Structure and Polymer Morphology"
    if "technique" in text:
        return "Polymerization Techniques"
    if (
        "property" in text
        or "thermal" in text
        or "mechanical" in text
        or "rheological" in text
        or "permeability" in text
        or "elasticity" in text
        or "viscoelastic" in text
    ):
        return "Polymer Properties"
    if (
        "polymerization" in text
        or "copolymer" in text
        or "ring opening" in text
        or "ionic polymerization" in text
        or "coordination polymerization" in text
        or "polymer chemistry" in text
        or "polymer reaction" in text
        or "polymer synthesis" in text
        or "crosslinking" in text
    ):
        return "Polymerization Synthesis"
    return "Basic Polymer Knowledge"


def image_numbers(record: dict) -> list[int]:
    text = " ".join(
        str(record.get(key) or "")
        for key in ("question", "long_answer", "figure")
        if record.get(key) is not None
    )
    numbers = set()
    for match in re.findall(r"<image_(\d+)>|image_(\d+)", text):
        number = match[0] or match[1]
        if number:
            numbers.add(int(number))
    for figure in record.get("figure") or []:
        if isinstance(figure, str):
            match = re.search(r"image_(\d+)", figure)
            if match:
                numbers.add(int(match.group(1)))
    return sorted(numbers)


def iter_dataset_dirs():
    candidate_roots = [DATA_DIR, DATA_DIR / "textbook", DATA_DIR / "web"]
    seen = set()
    for root in candidate_roots:
        if not root.exists():
            continue
        for dataset_dir in sorted(root.iterdir()):
            if not dataset_dir.is_dir():
                continue
            if not ((dataset_dir / "mcq.jsonl").exists() or (dataset_dir / "qa.jsonl").exists()):
                continue
            dataset = dataset_dir.name
            key = (dataset, dataset_dir.resolve())
            if key in seen:
                continue
            seen.add(key)
            yield dataset, dataset_dir


def find_image_source_dir(dataset: str, uuid: str) -> Path | None:
    candidates = [
        DATA_DIR / dataset / "images" / uuid,
        DATA_DIR / "textbook" / dataset / "images" / uuid,
        DATA_DIR / "web" / dataset / "images" / uuid,
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return None


def question_image_entries(
    dataset: str,
    uuid: str,
    numbers: list[int],
    copy_files: bool = False,
) -> list[dict]:
    images = []
    source_dir = find_image_source_dir(dataset, uuid)
    if source_dir is None:
        return images

    target_dir = None
    if copy_files:
        target_dir = OUT_IMAGES_DIR / dataset / uuid
        target_dir.mkdir(parents=True, exist_ok=True)

    for number in numbers:
        matches = sorted(source_dir.glob(f"image_{number}.*"))
        if not matches:
            continue
        source = matches[0]
        if target_dir is not None:
            target = target_dir / source.name
            shutil.copy2(source, target)
        images.append(
            {
                "label": f"image_{number}",
                "src": f"assets/data/images/{dataset}/{uuid}/{source.name}",
            }
        )
    return images


def slim_answer(value):
    if isinstance(value, list):
        return [clean_text(item) for item in value]
    return clean_text(value)


def build_questions() -> tuple[list[dict], dict, dict]:
    questions = []
    uuid_index = {}
    dataset_stats = defaultdict(
        lambda: {
            "id": "",
            "label": "",
            "mcq": 0,
            "qa": 0,
            "images": 0,
            "topics": Counter(),
            "subtopics": Counter(),
        }
    )

    for dataset, dataset_dir in iter_dataset_dirs():
        for question_type, filename in (("MCQ", "mcq.jsonl"), ("QA", "qa.jsonl")):
            path = dataset_dir / filename
            if not path.exists():
                continue

            for record in read_jsonl(path):
                uuid = str(record.get("uuid") or "")
                if not uuid:
                    continue
                original_topic = clean_text(record.get("topic")) or "Unlabeled"
                subtopic = clean_text(record.get("subtopic")) or "General"
                topic = normalize_main_topic(original_topic, subtopic)
                numbers = image_numbers(record)
                image_count = len(question_image_entries(dataset, uuid, numbers))

                question = {
                    "id": uuid,
                    "dataset": dataset,
                    "datasetLabel": DATASET_LABELS.get(dataset, dataset),
                    "type": question_type,
                    "topic": topic,
                    "originalTopic": original_topic,
                    "subtopic": subtopic,
                    "question": clean_text(record.get("question")),
                    "options": record.get("options") or {},
                    "answer": slim_answer(record.get("short_answer")),
                    "longAnswer": clean_text(record.get("long_answer")),
                    "reference": clean_text(record.get("reference")),
                    "keywords": record.get("keywords") or [],
                    "ability": record.get("ability") or record.get("Ability") or [],
                    "metrics": record.get("metrics") or [],
                    "outputDescription": record.get("output_description") or [],
                    "outputUnit": record.get("output_unit") or [],
                    "images": [],
                    "_imageNumbers": numbers,
                    "_imageCount": image_count,
                }
                questions.append(question)
                uuid_index[uuid] = question

                stats = dataset_stats[dataset]
                stats["id"] = dataset
                stats["label"] = DATASET_LABELS.get(dataset, dataset)
                if question_type == "MCQ":
                    stats["mcq"] += 1
                else:
                    stats["qa"] += 1
                stats["images"] += image_count
                stats["topics"][topic] += 1
                stats["subtopics"][subtopic] += 1

    serializable_stats = {}
    for dataset, stats in dataset_stats.items():
        total = stats["mcq"] + stats["qa"]
        serializable_stats[dataset] = {
            "id": stats["id"],
            "label": stats["label"],
            "mcq": stats["mcq"],
            "qa": stats["qa"],
            "total": total,
            "images": stats["images"],
            "topics": [
                {"name": name, "count": count}
                for name, count in stats["topics"].most_common()
            ],
            "subtopics": [
                {"name": name, "count": count}
                for name, count in stats["subtopics"].most_common(8)
            ],
        }

    questions.sort(key=lambda item: (item["dataset"], item["type"], item["topic"], item["id"]))
    return questions, uuid_index, serializable_stats


def round_robin_sample(questions: list[dict], limit: int) -> list[dict]:
    by_dataset = defaultdict(list)
    for question in questions:
        by_dataset[question["dataset"]].append(question)

    for bucket in by_dataset.values():
        bucket.sort(
            key=lambda item: (
                bool(item.get("_imageNumbers")),
                item["topic"],
                item["subtopic"],
                item["id"],
            ),
            reverse=True,
        )

    dataset_order = sorted(by_dataset)
    selected = []
    while len(selected) < limit and any(by_dataset.values()):
        for dataset in dataset_order:
            if by_dataset[dataset]:
                selected.append(by_dataset[dataset].pop(0))
                if len(selected) == limit:
                    break
    return selected


def build_example_questions(questions: list[dict]) -> list[dict]:
    if OUT_IMAGES_DIR.exists():
        shutil.rmtree(OUT_IMAGES_DIR)
    OUT_IMAGES_DIR.mkdir(parents=True, exist_ok=True)

    examples = []
    for question_type in ("MCQ", "QA"):
        typed = [question for question in questions if question["type"] == question_type]
        examples.extend(round_robin_sample(typed, EXAMPLE_LIMIT_PER_TYPE))

    examples.sort(key=lambda item: (item["type"], item["dataset"], item["topic"], item["id"]))
    output_questions = []
    for question in examples:
        public_question = {
            key: value
            for key, value in question.items()
            if not key.startswith("_")
        }
        public_question["images"] = question_image_entries(
            question["dataset"],
            question["id"],
            question.get("_imageNumbers", []),
            copy_files=True,
        )
        output_questions.append(public_question)
    return output_questions


def read_score_rows(source: dict) -> list[dict]:
    path = source["path"]
    if not path.exists():
        return []

    rows = []
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            uuid = row.get("uuid")
            if not uuid:
                continue
            raw_score = row.get(source["score_column"], "")
            try:
                score = float(raw_score)
            except ValueError:
                continue
            rows.append({"uuid": uuid, "score": score})
    return rows


def parse_answer_cell(value: str):
    value = (value or "").strip()
    if not value:
        return []
    try:
        return ast.literal_eval(value)
    except (ValueError, SyntaxError):
        return value


def as_list(value) -> list:
    if isinstance(value, list):
        return value
    return [value]


def is_number(value) -> bool:
    try:
        float(value)
    except (TypeError, ValueError):
        return False
    return True


def answers_match(gold, predicted) -> bool:
    if is_number(gold) and is_number(predicted):
        gold_value = float(gold)
        predicted_value = float(predicted)
        tolerance = max(1e-9, abs(gold_value) * 1e-6)
        return abs(gold_value - predicted_value) <= tolerance
    return str(gold).strip().lower() == str(predicted).strip().lower()


def score_answer(gold, predicted) -> tuple[int, int]:
    gold_items = as_list(gold)
    predicted_items = as_list(predicted)
    if not gold_items:
        return 0, 0

    correct = 0
    for index, gold_item in enumerate(gold_items):
        if index < len(predicted_items) and answers_match(gold_item, predicted_items[index]):
            correct += 1
    return correct, len(gold_items)


def model_display(column: str) -> tuple[str, str]:
    if column in MODEL_LABELS:
        return MODEL_LABELS[column]
    label = column.replace("_", " ").replace("-", " ")
    return label, "Model run"


def build_aggregate_leaderboard(uuid_index: dict) -> list[dict]:
    if not AGGREGATE_RESULTS_CSV.exists():
        return []

    with AGGREGATE_RESULTS_CSV.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        model_columns = [
            column
            for column in (reader.fieldnames or [])
            if column not in {"uuid", "short_answer"}
        ]
        stats = {
            column: {
                "correct": 0,
                "total": 0,
                "samples": set(),
                "topics": defaultdict(lambda: {"correct": 0, "total": 0, "samples": set()}),
            }
            for column in model_columns
        }

        for row in reader:
            uuid = row.get("uuid")
            question = uuid_index.get(uuid or "")
            if question is None:
                continue

            gold = parse_answer_cell(row.get("short_answer", ""))
            topic = question["topic"]
            for column in model_columns:
                correct, total = score_answer(gold, parse_answer_cell(row.get(column, "")))
                if total == 0:
                    continue
                stats[column]["correct"] += correct
                stats[column]["total"] += total
                stats[column]["samples"].add(uuid)
                topic_stats = stats[column]["topics"][topic]
                topic_stats["correct"] += correct
                topic_stats["total"] += total
                topic_stats["samples"].add(uuid)

    leaderboard = []
    for column, model_stats in stats.items():
        total = model_stats["total"]
        if total == 0:
            continue
        model_name, provider = model_display(column)
        topics = []
        for topic in MAIN_TOPICS:
            topic_stats = model_stats["topics"].get(topic, {"correct": 0, "total": 0, "samples": set()})
            topic_total = topic_stats["total"]
            topics.append(
                {
                    "name": topic,
                    "score": round(topic_stats["correct"] / topic_total * 100, 1) if topic_total else None,
                    "samples": len(topic_stats["samples"]) if topic_total else 0,
                }
            )

        leaderboard.append(
            {
                "model": model_name,
                "provider": provider,
                "type": "Total",
                "overall": round(model_stats["correct"] / total * 100, 1),
                "samples": len(model_stats["samples"]),
                "source": str(AGGREGATE_RESULTS_CSV.relative_to(ROOT)),
                "topics": topics,
            }
        )

    leaderboard.sort(key=lambda item: (-item["overall"], -item["samples"], item["model"]))
    for rank, entry in enumerate(leaderboard, start=1):
        entry["rank"] = rank
    return leaderboard


def build_source_leaderboard(uuid_index: dict) -> list[dict]:
    leaderboard = []

    for source in SCORE_SOURCES:
        rows = [row for row in read_score_rows(source) if row["uuid"] in uuid_index]
        if not rows:
            continue

        dataset_scores = defaultdict(list)
        topic_scores = defaultdict(list)
        type_scores = defaultdict(list)

        for row in rows:
            question = uuid_index[row["uuid"]]
            score = row["score"]
            dataset_scores[question["dataset"]].append(score)
            topic_scores[question["topic"]].append(score)
            type_scores[question["type"]].append(score)

        overall = sum(row["score"] for row in rows) / len(rows)
        entry = {
            "model": source["model"],
            "provider": source["provider"],
            "type": source["type"],
            "overall": round(overall * 100, 1),
            "samples": len(rows),
            "source": str(source["path"].relative_to(ROOT)),
            "datasets": [
                {
                    "id": dataset,
                    "label": DATASET_LABELS.get(dataset, dataset),
                    "score": round(sum(scores) / len(scores) * 100, 1),
                    "samples": len(scores),
                }
                for dataset, scores in sorted(dataset_scores.items())
            ],
            "topics": [
                {
                    "name": topic,
                    "score": round(sum(scores) / len(scores) * 100, 1),
                    "samples": len(scores),
                }
                for topic, scores in sorted(topic_scores.items())
            ],
            "breakdown": [
                {
                    "type": question_type,
                    "score": round(sum(scores) / len(scores) * 100, 1),
                    "samples": len(scores),
                }
                for question_type, scores in sorted(type_scores.items())
            ],
        }
        leaderboard.append(entry)

    leaderboard.sort(key=lambda item: (-item["overall"], -item["samples"], item["model"]))
    for rank, entry in enumerate(leaderboard, start=1):
        entry["rank"] = rank
    return leaderboard


def build_leaderboard(uuid_index: dict) -> list[dict]:
    leaderboard = [
        {
            "model": item["model"],
            "provider": item["provider"],
            "type": "Total",
            "overall": item["overall"],
            "samples": 0,
            "source": "user-provided total scores",
            "topics": [],
        }
        for item in FIXED_LEADERBOARD_RESULTS
    ]
    leaderboard.sort(key=lambda item: (-item["overall"], item["model"]))
    for rank, entry in enumerate(leaderboard, start=1):
        entry["rank"] = rank
    return leaderboard


def build_topic_summary(questions: list[dict]) -> list[dict]:
    topic_counts = defaultdict(lambda: {"total": 0, "mcq": 0, "qa": 0, "datasets": Counter()})
    for question in questions:
        stats = topic_counts[question["topic"]]
        stats["total"] += 1
        stats[question["type"].lower()] += 1
        stats["datasets"][question["dataset"]] += 1

    topics = []
    for topic in MAIN_TOPICS:
        stats = topic_counts[topic]
        topics.append(
            {
                "name": topic,
                "total": stats["total"],
                "mcq": stats["mcq"],
                "qa": stats["qa"],
                "datasets": [
                    {"id": dataset, "count": count}
                    for dataset, count in stats["datasets"].most_common()
                ],
            }
        )
    return topics


def build_topic_distribution() -> dict:
    subtopics_by_topic = defaultdict(list)
    if TOPIC_SUBTOPIC_COUNTS_CSV.exists():
        with TOPIC_SUBTOPIC_COUNTS_CSV.open("r", encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle)
            for row in reader:
                topic = row.get("topic") or ""
                if not topic:
                    continue
                subtopics_by_topic[topic].append(
                    {
                        "name": row.get("subtopic") or "General",
                        "count": int(float(row.get("count") or 0)),
                        "percentWithinTopic": float(row.get("percent_within_topic") or 0),
                        "percentOfTotal": float(row.get("percent_of_total") or 0),
                    }
                )

    topics = []
    if TOPIC_COUNTS_CSV.exists():
        with TOPIC_COUNTS_CSV.open("r", encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle)
            for row in reader:
                topic = row.get("topic") or ""
                if not topic:
                    continue
                topics.append(
                    {
                        "name": topic,
                        "count": int(float(row.get("count") or 0)),
                        "percentOfTotal": float(row.get("percent_of_total") or 0),
                        "subtopics": subtopics_by_topic.get(topic, []),
                    }
                )

    total = sum(topic["count"] for topic in topics)
    return {
        "source": {
            "topics": str(TOPIC_COUNTS_CSV.relative_to(ROOT)) if TOPIC_COUNTS_CSV.exists() else "",
            "subtopics": str(TOPIC_SUBTOPIC_COUNTS_CSV.relative_to(ROOT))
            if TOPIC_SUBTOPIC_COUNTS_CSV.exists()
            else "",
        },
        "total": total,
        "topics": topics,
    }


def build_ability_patterns() -> dict:
    total = sum(count for _, count in ABILITY_PATTERN_COUNTS)
    ability_counts = Counter()
    patterns = []

    for abilities, count in ABILITY_PATTERN_COUNTS:
        for ability in abilities:
            ability_counts[ability] += count
        patterns.append(
            {
                "abilities": abilities,
                "count": count,
                "percentOfTotal": round(count / total * 100, 2) if total else 0,
            }
        )

    abilities = [
        {
            "name": ability,
            "count": count,
            "percentOfTotal": round(count / total * 100, 2) if total else 0,
        }
        for ability, count in sorted(ability_counts.items(), key=lambda item: (-item[1], item[0]))
    ]

    return {
        "source": "data/",
        "total": total,
        "abilities": abilities,
        "patterns": patterns,
    }


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    questions, uuid_index, datasets = build_questions()
    leaderboard = build_leaderboard(uuid_index)
    topics = build_topic_summary(questions)
    topic_distribution = build_topic_distribution()
    ability_patterns = build_ability_patterns()
    example_questions = build_example_questions(questions)
    example_mcq = sum(1 for item in example_questions if item["type"] == "MCQ")
    example_qa = sum(1 for item in example_questions if item["type"] == "QA")

    payload = {
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "summary": {
            "totalQuestions": len(questions),
            "mcqQuestions": sum(1 for item in questions if item["type"] == "MCQ"),
            "qaQuestions": sum(1 for item in questions if item["type"] == "QA"),
            "imageQuestions": sum(1 for item in questions if item.get("_imageCount", 0)),
            "imageFiles": sum(item.get("_imageCount", 0) for item in questions),
            "datasets": len(datasets),
            "topics": len(topics),
            "resultRuns": len(leaderboard),
            "exampleQuestions": len(example_questions),
            "exampleMcqQuestions": example_mcq,
            "exampleQaQuestions": example_qa,
        },
        "questionBundle": {
            "mode": "example",
            "description": "The experts quiz ships with 100 MCQ and 100 QA example questions. Replace the questions array or rerun this generator with another sampling rule for production.",
            "mcqLimit": EXAMPLE_LIMIT_PER_TYPE,
            "qaLimit": EXAMPLE_LIMIT_PER_TYPE,
            "mcqQuestions": example_mcq,
            "qaQuestions": example_qa,
        },
        "datasets": list(sorted(datasets.values(), key=lambda item: item["label"])),
        "topics": topics,
        "topicDistribution": topic_distribution,
        "abilityPatterns": ability_patterns,
        "leaderboard": leaderboard,
        "questions": example_questions,
    }

    output = "window.POLYBENCH_DATA = "
    output += json.dumps(payload, ensure_ascii=False, indent=2)
    output += ";\n"
    (OUT_DIR / "polybench-data.js").write_text(output, encoding="utf-8")

    print(
        "Built docs/assets/data/polybench-data.js "
        f"with {len(questions)} total questions summarized, "
        f"{example_mcq} MCQ examples, {example_qa} QA examples, "
        f"{len(leaderboard)} result runs, and "
        f"{sum(len(item['images']) for item in example_questions)} copied example images."
    )


if __name__ == "__main__":
    main()
