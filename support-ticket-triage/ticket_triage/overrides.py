"""Classification Override control (SDD 2.12): FR-23, FR-24, FR-25.

Lets an agent correct the AI-assigned category and/or urgency on a ticket.
Writes an OverrideRecord capturing the original value, corrected value,
ticket metadata, timestamp, and -- when urgency changes -- an explicit
upgraded-to-urgent / downgraded-from-urgent direction flag distinct from
the before/after values (FR-25), so it can be queried directly rather than
re-derived by comparing two enum values every time (NFR-10).
"""
from __future__ import annotations

from ticket_triage.audit import log_event
from ticket_triage.models import (
    Category,
    OverrideRecord,
    Ticket,
    Urgency,
    UrgencyOverrideDirection,
    new_id,
    utcnow,
)
from ticket_triage.storage import Storage


def _urgency_direction(original: Urgency | None, corrected: Urgency | None) -> UrgencyOverrideDirection:
    if original == corrected:
        return UrgencyOverrideDirection.NONE
    if corrected == Urgency.URGENT:
        return UrgencyOverrideDirection.UPGRADED_TO_URGENT
    if original == Urgency.URGENT:
        return UrgencyOverrideDirection.DOWNGRADED_FROM_URGENT
    return UrgencyOverrideDirection.NONE


def apply_override(
    storage: Storage,
    ticket: Ticket,
    *,
    agent_id: str,
    corrected_category: Category | None = None,
    corrected_urgency: Urgency | None = None,
) -> OverrideRecord:
    """Record an override and update the ticket's live category/urgency (FR-23/24/25).

    Either corrected_category or corrected_urgency (or both) may be given;
    an unspecified one leaves that field unchanged on the ticket but is
    still recorded in the OverrideRecord as equal to the original value
    (direction NONE for urgency in that case).
    """
    original_category = ticket.category
    original_urgency = ticket.urgency

    new_category = corrected_category if corrected_category is not None else original_category
    new_urgency = corrected_urgency if corrected_urgency is not None else original_urgency

    direction = _urgency_direction(original_urgency, new_urgency)

    record = OverrideRecord(
        id=new_id(),
        ticket_id=ticket.id,
        original_category=original_category,
        corrected_category=new_category,
        original_urgency=original_urgency,
        corrected_urgency=new_urgency,
        urgency_direction=direction,
        channel=ticket.channel,
        agent_id=agent_id,
        created_at=utcnow(),
    )
    storage.insert_override(record)
    storage.update_ticket_classification(
        ticket.id,
        status=ticket.status,
        category=new_category,
        urgency=new_urgency,
        confidence=ticket.confidence,
    )
    log_event(storage, ticket.id, "override", {
        "override_id": record.id,
        "original_category": original_category.value if original_category else None,
        "corrected_category": new_category.value if new_category else None,
        "original_urgency": original_urgency.value if original_urgency else None,
        "corrected_urgency": new_urgency.value if new_urgency else None,
        "urgency_direction": direction.value,
        "agent_id": agent_id,
    })
    return record
