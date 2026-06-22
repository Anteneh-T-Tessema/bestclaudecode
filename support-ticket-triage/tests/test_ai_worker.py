"""Tests for ai_worker.py: orchestration of classify -> retrieve -> draft."""
from __future__ import annotations

import unittest

from ticket_triage.ai_worker import AIWorker
from ticket_triage.llm_client import FakeLLMClient
from ticket_triage.local_index import VectorIndex
from tests.helpers import make_kb, make_ticket


class AIWorkerProcessTicketTests(unittest.TestCase):
    def setUp(self) -> None:
        self.kb = make_kb()
        self.index = VectorIndex()
        for article in self.kb.all():
            self.index.index_kb_article(article.id, article.text)
        self.worker = AIWorker(FakeLLMClient(), self.index, self.kb, {})

    def test_process_ticket_returns_classification_retrieval_and_draft(self) -> None:
        ticket = make_ticket(body="I forgot my password, how do I reset it?")
        result = self.worker.process_ticket(ticket)

        self.assertIsNotNone(result.classification)
        self.assertIsNotNone(result.draft)
        self.assertEqual(result.similar_tickets.ticket_id, ticket.id)
        self.assertEqual(result.kb_articles.ticket_id, ticket.id)

    def test_retrieval_runs_even_when_classification_fails_safe(self) -> None:
        """SDD 3.1 step 4: drafting job runs regardless of classification outcome."""
        from ticket_triage.llm_client import ClassificationResult, ScriptedLLMClient

        scripted = ScriptedLLMClient(classify_responses=[ClassificationResult(category="bad", urgency="bad", confidence=0.9)])
        worker = AIWorker(scripted, self.index, self.kb, {})
        ticket = make_ticket(body="How do I reset my password?")

        # generate_draft also needs a scripted response since this client
        # is used for both calls.
        from ticket_triage.llm_client import DraftResult

        scripted.draft_responses.append(DraftResult(text="Here is how to reset your password."))

        result = worker.process_ticket(ticket)
        self.assertTrue(result.classification.fail_safe)
        self.assertIsNotNone(result.draft)
        self.assertTrue(result.draft.text)

    def test_finds_kb_grounding_for_relevant_ticket(self) -> None:
        ticket = make_ticket(subject="Password reset", body="I need to reset my password, the link is broken.")
        result = self.worker.process_ticket(ticket)
        self.assertTrue(result.kb_articles.items, "expected at least one KB article retrieved")
        self.assertIn("kb-1", [item.source_id for item in result.kb_articles.items])


if __name__ == "__main__":
    unittest.main()
