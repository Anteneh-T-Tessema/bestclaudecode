"""Outbound Send Gateway (SDD 4.1, 4.3): the only channel to the customer.

Local-equivalent infrastructure note: the SDD assumes the organization's
existing transactional email/reply-sending provider. There is no real
provider configured in this study repo, so this module is a local/mock
gateway that "delivers" by writing the final message to an in-memory (or
optionally file-backed) outbox and returning a delivery id -- structurally
identical to what a real provider's API call/response would look like,
without making a network call.

Critically, this module is *never imported by* ``ai_worker.py`` or
``classifier.py``/``retrieval.py``/``drafting.py`` -- only by
``review.py``, which is the sole caller per NFR-6/FR-19. See
``tests/test_architecture_boundary.py`` for the check that enforces this
at the import-graph level, not just by convention.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from ticket_triage.models import new_id


@dataclass
class DeliveryReceipt:
    """Confirmation returned by the gateway for one send."""

    delivery_id: str
    customer_email: str
    final_text: str


@dataclass
class SendGateway:
    """Mock outbound send gateway: the local equivalent of a real ESP API.

    ``outbox`` accumulates every message "sent" through this gateway, for
    test assertions and for the no-autonomous-send check (every entry here
    must trace back to a recorded review action through the caller's own
    bookkeeping -- this class does not enforce that itself; ``review.py``
    does, by being the only caller).
    """

    outbox: list[DeliveryReceipt] = field(default_factory=list)

    def send(self, *, customer_email: str, final_text: str) -> DeliveryReceipt:
        """"Deliver" a customer-facing reply. Returns a delivery receipt.

        This method has no awareness of review actions, audit logs, or
        tickets -- it is intentionally a dumb transport. The requirement
        that it only ever be invoked after a recorded human review action
        is enforced by ``review.py`` being the only code that holds a
        reference to a SendGateway instance, not by any check inside this
        method.
        """
        receipt = DeliveryReceipt(delivery_id=new_id(), customer_email=customer_email, final_text=final_text)
        self.outbox.append(receipt)
        return receipt
