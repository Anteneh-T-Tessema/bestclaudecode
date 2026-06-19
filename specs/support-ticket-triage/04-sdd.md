# System Design Document: AI-Powered Support Ticket Triage

Date: 2026-06-18

Source documents: `01-prd.md`, `02-ai-requirements.md`, `03-srs.md`

## 1. Architecture overview

The system is a single web application (one deployable agent-facing
service) plus one internal AI/worker service, sitting between two
inbound ticket channels and one outbound send channel. There is no
case for microservices, multi-region, or a message-queue-based
event bus here: ticket volume is unvalidated and likely modest
(C-4/NFR-18), every workload is either a fast synchronous call
(classification) or a short asynchronous job (retrieval+drafting)
with a 15-second ceiling, and the dominant design pressure from the
SRS is a *security boundary*, not a *scale* boundary. The simplest
architecture that satisfies the NFRs is therefore: one ingestion
entry point, one relational datastore, one background job runner,
and a hard process/credential boundary between "things that call
the AI" and "things that can email a customer."

At the center is the **Ticket Service** — a backend application
exposing the ingestion endpoints (email webhook, web-form API), the
agent-facing API, and the only credentials capable of calling the
**Outbound Send Gateway** (the organization's transactional email/
reply-sending provider). The Ticket Service owns the **primary
datastore** (tickets, classifications, drafts, overrides, audit
log) and a **vector index** used for semantic retrieval over two
corpora: historical ticket content and knowledge-base articles.

Classification and drafting are performed by a separate **AI
Worker** process. The AI Worker is invoked by the Ticket Service
(directly, in-process call or local job queue — not a separately
hosted network service that the Ticket Service merely happens to
trust) but is architecturally walled off from the send path: the AI
Worker holds API keys for the embedding/LLM provider and read access
to ticket/KB content for retrieval, and nothing else. It has no
network egress rule, no credential, and no code path that reaches
the Outbound Send Gateway. This is the architectural enforcement of
NFR-6/C-9 described in detail in Section 4 and Section 7.

A human **Agent UI** (web application) is the only caller of the
send capability. An agent opens a ticket, sees the AI-assigned
category/urgency and the AI-drafted response (already generated
eagerly, per FR-16/NFR-2), edits or accepts or discards it, and the
Ticket Service records that review action and — only as a direct
consequence of that recorded action — calls the Outbound Send
Gateway. No batch job, retry queue, or scheduled task in this system
calls the Outbound Send Gateway; that capability is wired to exactly
one code path, reachable only from an authenticated agent-initiated
review action.

In summary, four parts: (1) ingestion adapters for email and web
form feeding a (2) Ticket Service backed by a relational datastore
and vector index, which invokes (3) an AI Worker (classifier + RAG
drafter, no send capability) and exposes data to (4) an Agent UI,
which is the sole caller of the Outbound Send Gateway via the Ticket
Service's send endpoint.

## 2. Component breakdown

### 2.1 Email Ingestion Adapter
Receives inbound support email (via the organization's existing mail
handling integration, C-7) and converts each message into a raw
ticket-creation request. Satisfies **FR-1, FR-3** (channel = email).

### 2.2 Web-Form Ingestion Adapter
Receives ticket submissions from the existing/standing-up web form
(C-7) and converts each submission into a raw ticket-creation
request. Satisfies **FR-1, FR-3** (channel = web form).

### 2.3 Ticket Normalization module (in Ticket Service)
Maps both adapters' raw payloads into one canonical ticket schema
(subject, body, customer identifier/contact, source channel,
timestamps) before anything downstream touches the data. Satisfies
**FR-2, FR-3**.

### 2.4 Classification Service (in AI Worker)
Invoked synchronously on ingestion. Sends ticket text plus the fixed
category taxonomy and urgency rubric to an LLM via structured-output/
function-calling, so the response is constrained to the enumerated
schema. Validates the returned object against the schema; on
validation failure or a model-reported low-confidence signal, routes
the ticket to the fail-safe "needs manual triage" state instead of a
default category/urgency. Treats ticket text strictly as data inside
a clearly delimited prompt section, never as instructions. Satisfies
**FR-4, FR-5, FR-6, FR-7, FR-8**; informs **FR-21, FR-22** (queue
surfacing reads this output); supports **NFR-1, NFR-13, NFR-16**.

### 2.5 Similar-Ticket Retriever (in AI Worker)
Embeds the incoming ticket and queries the vector index's ticket-
history partition for the top-k most similar prior tickets. Applies
a redaction/filtering step that strips or masks another customer's
name, email, and account-identifying fields from retrieved ticket
content before it is allowed into the drafting prompt, unless that
identifying information matches the current ticket's own customer.
Records what was retrieved (and at what rank) for later inspection.
Satisfies **FR-9, FR-10, FR-11**; supports **NFR-7, NFR-14**.

### 2.6 Knowledge-Base Retriever (in AI Worker)
Embeds the incoming ticket and queries the vector index's KB
partition for relevant articles. Records what was retrieved.
Satisfies **FR-12**; supports **NFR-14**.

### 2.7 Draft Generator (in AI Worker)
Takes the ticket text plus the (redacted) similar-ticket results and
KB results and prompts an LLM to produce a first-response draft
grounded only in that material, with explicit instruction not to add
facts, figures, or commitments absent from the supplied context.
Output passes through the **Output Content Filter** (2.8) before
being persisted as a draft. Runs as one asynchronous job per ticket
triggered immediately at ingestion (not on agent-open), so a draft is
available by the time an agent opens the ticket. Satisfies **FR-13,
FR-14, FR-16**; supports **NFR-2, NFR-4, NFR-12**.

### 2.8 Output Content Filter (in AI Worker, post-generation)
A dedicated check applied to every generated draft before it is
written to the datastore as agent-visible: scans for hate/offensive
content, residual PII patterns that should have been redacted by 2.5
but may have leaked through, and markers of fabricated
commitments/figures not traceable to the grounding context supplied
to the generator. A draft that trips the filter is flagged rather
than silently passed through. Satisfies **FR-15**; supports **NFR-7,
NFR-16**.

### 2.9 AI/Send Credential Boundary (architectural control, not a
runtime "component" in the traditional sense, but a first-class
design element)
This is the mechanism that satisfies **NFR-6 and C-9**. Concretely:
the AI Worker runs under a distinct service identity/credential set
from the Ticket Service's send path, holding only (a) LLM/embedding
API keys and (b) read-only datastore credentials scoped to ticket
content, KB content, and the vector index. It is issued no
credential for the Outbound Send Gateway, and the network/deployment
configuration gives it no route to reach that gateway (e.g., it is
not on an allow-list of callers, and/or it runs with an egress policy
that excludes the gateway's endpoint). The Outbound Send Gateway
itself only accepts calls from the Ticket Service's send endpoint,
which is gated entirely behind the Human Review workflow (2.10). See
Section 7 for the specific enforcement mechanisms. Satisfies **NFR-6,
FR-19** (architecturally, not just procedurally).

### 2.10 Human Review & Send workflow (in Ticket Service + Agent UI)
Presents each draft to the assigned agent; lets the agent edit,
replace, or discard it; records the review/edit action (agent
identity, timestamp, action type, and a diff/edit-distance between
draft and final content) against the ticket; and — only as the
direct result of that recorded action — invokes the Outbound Send
Gateway through the Ticket Service's single send endpoint. There is
no separate retry/backfill/batch job in the system with its own path
to the gateway; any retry of a failed send re-enters through this
same endpoint and still requires the original recorded review action
to already exist. Satisfies **FR-17, FR-18, FR-19, FR-20**; supports
**NFR-15**.

### 2.11 Queue/List View (in Agent UI)
Renders the ticket queue with urgent and fail-safe/manual-triage
tickets visually distinguished (e.g., badges/sorting/color) from
routine tickets, without requiring the agent to open each ticket.
Satisfies **FR-21, FR-22**; supports **NFR-20** (adjacent UI, not the
override control itself).

### 2.12 Classification Override control (in Agent UI + Ticket
Service)
A low-friction, in-place control on the ticket view letting an agent
change category and/or urgency without navigating away. Writes an
override record capturing original AI value, corrected value,
category/urgency/channel, timestamp, and — when urgency changes — an
explicit upgraded-to-urgent / downgraded-from-urgent flag, not just
before/after values. Satisfies **FR-23, FR-24, FR-25**; supports
**NFR-9, NFR-10, NFR-20**.

### 2.13 Cross-Customer Content Visual Separation (in Agent UI)
Where similar-ticket content is shown to the agent as supporting
context, the UI visually marks which parts originate from a
different customer's historical ticket, as a human-facing backstop
alongside the automatic redaction in 2.5. Satisfies **NFR-19**.

### 2.14 Observability/Audit Log (cross-cutting, written by 2.4, 2.5,
2.6, 2.7, 2.8, 2.10, 2.12)
A structured log/table capturing: every classification call (model/
prompt version, assigned values, confidence signal) — **NFR-13**;
every retrieval call (specific tickets/KB articles surfaced) —
**NFR-14**; every draft's accept/replace/discard outcome and edit
distance, tagged with category/urgency/model/prompt version —
**NFR-15**; every schema-validation failure, fail-safe routing event,
and content-filter trigger, as distinct safety-relevant events
separate from aggregate metrics — **NFR-16**; and every send action
with its preceding review action (the data source for the FR-19/FR-20
audit). This same data set is what supports computing **NFR-9**
(acceptance/override rate) and **NFR-10** (urgent-miss vs.
over-flag rate) without re-deriving them from raw events.

### 2.15 Pre-launch Evaluation harness (offline, not a production
runtime component)
A scripted process (run against a hand-labeled holdout set per C-2)
that computes precision/recall per category and per urgency level
(**NFR-11**) and supports the human-scored draft-quality rubric
(**NFR-12**). This runs against the same Classification Service and
Draft Generator code paths as production, pointed at the holdout
set instead of live tickets, so evaluation exercises real prompts/
schemas rather than a parallel implementation.

## 3. Data flow

### 3.1 Ticket ingestion through draft availability (primary flow)

1. A customer email arrives at the support mailbox, or a customer
   submits the web form. The respective Ingestion Adapter (2.1 or
   2.2) receives it and calls the Ticket Service's create-ticket
   operation with the raw payload.
2. The Ticket Normalization module (2.3) maps the payload into the
   canonical ticket schema and persists a new ticket row with status
   "ingested," source channel set, and no category/urgency yet.
3. The Ticket Service synchronously invokes the Classification
   Service (2.4) with the ticket text. The Classification Service
   calls the LLM with structured-output constraints; the result is
   validated against the category/urgency schema.
   - On success: the ticket row is updated with category, urgency,
     and a confidence signal; this update is what the Queue/List
     View (2.11) reads to surface urgency.
   - On schema-validation failure or low confidence: the ticket is
     instead marked "needs manual triage," logged as a safety event
     (2.14/NFR-16), and surfaced distinctly in the queue (FR-22)
     rather than defaulted to non-urgent.
   This step is synchronous and budgeted at p90 < 5 seconds (NFR-1)
   because the queue-surfacing decision depends on it.
4. Once classification completes (regardless of outcome), the Ticket
   Service enqueues an asynchronous drafting job for the ticket. This
   job is not on the request/response path the agent or customer
   waits on synchronously — it runs in the background, budgeted at
   p90 < 15 seconds end-to-end (NFR-2), so a draft exists before an
   agent typically opens the ticket.
5. The drafting job runs the Similar-Ticket Retriever (2.5) and
   Knowledge-Base Retriever (2.6) in parallel against the vector
   index, using an embedding of the ticket text. The Similar-Ticket
   Retriever applies redaction to strip other customers' identifying
   fields from retrieved ticket content. Both retrieval results
   (with ranking) are logged (2.14/NFR-14).
6. The Draft Generator (2.7) receives the ticket text plus both
   retrieval results and calls the LLM, prompted to ground its
   answer only in that material. The resulting draft passes through
   the Output Content Filter (2.8); if flagged, the draft is marked
   as filtered/held rather than shown to the agent as-is, and the
   filter trigger is logged as a distinct safety event.
7. The Ticket Service persists the draft against the ticket. The
   ticket is now in a queryable state: classified (or flagged for
   manual triage) and drafted, ready for an agent to open it from
   the Queue/List View.

### 3.2 Agent review through customer-facing send (second key flow)

1. An agent opens a ticket from the Queue/List View (2.11), which
   already visually distinguishes urgent and manual-triage tickets.
   The Agent UI displays the ticket text, the AI-assigned category/
   urgency, the draft (if available and not held by the content
   filter), and the supporting similar-ticket/KB context with
   cross-customer content visually separated (2.13).
2. The agent may use the Classification Override control (2.12) to
   correct category/urgency. This write goes directly to the Ticket
   Service, which persists an override record (original value,
   corrected value, category/urgency/channel, timestamp, and
   upgraded/downgraded direction if urgency changed) and updates the
   ticket's live category/urgency.
3. The agent edits, replaces, or discards the draft in the Agent UI,
   then chooses to send (if not discarding). This action calls the
   Ticket Service's single send-authorization endpoint, which: (a)
   records the human review/edit action (agent identity, timestamp,
   action type, diff/edit distance between draft and final content)
   against the ticket, and (b), only as a direct consequence of (a)
   having just succeeded, calls the Outbound Send Gateway with the
   final content and the customer's contact address.
4. The Outbound Send Gateway delivers the reply over the same
   channel type the ticket arrived on context permitting (email
   reply or web-form notification), and returns a delivery
   confirmation/identifier that the Ticket Service stores against the
   ticket and the review action record.
5. All of steps 2-4 are captured in the Observability/Audit Log
   (2.14), which is the data NFR-9/NFR-10 acceptance and urgent-miss/
   over-flag metrics are computed from, and which is what a
   code-level audit (per the SRS acceptance criteria) inspects to
   confirm zero sends occurred without a preceding recorded review
   action.

## 4. APIs / interfaces

### 4.1 External-facing interfaces

- **Email Ingestion endpoint** — receives inbound mail
  (webhook/callback from the mail-handling integration); operation:
  `submit ticket from email`.
- **Web Form Ingestion endpoint** — receives form submissions;
  operation: `submit ticket from web form`.
- **Outbound Send Gateway interface** — the organization's existing
  transactional email/reply-sending provider API; operation: `send
  customer-facing reply`. This interface is called by exactly one
  internal caller (4.3); it is not exposed to or reachable from the
  AI Worker.

### 4.2 Agent-facing interface (consumed by the Agent UI)

- `list tickets` (queue view, filterable/sortable by urgency/
  manual-triage status, category, channel) — backs FR-21, FR-22.
- `get ticket detail` (ticket text, classification, draft, retrieval
  context with cross-customer markers) — backs FR-16, NFR-19.
- `override classification` (ticket id, corrected category and/or
  urgency) — backs FR-23, FR-24, FR-25.
- `submit review action` (ticket id, action type: accept / edit /
  discard, final content if accept-or-edit) — backs FR-17, FR-18,
  FR-20; this is the only operation that can lead to a send.
- `send reply` — invoked internally by the Ticket Service immediately
  after `submit review action` succeeds with accept/edit; not a
  separately callable operation an agent (or anything else) can
  invoke without a preceding successful review action. Backs FR-19.
- `get audit/metrics views` (acceptance rate, urgent-miss vs.
  over-flag rate, per category/urgency/channel) — backs NFR-9,
  NFR-10.

### 4.3 Internal interfaces

- **Ticket Service to AI Worker — `classify ticket`**: ticket text in,
  structured `{category, urgency, confidence}` or a fail-safe
  signal out. Synchronous, called once per ingested ticket.
- **Ticket Service to AI Worker — `generate draft`**: ticket text in,
  `{draft text, retrieved similar tickets, retrieved KB articles,
  content-filter verdict}` out. Asynchronous job, called once per
  ingested ticket immediately after classification.
- **AI Worker to Vector Index — `query similar tickets`** and
  **`query KB articles`**: embedding vector in, ranked
  candidate list out. Internal to the AI Worker; the Ticket Service
  does not call the vector index directly for this purpose.
- **AI Worker to LLM/embedding provider — model inference calls**:
  used only for classification, embedding, and draft generation.
  This is the only external network dependency the AI Worker has,
  and explicitly excludes the Outbound Send Gateway (see Section
  2.9, Section 7).
- **Ticket Service to Outbound Send Gateway — `send reply`**: the
  single, exclusive call path to the gateway, reachable only from
  the code that executes immediately after a recorded review action
  (4.2's `submit review action`).

## 5. Data storage

- **Primary relational datastore (Ticket Service)** — stores ticket
  records (canonical schema, channel, status), classification
  results, override records, drafts, review/send actions, and the
  observability/audit log entries described in 2.14. A relational
  store is the right fit here: the data is structured, relationally
  linked (a ticket has classifications, overrides, drafts, and
  review actions that must be queried together for NFR-9/NFR-10
  metrics and for the FR-19/FR-20 audit), and the volume profile
  (per-ticket rows, not high-frequency event streams) does not need
  a specialized time-series or document store. This also gives
  transactional guarantees around "review action recorded, then and
  only then send" (FR-19), which a loosely consistent store would
  make harder to guarantee.
- **Vector index** — stores embeddings for two logically separate
  partitions/collections: ticket history (for FR-9 similar-ticket
  retrieval) and knowledge-base articles (for FR-12 KB retrieval).
  Source-of-truth ticket and KB text remains in the primary
  datastore (and the existing KB system per C-1); the vector index
  holds embeddings plus enough reference data (ticket/article id) to
  fetch full content from the primary store or KB system at
  retrieval time. Kept separate from the primary relational store
  because semantic/nearest-neighbor search is a different access
  pattern than the relational queries above, but it does not need to
  be a separate deployed service if a vector-capable extension of
  the primary datastore (e.g., a Postgres vector extension) meets
  the retrieval-latency budget in NFR-2 — this is the simplest
  option satisfying the NFR and should be preferred over standing up
  a dedicated vector database unless retrieval-latency testing shows
  otherwise.
- **Knowledge base** — existing system (C-1), consumed read-only for
  embedding/retrieval; this system does not write back to it (NFR-8
  forbids autonomous KB edits).
- **No durable storage in the AI Worker.** The AI Worker is
  stateless with respect to persistence: it reads ticket/KB content
  and the vector index, calls the model provider, and returns
  results to the Ticket Service to persist. It holds no datastore
  write credentials beyond what's needed to log its own
  classification/retrieval/generation activity (2.14), reinforcing
  the boundary in Section 2.9 by minimizing what the AI Worker can
  touch even before considering the send-credential question.
- **Data retention** — per C-5, no retention period or deletion
  mechanism is defined by the SRS; this SDD does not invent one.
  Whatever retention/deletion policy is eventually confirmed should
  be implementable as deletion/anonymization operations against the
  primary datastore and the corresponding vector-index entries (both
  the ticket row and its embedding need to be removable together).
  This is flagged here as a forward-compatibility note, not a
  current requirement to build.

## 6. Infrastructure & deployment

Given the SRS's NFRs do not call for high scale, multi-region
operation, or sub-second latency, this runs as a small number of
conventionally deployed services rather than a distributed system:

- **Ticket Service**: a single deployable web application (handles
  ingestion endpoints, agent-facing API, and the send-authorization
  endpoint), deployed behind the organization's standard web
  application hosting (e.g., a container platform or PaaS already in
  use). Scales horizontally behind a load balancer if needed, but a
  single instance or small fixed pool is adequate at the ticket
  volumes implied by the SRS (NFR-18 flags volume as unvalidated;
  this is a "scale up the same shape later" concern, not a reason to
  pre-build for high scale now).
- **AI Worker**: deployed as a separate process/service from the
  Ticket Service — separate deployable unit, separate runtime
  identity and credentials — specifically so the credential boundary
  in Section 2.9 is real at the infrastructure level (separate IAM
  role/service account, separate network egress rules), not just a
  logical module boundary inside one process that could be
  bypassed by a code change. It can run as a small worker pool
  consuming an internal job queue/table (e.g., a `drafting_jobs`
  table polled by workers, or a lightweight queue if the platform
  already provides one) for the asynchronous drafting step; the
  synchronous classification call can be a direct internal RPC/HTTP
  call from the Ticket Service to the AI Worker.
- **Vector index**: co-located with or adjacent to the primary
  datastore (see Section 5) to avoid operating a separate database
  technology unless retrieval-latency testing under NFR-2 shows it's
  needed.
- **Network segmentation**: the AI Worker's deployment is placed such
  that it has network reachability to (a) the primary datastore
  (read ticket/KB content, write its own logs/results) and (b) the
  external LLM/embedding provider, and explicitly does not have
  reachability to the Outbound Send Gateway's endpoint or
  credentials. This is implemented via separate security
  groups/network policies and a separate secrets scope from the
  Ticket Service's send-capable component — see Section 7 for
  specifics.
- **CI/CD**: standard build-test-deploy pipeline; the pre-launch
  evaluation harness (2.15) is run as a gated step before a
  classifier/drafter prompt or model change is promoted to
  production, satisfying NFR-11/NFR-12 as a release gate rather than
  a one-time activity disconnected from deployment.
- **Configuration/versioning**: model identifiers and prompt
  templates for both the classifier and the draft generator are
  externalized as versioned configuration (not hardcoded inline),
  so that the "model/prompt version" field required by NFR-13/NFR-15
  can be stamped automatically on every call from a single source of
  truth.

## 7. Technical constraints & operations

### Security

- **Architectural no-autonomous-send boundary (NFR-6, C-9) — the
  central security constraint of this system.** The AI Worker is
  deployed as a distinct service identity with its own credential
  set, containing only: (a) API keys for the embedding/LLM provider,
  and (b) read-scoped datastore credentials for ticket/KB content and
  the vector index, plus write access limited to its own
  classification/draft/log records. It is never issued credentials
  for the Outbound Send Gateway, and at the network layer it has no
  route/allow-list entry to reach that gateway's endpoint. The
  Outbound Send Gateway itself is configured to accept calls only
  from the Ticket Service's send-capable component, and that
  component invokes it only as the immediate, in-transaction
  consequence of a successfully recorded human review action — there
  is no standalone "send" operation callable independently of that
  sequence, and no retry/batch/backfill job is wired to the gateway
  at all (FR-19's "no code path" requirement is satisfied by there
  being exactly one path, not by access checks layered onto many
  paths). A code-level/architectural audit (per the SRS acceptance
  criteria) should periodically confirm that no new code path,
  credential grant, or network rule has been added that would let the
  AI Worker or any background job reach the gateway. This is the
  single point in the design where "policy" is deliberately not
  trusted to do the job — it is enforced by what credentials and
  network access physically exist.
- **Prompt-injection resistance.** Both the Classification Service
  and Draft Generator structure prompts with a clear, non-overridable
  separation between system instructions and ticket content (e.g.,
  ticket text passed as a delimited/templated data field, never
  concatenated into the instruction text), so embedded instructions
  in ticket text (FR-8) are treated as content to classify/respond
  to, not as commands.
- **Cross-customer PII containment.** Redaction in the Similar-Ticket
  Retriever (2.5) is the primary control; the Output Content Filter
  (2.8) is a backstop scan on generated drafts; the Agent UI's visual
  separation (2.13) is the final human-facing backstop. Three
  independent layers reflects NFR-7's requirement that this never
  reach a customer, given any single layer could miss a case.
- **Least-privilege datastore access.** The AI Worker's datastore
  credentials are read-only for ticket/KB content; it cannot modify
  ticket status, reassign tickets, or edit KB articles, directly
  enforcing NFR-8.

### Third-party integrations

- **LLM/embedding API provider**: selected per NFR-5 specifically for
  a contractual no-training-on-submitted-data commitment and data
  retention terms compatible with the organization's commitments;
  this is a procurement/contract criterion as much as a technical
  one and should be confirmed before any provider is finalized, since
  ticket/KB content sent to this provider includes customer PII
  (per AI requirements Section 7).
- **Mail-handling integration**: existing organizational email
  ingestion (C-7); this design assumes it can deliver inbound
  messages to the Email Ingestion Adapter via webhook or equivalent
  push mechanism without building new mail-server infrastructure.
- **Outbound Send Gateway**: existing transactional
  email/reply-sending provider; this design does not introduce a new
  sending provider, only a new, narrowly-scoped internal caller of
  it.
- **Knowledge base system (C-1)**: consumed read-only; no write
  integration is built.

### Performance constraints

- Classification (NFR-1, p90 < 5s) and end-to-end draft availability
  (NFR-2, p90 < 15s) are the two latency budgets the architecture is
  built around: classification is kept synchronous and on a fast/
  small model tier; drafting is deliberately asynchronous so its
  longer multi-step latency (two retrieval calls plus generation)
  never blocks ingestion or queue surfacing.
- Per the SRS (NFR-3, NFR-18, C-4), these targets and the per-ticket
  cost ceiling (NFR-4) are explicitly unvalidated placeholders; this
  design treats them as the current budget but does not hard-code
  assumptions (e.g., model tier, vector index technology) that would
  be expensive to change if real ticket volume or agent-workflow
  timing data later requires a different budget.

### Deployment / operational concerns

- **Separate deployability of the AI Worker is a security
  requirement, not just an operational one** — it must remain
  separately deployable with its own credentials for the boundary in
  Section 2.9 to hold; collapsing it into the Ticket Service process
  for operational convenience would silently reintroduce the risk
  NFR-6 is meant to eliminate, and should be treated as a design
  regression if proposed later.
- **Release gating**: classifier/drafter prompt or model changes pass
  through the pre-launch evaluation harness (2.15) results before
  promotion, and post-launch acceptance-rate/edit-distance trends
  (NFR-9, NFR-15) should be monitored as an ongoing signal of
  whether a given deployed prompt/model version is regressing.
- **Safety-event visibility**: schema-validation failures, fail-safe
  routings, and content-filter triggers (NFR-16) are logged as
  distinct events and should be surfaced to whoever operates the
  system as a standing, reviewable feed — not folded into aggregate
  dashboards where a small but important rate could go unnoticed.
- **Data retention/deletion is an open dependency (C-5)**: this
  design does not implement a retention or right-to-deletion
  mechanism because none is specified yet; whatever is confirmed
  later should be implementable as paired deletion across the
  primary datastore and the vector index (Section 5) without further
  architectural change.
