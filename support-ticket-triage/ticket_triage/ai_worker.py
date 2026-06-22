"""AI Worker: orchestrates classify -> retrieve -> draft (SDD Section 1, 2.9).

This module is the architectural embodiment of the "AI/Send Credential
Boundary" (SDD 2.9, NFR-6, C-9): ``AIWorker`` holds an ``LLMClient``, a
``VectorIndex``, a ``KnowledgeBase``, and read access to ticket content --
and nothing else. It has no import of, reference to, or method that calls
the outbound delivery module or the human review workflow anywhere in this
module. That is not just a convention stated in a docstring: it is
verified by a static/architectural test (see
``tests/test_architecture_boundary.py``) that asserts this module's source
contains no reference to that delivery capability and that ``AIWorker``
exposes no method capable of reaching it.

``AIWorker.process_ticket`` is the single entry point the Ticket Service
calls once per ingested ticket (SDD 3.1): it runs the synchronous
classification step, then -- regardless of classification outcome,
matching SDD 3.1 step 4 ("once classification completes, regardless of
outcome") -- runs retrieval and drafting. It returns plain result objects
for the caller (Ticket Service) to persist; this module does not touch
storage directly so the worker boundary stays a pure compute step with no
write credential beyond what the caller chooses to grant it.
"""
from __future__ import annotations

from dataclasses import dataclass

from ticket_triage.classifier import Classifier, ClassificationOutcome
from ticket_triage.drafting import DraftGenerator
from ticket_triage.knowledge_base import KnowledgeBase
from ticket_triage.llm_client import LLMClient
from ticket_triage.local_index import VectorIndex
from ticket_triage.models import Draft, RetrievalRecord, Ticket
from ticket_triage.retrieval import KnowledgeBaseRetriever, SimilarTicketRetriever


@dataclass
class TicketProcessingResult:
    """Everything AIWorker.process_ticket produces for one ticket.

    Deliberately has no field, method, or attribute related to sending --
    there is nothing in this object an agent UI or batch job could use to
    reach the customer-facing channel without going through review.py.
    """

    classification: ClassificationOutcome
    similar_tickets: RetrievalRecord
    kb_articles: RetrievalRecord
    draft: Draft


class AIWorker:
    """Classifier + retriever + drafter, with no outbound-send capability.

    Construction only accepts AI-pipeline collaborators (LLM client, vector
    index, knowledge base, and an in-memory ticket lookup for similar-ticket
    retrieval) -- never a send gateway or review-workflow object. This is
    deliberate: it is the thing that makes "the AI Worker has no
    credential/capability to call the outbound send API" true in code, not
    just in prose.
    """

    def __init__(
        self,
        llm_client: LLMClient,
        vector_index: VectorIndex,
        knowledge_base: KnowledgeBase,
        tickets_by_id: dict[str, Ticket],
    ) -> None:
        self._classifier = Classifier(llm_client)
        self._similar_ticket_retriever = SimilarTicketRetriever(vector_index, tickets_by_id)
        self._kb_retriever = KnowledgeBaseRetriever(vector_index, knowledge_base)
        self._draft_generator = DraftGenerator(llm_client)

    def process_ticket(self, ticket: Ticket) -> TicketProcessingResult:
        """Run classify -> retrieve (tickets + KB) -> draft for one ticket.

        Matches SDD 3.1 steps 3-6: classification runs first and its
        outcome (including a fail-safe outcome) does not block retrieval/
        drafting from running, since a draft is still useful context for
        an agent triaging a manually-flagged ticket.
        """
        classification = self._classifier.classify(ticket.id, f"{ticket.subject}\n{ticket.body}")

        similar_tickets = self._similar_ticket_retriever.retrieve(ticket)
        kb_articles = self._kb_retriever.retrieve(ticket)

        draft = self._draft_generator.generate(
            ticket,
            similar_tickets=similar_tickets.items,
            kb_articles=kb_articles.items,
        )

        return TicketProcessingResult(
            classification=classification,
            similar_tickets=similar_tickets,
            kb_articles=kb_articles,
            draft=draft,
        )
