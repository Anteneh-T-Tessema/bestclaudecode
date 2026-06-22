"""Pre-launch Evaluation harness (SDD 2.15): NFR-11 classification accuracy.

"A scripted process (run against a hand-labeled holdout set per C-2) that
computes precision/recall per category and per urgency level (NFR-11)...
This runs against the same Classification Service... code paths as
production, pointed at the holdout set instead of live tickets" (SDD 2.15).

``evaluate_classifier`` does exactly that: it takes a ``Classifier``
(the real production class, constructed with whatever ``LLMClient`` the
caller wants -- a real one for an actual pre-launch run, ``FakeLLMClient``
for this repo's own test suite) and a labeled holdout set, and reports
precision/recall per category and per urgency level, plus the
missed-urgent/over-flagged breakdown (mirroring NFR-10's separation, since
this is the same costly-asymmetry concern at evaluation time).

The draft-quality human-eval rubric (NFR-12) is, by the SDD's own
description, a *human-scored* rubric on a sample of drafts -- not something
that can be meaningfully automated. ``DraftRubricScore`` and
``summarize_rubric_scores`` below provide the data structure and
aggregation a human reviewer's scores would be recorded into and rolled up
from, satisfying "a repeatable check" (AI requirements Section 3) without
fabricating an automated quality judgment the source documents explicitly
say should come from people.
"""
from __future__ import annotations

from dataclasses import dataclass

from ticket_triage.classifier import Classifier
from ticket_triage.models import Category, Urgency


@dataclass(frozen=True)
class LabeledTicket:
    """One holdout-set entry: ticket text plus its ground-truth labels (C-2)."""

    ticket_id: str
    text: str
    true_category: Category
    true_urgency: Urgency


@dataclass
class CategoryMetrics:
    precision: float
    recall: float
    support: int  # number of holdout tickets with this true label


@dataclass
class ClassifierEvaluationReport:
    """Per-category and per-urgency precision/recall, plus urgent-miss/over-flag counts."""

    category_metrics: dict[Category, CategoryMetrics]
    urgency_metrics: dict[Urgency, CategoryMetrics]
    missed_urgent: int    # true=URGENT, predicted!=URGENT (or fail-safe)
    over_flagged: int     # true!=URGENT, predicted=URGENT
    fail_safe_count: int
    total: int


def _precision_recall(true_labels: list, pred_labels: list, value) -> CategoryMetrics:
    tp = sum(1 for t, p in zip(true_labels, pred_labels) if t == value and p == value)
    fp = sum(1 for t, p in zip(true_labels, pred_labels) if t != value and p == value)
    fn = sum(1 for t, p in zip(true_labels, pred_labels) if t == value and p != value)
    support = sum(1 for t in true_labels if t == value)
    precision = tp / (tp + fp) if (tp + fp) else 0.0
    recall = tp / (tp + fn) if (tp + fn) else 0.0
    return CategoryMetrics(precision=precision, recall=recall, support=support)


def evaluate_classifier(classifier: Classifier, holdout: list[LabeledTicket]) -> ClassifierEvaluationReport:
    """Run the real Classifier against a labeled holdout set (NFR-11, SDD 2.15)."""
    true_categories: list[Category] = []
    pred_categories: list[Category | None] = []
    true_urgencies: list[Urgency] = []
    pred_urgencies: list[Urgency | None] = []
    fail_safe_count = 0
    missed_urgent = 0
    over_flagged = 0

    for item in holdout:
        outcome = classifier.classify(item.ticket_id, item.text)
        true_categories.append(item.true_category)
        pred_categories.append(outcome.category)
        true_urgencies.append(item.true_urgency)
        pred_urgencies.append(outcome.urgency)

        if outcome.fail_safe:
            fail_safe_count += 1

        if item.true_urgency == Urgency.URGENT and outcome.urgency != Urgency.URGENT:
            missed_urgent += 1
        elif item.true_urgency != Urgency.URGENT and outcome.urgency == Urgency.URGENT:
            over_flagged += 1

    category_metrics = {c: _precision_recall(true_categories, pred_categories, c) for c in Category}
    urgency_metrics = {u: _precision_recall(true_urgencies, pred_urgencies, u) for u in Urgency}

    return ClassifierEvaluationReport(
        category_metrics=category_metrics,
        urgency_metrics=urgency_metrics,
        missed_urgent=missed_urgent,
        over_flagged=over_flagged,
        fail_safe_count=fail_safe_count,
        total=len(holdout),
    )


@dataclass(frozen=True)
class DraftRubricScore:
    """One human reviewer's rubric score for one generated draft (NFR-12).

    Each dimension is a 1-5 score per the AI requirements doc ("a simple
    pass/fail or 1-5 rubric per dimension is sufficient").
    """

    ticket_id: str
    grounding_score: int   # 1-5: does the draft only state supported facts
    relevance_score: int   # 1-5: relevance of retrieved sources
    tone_score: int        # 1-5: tone/usability as a starting draft


@dataclass
class RubricSummary:
    mean_grounding: float
    mean_relevance: float
    mean_tone: float
    count: int


def summarize_rubric_scores(scores: list[DraftRubricScore]) -> RubricSummary:
    """Aggregate human rubric scores into per-dimension means (NFR-12)."""
    if not scores:
        return RubricSummary(mean_grounding=0.0, mean_relevance=0.0, mean_tone=0.0, count=0)
    n = len(scores)
    return RubricSummary(
        mean_grounding=sum(s.grounding_score for s in scores) / n,
        mean_relevance=sum(s.relevance_score for s in scores) / n,
        mean_tone=sum(s.tone_score for s in scores) / n,
        count=n,
    )
