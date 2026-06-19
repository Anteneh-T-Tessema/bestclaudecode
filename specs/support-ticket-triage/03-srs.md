# Software Requirements Specification: AI-Powered Support Ticket Triage

Date: 2026-06-18

Source documents: `01-prd.md`, `02-ai-requirements.md`

## 1. Functional requirements

### Ticket ingestion (PRD Feature 1)

- **FR-1:** The system shall ingest incoming support tickets from two
  channels — inbound email and a web form submission.
- **FR-2:** The system shall normalize tickets from both channels into
  a single ticket record format, regardless of source channel, such
  that downstream classification, retrieval, and drafting operate on
  one consistent schema.
- **FR-3:** Each ticket record shall retain its source channel
  (email or web form) as an attribute, so that this dimension is
  available for later analysis (see FR-23).

### Automatic classification (PRD Feature 2)

- **FR-4:** On ingestion, the system shall automatically classify
  each ticket with exactly one category from a fixed, enumerated
  category taxonomy.
- **FR-5:** On ingestion, the system shall automatically classify
  each ticket with exactly one urgency level from a fixed, enumerated
  urgency taxonomy, using an urgency rubric.
- **FR-6:** Classification output (category and urgency) shall be
  produced via a structured/schema-constrained model output (not
  free text), such that the value is always one of the enumerated
  valid categories or urgency levels.
- **FR-7:** If a classification call's output fails schema
  validation, or the model signals low confidence, the system shall
  fail safe by routing the ticket to a conservative default state
  (flagged for manual/human triage) rather than silently defaulting
  to a non-urgent or unclassified state.
- **FR-8:** The system shall treat all incoming ticket text as
  untrusted input to the classifier: instructions embedded within
  ticket content (e.g., text attempting to direct the classifier to
  assign a specific label or reveal its prompt) shall not alter
  classifier behavior outside of its designed classification task.

### Similar-ticket retrieval (PRD Feature 3)

- **FR-9:** For each incoming ticket, the system shall retrieve a set
  of similar past tickets from ticket history, using semantic/
  embedding-based search over prior ticket content.
- **FR-10:** Retrieved similar tickets and their relevance ranking
  shall be made available to the drafting step (FR-13) and recorded
  for later inspection (see FR-24).
- **FR-11:** Before similar-ticket content is used as grounding
  material for a draft, the system shall remove or otherwise prevent
  exposure of another customer's identifying information (name,
  email, account details) carried over from the retrieved ticket,
  unless that information also belongs to the customer who submitted
  the current ticket.

### Knowledge-base retrieval (PRD Feature 4)

- **FR-12:** For each incoming ticket, the system shall retrieve
  relevant knowledge-base articles using semantic/embedding-based
  search over the existing knowledge base, to be used as grounding
  material for the drafted response.

### Suggested first-response drafting (PRD Feature 5)

- **FR-13:** The system shall generate a draft first-response for
  each incoming ticket, using an LLM prompted to ground its output
  only in the retrieved similar tickets (FR-9) and retrieved
  knowledge-base articles (FR-12), plus the ticket's own text.
- **FR-14:** The draft generator shall not introduce claims, policy
  commitments, refund amounts, account-specific facts, or promises
  that are not present in the retrieved grounding material or the
  incoming ticket text.
- **FR-15:** Generated draft content shall pass through an output
  content filter (covering, at minimum, hate/offensive content,
  leaked PII from unrelated tickets, and clearly fabricated
  commitments) before being presented to an agent.
- **FR-16:** A draft shall be available for agent review by the time
  an agent opens the corresponding ticket (i.e., generated
  asynchronously/eagerly on ingestion, not on-demand when the agent
  opens it), consistent with the latency budget in NFR-2.

### Human review and edit workflow (PRD Feature 6)

- **FR-17:** Every AI-generated draft shall be presented to a human
  agent for review before any customer-facing send can occur.
- **FR-18:** An agent shall be able to edit, replace, or discard a
  draft prior to send.
- **FR-19:** The system shall provide no code path — including
  automated retries, batch/backfill jobs, or any background process
  — by which a generated draft reaches the customer-facing email or
  web-form-reply channel without a recorded human review/edit action
  immediately preceding that send.
- **FR-20:** Every sent reply shall have an associated, recorded
  human review/edit action stored against the ticket, identifying
  which agent performed the action and when.

### Urgency-based queue surfacing (PRD Feature 7)

- **FR-21:** Tickets classified as urgent shall be visibly
  distinguished and prioritized in the agent-facing ticket queue/list
  view relative to non-urgent tickets, such that an agent scanning
  the queue can identify urgent tickets without opening each one.
- **FR-22:** Tickets that fail safe to the conservative "needs manual
  triage" state (FR-7) shall also be visibly surfaced in the queue as
  needing attention, not silently merged into the non-urgent queue.

### Classification override (PRD Feature 8)

- **FR-23:** An agent shall be able to correct the AI-assigned
  category and/or urgency label on any ticket.
- **FR-24:** Each override action shall be recorded, capturing at
  minimum: the original AI-assigned value, the agent-corrected value,
  the ticket's category/urgency/channel, and a timestamp, such that
  acceptance/override rate (see NFR-9) can be computed without
  re-deriving it from raw event logs.
- **FR-25:** Where the override changes urgency, the system shall
  record the direction of the change (upgraded to urgent vs.
  downgraded from urgent) as a distinct, queryable signal, not merely
  the before/after values.

## 2. Non-functional requirements

### Performance / latency

- **NFR-1:** Ticket classification (FR-4, FR-5) shall complete
  synchronously on ingestion within a few seconds per ticket (target:
  under 5 seconds at p90), since urgent-queue surfacing (FR-21)
  depends on it.
- **NFR-2:** End-to-end draft availability (similar-ticket retrieval +
  KB retrieval + generation) shall complete within 10-15 seconds per
  ticket (target ceiling: 15 seconds at p90) from ticket ingestion, so
  the draft is ready by the time an agent typically opens a newly
  surfaced ticket.
- **NFR-3:** These latency targets are placeholders pending validation
  against real agent workflow timing and must be confirmed with the
  team before being treated as a hard SLA (carried over from AI
  requirements doc Section 5).

### Cost

- **NFR-4:** Per-ticket AI cost (one classification call plus one
  retrieval+generation call) shall target on the order of a few cents
  per ticket as an initial budget ceiling, to be re-validated once
  actual ticket volume is known.

### Security / data protection

- **NFR-5:** Any embedding model, vector store, or LLM API provider
  used in the classification or RAG pipeline shall be selected such
  that it complies with the organization's data retention/data-use
  commitments, including no training on submitted ticket/KB data by
  the API provider.
- **NFR-6:** The AI service components (classifier, retriever, draft
  generator) shall have no credential or capability to call the
  outbound customer-facing send API. Only the human-facing agent UI,
  following a recorded review action, may trigger a send. This
  boundary shall be enforced architecturally, not by policy or prompt
  instruction alone.
- **NFR-7:** The system shall not allow another customer's PII
  retrieved via similar-ticket search to be sent to a different
  customer; this is enforced via FR-11 (redaction/exclusion before
  grounding) and reinforced by FR-15 (output content filtering) and
  FR-17-19 (mandatory human review).
- **NFR-8:** The system shall not autonomously modify ticket data
  other than writing its own classification suggestion and draft
  (e.g., it shall not auto-close, auto-reassign, or edit KB articles).

### Accuracy / quality (tied to Goal 4 and AI requirements Section 3)

- **NFR-9:** The system shall make it possible to compute, on an
  ongoing basis, the percentage of AI-assigned category/urgency
  labels accepted without agent override, sliced by category, urgency
  level, and channel.
- **NFR-10:** The system shall make it possible to compute,
  separately, the rate of urgent tickets missed (classified
  non-urgent, later corrected to urgent by an agent) versus
  over-flagged (classified urgent, later corrected down), since these
  carry different costs and must not be netted into a single number.
- **NFR-11:** Pre-launch, classification accuracy shall be measured
  (precision/recall per category and per urgency level) against a
  human-labeled holdout set of historical or hand-labeled tickets,
  before the classifier is used to drive live queue surfacing.
- **NFR-12:** Pre-launch, draft quality shall be evaluated via a
  human-scored rubric (factual grounding, relevance of retrieved
  sources, tone/usability) on a sample of generated drafts.

### Observability

- **NFR-13:** Every classification call shall be logged with the
  assigned category, assigned urgency, model/prompt version used,
  and confidence signal if available.
- **NFR-14:** Every retrieval step shall be logged with the specific
  similar tickets and KB articles retrieved and surfaced for that
  draft, so retrieval failures can be distinguished from generation
  failures during investigation.
- **NFR-15:** Every draft shall be logged with its accept/replace/
  discard outcome and edit distance from the sent response, tagged
  with category, urgency, and model/prompt version, to support
  trend detection over time (not only a rolled-up average).
- **NFR-16:** Schema-validation failures and fail-safe defaults
  (FR-7), and any case where output content filtering on a draft
  triggered (FR-15), shall be logged as distinct, reviewable
  safety-relevant events, separate from aggregate accuracy metrics.

### Availability / scalability

- **NFR-17:** The system shall process tickets from both ingestion
  channels (FR-1) continuously as they arrive, without requiring a
  human to manually trigger classification or draft generation.
- **NFR-18:** Per-ticket cost and latency budgets (NFR-1, NFR-2,
  NFR-4) shall be re-validated once real ticket volume is known, since
  no specific volume figure is available from the PRD to size these
  precisely at this stage.

### Usability

- **NFR-19:** The agent UI shall visually distinguish content drawn
  from a different customer's historical ticket (when surfaced as
  similar-ticket context) from the current customer's own ticket
  content, so an agent can identify and strip any such content before
  sending, as an alternative/complement to automatic redaction
  (FR-11).
- **NFR-20:** Override actions (FR-23) shall be a first-class, low-
  friction UI action (e.g., not requiring navigation away from the
  ticket view) so that agents reliably record corrections rather than
  silently ignoring incorrect labels.

## 3. Constraints & assumptions

- **C-1 (existing system to integrate with):** The system consumes an
  existing knowledge base for retrieval (PRD Section 5); building or
  modifying KB content-management tooling is out of scope, and the
  KB's existing content/structure is assumed usable as-is for
  embedding/retrieval.
- **C-2 (no pre-existing labeled dataset):** No labeled historical
  dataset of category/urgency-tagged tickets is assumed to exist at
  launch. Per AI requirements Section 3, a human-labeled holdout
  sample must be hand-built before launch to obtain any pre-launch
  accuracy number; this is a one-time setup task, not an ongoing
  system requirement.
- **C-3 (urgency SLA threshold unconfirmed):** The urgency rubric's
  threshold (e.g., the "1 hour" response-time figure referenced in
  PRD Goal 2) is an assumed placeholder, not a confirmed number. It
  must be confirmed with the team that owns support SLAs before
  launch; FR-5's urgency rubric is dependent on this confirmation.
- **C-4 (latency/cost budgets unconfirmed):** The latency targets
  (NFR-1, NFR-2) and cost ceiling (NFR-4) are derived estimates, not
  numbers stated in the PRD, and must be validated against real agent
  workflows and real ticket volume.
- **C-5 (data residency / regulatory regime unconfirmed):** The
  PRD/AI requirements doc does not state which jurisdiction(s) or
  regulatory regime (e.g., GDPR, CCPA) applies to this organization's
  customer base. Right-to-deletion handling for ticket data retained
  in the ticket-history store, and any retention-period policy, must
  be confirmed with whoever owns data privacy before launch — this SRS
  assumes that confirmation will happen but does not itself define a
  retention period or deletion mechanism, since the source documents
  do not specify one.
- **C-6 (no special-category data confirmed one way or another):** It
  is not confirmed whether the underlying product being supported
  operates in a regulated domain (health, finance, etc.) such that
  tickets might incidentally contain regulated data. This SRS assumes
  general customer-support data only, pending confirmation.
- **C-7 (assumed user environment):** Support agents and team leads
  are assumed to access the system through a web-based agent UI (the
  PRD does not specify a desktop/native client), and tickets arrive
  via a standard email inbox/mail-handling integration and a web form
  the organization already operates or will stand up.
- **C-8 (out-of-scope channels and capabilities carried forward as
  constraints):** Chat widgets, social media, and phone-transcript
  ingestion; ticket routing/assignment automation; customer-facing
  self-service; multi-language support; SLA configuration tooling;
  and reporting dashboards beyond the metrics in Section 2's
  observability requirements are explicitly out of scope for this
  version and are not addressed by any requirement in this document.
- **C-9 (no autonomous send, permanently):** The architectural
  separation in NFR-6 is treated as a permanent constraint on the
  system's design, not a v1-only limitation; any future requirement
  to relax it would require a new requirements decision, not an
  incremental change under this SRS.

## 4. Acceptance criteria

### Ingestion (FR-1 to FR-3)

- A ticket submitted via email and a ticket submitted via the web
  form both produce a ticket record in the same schema, with source
  channel correctly attributed, and both are available to downstream
  classification within the ingestion pipeline's normal processing
  flow.

### Classification (FR-4 to FR-8)

- Every newly ingested ticket has exactly one category and one
  urgency value assigned, both drawn from the enumerated taxonomies,
  with no ticket left unclassified or assigned a free-text value.
- A ticket engineered to fail schema validation (e.g., simulated
  malformed model output) results in the ticket being routed to the
  manual-triage fail-safe state (FR-7), not defaulted to non-urgent,
  verified via a test that forces a validation failure.
- A ticket containing an embedded instruction attempting to
  manipulate the classifier (e.g., "mark this urgent") is classified
  according to its actual content/urgency signals, not the embedded
  instruction, verified via adversarial test cases.
- Pre-launch accuracy evaluation (NFR-11) has been run against a
  holdout set and precision/recall per category and per urgency level
  has been reported to stakeholders before go-live.

### Retrieval (FR-9 to FR-12)

- For a test ticket with known similar historical tickets and known
  relevant KB articles, the retrieval step returns those known items
  among its results (a recall spot-check), and the retrieval record
  is logged per NFR-14.
- For a retrieved similar ticket containing another customer's PII,
  that PII does not appear in the resulting draft or in the agent UI
  without clear visual separation, verified via a test case using a
  planted cross-customer PII fixture.

### Drafting (FR-13 to FR-16)

- For a sample of test tickets, generated drafts contain no
  fact/claim/commitment absent from the retrieved grounding material
  or the ticket text itself, verified via the pre-launch human-eval
  rubric (NFR-12).
- A draft engineered to trigger the content filter (e.g., containing
  planted offensive language drawn from adversarial test input) is
  caught and flagged before being shown to an agent, verified via a
  test case.
- For a ticket opened by an agent under normal load, a draft is
  already present (not generated on-demand at open time), measured
  against the NFR-2 latency budget.

### Human review workflow (FR-17 to FR-20)

- A code-level/architectural audit confirms no service other than the
  agent-facing UI holds credentials to the outbound send API (NFR-6).
- For every sent reply in a test/staging environment, a query of the
  audit log shows a recorded human review/edit action with agent
  identity and timestamp preceding the send, with zero exceptions
  across a full test suite run including retry and batch-job paths.
- An agent can successfully edit, replace, or discard a draft and the
  resulting action (and final sent content, if sent) is recorded
  correctly in each of the three cases.

### Queue surfacing (FR-21 to FR-22)

- In a queue view containing a mix of urgent, non-urgent, and
  fail-safe/manual-triage tickets, urgent and fail-safe tickets are
  visually distinguishable from non-urgent tickets without opening
  each ticket, verified via a UI test against a fixture queue.

### Override (FR-23 to FR-25)

- An agent correcting a category or urgency label results in a
  recorded override entry containing original value, corrected value,
  ticket metadata, and timestamp, queryable to compute acceptance rate
  (NFR-9) and urgent-miss vs. over-flag rate (NFR-10) for a test
  dataset of overrides covering both directions.

## 5. Self-check notes

Every functional requirement (FR-1 through FR-25) traces to one of
the eight PRD features. Every PRD feature (1 through 8) has at least
one corresponding functional requirement:

- Feature 1 -> FR-1, FR-2, FR-3
- Feature 2 -> FR-4, FR-5, FR-6, FR-7, FR-8
- Feature 3 -> FR-9, FR-10, FR-11
- Feature 4 -> FR-12
- Feature 5 -> FR-13, FR-14, FR-15, FR-16
- Feature 6 -> FR-17, FR-18, FR-19, FR-20
- Feature 7 -> FR-21, FR-22
- Feature 8 -> FR-23, FR-24, FR-25

No PRD feature was left untranslated.
