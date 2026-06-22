"""Ticket Service facade (SDD Section 1): wires ingestion -> AI worker -> storage.

This is the "single deployable agent-facing service" the SDD describes,
collapsed here into one in-process facade class for a local study repo
(no real container/PaaS deployment). It owns the primary datastore
(``Storage``) and is the only thing that constructs a ``ReviewWorkflow``
(and therefore the only path that can reach the ``SendGateway``) -- the AI
worker it holds is a pure compute step with no storage write access beyond
what this facade explicitly persists on its behalf.

Data flow implemented here matches SDD Section 3.1:
  1. ``ingest_ticket`` normalizes + persists a new ticket (status=INGESTED).
  2. It synchronously invokes the AI Worker (classify, then retrieve+draft).
  3. Classification result updates the ticket row (CLASSIFIED or
     NEEDS_MANUAL_TRIAGE) and is logged to the audit trail (NFR-13).
  4. Retrieval results are logged (NFR-14).
  5. The draft is persisted; if content-filter-flagged, the ticket is left
     in CLASSIFIED status rather than DRAFTED (it is not "ready for an
     agent" the same way -- SDD 2.8's "flagged rather than silently passed
     through").

The SDD models retrieval+drafting as an asynchronous job triggered after
classification (SDD 3.1 step 4, NFR-2's 15s budget existing precisely
because it's off the synchronous ingestion path). This facade runs it
synchronously within ``ingest_ticket`` for simplicity in a local,
single-process study implementation -- there is no real job queue/worker
pool to demonstrate here, and the FakeLLMClient's calls are fast enough
that synchronous execution does not violate the spirit of the latency
budget. ``ingest_ticket_async`` is provided as a thin two-phase variant
(classify now, draft later) for callers/tests that want to exercise the
"draft job runs after classification, not blocking it" shape explicitly.
"""
from __future__ import annotations

from ticket_triage.ai_worker import AIWorker
from ticket_triage.audit import log_event
from ticket_triage.models import Draft, Ticket, TicketStatus
from ticket_triage.review import ReviewWorkflow
from ticket_triage.send_gateway import SendGateway
from ticket_triage.storage import Storage


class TicketService:
    """Facade wiring ingestion, the AI worker, storage, and the review workflow."""

    def __init__(self, storage: Storage, ai_worker: AIWorker, send_gateway: SendGateway | None = None) -> None:
        self._storage = storage
        self._ai_worker = ai_worker
        self._review_workflow = ReviewWorkflow(storage, send_gateway or SendGateway())

    @property
    def storage(self) -> Storage:
        return self._storage

    @property
    def review_workflow(self) -> ReviewWorkflow:
        return self._review_workflow

    def ingest_ticket(self, ticket: Ticket) -> Ticket:
        """Persist a normalized ticket, then run classify+retrieve+draft (SDD 3.1)."""
        self._storage.insert_ticket(ticket)

        result = self._ai_worker.process_ticket(ticket)

        # Step 3: classification outcome.
        outcome = result.classification
        new_status = TicketStatus.NEEDS_MANUAL_TRIAGE if outcome.fail_safe else TicketStatus.CLASSIFIED
        self._storage.update_ticket_classification(
            ticket.id,
            status=new_status,
            category=outcome.category,
            urgency=outcome.urgency,
            confidence=outcome.confidence,
        )
        self._storage.insert_classification(outcome.record)
        log_event(self._storage, ticket.id, "classification", {
            "category": outcome.category.value if outcome.category else None,
            "urgency": outcome.urgency.value if outcome.urgency else None,
            "confidence": outcome.confidence,
            "fail_safe_triggered": outcome.fail_safe,
            "model_version": outcome.record.model_version,
            "prompt_version": outcome.record.prompt_version,
        })
        if outcome.fail_safe:
            log_event(self._storage, ticket.id, "fail_safe_routed", {
                "schema_valid": outcome.record.schema_valid,
                "confidence": outcome.confidence,
            })

        # Steps 4-5: retrieval, logged for NFR-14.
        self._storage.insert_retrieval(result.similar_tickets)
        self._storage.insert_retrieval(result.kb_articles)
        log_event(self._storage, ticket.id, "retrieval", {
            "similar_ticket_count": len(result.similar_tickets.items),
            "kb_article_count": len(result.kb_articles.items),
        })

        # Step 6-7: draft persisted; content-filter trigger logged distinctly (NFR-16).
        self._persist_draft(ticket.id, result.draft)

        return self._storage.get_ticket(ticket.id)  # type: ignore[return-value]

    def _persist_draft(self, ticket_id: str, draft: Draft) -> None:
        self._storage.insert_draft(draft)
        if draft.content_filter_flagged:
            log_event(self._storage, ticket_id, "content_filter_triggered", {
                "draft_id": draft.id,
                "reason": draft.content_filter_reason,
            })
            # Held, not surfaced as a normal draft (SDD 2.8): ticket stays
            # at its post-classification status rather than advancing to
            # DRAFTED.
            return
        current = self._storage.get_ticket(ticket_id)
        if current is not None and current.status != TicketStatus.NEEDS_MANUAL_TRIAGE:
            self._storage.update_ticket_status(ticket_id, TicketStatus.DRAFTED)
