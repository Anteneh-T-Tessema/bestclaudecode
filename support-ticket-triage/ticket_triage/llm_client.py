"""Injectable LLM client boundary.

AI requirements Section 1 calls for an off-the-shelf instruction-following
LLM accessed via API, using structured output/function-calling (FR-6) for
classification, and a grounded generation call for drafting. This repo is a
local study project with no API keys configured, so this module defines a
small ``LLMClient`` protocol plus:

- ``FakeLLMClient`` -- a deterministic, fully offline stand-in used by the
  whole test suite (classification, retrieval/draft integration tests) and
  by default when no real provider is configured. It uses simple keyword
  heuristics, not a network call, so the suite never needs API keys and
  never makes a real network request (the spec's "real third-party LLM API
  calls in tests" -> local-equivalent substitution called out in the task).
- ``ScriptedLLMClient`` -- a test helper that returns pre-programmed
  responses in sequence, used to engineer schema-validation failures and
  low-confidence cases (SRS acceptance criteria for FR-7).

Any real provider integration (e.g. an Anthropic/OpenAI client wired to a
structured-output API) would implement the same ``LLMClient`` protocol and
be passed into ``Classifier``/``DraftGenerator`` in its place -- nothing in
those components imports a concrete provider SDK directly.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol

from ticket_triage.models import Category, Urgency

MODEL_VERSION_CLASSIFIER = "fake-classifier-v1"
MODEL_VERSION_DRAFTER = "fake-drafter-v1"


@dataclass
class ClassificationResult:
    """Raw model output for a classification call, pre-validation.

    ``category``/``urgency`` are left as raw strings here (not the enum)
    specifically so the classifier's schema-validation step (FR-6, FR-7)
    has something to validate -- a real LLM's structured output could
    return a string outside the enumerated taxonomy, and the validation
    step must be able to detect that.
    """

    category: str
    urgency: str
    confidence: float


@dataclass
class DraftResult:
    """Raw model output for a draft-generation call."""

    text: str


class LLMClient(Protocol):
    """Protocol every LLM client (real or fake) must implement."""

    def classify(self, ticket_text: str, *, categories: list[str], urgencies: list[str]) -> ClassificationResult:
        ...

    def generate_draft(self, ticket_text: str, *, grounding: str) -> DraftResult:
        ...


# Keyword heuristics used only by FakeLLMClient -- a stand-in for what a
# real LLM would infer from free text. Order matters: first match wins.
_CATEGORY_KEYWORDS: list[tuple[str, Category]] = [
    ("refund", Category.BILLING),
    ("charge", Category.BILLING),
    ("invoice", Category.BILLING),
    ("billing", Category.BILLING),
    ("password", Category.ACCOUNT_ACCESS),
    ("login", Category.ACCOUNT_ACCESS),
    ("locked out", Category.ACCOUNT_ACCESS),
    ("can't log in", Category.ACCOUNT_ACCESS),
    ("crash", Category.BUG_REPORT),
    ("error", Category.BUG_REPORT),
    ("bug", Category.BUG_REPORT),
    ("broken", Category.BUG_REPORT),
    ("feature", Category.FEATURE_REQUEST),
    ("would be nice", Category.FEATURE_REQUEST),
    ("how do i", Category.HOW_TO),
    ("how to", Category.HOW_TO),
]

_URGENT_KEYWORDS = ["urgent", "asap", "immediately", "down", "outage", "can't access", "losing money", "critical"]
_LOW_KEYWORDS = ["whenever", "no rush", "just curious", "someday"]


class FakeLLMClient:
    """Deterministic, offline LLM stand-in used in tests and as the default.

    Classification uses simple keyword matching over the ticket text.
    Drafting concatenates a templated reply referencing the supplied
    grounding text, never inventing facts outside of it -- this mirrors
    the hallucination-control requirement (FR-14) trivially, since it is
    a template, but is a deliberately simple stand-in for a real LLM call
    that the test suite drives the same way it would a real client.
    """

    def classify(self, ticket_text: str, *, categories: list[str], urgencies: list[str]) -> ClassificationResult:
        text = ticket_text.lower()

        category = Category.OTHER
        for keyword, cat in _CATEGORY_KEYWORDS:
            if keyword in text:
                category = cat
                break

        if any(k in text for k in _URGENT_KEYWORDS):
            urgency = Urgency.URGENT
        elif any(k in text for k in _LOW_KEYWORDS):
            urgency = Urgency.LOW
        else:
            urgency = Urgency.NORMAL

        return ClassificationResult(category=category.value, urgency=urgency.value, confidence=0.9)

    def generate_draft(self, ticket_text: str, *, grounding: str) -> DraftResult:
        if grounding.strip():
            text = (
                "Thanks for reaching out. Based on similar cases and our "
                "knowledge base, here is what we found:\n\n"
                f"{grounding}\n\n"
                "Let us know if this resolves your issue or if you need "
                "further help."
            )
        else:
            text = (
                "Thanks for reaching out. We don't have closely matching "
                "prior tickets or knowledge-base articles for this yet, "
                "so an agent will follow up with you directly."
            )
        return DraftResult(text=text)


@dataclass
class ScriptedLLMClient:
    """Test helper: returns pre-programmed responses in call order.

    Used to engineer schema-validation failures, low-confidence results,
    and adversarial/prompt-injection scenarios deterministically (SRS
    acceptance criteria for FR-7, FR-8).
    """

    classify_responses: list[ClassificationResult] = field(default_factory=list)
    draft_responses: list[DraftResult] = field(default_factory=list)
    _classify_calls: list[str] = field(default_factory=list)
    _draft_calls: list[str] = field(default_factory=list)

    def classify(self, ticket_text: str, *, categories: list[str], urgencies: list[str]) -> ClassificationResult:
        self._classify_calls.append(ticket_text)
        idx = len(self._classify_calls) - 1
        if idx >= len(self.classify_responses):
            raise AssertionError("ScriptedLLMClient.classify called more times than scripted")
        return self.classify_responses[idx]

    def generate_draft(self, ticket_text: str, *, grounding: str) -> DraftResult:
        self._draft_calls.append(ticket_text)
        idx = len(self._draft_calls) - 1
        if idx >= len(self.draft_responses):
            raise AssertionError("ScriptedLLMClient.generate_draft called more times than scripted")
        return self.draft_responses[idx]
