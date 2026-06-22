"""Tests for evaluation.py: the pre-launch evaluation harness (NFR-11, NFR-12)."""
from __future__ import annotations

import unittest

from ticket_triage.classifier import Classifier
from ticket_triage.evaluation import (
    DraftRubricScore,
    LabeledTicket,
    evaluate_classifier,
    summarize_rubric_scores,
)
from ticket_triage.llm_client import FakeLLMClient
from ticket_triage.models import Category, Urgency


class EvaluateClassifierTests(unittest.TestCase):
    def setUp(self) -> None:
        self.classifier = Classifier(FakeLLMClient())
        self.holdout = [
            LabeledTicket("t1", "I was charged twice, please refund my invoice.", Category.BILLING, Urgency.NORMAL),
            LabeledTicket("t2", "URGENT the site is down and I'm losing money.", Category.OTHER, Urgency.URGENT),
            LabeledTicket("t3", "How do I export my data?", Category.HOW_TO, Urgency.NORMAL),
            LabeledTicket("t4", "The app keeps crashing on startup, this is a bug.", Category.BUG_REPORT, Urgency.NORMAL),
        ]

    def test_runs_against_real_classifier_code_path(self) -> None:
        """SDD 2.15: this runs against the same Classifier class as production."""
        report = evaluate_classifier(self.classifier, self.holdout)
        self.assertEqual(report.total, 4)

    def test_reports_per_category_precision_recall(self) -> None:
        report = evaluate_classifier(self.classifier, self.holdout)
        self.assertIn(Category.BILLING, report.category_metrics)
        billing_metrics = report.category_metrics[Category.BILLING]
        self.assertEqual(billing_metrics.support, 1)
        self.assertGreaterEqual(billing_metrics.recall, 0.0)

    def test_reports_per_urgency_precision_recall(self) -> None:
        report = evaluate_classifier(self.classifier, self.holdout)
        self.assertIn(Urgency.URGENT, report.urgency_metrics)
        self.assertEqual(report.urgency_metrics[Urgency.URGENT].support, 1)

    def test_missed_urgent_and_overflagged_tracked_separately(self) -> None:
        # t2 is truly urgent and contains "urgent"/"losing money" keywords,
        # so FakeLLMClient should correctly flag it -- construct a holdout
        # entry that the classifier will plausibly get wrong to exercise
        # the miss-counting path.
        holdout = [LabeledTicket("t5", "Just a routine question, no rush at all.", Category.OTHER, Urgency.URGENT)]
        report = evaluate_classifier(self.classifier, holdout)
        # FakeLLMClient won't detect urgency from this text -> should count as a miss.
        self.assertEqual(report.missed_urgent, 1)
        self.assertEqual(report.over_flagged, 0)

    def test_perfect_classifier_has_full_precision_and_recall(self) -> None:
        from ticket_triage.llm_client import ClassificationResult, ScriptedLLMClient

        holdout = [LabeledTicket("t1", "text", Category.BILLING, Urgency.URGENT)]
        scripted = ScriptedLLMClient(classify_responses=[ClassificationResult(category="billing", urgency="urgent", confidence=0.99)])
        report = evaluate_classifier(Classifier(scripted), holdout)
        self.assertEqual(report.category_metrics[Category.BILLING].precision, 1.0)
        self.assertEqual(report.category_metrics[Category.BILLING].recall, 1.0)
        self.assertEqual(report.urgency_metrics[Urgency.URGENT].precision, 1.0)


class RubricSummaryTests(unittest.TestCase):
    def test_summarizes_mean_scores_per_dimension(self) -> None:
        scores = [
            DraftRubricScore(ticket_id="t1", grounding_score=5, relevance_score=4, tone_score=3),
            DraftRubricScore(ticket_id="t2", grounding_score=3, relevance_score=4, tone_score=5),
        ]
        summary = summarize_rubric_scores(scores)
        self.assertAlmostEqual(summary.mean_grounding, 4.0)
        self.assertAlmostEqual(summary.mean_relevance, 4.0)
        self.assertAlmostEqual(summary.mean_tone, 4.0)
        self.assertEqual(summary.count, 2)

    def test_empty_scores_returns_zeroed_summary_not_error(self) -> None:
        summary = summarize_rubric_scores([])
        self.assertEqual(summary.count, 0)
        self.assertEqual(summary.mean_grounding, 0.0)


if __name__ == "__main__":
    unittest.main()
