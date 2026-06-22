"""Shared data model: tickets, classification, drafts, overrides, review/send.

This module owns the canonical ticket schema (SDD 2.3 / FR-2) and the fixed
enumerated taxonomies for category and urgency (AI requirements Section 1,
FR-4/FR-5/FR-6) that every other component imports rather than re-declaring.
Keeping these in one place is what makes "structured output, not free text"
(FR-6) enforceable: a classifier result can only ever be one of these enum
members, never an arbitrary string.

Nothing in this module talks to a model, a datastore, or the network -- it
is pure data shape, shared by ingestion, the AI worker, storage, and the
agent-facing layer alike.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum


def new_id() -> str:
    """Generate a fresh opaque identifier (ticket id, draft id, etc.)."""
    return uuid.uuid4().hex


def utcnow() -> datetime:
    """Current UTC time, used uniformly for every timestamp in this system."""
    return datetime.now(timezone.utc)


class Channel(str, Enum):
    """Ticket source channel (FR-3): retained on every ticket record."""

    EMAIL = "email"
    WEB_FORM = "web_form"


class Category(str, Enum):
    """Fixed, enumerated category taxonomy (FR-4, FR-6).

    A placeholder-but-reasonable taxonomy for a generic support product;
    the AI requirements doc treats the exact taxonomy as something the
    organization will refine over time (Section 1), so this enum is the
    single point of truth a real deployment would edit.
    """

    BILLING = "billing"
    ACCOUNT_ACCESS = "account_access"
    BUG_REPORT = "bug_report"
    FEATURE_REQUEST = "feature_request"
    HOW_TO = "how_to"
    OTHER = "other"


class Urgency(str, Enum):
    """Fixed, enumerated urgency taxonomy (FR-5, FR-6)."""

    URGENT = "urgent"
    NORMAL = "normal"
    LOW = "low"


class TicketStatus(str, Enum):
    """Ticket lifecycle status, independent of category/urgency.

    NEEDS_MANUAL_TRIAGE is the fail-safe state from FR-7: a ticket lands
    here, instead of being defaulted to NORMAL urgency, whenever
    classification output fails schema validation or reports low
    confidence (SDD 2.4, 3.1 step 3).
    """

    INGESTED = "ingested"
    CLASSIFIED = "classified"
    NEEDS_MANUAL_TRIAGE = "needs_manual_triage"
    DRAFTED = "drafted"
    SENT = "sent"
    DISCARDED = "discarded"


class ReviewActionType(str, Enum):
    """The three things an agent can do with a draft (FR-18)."""

    ACCEPT = "accept"
    EDIT = "edit"
    DISCARD = "discard"


class UrgencyOverrideDirection(str, Enum):
    """Direction of an urgency override (FR-25) -- tracked distinctly.

    Required because an under-flagged "missed urgent" ticket and an
    over-flagged ticket have different costs (AI requirements Section 3)
    and must not be netted into one number (NFR-10).
    """

    UPGRADED_TO_URGENT = "upgraded_to_urgent"
    DOWNGRADED_FROM_URGENT = "downgraded_from_urgent"
    NONE = "none"  # override changed category only, not urgency


@dataclass
class Ticket:
    """Canonical ticket record (FR-2): one schema regardless of channel."""

    id: str
    subject: str
    body: str
    customer_email: str
    channel: Channel
    created_at: datetime
    status: TicketStatus = TicketStatus.INGESTED
    category: Category | None = None
    urgency: Urgency | None = None
    confidence: float | None = None


@dataclass
class ClassificationRecord:
    """One classification call's result, logged for audit (NFR-13).

    ``raw_output`` retains what the model actually returned (pre- or
    post-validation) so a schema-validation failure can be inspected
    later (NFR-16) without having to reproduce the call.
    """

    id: str
    ticket_id: str
    category: Category | None
    urgency: Urgency | None
    confidence: float | None
    model_version: str
    prompt_version: str
    schema_valid: bool
    fail_safe_triggered: bool
    raw_output: str
    created_at: datetime = field(default_factory=utcnow)


@dataclass
class RetrievedItem:
    """One retrieval hit (a similar ticket or a KB article), with rank/score."""

    source_type: str  # "ticket" or "kb_article"
    source_id: str
    rank: int
    score: float
    snippet: str
    redacted: bool = False


@dataclass
class RetrievalRecord:
    """Logged retrieval step (NFR-14): what was surfaced, and at what rank."""

    id: str
    ticket_id: str
    items: list[RetrievedItem]
    created_at: datetime = field(default_factory=utcnow)


@dataclass
class Draft:
    """A generated draft reply (FR-13), pending agent review."""

    id: str
    ticket_id: str
    text: str
    model_version: str
    prompt_version: str
    grounding_ticket_ids: list[str]
    grounding_kb_ids: list[str]
    content_filter_flagged: bool = False
    content_filter_reason: str | None = None
    created_at: datetime = field(default_factory=utcnow)


@dataclass
class OverrideRecord:
    """An agent's correction of AI-assigned category/urgency (FR-23/24/25)."""

    id: str
    ticket_id: str
    original_category: Category | None
    corrected_category: Category | None
    original_urgency: Urgency | None
    corrected_urgency: Urgency | None
    urgency_direction: UrgencyOverrideDirection
    channel: Channel
    agent_id: str
    created_at: datetime = field(default_factory=utcnow)


@dataclass
class ReviewAction:
    """A recorded human review/edit/discard action (FR-17-20).

    This is the record that send.py / review.py require to exist,
    successfully persisted, before the send gateway may be called
    (NFR-6, FR-19). ``final_text`` is None for a DISCARD action.
    """

    id: str
    ticket_id: str
    draft_id: str
    agent_id: str
    action_type: ReviewActionType
    final_text: str | None
    edit_distance: int
    created_at: datetime = field(default_factory=utcnow)


@dataclass
class SendRecord:
    """A confirmed send via the Outbound Send Gateway (FR-20, SDD 3.2 step 4).

    ``review_action_id`` is a hard foreign key in the storage layer: a
    SendRecord cannot exist without a preceding ReviewAction id, which is
    the data-level enforcement behind the audit acceptance criterion in
    the SRS ("zero exceptions across a full test suite run").
    """

    id: str
    ticket_id: str
    review_action_id: str
    delivery_id: str
    sent_at: datetime = field(default_factory=utcnow)


@dataclass
class AuditEvent:
    """A safety-relevant or observability event (NFR-13 through NFR-16).

    ``event_type`` is a free string by design (e.g. "schema_validation_failed",
    "content_filter_triggered", "classification", "retrieval", "send") --
    this is the cross-cutting log described in SDD 2.14, not a typed
    table per event kind, so new event kinds don't require a schema change.
    """

    id: str
    ticket_id: str
    event_type: str
    details: dict
    created_at: datetime = field(default_factory=utcnow)
