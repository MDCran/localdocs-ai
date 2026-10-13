import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "evaluate", Path(__file__).resolve().parents[1] / "scripts/evaluate.py"
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def test_metrics_count_each_supporting_passage_and_first_relevant_rank():
    results = [
        {"document_title": "other.md", "text": "Unrelated"},
        {"document_title": "guide.md", "text": "Archive retention is 30 days"},
    ]
    recall, mrr = module.rank_metrics(
        results,
        [
            {"document": "guide.md", "passage": "30 days"},
            {"document": "release.md", "passage": "7 days"},
        ],
    )
    assert recall == 0.5 and mrr == 0.5


def test_unanswerable_cases_are_not_scored_as_zero_recall():
    assert module.rank_metrics([], []) == (None, None)
