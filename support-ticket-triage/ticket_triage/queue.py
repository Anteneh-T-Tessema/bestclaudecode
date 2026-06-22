"""Queue/List View helpers (SDD 2.11): FR-21, FR-22.

This is a backend-side ordering/grouping helper -- the actual visual
badge/color rendering belongs to a real UI layer this study repo does not
build (no web frontend is in scope here; see README "What this does not
build"). What's testable and spec-relevant without a UI framework is the
*ordering and classification* of tickets into queue buckets, which is what
``QueueView`` provides: urgent and "needs manual triage" tickets must sort
ahead of routine tickets and be distinguishable as a queue *attribute*
(``bucket``) that any UI would key its badge/color off of.
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from ticket_triage.models import Ticket, TicketStatus, Urgency


class QueueBucket(str, Enum):
    """Distinguishable queue buckets a UI would render with different styling."""

    NEEDS_MANUAL_TRIAGE = "needs_manual_triage"
    URGENT = "urgent"
    NORMAL = "normal"
    LOW = "low"


@dataclass
class QueueEntry:
    ticket: Ticket
    bucket: QueueBucket


def bucket_for_ticket(ticket: Ticket) -> QueueBucket:
    """Classify a ticket into a queue bucket for surfacing purposes (FR-21/22)."""
    if ticket.status == TicketStatus.NEEDS_MANUAL_TRIAGE:
        return QueueBucket.NEEDS_MANUAL_TRIAGE
    if ticket.urgency == Urgency.URGENT:
        return QueueBucket.URGENT
    if ticket.urgency == Urgency.LOW:
        return QueueBucket.LOW
    return QueueBucket.NORMAL


#: Sort priority: manual-triage and urgent tickets surface first (FR-21/22).
_BUCKET_PRIORITY = {
    QueueBucket.NEEDS_MANUAL_TRIAGE: 0,
    QueueBucket.URGENT: 1,
    QueueBucket.NORMAL: 2,
    QueueBucket.LOW: 3,
}


class QueueView:
    """Builds an ordered, bucketed view of tickets for the agent queue."""

    def build(self, tickets: list[Ticket]) -> list[QueueEntry]:
        """Return tickets as QueueEntry objects, sorted urgent/manual-triage first.

        Within a bucket, original (creation) order is preserved -- a stable
        sort so urgent tickets queue FIFO among themselves rather than being
        reordered arbitrarily.
        """
        entries = [QueueEntry(ticket=t, bucket=bucket_for_ticket(t)) for t in tickets]
        entries.sort(key=lambda e: _BUCKET_PRIORITY[e.bucket])
        return entries
