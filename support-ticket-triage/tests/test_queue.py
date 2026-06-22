"""Tests for queue.py: FR-21, FR-22 (urgent and manual-triage tickets surfaced)."""
from __future__ import annotations

import unittest

from ticket_triage.models import Category, TicketStatus, Urgency
from ticket_triage.queue import QueueBucket, QueueView, bucket_for_ticket
from tests.helpers import make_ticket


def _classified(urgency: Urgency, status: TicketStatus = TicketStatus.CLASSIFIED):
    ticket = make_ticket()
    ticket.status = status
    ticket.category = Category.OTHER
    ticket.urgency = urgency
    return ticket


class BucketForTicketTests(unittest.TestCase):
    def test_manual_triage_status_overrides_urgency(self) -> None:
        ticket = _classified(Urgency.NORMAL, status=TicketStatus.NEEDS_MANUAL_TRIAGE)
        self.assertEqual(bucket_for_ticket(ticket), QueueBucket.NEEDS_MANUAL_TRIAGE)

    def test_urgent_ticket_buckets_as_urgent(self) -> None:
        ticket = _classified(Urgency.URGENT)
        self.assertEqual(bucket_for_ticket(ticket), QueueBucket.URGENT)

    def test_low_urgency_buckets_as_low(self) -> None:
        ticket = _classified(Urgency.LOW)
        self.assertEqual(bucket_for_ticket(ticket), QueueBucket.LOW)

    def test_normal_urgency_buckets_as_normal(self) -> None:
        ticket = _classified(Urgency.NORMAL)
        self.assertEqual(bucket_for_ticket(ticket), QueueBucket.NORMAL)


class QueueViewOrderingTests(unittest.TestCase):
    def test_urgent_and_manual_triage_sort_ahead_of_normal_and_low(self) -> None:
        normal = _classified(Urgency.NORMAL)
        urgent = _classified(Urgency.URGENT)
        manual = _classified(Urgency.NORMAL, status=TicketStatus.NEEDS_MANUAL_TRIAGE)
        low = _classified(Urgency.LOW)

        entries = QueueView().build([normal, urgent, manual, low])
        buckets_in_order = [e.bucket for e in entries]

        self.assertEqual(
            buckets_in_order,
            [QueueBucket.NEEDS_MANUAL_TRIAGE, QueueBucket.URGENT, QueueBucket.NORMAL, QueueBucket.LOW],
        )

    def test_visually_distinguishable_without_opening_each_ticket(self) -> None:
        """Acceptance criterion: urgent/manual-triage tickets are
        distinguishable from a queue-level attribute alone."""
        urgent = _classified(Urgency.URGENT)
        normal = _classified(Urgency.NORMAL)
        entries = QueueView().build([urgent, normal])
        buckets = {e.ticket.id: e.bucket for e in entries}
        self.assertNotEqual(buckets[urgent.id], buckets[normal.id])

    def test_stable_sort_preserves_order_within_bucket(self) -> None:
        urgent_first = _classified(Urgency.URGENT)
        urgent_second = _classified(Urgency.URGENT)
        entries = QueueView().build([urgent_first, urgent_second])
        self.assertEqual([e.ticket.id for e in entries], [urgent_first.id, urgent_second.id])


if __name__ == "__main__":
    unittest.main()
