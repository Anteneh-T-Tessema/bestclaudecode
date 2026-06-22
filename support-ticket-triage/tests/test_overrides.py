"""Tests for overrides.py: FR-23 through FR-25."""
from __future__ import annotations

import unittest

from ticket_triage.models import Category, TicketStatus, Urgency, UrgencyOverrideDirection
from ticket_triage.overrides import apply_override
from ticket_triage.storage import Storage
from tests.helpers import make_ticket


class ApplyOverrideTests(unittest.TestCase):
    def setUp(self) -> None:
        self.storage = Storage(":memory:")
        self.ticket = make_ticket()
        self.ticket.status = TicketStatus.CLASSIFIED
        self.ticket.category = Category.OTHER
        self.ticket.urgency = Urgency.NORMAL
        self.ticket.confidence = 0.7
        self.storage.insert_ticket(self.ticket)

    def test_override_upgrading_to_urgent_records_direction(self) -> None:
        record = apply_override(self.storage, self.ticket, agent_id="agent-1", corrected_urgency=Urgency.URGENT)
        self.assertEqual(record.urgency_direction, UrgencyOverrideDirection.UPGRADED_TO_URGENT)
        self.assertEqual(record.original_urgency, Urgency.NORMAL)
        self.assertEqual(record.corrected_urgency, Urgency.URGENT)

        updated = self.storage.get_ticket(self.ticket.id)
        self.assertEqual(updated.urgency, Urgency.URGENT)

    def test_override_downgrading_from_urgent_records_direction(self) -> None:
        self.ticket.urgency = Urgency.URGENT
        self.storage.update_ticket_classification(
            self.ticket.id, status=self.ticket.status, category=self.ticket.category, urgency=Urgency.URGENT, confidence=0.9
        )
        record = apply_override(self.storage, self.ticket, agent_id="agent-1", corrected_urgency=Urgency.NORMAL)
        self.assertEqual(record.urgency_direction, UrgencyOverrideDirection.DOWNGRADED_FROM_URGENT)

    def test_category_only_override_has_no_urgency_direction(self) -> None:
        record = apply_override(self.storage, self.ticket, agent_id="agent-1", corrected_category=Category.BILLING)
        self.assertEqual(record.urgency_direction, UrgencyOverrideDirection.NONE)
        self.assertEqual(record.corrected_category, Category.BILLING)

        updated = self.storage.get_ticket(self.ticket.id)
        self.assertEqual(updated.category, Category.BILLING)
        self.assertEqual(updated.urgency, Urgency.NORMAL)  # untouched

    def test_override_is_recorded_with_ticket_metadata_and_timestamp(self) -> None:
        record = apply_override(self.storage, self.ticket, agent_id="agent-7", corrected_urgency=Urgency.URGENT)
        self.assertEqual(record.channel, self.ticket.channel)
        self.assertEqual(record.agent_id, "agent-7")
        self.assertIsNotNone(record.created_at)

        all_overrides = self.storage.list_overrides()
        self.assertEqual(len(all_overrides), 1)

    def test_override_logs_an_audit_event(self) -> None:
        apply_override(self.storage, self.ticket, agent_id="agent-1", corrected_urgency=Urgency.URGENT)
        events = self.storage.list_audit_events(self.ticket.id, event_type="override")
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0].details["urgency_direction"], UrgencyOverrideDirection.UPGRADED_TO_URGENT.value)


if __name__ == "__main__":
    unittest.main()
