"""Observability/Audit Log helpers (SDD 2.14).

Thin wrapper around ``Storage``'s audit_events table plus read-side
aggregation for the metrics the SRS requires be computable without
re-deriving them from raw event logs (NFR-9, NFR-10):

- ``acceptance_rate`` -- percentage of AI-assigned labels accepted without
  agent override (Goal 4), sliceable by category/urgency/channel.
- ``urgent_miss_vs_overflag`` -- rate of missed-urgent vs. over-flagged
  overrides, tracked separately per NFR-10 (these must never be netted
  into one number).

``log_event`` is the single write helper every component (classifier,
retrievers, draft generator, review workflow, override handler) should
call so every safety-relevant or observability event ends up in one place
(SDD 2.14's "structured log/table capturing...").
"""
from __future__ import annotations

from collections import Counter

from ticket_triage.models import AuditEvent, OverrideRecord, UrgencyOverrideDirection, new_id, utcnow
from ticket_triage.storage import Storage


def log_event(storage: Storage, ticket_id: str, event_type: str, details: dict) -> AuditEvent:
    """Append one audit event and return it."""
    event = AuditEvent(id=new_id(), ticket_id=ticket_id, event_type=event_type, details=details, created_at=utcnow())
    storage.insert_audit_event(event)
    return event


def acceptance_rate(overrides: list[OverrideRecord], total_classified_tickets: int) -> float:
    """Percentage of classified tickets with no recorded override (NFR-9).

    ``overrides`` should be the full override list (one entry per
    overridden ticket, by construction of ``overrides.py``);
    ``total_classified_tickets`` is the denominator the caller supplies
    (e.g. count of tickets with a non-null category/urgency).
    """
    if total_classified_tickets == 0:
        return 0.0
    overridden_ticket_ids = {o.ticket_id for o in overrides}
    accepted = total_classified_tickets - len(overridden_ticket_ids)
    return accepted / total_classified_tickets


def urgent_miss_vs_overflag(overrides: list[OverrideRecord]) -> dict[str, int]:
    """Count missed-urgent vs. over-flagged-urgent overrides (NFR-10).

    "Missed urgent" = upgraded_to_urgent (classifier said non-urgent, agent
    corrected to urgent). "Over-flagged" = downgraded_from_urgent. Reported
    as two separate counts, never netted into one number, per AI
    requirements Section 3 ("these have different costs... should be
    tracked and reported separately").
    """
    counts = Counter(o.urgency_direction for o in overrides)
    return {
        "missed_urgent": counts.get(UrgencyOverrideDirection.UPGRADED_TO_URGENT, 0),
        "over_flagged": counts.get(UrgencyOverrideDirection.DOWNGRADED_FROM_URGENT, 0),
    }
