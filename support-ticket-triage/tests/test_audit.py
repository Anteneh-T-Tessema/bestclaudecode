"""Tests for audit.py: NFR-9, NFR-10 metrics computed from recorded events."""
from __future__ import annotations

import unittest

from ticket_triage.audit import acceptance_rate, log_event, urgent_miss_vs_overflag
from ticket_triage.models import Category, OverrideRecord, Urgency, UrgencyOverrideDirection, new_id
from ticket_triage.storage import Storage
from tests.helpers import make_ticket


def _override(direction: UrgencyOverrideDirection, ticket_id: str | None = None) -> OverrideRecord:
    return OverrideRecord(
        id=new_id(),
        ticket_id=ticket_id or new_id(),
        original_category=Category.OTHER,
        corrected_category=Category.OTHER,
        original_urgency=Urgency.NORMAL,
        corrected_urgency=Urgency.URGENT,
        urgency_direction=direction,
        channel=make_ticket().channel,
        agent_id="agent-1",
    )


class AcceptanceRateTests(unittest.TestCase):
    def test_no_overrides_is_full_acceptance(self) -> None:
        self.assertEqual(acceptance_rate([], total_classified_tickets=10), 1.0)

    def test_some_overrides_reduces_acceptance_rate(self) -> None:
        overrides = [_override(UrgencyOverrideDirection.UPGRADED_TO_URGENT) for _ in range(3)]
        self.assertAlmostEqual(acceptance_rate(overrides, total_classified_tickets=10), 0.7)

    def test_zero_classified_tickets_returns_zero_not_error(self) -> None:
        self.assertEqual(acceptance_rate([], total_classified_tickets=0), 0.0)

    def test_multiple_overrides_on_same_ticket_count_once(self) -> None:
        tid = new_id()
        overrides = [_override(UrgencyOverrideDirection.UPGRADED_TO_URGENT, ticket_id=tid) for _ in range(2)]
        self.assertAlmostEqual(acceptance_rate(overrides, total_classified_tickets=10), 0.9)


class UrgentMissVsOverflagTests(unittest.TestCase):
    """NFR-10: these must be tracked and reported separately, never netted."""

    def test_separates_missed_urgent_from_overflagged(self) -> None:
        overrides = [
            _override(UrgencyOverrideDirection.UPGRADED_TO_URGENT),
            _override(UrgencyOverrideDirection.UPGRADED_TO_URGENT),
            _override(UrgencyOverrideDirection.DOWNGRADED_FROM_URGENT),
        ]
        result = urgent_miss_vs_overflag(overrides)
        self.assertEqual(result, {"missed_urgent": 2, "over_flagged": 1})

    def test_none_direction_overrides_are_not_counted_in_either_bucket(self) -> None:
        overrides = [_override(UrgencyOverrideDirection.NONE)]
        result = urgent_miss_vs_overflag(overrides)
        self.assertEqual(result, {"missed_urgent": 0, "over_flagged": 0})


class LogEventTests(unittest.TestCase):
    def test_log_event_persists_to_storage(self) -> None:
        storage = Storage(":memory:")
        ticket = make_ticket()
        storage.insert_ticket(ticket)
        log_event(storage, ticket.id, "classification", {"category": "billing"})
        events = storage.list_audit_events(ticket.id)
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0].event_type, "classification")


if __name__ == "__main__":
    unittest.main()
