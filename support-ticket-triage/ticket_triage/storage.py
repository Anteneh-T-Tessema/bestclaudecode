"""Primary relational datastore (SDD Section 5: "Primary relational datastore").

SQLite is the local-equivalent of the SDD's "a relational store is the right
fit" call -- structured, relationally linked rows (a ticket has
classifications, overrides, drafts, and review actions queried together for
NFR-9/NFR-10 and the FR-19/FR-20 audit), at a volume profile that does not
need a specialized store. SQLite gives the same transactional guarantee the
SDD calls out as the reason to prefer a relational store: "review action
recorded, then and only then send" (FR-19) is implemented here as a single
transaction in ``record_send`` that requires a foreign key to an existing
ReviewAction row -- the database itself rejects a SendRecord with no matching
review action, rather than relying on application code to remember to check.

This module is intentionally the *only* place that touches SQL. Every other
component (classifier, retriever, drafter, review workflow, queue view,
audit) goes through a ``Storage`` instance.
"""
from __future__ import annotations

import json
import sqlite3
from contextlib import closing
from datetime import datetime
from pathlib import Path

from ticket_triage.models import (
    AuditEvent,
    Category,
    Channel,
    ClassificationRecord,
    Draft,
    OverrideRecord,
    RetrievalRecord,
    RetrievedItem,
    ReviewAction,
    ReviewActionType,
    SendRecord,
    Ticket,
    TicketStatus,
    Urgency,
    UrgencyOverrideDirection,
)

_SCHEMA = """
CREATE TABLE IF NOT EXISTS tickets (
    id TEXT PRIMARY KEY,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    customer_email TEXT NOT NULL,
    channel TEXT NOT NULL,
    created_at TEXT NOT NULL,
    status TEXT NOT NULL,
    category TEXT,
    urgency TEXT,
    confidence REAL
);

CREATE TABLE IF NOT EXISTS classifications (
    id TEXT PRIMARY KEY,
    ticket_id TEXT NOT NULL REFERENCES tickets(id),
    category TEXT,
    urgency TEXT,
    confidence REAL,
    model_version TEXT NOT NULL,
    prompt_version TEXT NOT NULL,
    schema_valid INTEGER NOT NULL,
    fail_safe_triggered INTEGER NOT NULL,
    raw_output TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS retrievals (
    id TEXT PRIMARY KEY,
    ticket_id TEXT NOT NULL REFERENCES tickets(id),
    items_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS drafts (
    id TEXT PRIMARY KEY,
    ticket_id TEXT NOT NULL REFERENCES tickets(id),
    text TEXT NOT NULL,
    model_version TEXT NOT NULL,
    prompt_version TEXT NOT NULL,
    grounding_ticket_ids_json TEXT NOT NULL,
    grounding_kb_ids_json TEXT NOT NULL,
    content_filter_flagged INTEGER NOT NULL,
    content_filter_reason TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS overrides (
    id TEXT PRIMARY KEY,
    ticket_id TEXT NOT NULL REFERENCES tickets(id),
    original_category TEXT,
    corrected_category TEXT,
    original_urgency TEXT,
    corrected_urgency TEXT,
    urgency_direction TEXT NOT NULL,
    channel TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS review_actions (
    id TEXT PRIMARY KEY,
    ticket_id TEXT NOT NULL REFERENCES tickets(id),
    draft_id TEXT NOT NULL REFERENCES drafts(id),
    agent_id TEXT NOT NULL,
    action_type TEXT NOT NULL,
    final_text TEXT,
    edit_distance INTEGER NOT NULL,
    created_at TEXT NOT NULL
);

-- review_action_id has NOT NULL + a foreign key, and there is no nullable
-- "or send anyway" path: this is the data-level enforcement of FR-19/NFR-6.
CREATE TABLE IF NOT EXISTS sends (
    id TEXT PRIMARY KEY,
    ticket_id TEXT NOT NULL REFERENCES tickets(id),
    review_action_id TEXT NOT NULL REFERENCES review_actions(id),
    delivery_id TEXT NOT NULL,
    sent_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
    id TEXT PRIMARY KEY,
    ticket_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    details_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);
"""


def _dt(value: datetime) -> str:
    return value.isoformat()


def _parse_dt(value: str) -> datetime:
    return datetime.fromisoformat(value)


class Storage:
    """SQLite-backed primary datastore. One instance per database file/connection.

    Use ``Storage(":memory:")`` or a temp path in tests; use a real file
    path for a persistent local deployment. All write operations that
    correspond to an SRS acceptance-criteria transaction (notably
    ``record_send``) are wrapped in an explicit transaction.
    """

    def __init__(self, path: str | Path = ":memory:") -> None:
        self._path = str(path)
        self._conn = sqlite3.connect(self._path)
        self._conn.execute("PRAGMA foreign_keys = ON")
        with closing(self._conn.cursor()) as cur:
            cur.executescript(_SCHEMA)
        self._conn.commit()

    def close(self) -> None:
        self._conn.close()

    # ------------------------------------------------------------------
    # Tickets
    # ------------------------------------------------------------------

    def insert_ticket(self, ticket: Ticket) -> None:
        self._conn.execute(
            """INSERT INTO tickets
               (id, subject, body, customer_email, channel, created_at,
                status, category, urgency, confidence)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                ticket.id,
                ticket.subject,
                ticket.body,
                ticket.customer_email,
                ticket.channel.value,
                _dt(ticket.created_at),
                ticket.status.value,
                ticket.category.value if ticket.category else None,
                ticket.urgency.value if ticket.urgency else None,
                ticket.confidence,
            ),
        )
        self._conn.commit()

    def update_ticket_classification(
        self,
        ticket_id: str,
        *,
        status: TicketStatus,
        category: Category | None,
        urgency: Urgency | None,
        confidence: float | None,
    ) -> None:
        self._conn.execute(
            """UPDATE tickets SET status = ?, category = ?, urgency = ?, confidence = ?
               WHERE id = ?""",
            (
                status.value,
                category.value if category else None,
                urgency.value if urgency else None,
                confidence,
                ticket_id,
            ),
        )
        self._conn.commit()

    def update_ticket_status(self, ticket_id: str, status: TicketStatus) -> None:
        self._conn.execute("UPDATE tickets SET status = ? WHERE id = ?", (status.value, ticket_id))
        self._conn.commit()

    def get_ticket(self, ticket_id: str) -> Ticket | None:
        row = self._conn.execute("SELECT * FROM tickets WHERE id = ?", (ticket_id,)).fetchone()
        if row is None:
            return None
        return self._row_to_ticket(row)

    def list_tickets(self) -> list[Ticket]:
        rows = self._conn.execute("SELECT * FROM tickets ORDER BY created_at ASC").fetchall()
        return [self._row_to_ticket(r) for r in rows]

    def _row_to_ticket(self, row) -> Ticket:
        cols = [d[0] for d in self._conn.execute("SELECT * FROM tickets LIMIT 0").description]
        d = dict(zip(cols, row))
        return Ticket(
            id=d["id"],
            subject=d["subject"],
            body=d["body"],
            customer_email=d["customer_email"],
            channel=Channel(d["channel"]),
            created_at=_parse_dt(d["created_at"]),
            status=TicketStatus(d["status"]),
            category=Category(d["category"]) if d["category"] else None,
            urgency=Urgency(d["urgency"]) if d["urgency"] else None,
            confidence=d["confidence"],
        )

    # ------------------------------------------------------------------
    # Classifications
    # ------------------------------------------------------------------

    def insert_classification(self, record: ClassificationRecord) -> None:
        self._conn.execute(
            """INSERT INTO classifications
               (id, ticket_id, category, urgency, confidence, model_version,
                prompt_version, schema_valid, fail_safe_triggered, raw_output, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                record.id,
                record.ticket_id,
                record.category.value if record.category else None,
                record.urgency.value if record.urgency else None,
                record.confidence,
                record.model_version,
                record.prompt_version,
                int(record.schema_valid),
                int(record.fail_safe_triggered),
                record.raw_output,
                _dt(record.created_at),
            ),
        )
        self._conn.commit()

    def list_classifications(self, ticket_id: str | None = None) -> list[ClassificationRecord]:
        if ticket_id is None:
            rows = self._conn.execute("SELECT * FROM classifications ORDER BY created_at ASC").fetchall()
        else:
            rows = self._conn.execute(
                "SELECT * FROM classifications WHERE ticket_id = ? ORDER BY created_at ASC", (ticket_id,)
            ).fetchall()
        cols = [d[0] for d in self._conn.execute("SELECT * FROM classifications LIMIT 0").description]
        out = []
        for row in rows:
            d = dict(zip(cols, row))
            out.append(
                ClassificationRecord(
                    id=d["id"],
                    ticket_id=d["ticket_id"],
                    category=Category(d["category"]) if d["category"] else None,
                    urgency=Urgency(d["urgency"]) if d["urgency"] else None,
                    confidence=d["confidence"],
                    model_version=d["model_version"],
                    prompt_version=d["prompt_version"],
                    schema_valid=bool(d["schema_valid"]),
                    fail_safe_triggered=bool(d["fail_safe_triggered"]),
                    raw_output=d["raw_output"],
                    created_at=_parse_dt(d["created_at"]),
                )
            )
        return out

    # ------------------------------------------------------------------
    # Retrievals
    # ------------------------------------------------------------------

    def insert_retrieval(self, record: RetrievalRecord) -> None:
        items_json = json.dumps([
            {
                "source_type": it.source_type,
                "source_id": it.source_id,
                "rank": it.rank,
                "score": it.score,
                "snippet": it.snippet,
                "redacted": it.redacted,
            }
            for it in record.items
        ])
        self._conn.execute(
            "INSERT INTO retrievals (id, ticket_id, items_json, created_at) VALUES (?, ?, ?, ?)",
            (record.id, record.ticket_id, items_json, _dt(record.created_at)),
        )
        self._conn.commit()

    def list_retrievals(self, ticket_id: str) -> list[RetrievalRecord]:
        rows = self._conn.execute(
            "SELECT id, ticket_id, items_json, created_at FROM retrievals WHERE ticket_id = ? ORDER BY created_at ASC",
            (ticket_id,),
        ).fetchall()
        out = []
        for rid, tid, items_json, created_at in rows:
            items = [RetrievedItem(**it) for it in json.loads(items_json)]
            out.append(RetrievalRecord(id=rid, ticket_id=tid, items=items, created_at=_parse_dt(created_at)))
        return out

    # ------------------------------------------------------------------
    # Drafts
    # ------------------------------------------------------------------

    def insert_draft(self, draft: Draft) -> None:
        self._conn.execute(
            """INSERT INTO drafts
               (id, ticket_id, text, model_version, prompt_version,
                grounding_ticket_ids_json, grounding_kb_ids_json,
                content_filter_flagged, content_filter_reason, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                draft.id,
                draft.ticket_id,
                draft.text,
                draft.model_version,
                draft.prompt_version,
                json.dumps(draft.grounding_ticket_ids),
                json.dumps(draft.grounding_kb_ids),
                int(draft.content_filter_flagged),
                draft.content_filter_reason,
                _dt(draft.created_at),
            ),
        )
        self._conn.commit()

    def get_draft(self, draft_id: str) -> Draft | None:
        row = self._conn.execute("SELECT * FROM drafts WHERE id = ?", (draft_id,)).fetchone()
        if row is None:
            return None
        return self._row_to_draft(row)

    def get_latest_draft_for_ticket(self, ticket_id: str) -> Draft | None:
        row = self._conn.execute(
            "SELECT * FROM drafts WHERE ticket_id = ? ORDER BY created_at DESC LIMIT 1", (ticket_id,)
        ).fetchone()
        if row is None:
            return None
        return self._row_to_draft(row)

    def _row_to_draft(self, row) -> Draft:
        cols = [d[0] for d in self._conn.execute("SELECT * FROM drafts LIMIT 0").description]
        d = dict(zip(cols, row))
        return Draft(
            id=d["id"],
            ticket_id=d["ticket_id"],
            text=d["text"],
            model_version=d["model_version"],
            prompt_version=d["prompt_version"],
            grounding_ticket_ids=json.loads(d["grounding_ticket_ids_json"]),
            grounding_kb_ids=json.loads(d["grounding_kb_ids_json"]),
            content_filter_flagged=bool(d["content_filter_flagged"]),
            content_filter_reason=d["content_filter_reason"],
            created_at=_parse_dt(d["created_at"]),
        )

    # ------------------------------------------------------------------
    # Overrides
    # ------------------------------------------------------------------

    def insert_override(self, record: OverrideRecord) -> None:
        self._conn.execute(
            """INSERT INTO overrides
               (id, ticket_id, original_category, corrected_category,
                original_urgency, corrected_urgency, urgency_direction,
                channel, agent_id, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                record.id,
                record.ticket_id,
                record.original_category.value if record.original_category else None,
                record.corrected_category.value if record.corrected_category else None,
                record.original_urgency.value if record.original_urgency else None,
                record.corrected_urgency.value if record.corrected_urgency else None,
                record.urgency_direction.value,
                record.channel.value,
                record.agent_id,
                _dt(record.created_at),
            ),
        )
        self._conn.commit()

    def list_overrides(self) -> list[OverrideRecord]:
        rows = self._conn.execute("SELECT * FROM overrides ORDER BY created_at ASC").fetchall()
        cols = [d[0] for d in self._conn.execute("SELECT * FROM overrides LIMIT 0").description]
        out = []
        for row in rows:
            d = dict(zip(cols, row))
            out.append(
                OverrideRecord(
                    id=d["id"],
                    ticket_id=d["ticket_id"],
                    original_category=Category(d["original_category"]) if d["original_category"] else None,
                    corrected_category=Category(d["corrected_category"]) if d["corrected_category"] else None,
                    original_urgency=Urgency(d["original_urgency"]) if d["original_urgency"] else None,
                    corrected_urgency=Urgency(d["corrected_urgency"]) if d["corrected_urgency"] else None,
                    urgency_direction=UrgencyOverrideDirection(d["urgency_direction"]),
                    channel=Channel(d["channel"]),
                    agent_id=d["agent_id"],
                    created_at=_parse_dt(d["created_at"]),
                )
            )
        return out

    # ------------------------------------------------------------------
    # Review actions + sends (the FR-19/NFR-6 transactional boundary)
    # ------------------------------------------------------------------

    def insert_review_action(self, action: ReviewAction) -> None:
        self._conn.execute(
            """INSERT INTO review_actions
               (id, ticket_id, draft_id, agent_id, action_type, final_text, edit_distance, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                action.id,
                action.ticket_id,
                action.draft_id,
                action.agent_id,
                action.action_type.value,
                action.final_text,
                action.edit_distance,
                _dt(action.created_at),
            ),
        )
        self._conn.commit()

    def get_review_action(self, review_action_id: str) -> ReviewAction | None:
        row = self._conn.execute(
            "SELECT * FROM review_actions WHERE id = ?", (review_action_id,)
        ).fetchone()
        if row is None:
            return None
        cols = [d[0] for d in self._conn.execute("SELECT * FROM review_actions LIMIT 0").description]
        d = dict(zip(cols, row))
        return ReviewAction(
            id=d["id"],
            ticket_id=d["ticket_id"],
            draft_id=d["draft_id"],
            agent_id=d["agent_id"],
            action_type=ReviewActionType(d["action_type"]),
            final_text=d["final_text"],
            edit_distance=d["edit_distance"],
            created_at=_parse_dt(d["created_at"]),
        )

    def list_review_actions(self, ticket_id: str | None = None) -> list[ReviewAction]:
        if ticket_id is None:
            rows = self._conn.execute("SELECT * FROM review_actions ORDER BY created_at ASC").fetchall()
        else:
            rows = self._conn.execute(
                "SELECT * FROM review_actions WHERE ticket_id = ? ORDER BY created_at ASC", (ticket_id,)
            ).fetchall()
        cols = [d[0] for d in self._conn.execute("SELECT * FROM review_actions LIMIT 0").description]
        out = []
        for row in rows:
            d = dict(zip(cols, row))
            out.append(
                ReviewAction(
                    id=d["id"],
                    ticket_id=d["ticket_id"],
                    draft_id=d["draft_id"],
                    agent_id=d["agent_id"],
                    action_type=ReviewActionType(d["action_type"]),
                    final_text=d["final_text"],
                    edit_distance=d["edit_distance"],
                    created_at=_parse_dt(d["created_at"]),
                )
            )
        return out

    def record_send(self, send: SendRecord) -> None:
        """Persist a SendRecord. Fails (FK violation) if review_action_id doesn't exist.

        This is the data-level half of FR-19/NFR-6: even if a caller bypassed
        the Python-level guard in review.py, the database schema itself
        refuses to store a send with no matching review action row.
        """
        self._conn.execute(
            "INSERT INTO sends (id, ticket_id, review_action_id, delivery_id, sent_at) VALUES (?, ?, ?, ?, ?)",
            (send.id, send.ticket_id, send.review_action_id, send.delivery_id, _dt(send.sent_at)),
        )
        self._conn.commit()

    def list_sends(self) -> list[SendRecord]:
        rows = self._conn.execute("SELECT * FROM sends ORDER BY sent_at ASC").fetchall()
        cols = [d[0] for d in self._conn.execute("SELECT * FROM sends LIMIT 0").description]
        out = []
        for row in rows:
            d = dict(zip(cols, row))
            out.append(
                SendRecord(
                    id=d["id"],
                    ticket_id=d["ticket_id"],
                    review_action_id=d["review_action_id"],
                    delivery_id=d["delivery_id"],
                    sent_at=_parse_dt(d["sent_at"]),
                )
            )
        return out

    # ------------------------------------------------------------------
    # Audit log (SDD 2.14)
    # ------------------------------------------------------------------

    def insert_audit_event(self, event: AuditEvent) -> None:
        self._conn.execute(
            "INSERT INTO audit_events (id, ticket_id, event_type, details_json, created_at) VALUES (?, ?, ?, ?, ?)",
            (event.id, event.ticket_id, event.event_type, json.dumps(event.details), _dt(event.created_at)),
        )
        self._conn.commit()

    def list_audit_events(self, ticket_id: str | None = None, event_type: str | None = None) -> list[AuditEvent]:
        query = "SELECT * FROM audit_events WHERE 1=1"
        params: list = []
        if ticket_id is not None:
            query += " AND ticket_id = ?"
            params.append(ticket_id)
        if event_type is not None:
            query += " AND event_type = ?"
            params.append(event_type)
        query += " ORDER BY created_at ASC"
        rows = self._conn.execute(query, params).fetchall()
        cols = [d[0] for d in self._conn.execute("SELECT * FROM audit_events LIMIT 0").description]
        out = []
        for row in rows:
            d = dict(zip(cols, row))
            out.append(
                AuditEvent(
                    id=d["id"],
                    ticket_id=d["ticket_id"],
                    event_type=d["event_type"],
                    details=json.loads(d["details_json"]),
                    created_at=_parse_dt(d["created_at"]),
                )
            )
        return out
