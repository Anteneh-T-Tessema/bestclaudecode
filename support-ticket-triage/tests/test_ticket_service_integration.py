"""End-to-end integration tests: ingestion -> classify -> retrieve -> draft ->
human review -> send, exercising the full SDD 3.1/3.2 data flow through the
TicketService facade.
"""
from __future__ import annotations

import unittest

from ticket_triage.ingestion import parse_email_message, parse_web_form_submission
from ticket_triage.models import Category, ReviewActionType, TicketStatus, Urgency
from ticket_triage.overrides import apply_override
from ticket_triage.queue import QueueView
from tests.helpers import build_service, make_ticket


class FullLifecycleTests(unittest.TestCase):
    def test_email_ticket_flows_through_to_drafted_state(self) -> None:
        service, *_ = build_service()
        ticket = parse_email_message(
            "From: alice@example.com\nSubject: Password reset broken\n\nThe reset link in my email never arrives."
        )
        updated = service.ingest_ticket(ticket)

        self.assertIn(updated.status, (TicketStatus.DRAFTED, TicketStatus.NEEDS_MANUAL_TRIAGE))
        self.assertIsNotNone(updated.category)
        self.assertIsNotNone(updated.urgency)

        draft = service.storage.get_latest_draft_for_ticket(ticket.id)
        self.assertIsNotNone(draft)

        classifications = service.storage.list_classifications(ticket.id)
        self.assertEqual(len(classifications), 1)

        retrievals = service.storage.list_retrievals(ticket.id)
        self.assertEqual(len(retrievals), 2)  # similar tickets + KB articles

    def test_web_form_ticket_uses_same_pipeline(self) -> None:
        service, *_ = build_service()
        ticket = parse_web_form_submission(
            {"subject": "Refund", "body": "I'd like a refund for a duplicate billing charge.", "email": "bob@example.com"}
        )
        updated = service.ingest_ticket(ticket)
        self.assertEqual(updated.category, Category.BILLING)

    def test_urgent_ticket_surfaces_in_queue_ahead_of_normal(self) -> None:
        service, *_ = build_service()
        urgent_ticket = make_ticket(body="URGENT the service is down and I'm losing money right now.")
        normal_ticket = make_ticket(body="Just a general question about features.")

        service.ingest_ticket(normal_ticket)
        service.ingest_ticket(urgent_ticket)

        entries = QueueView().build(service.storage.list_tickets())
        urgent_index = next(i for i, e in enumerate(entries) if e.ticket.id == urgent_ticket.id)
        normal_index = next(i for i, e in enumerate(entries) if e.ticket.id == normal_ticket.id)
        self.assertLess(urgent_index, normal_index)

    def test_full_flow_with_override_then_review_then_send(self) -> None:
        service, *_ = build_service()
        ticket = make_ticket(body="I need help resetting my password please.")
        service.ingest_ticket(ticket)

        current = service.storage.get_ticket(ticket.id)
        apply_override(service.storage, current, agent_id="agent-1", corrected_urgency=Urgency.URGENT)
        current = service.storage.get_ticket(ticket.id)
        self.assertEqual(current.urgency, Urgency.URGENT)

        draft = service.storage.get_latest_draft_for_ticket(ticket.id)
        action = service.review_workflow.submit_review_action(
            ticket=current, draft=draft, agent_id="agent-1", action_type=ReviewActionType.ACCEPT, final_text=draft.text
        )
        self.assertEqual(action.action_type, ReviewActionType.ACCEPT)

        final_ticket = service.storage.get_ticket(ticket.id)
        self.assertEqual(final_ticket.status, TicketStatus.SENT)

        sends = service.storage.list_sends()
        self.assertEqual(len(sends), 1)
        review_action = service.storage.get_review_action(sends[0].review_action_id)
        self.assertIsNotNone(review_action)

    def test_content_filter_flagged_draft_does_not_advance_ticket_to_drafted(self) -> None:
        from ticket_triage.ai_worker import AIWorker
        from ticket_triage.knowledge_base import KnowledgeBase
        from ticket_triage.llm_client import ClassificationResult, DraftResult, ScriptedLLMClient
        from ticket_triage.local_index import VectorIndex
        from ticket_triage.send_gateway import SendGateway
        from ticket_triage.storage import Storage
        from ticket_triage.ticket_service import TicketService

        scripted = ScriptedLLMClient(
            classify_responses=[ClassificationResult(category="other", urgency="normal", confidence=0.9)],
            draft_responses=[DraftResult(text="You're being stupid about this issue.")],
        )
        worker = AIWorker(scripted, VectorIndex(), KnowledgeBase(), {})
        service = TicketService(Storage(":memory:"), worker, SendGateway())

        ticket = make_ticket(body="A routine question.")
        updated = service.ingest_ticket(ticket)

        self.assertEqual(updated.status, TicketStatus.CLASSIFIED)  # not advanced to DRAFTED
        events = service.storage.list_audit_events(ticket.id, event_type="content_filter_triggered")
        self.assertEqual(len(events), 1)


if __name__ == "__main__":
    unittest.main()
