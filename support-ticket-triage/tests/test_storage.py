"""Tests for storage.py: round-tripping every record type, and the FR-19/NFR-6
transactional guarantee that a SendRecord cannot exist without a matching
ReviewAction.
"""
from __future__ import annotations

import sqlite3
import unittest

from ticket_triage.models import (
    AuditEvent,
    Category,
    ClassificationRecord,
    Draft,
    OverrideRecord,
    ReviewAction,
    ReviewActionType,
    RetrievalRecord,
    RetrievedItem,
    SendRecord,
    Urgency,
    UrgencyOverrideDirection,
    new_id,
)
from ticket_triage.storage import Storage
from tests.helpers import make_ticket


class TicketRoundTripTests(unittest.TestCase):
    def setUp(self) -> None:
        self.storage = Storage(":memory:")

    def test_insert_and_get_ticket(self) -> None:
        ticket = make_ticket()
        self.storage.insert_ticket(ticket)
        fetched = self.storage.get_ticket(ticket.id)
        self.assertIsNotNone(fetched)
        self.assertEqual(fetched.subject, ticket.subject)
        self.assertEqual(fetched.channel, ticket.channel)
        self.assertIsNone(fetched.category)

    def test_update_ticket_classification(self) -> None:
        from ticket_triage.models import TicketStatus

        ticket = make_ticket()
        self.storage.insert_ticket(ticket)
        self.storage.update_ticket_classification(
            ticket.id, status=TicketStatus.CLASSIFIED, category=Category.BILLING, urgency=Urgency.URGENT, confidence=0.95
        )
        fetched = self.storage.get_ticket(ticket.id)
        self.assertEqual(fetched.category, Category.BILLING)
        self.assertEqual(fetched.urgency, Urgency.URGENT)
        self.assertEqual(fetched.status, TicketStatus.CLASSIFIED)

    def test_list_tickets_ordered_by_creation(self) -> None:
        t1 = make_ticket(subject="first")
        t2 = make_ticket(subject="second")
        self.storage.insert_ticket(t1)
        self.storage.insert_ticket(t2)
        tickets = self.storage.list_tickets()
        self.assertEqual([t.subject for t in tickets], ["first", "second"])


class ClassificationAndRetrievalRoundTripTests(unittest.TestCase):
    def setUp(self) -> None:
        self.storage = Storage(":memory:")
        self.ticket = make_ticket()
        self.storage.insert_ticket(self.ticket)

    def test_classification_round_trip(self) -> None:
        record = ClassificationRecord(
            id=new_id(),
            ticket_id=self.ticket.id,
            category=Category.BUG_REPORT,
            urgency=Urgency.NORMAL,
            confidence=0.8,
            model_version="m1",
            prompt_version="p1",
            schema_valid=True,
            fail_safe_triggered=False,
            raw_output="raw",
        )
        self.storage.insert_classification(record)
        fetched = self.storage.list_classifications(self.ticket.id)
        self.assertEqual(len(fetched), 1)
        self.assertEqual(fetched[0].category, Category.BUG_REPORT)

    def test_retrieval_round_trip(self) -> None:
        items = [RetrievedItem(source_type="ticket", source_id="t-2", rank=1, score=0.5, snippet="hi", redacted=False)]
        record = RetrievalRecord(id=new_id(), ticket_id=self.ticket.id, items=items)
        self.storage.insert_retrieval(record)
        fetched = self.storage.list_retrievals(self.ticket.id)
        self.assertEqual(len(fetched), 1)
        self.assertEqual(fetched[0].items[0].source_id, "t-2")


class SendRequiresReviewActionTests(unittest.TestCase):
    """The core FR-19/NFR-6 data-level guarantee."""

    def setUp(self) -> None:
        self.storage = Storage(":memory:")
        self.ticket = make_ticket()
        self.storage.insert_ticket(self.ticket)
        self.draft = Draft(
            id=new_id(),
            ticket_id=self.ticket.id,
            text="draft text",
            model_version="m1",
            prompt_version="p1",
            grounding_ticket_ids=[],
            grounding_kb_ids=[],
        )
        self.storage.insert_draft(self.draft)

    def test_send_with_nonexistent_review_action_is_rejected(self) -> None:
        bogus_send = SendRecord(
            id=new_id(),
            ticket_id=self.ticket.id,
            review_action_id="does-not-exist",
            delivery_id="d1",
        )
        with self.assertRaises(sqlite3.IntegrityError):
            self.storage.record_send(bogus_send)

    def test_send_with_real_review_action_succeeds(self) -> None:
        action = ReviewAction(
            id=new_id(),
            ticket_id=self.ticket.id,
            draft_id=self.draft.id,
            agent_id="agent-1",
            action_type=ReviewActionType.ACCEPT,
            final_text="final",
            edit_distance=0,
        )
        self.storage.insert_review_action(action)
        send = SendRecord(id=new_id(), ticket_id=self.ticket.id, review_action_id=action.id, delivery_id="d1")
        self.storage.record_send(send)
        self.assertEqual(len(self.storage.list_sends()), 1)


class OverrideAndAuditRoundTripTests(unittest.TestCase):
    def setUp(self) -> None:
        self.storage = Storage(":memory:")
        self.ticket = make_ticket()
        self.storage.insert_ticket(self.ticket)

    def test_override_round_trip(self) -> None:
        record = OverrideRecord(
            id=new_id(),
            ticket_id=self.ticket.id,
            original_category=Category.OTHER,
            corrected_category=Category.BILLING,
            original_urgency=Urgency.NORMAL,
            corrected_urgency=Urgency.URGENT,
            urgency_direction=UrgencyOverrideDirection.UPGRADED_TO_URGENT,
            channel=self.ticket.channel,
            agent_id="agent-1",
        )
        self.storage.insert_override(record)
        overrides = self.storage.list_overrides()
        self.assertEqual(len(overrides), 1)
        self.assertEqual(overrides[0].urgency_direction, UrgencyOverrideDirection.UPGRADED_TO_URGENT)

    def test_audit_event_round_trip_and_filter(self) -> None:
        e1 = AuditEvent(id=new_id(), ticket_id=self.ticket.id, event_type="classification", details={"a": 1})
        e2 = AuditEvent(id=new_id(), ticket_id=self.ticket.id, event_type="send", details={"b": 2})
        self.storage.insert_audit_event(e1)
        self.storage.insert_audit_event(e2)

        all_events = self.storage.list_audit_events(self.ticket.id)
        self.assertEqual(len(all_events), 2)

        sends_only = self.storage.list_audit_events(self.ticket.id, event_type="send")
        self.assertEqual(len(sends_only), 1)
        self.assertEqual(sends_only[0].details, {"b": 2})


if __name__ == "__main__":
    unittest.main()
