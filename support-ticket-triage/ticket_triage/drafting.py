"""Draft Generator (2.7) and Output Content Filter (2.8).

Implements FR-13 through FR-16:

- FR-13/FR-14: generate a draft reply grounded only in retrieved similar
  tickets + KB articles + the ticket's own text; the LLM client is never
  given license to add unsupported claims (enforced by the prompt
  contract documented in ``llm_client.FakeLLMClient.generate_draft``,
  which only ever echoes back supplied grounding text, never invents new
  facts).
- FR-15: every generated draft passes through ``ContentFilter`` before
  being considered agent-visible. A flagged draft is marked
  ``content_filter_flagged`` rather than silently passed through (SDD 2.8:
  "flagged rather than silently passed through").
- FR-16: this module itself doesn't decide *when* it runs (that's the AI
  worker's job, triggered eagerly at ingestion per SDD 3.1 step 4) -- it
  only generates and filters once invoked.
"""
from __future__ import annotations

import re

from ticket_triage.llm_client import LLMClient, MODEL_VERSION_DRAFTER
from ticket_triage.models import Draft, RetrievedItem, Ticket, new_id, utcnow

PROMPT_VERSION = "draft-v1"

#: Crude offline content-filter wordlist. A real deployment would use a
#: dedicated moderation API/model; this is a deterministic, zero-dependency
#: stand-in sufficient to exercise the FR-15 code path in tests without a
#: network call (same local-equivalent-infrastructure rationale as the
#: rest of this AI worker).
_OFFENSIVE_PATTERNS = [
    re.compile(r"\bidiot\b", re.IGNORECASE),
    re.compile(r"\bhate\b", re.IGNORECASE),
    re.compile(r"\bstupid\b", re.IGNORECASE),
]

#: Patterns suggesting a fabricated commitment that should never appear in
#: a grounded draft unless it was present in the grounding material itself
#: -- a backstop scan, not the primary grounding control (FR-14 is primary;
#: this is the FR-15 "clearly fabricated commitments" backstop).
_FABRICATION_PATTERNS = [
    re.compile(r"\bguaranteed?\s+refund\b", re.IGNORECASE),
    re.compile(r"\b100%\s+guarantee\b", re.IGNORECASE),
]

_EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")


class ContentFilter:
    """Output Content Filter (2.8): scans a generated draft before persistence."""

    def check(self, draft_text: str, *, grounding_text: str) -> tuple[bool, str | None]:
        """Return (flagged, reason). reason is None when not flagged.

        Covers, at minimum, the three categories FR-15 names: hate/
        offensive content, leaked PII from unrelated tickets, and clearly
        fabricated commitments not traceable to the supplied grounding.
        """
        for pattern in _OFFENSIVE_PATTERNS:
            if pattern.search(draft_text):
                return True, f"offensive language detected: {pattern.pattern}"

        for pattern in _FABRICATION_PATTERNS:
            if pattern.search(draft_text) and not pattern.search(grounding_text):
                return True, f"unsupported commitment detected: {pattern.pattern}"

        draft_emails = set(_EMAIL_RE.findall(draft_text))
        grounding_emails = set(_EMAIL_RE.findall(grounding_text))
        leaked = draft_emails - grounding_emails
        if leaked:
            return True, f"possible leaked PII not present in grounding material: {sorted(leaked)}"

        return False, None


def _format_grounding(similar_tickets: list[RetrievedItem], kb_articles: list[RetrievedItem]) -> str:
    """Render retrieved items into the grounding text handed to the LLM client.

    Items are clearly labeled by source so a real LLM prompt could
    instruct "only use facts from the sections below" -- the same
    delimiting discipline as the classifier's prompt (FR-8's sibling
    concern for the drafting call, even though drafting's untrusted-input
    surface is different).
    """
    parts: list[str] = []
    for item in similar_tickets:
        parts.append(f"[similar ticket {item.source_id}]\n{item.snippet}")
    for item in kb_articles:
        parts.append(f"[KB article {item.source_id}]\n{item.snippet}")
    return "\n\n".join(parts)


class DraftGenerator:
    """Draft Generator: calls an LLMClient grounded in retrieval results, then filters."""

    def __init__(self, llm_client: LLMClient, content_filter: ContentFilter | None = None) -> None:
        self._llm = llm_client
        self._filter = content_filter or ContentFilter()

    def generate(
        self,
        ticket: Ticket,
        *,
        similar_tickets: list[RetrievedItem],
        kb_articles: list[RetrievedItem],
    ) -> Draft:
        """Generate a draft for ticket, grounded in the given retrieval results.

        Always returns a Draft -- a content-filter trigger does not raise,
        it sets ``content_filter_flagged``/``content_filter_reason`` so the
        caller (AI worker) can log the safety event (NFR-16) and hold the
        draft rather than surface it as-is (SDD 2.7/2.8).
        """
        grounding = _format_grounding(similar_tickets, kb_articles)
        result = self._llm.generate_draft(ticket.body, grounding=grounding)

        flagged, reason = self._filter.check(result.text, grounding_text=grounding)

        return Draft(
            id=new_id(),
            ticket_id=ticket.id,
            text=result.text,
            model_version=MODEL_VERSION_DRAFTER,
            prompt_version=PROMPT_VERSION,
            grounding_ticket_ids=[item.source_id for item in similar_tickets],
            grounding_kb_ids=[item.source_id for item in kb_articles],
            content_filter_flagged=flagged,
            content_filter_reason=reason,
            created_at=utcnow(),
        )
