# support-ticket-triage

An AI-powered support ticket triage system: incoming tickets (from email
and a web form) are automatically classified by category and urgency,
similar past tickets and knowledge-base articles are retrieved (RAG), and
a suggested first-response draft is generated. A human agent always
reviews, edits, or discards the draft before anything is sent -- there is
no code path in this system that sends a customer-facing reply without an
explicit recorded human review action.

Built from the spec at `specs/support-ticket-triage/` in the parent
repository (`00-idea.md`, `01-prd.md`, `02-ai-requirements.md`,
`03-srs.md`, `04-sdd.md`). Read those for the full product/requirements/
design rationale; this README covers what was actually built, how to run
it, and the scoping decisions made to implement the SDD's architecture as
a runnable, fully offline local system.

## What this is (and isn't)

This is a **local, offline study implementation** of the SDD's
architecture, not a production deployment. Every place the SDD calls for
real external infrastructure (a real inbound mail server, a cloud vector
database, a real third-party LLM API) is replaced with a realistic local
equivalent that preserves the same component boundaries and data flow:

| SDD component (real infra assumed) | This implementation |
|---|---|
| Mail-handling integration / webhook (2.1) | Reads plain-text message files from a local folder (`ticket_triage/ingestion.py`) |
| Cloud vector DB / embedding API (Section 5) | Pure-stdlib TF-IDF index, two partitions (`ticket_triage/local_index.py`) |
| LLM API (classification + drafting) | Injectable `LLMClient` protocol; `FakeLLMClient` (keyword-heuristic, deterministic, offline) is the default (`ticket_triage/llm_client.py`) |
| Outbound transactional-email/reply provider (4.1) | Mock `SendGateway` that "delivers" to an in-memory outbox (`ticket_triage/send_gateway.py`) |
| Separate AI Worker process/service, separate credentials (Section 6) | Same process, but the credential/capability boundary is preserved at the **code level**: `ai_worker.py` and everything it imports contains no reference to the send gateway at all -- see "The no-autonomous-send guarantee" below |
| Web-based Agent UI (C-7) | A CLI (`ticket_triage/cli.py`) exercising the same backend operations (ingest, queue, override, review/send) a real UI would call |

No real API keys, network access, or cloud services are required to run
this project or its test suite.

## Architecture

```
ingestion.py  ──┐
(email/web)     │
                 ▼
        ticket_service.py  ──── storage.py (SQLite: tickets, classifications,
        (Ticket Service           drafts, overrides, review actions, sends,
         facade)                  audit log)
                 │
                 ▼
          ai_worker.py  (no send capability -- see below)
            ├─ classifier.py        (FR-4..8: category/urgency, fail-safe)
            ├─ retrieval.py         (FR-9..12: similar tickets + KB, PII redaction)
            │    └─ local_index.py  (TF-IDF, "tickets" + "kb" partitions)
            │    └─ knowledge_base.py (read-only KB store)
            └─ drafting.py          (FR-13..16: grounded draft + content filter)
                 └─ llm_client.py   (injectable LLMClient; FakeLLMClient default)

          review.py  (FR-17..20: the ONLY caller of send_gateway.py)
          overrides.py (FR-23..25), queue.py (FR-21..22), audit.py (NFR-9/10)
          evaluation.py (SDD 2.15: pre-launch precision/recall harness)
```

## The no-autonomous-send guarantee

This is the hard requirement carried through the whole spec: **no code
path sends a customer-facing reply without a preceding, recorded human
review action.** It's enforced at three layers, not just by convention:

1. **Code boundary.** `ai_worker.py` (and everything it imports --
   `classifier.py`, `retrieval.py`, `drafting.py`, `local_index.py`,
   `knowledge_base.py`, `llm_client.py`) contains no import of, or
   reference to, `send_gateway.py`. `ReviewWorkflow` (`review.py`) is the
   only class in the package constructed with a `SendGateway`.
   `tests/test_architecture_boundary.py` enforces this with source-scan
   and `ast`-level import-graph checks -- if a future change added a
   send-capable method to `AIWorker` or an import of `send_gateway` into
   any AI-pipeline module, that test suite would fail.
2. **Data boundary.** `storage.py`'s `sends` table has a `NOT NULL`
   foreign key to `review_actions`; `Storage.record_send()` raises a
   `sqlite3.IntegrityError` if no matching review action row exists. This
   means even a bug that bypassed the Python-level guard in `review.py`
   would still be rejected by the database itself.
3. **Behavioral guarantee.** `ReviewWorkflow.submit_review_action()` is
   the single method that can lead to a send: it always persists the
   `ReviewAction` first, and only calls the gateway afterward, only for
   `accept`/`edit` (never `discard`). There is no separate "send" method,
   retry path, or batch job anywhere in the codebase.

## Requirements

- Python 3.9+
- No third-party runtime dependencies (standard library only)

## Installation

From this directory:

```sh
pip install .
```

This installs a `ticket-triage` console command. Alternatively, run it
without installing, from the parent repository root:

```sh
PYTHONPATH=support-ticket-triage python3 -m ticket_triage.cli --help
```

## Usage (CLI)

```sh
# Initialize a local SQLite datastore.
ticket-triage --db tickets.db init

# Ingest a ticket from a web-form submission.
ticket-triage --db tickets.db ingest-web \
  --subject "Can't log in" --body "My password reset link never arrives." \
  --email alice@example.com

# Ingest a ticket from a local email message file (.eml/.txt: From:/Subject:
# headers, blank line, body -- the local equivalent of an inbound mail webhook).
ticket-triage --db tickets.db ingest-email path/to/message.eml

# List the agent queue -- urgent and "needs manual triage" tickets surface first.
ticket-triage --db tickets.db --kb kb_articles.json queue

# Show a ticket's classification, status, and AI-drafted reply.
ticket-triage --db tickets.db show <ticket-id>

# Agent corrects an AI-assigned label (FR-23..25).
ticket-triage --db tickets.db override <ticket-id> --urgency urgent

# Agent reviews a draft: accept (send as-is), edit (send modified text),
# or discard (never sent). Only accept/edit reach the (mock) send gateway,
# and only after the review action is recorded.
ticket-triage --db tickets.db review <ticket-id> --action accept
ticket-triage --db tickets.db review <ticket-id> --action edit --text "..."
ticket-triage --db tickets.db review <ticket-id> --action discard
```

`--kb path/to/articles.json` (a list of `{"id", "title", "body"}` objects)
seeds the read-only knowledge base used for RAG retrieval; omit it to run
with an empty KB (similar-ticket retrieval still works against
previously-ingested tickets in the same database).

## Running the tests

From this directory, using the parent repository's shared virtualenv
(per the root `CLAUDE.md`, dev tools live in `.venv`, not on `PATH`):

```sh
cd support-ticket-triage
../.venv/bin/pytest tests/ -q
../.venv/bin/ruff check .
```

All 121 tests run fully offline (no network access, no API keys) and
complete in well under a second, since `FakeLLMClient` and the TF-IDF
index are pure in-process computation.

Test coverage by concern:

- `tests/test_classifier.py` -- FR-4..8: valid classification, fail-safe
  routing on schema-validation failure or low confidence (never defaults
  to non-urgent), and adversarial prompt-injection cases.
- `tests/test_retrieval.py` -- FR-9..12: similar-ticket and KB retrieval,
  and the FR-11/NFR-7 cross-customer PII redaction acceptance criterion
  (a planted cross-customer PII fixture must not leak into the draft).
- `tests/test_drafting.py` -- FR-13..16: grounded drafting and the output
  content filter (offensive language, unsupported commitments, leaked PII
  not present in the supplied grounding material).
- `tests/test_review.py` -- FR-17..20: accept/edit/discard behavior, edit
  distance, and the audit-trail acceptance criterion that every send has a
  preceding recorded review action with zero exceptions.
- `tests/test_architecture_boundary.py` -- the code-level audit the SRS
  acceptance criteria call for: no AI-pipeline module can reach the send
  gateway.
- `tests/test_overrides.py`, `test_queue.py`, `test_audit.py` -- FR-21..25,
  NFR-9/10.
- `tests/test_evaluation.py` -- the pre-launch harness (NFR-11/12) run
  against the real `Classifier` class, per SDD 2.15.
- `tests/test_storage.py` -- the FK-enforced send/review-action invariant
  at the database level.
- `tests/test_ai_worker.py`, `test_ticket_service_integration.py`,
  `test_cli_integration.py` -- end-to-end flows through the facade and CLI.

## Scoping decisions and assumptions

- **Category taxonomy.** The PRD/AI-requirements docs say the exact
  taxonomy is an implementation choice the org will refine over time
  (AI requirements Section 1). `models.Category` picks a reasonable
  generic set (`billing`, `account_access`, `bug_report`,
  `feature_request`, `how_to`, `other`) as a placeholder, the same way the
  PRD flags the urgency SLA threshold as an assumed placeholder pending
  confirmation.
- **Synchronous drafting, not a job queue.** The SDD models retrieval +
  drafting as an asynchronous job triggered after classification (3.1 step
  4), specifically so a slow draft never blocks ingestion/queue-surfacing.
  This implementation runs it synchronously inside
  `TicketService.ingest_ticket()` for simplicity, since there's no real
  job-queue infrastructure to demonstrate in a local single-process study
  repo and `FakeLLMClient`'s calls are effectively instant. The component
  boundary the SDD actually cares about for NFR-6 (`AIWorker` has no send
  capability) is preserved regardless of whether it's invoked sync or
  async -- that boundary is the one enforced by tests.
- **`FakeLLMClient` is a keyword-heuristic stand-in, not a real model.**
  It exists so the entire test suite and CLI demo run fully offline. A
  real deployment would implement the same `LLMClient` protocol
  (`classify()` / `generate_draft()`) against an actual provider's
  structured-output API; nothing else in the codebase would need to
  change, since `Classifier` and `DraftGenerator` only depend on the
  protocol.
- **Output content filter is a deterministic wordlist/pattern scan**, not
  a real moderation model. It exists to exercise the FR-15 code path
  (flag-and-hold, never silently pass through) deterministically in
  tests; a real deployment would call a moderation API/model behind the
  same `ContentFilter.check()` interface.
- **No web frontend.** The SDD's Agent UI is a web application (C-7); this
  study repo builds the backend operations a web UI would call
  (`ticket_service.py`, `queue.py`, `overrides.py`, `review.py`) and a CLI
  that exercises them, rather than a browser-based UI, since the spec's
  AI/data-flow/no-autonomous-send requirements -- the part worth
  faithfully implementing and testing -- live entirely in the backend.
  `queue.py`'s `QueueBucket` enum is what a real UI would key its
  urgent/manual-triage badge styling off of (FR-21/22, NFR-19); this repo
  verifies the bucketing/ordering logic, not pixel-level rendering.
- **Cross-customer PII redaction is regex-based** (email-address pattern
  matching plus an exact-match check against the retrieved ticket's own
  customer email), not a full PII-detection model. It satisfies FR-11's
  functional requirement (don't carry another customer's identifying
  field into the drafting prompt) for the email-address case the SRS's
  acceptance-criteria fixture describes; a production system handling
  names/account numbers/phone numbers would need a more thorough PII
  detector behind the same `redact_other_customer_pii()` call site.
- **No retention/deletion mechanism.** Per the SRS's own C-5
  ("data residency / regulatory regime unconfirmed... this SRS assumes
  that confirmation will happen but does not itself define a retention
  period or deletion mechanism"), this implementation does not invent one
  either -- consistent with the SDD's Section 5 note that this is a
  forward-compatibility flag, not a v1 requirement to build.
- **Pre-launch draft-quality rubric (NFR-12) is intentionally not
  automated.** The AI requirements doc is explicit that this is a
  human-scored rubric ("a human-eval rubric scored by support team
  leads/agents"). `evaluation.DraftRubricScore` and
  `summarize_rubric_scores()` provide the data structure a human
  reviewer's scores would be recorded into and aggregated from, rather
  than fabricating an automated proxy for a judgment the spec says should
  come from people.

## What this does not build

- A web-based Agent UI (see "No web frontend" above).
- A real mail-server/IMAP integration, real cloud vector database, or
  real third-party LLM/embedding API client -- all replaced by local
  equivalents per the scoping guidance above. Swapping in a real
  `LLMClient` implementation or a real outbound-email provider behind
  `SendGateway`'s interface would not require changing any other module.
- Multi-language support, SLA configuration tooling, or reporting
  dashboards beyond the metrics in `audit.py` -- explicitly out of scope
  per the PRD (Section 5) and SRS (C-8).
- Ticket routing/assignment automation, KB authoring tools, or any
  customer-facing self-service surface -- all explicitly out of scope per
  the PRD.
