"""Human Review & Send workflow (SDD 2.10): the only path to a customer send.

Implements FR-17 through FR-20 and is the architectural enforcement point
for NFR-6/FR-19 ("no code path... without a recorded human review/edit
action immediately preceding that send"):

- ``ReviewWorkflow`` is the only class in this codebase constructed with a
  ``SendGateway``. Nothing in ``ai_worker.py`` or its collaborators holds
  one (see ``tests/test_architecture_boundary.py``).
- ``submit_review_action`` always persists the ReviewAction first (FR-20:
  agent identity + timestamp + action type recorded), in the same call
  that -- only for ACCEPT/EDIT, and only as the direct next step after that
  persistence succeeds -- invokes the gateway. A DISCARD action never
  reaches the gateway at all.
- There is exactly one method that can lead to a send
  (``submit_review_action``); there is no separate "send" method, no
  retry/backfill/batch entry point in this module or anywhere else in the
  package. Any retry must re-enter through this same method and therefore
  always re-records (or requires) a review action.
"""
from __future__ import annotations

from ticket_triage.audit import log_event
from ticket_triage.models import (
    Draft,
    ReviewAction,
    ReviewActionType,
    SendRecord,
    Ticket,
    TicketStatus,
    new_id,
    utcnow,
)
from ticket_triage.send_gateway import SendGateway
from ticket_triage.storage import Storage


class ReviewError(Exception):
    """A review action could not be processed (e.g. missing draft/ticket)."""


def edit_distance(a: str, b: str) -> int:
    """Levenshtein edit distance between a and b (used for NFR-15 tracking)."""
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)

    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, start=1):
        curr = [i] + [0] * len(b)
        for j, cb in enumerate(b, start=1):
            cost = 0 if ca == cb else 1
            curr[j] = min(
                prev[j] + 1,       # deletion
                curr[j - 1] + 1,   # insertion
                prev[j - 1] + cost,  # substitution
            )
        prev = curr
    return prev[-1]


class ReviewWorkflow:
    """The sole caller of SendGateway. Constructed with storage + a gateway."""

    def __init__(self, storage: Storage, send_gateway: SendGateway) -> None:
        self._storage = storage
        self._gateway = send_gateway

    def submit_review_action(
        self,
        *,
        ticket: Ticket,
        draft: Draft,
        agent_id: str,
        action_type: ReviewActionType,
        final_text: str | None = None,
    ) -> ReviewAction:
        """Record a review action and, for accept/edit, send (FR-17-20).

        Order of operations is the whole point of this method:
          1. Validate inputs.
          2. Persist the ReviewAction (FR-20) -- this happens unconditionally,
             including for DISCARD.
          3. Only if action_type is ACCEPT or EDIT, and only after step 2
             has successfully committed, call the SendGateway and persist
             the resulting SendRecord (which itself requires the just-
             persisted review_action_id as a foreign key -- see storage.py).
        A DISCARD action stops at step 2: final_text is None, no send ever
        occurs, satisfying "discard" as a no-send terminal action (FR-18).
        """
        if draft.ticket_id != ticket.id:
            raise ReviewError("draft does not belong to this ticket")

        if action_type == ReviewActionType.DISCARD:
            if final_text is not None:
                raise ReviewError("discard action must not carry final_text")
            distance = 0
        else:
            if not final_text or not final_text.strip():
                raise ReviewError(f"{action_type.value} action requires non-empty final_text")
            distance = edit_distance(draft.text, final_text)

        action = ReviewAction(
            id=new_id(),
            ticket_id=ticket.id,
            draft_id=draft.id,
            agent_id=agent_id,
            action_type=action_type,
            final_text=final_text,
            edit_distance=distance,
            created_at=utcnow(),
        )
        # Step 2: record the review action. This is the gate every send
        # must pass through (FR-19/FR-20) -- it is persisted before any
        # gateway call is even considered below.
        self._storage.insert_review_action(action)
        log_event(self._storage, ticket.id, "review_action", {
            "review_action_id": action.id,
            "action_type": action_type.value,
            "agent_id": agent_id,
            "edit_distance": distance,
        })

        if action_type == ReviewActionType.DISCARD:
            self._storage.update_ticket_status(ticket.id, TicketStatus.DISCARDED)
            return action

        # Step 3: send, strictly as a consequence of the just-persisted
        # review action above (FR-19's "no code path... without a recorded
        # human review action immediately preceding that send").
        receipt = self._gateway.send(customer_email=ticket.customer_email, final_text=final_text)
        send_record = SendRecord(
            id=new_id(),
            ticket_id=ticket.id,
            review_action_id=action.id,
            delivery_id=receipt.delivery_id,
            sent_at=utcnow(),
        )
        self._storage.record_send(send_record)
        self._storage.update_ticket_status(ticket.id, TicketStatus.SENT)
        log_event(self._storage, ticket.id, "send", {
            "review_action_id": action.id,
            "delivery_id": receipt.delivery_id,
        })

        return action
