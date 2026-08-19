# Ingestion Pipeline: Design Review

## Summary

This document describes the proposed architecture for the document ingestion
pipeline that will replace the current batch loader. The existing loader was
written as a stopgap in early 2024 and has since accumulated enough special
cases that adding a new source format now takes roughly a week of engineering
time. The proposal here is to decompose the loader into four independent
stages connected by durable queues, so that each stage can be scaled, retried,
and reasoned about on its own.

The headline claim is that this design will reduce median ingestion latency
from eleven minutes to under ninety seconds while cutting the per-document
cost by about sixty percent. Those numbers come from a prototype run against a
sample of forty thousand documents drawn from the production corpus.

## Background

The current loader is a single Python process that polls an S3 prefix every
five minutes, downloads whatever it finds, and writes rows into Postgres. It
does everything in one transaction: parsing, normalization, entity extraction,
embedding, and indexing. When any step fails, the whole batch rolls back and
is retried from the beginning on the next poll. In practice this means that a
single malformed PDF in a batch of two thousand documents can block the entire
batch indefinitely, and we have seen exactly this happen four times in the last
quarter.

There is no observability to speak of. The loader emits a single log line per
batch and nothing at all per document, so when a customer asks why a specific
file has not appeared in search results we have no way to answer except by
re-running the loader locally against that file and watching what happens. On
average this takes an engineer about forty minutes.

Finally, the loader is not idempotent. Re-running it against the same input
produces duplicate rows, which we currently clean up with a nightly
deduplication job. That job is itself a source of incidents, because it
occasionally deletes the wrong copy when two versions of a document share a
checksum prefix.

## Goals

The redesign should achieve the following. First, per-document isolation: one
bad document must never block another. Second, observability: every document
must have a traceable state at every point in the pipeline, queryable by
document ID. Third, idempotency: re-processing any document must be safe and
must converge to the same result. Fourth, horizontal scalability: each stage
must scale independently, since embedding is compute-bound while parsing is
I/O-bound and they have wildly different resource profiles.

Explicit non-goals: we are not attempting to support streaming or real-time
ingestion in this iteration, we are not changing the storage schema, and we are
not touching the query path at all.

## Proposed architecture

The pipeline decomposes into four stages.

**Stage one, acquisition.** A lightweight watcher subscribes to S3 event
notifications rather than polling. On each object-created event it writes a
work item to the `acquire` queue containing the bucket, key, version ID, and
observed ETag. The watcher does no I/O against the object itself, which keeps
it cheap and makes it nearly impossible for it to fall behind.

**Stage two, parsing.** Workers pull from `acquire`, download the object, and
dispatch on content type to a parser. Parsers are pure functions from bytes to
a normalized intermediate representation: a list of blocks, each with a type,
a text payload, and a source offset range. Parsers must not perform network
I/O. This restriction is what makes the stage trivially retryable and lets us
run the entire parser suite in a sandbox with no egress.

**Stage three, enrichment.** Workers pull parsed documents and run entity
extraction and embedding. This is the expensive stage, and the only one that
calls out to a model. Enrichment is checkpointed per block, so a document that
fails halfway through does not need to re-embed the blocks that already
succeeded. Checkpoints live in Redis with a seven-day TTL.

**Stage four, indexing.** Workers write the enriched document into Postgres and
the vector store in a single logical unit, keyed by a deterministic document
ID derived from the source URI and content hash. Writes use upsert semantics
throughout, which is what buys us idempotency.

Between each stage sits a durable queue with a dead-letter queue attached.
Documents that fail a stage three times land in the DLQ with their full error
context and are visible in the operations dashboard.

## State model

Every document has exactly one row in the `ingestion_state` table, keyed by
document ID. The row records the current stage, the attempt count, the last
error if any, and timestamps for each stage transition. Stage workers update
this row as their final action before acknowledging the queue message.

This gives us the observability property directly: answering "why has this file
not appeared" becomes a single indexed lookup rather than a forty-minute
investigation. It also gives us a natural place to hang metrics. Stage latency
histograms fall out of the transition timestamps without any additional
instrumentation.

The obvious objection is that this table becomes a write hotspot. At our
current volume of roughly two hundred thousand documents per day, that is
around ten writes per second across four stages, which Postgres will not
notice. If volume grows by two orders of magnitude we would move this table to
its own instance, but that is not a concern for this iteration.

## Failure handling

Each stage distinguishes between retryable and terminal failures. Network
timeouts, rate limits, and transient model errors are retryable and use
exponential backoff with jitter, capped at five minutes. Parse failures on
malformed input, unsupported content types, and documents exceeding the size
limit are terminal and go straight to the DLQ without retrying.

Getting this classification right matters more than it sounds. The current
loader treats every failure as retryable, which is why a single corrupt PDF can
consume the entire retry budget for a batch. Under the new design that document
lands in the DLQ within seconds and every other document proceeds untouched.

DLQ items are not automatically retried. An operator reviews them in the
dashboard and either fixes the underlying issue and replays the item, or marks
it as permanently rejected with a reason. Rejection reasons are surfaced to
customers through the existing status API.

## Migration plan

We propose a three-phase migration. In phase one, the new pipeline runs in
shadow mode alongside the existing loader, writing to a parallel set of tables.
We compare outputs daily and investigate every divergence. We expect this phase
to take three weeks.

In phase two, we cut over reads for a single pilot tenant while keeping the old
loader running. If anything goes wrong we flip a feature flag and the tenant is
back on the old path within seconds. We hold here for one week.

In phase three we migrate remaining tenants in batches of twenty, monitoring
error rates between batches, and then decommission the old loader and the
nightly deduplication job.

## Open questions

Should enrichment checkpoints live in Redis or in Postgres alongside the state
row? Redis is faster and the TTL semantics are convenient, but it adds a
component to the critical path that can fail independently. The counter-argument
is that a Redis outage would only cause redundant re-embedding, not data loss,
which seems acceptable.

How should we handle documents that change while in flight? The current
proposal keys on version ID, so a mid-flight change simply produces a second
independent pipeline run and the later one wins by timestamp. This is correct
but wasteful. An alternative is to cancel in-flight runs when a newer version
arrives, at the cost of considerable complexity in the workers.

What is the right size limit for a single document? The current loader has no
limit, and we have seen a single four-hundred-megabyte log file consume an
entire worker for two hours. A limit of fifty megabytes would cover
ninety-nine point eight percent of observed documents.

## Appendix: measured prototype numbers

The prototype processed forty thousand documents sampled uniformly from the
last ninety days of production traffic. Median end-to-end latency was
eighty-one seconds and the ninety-fifth percentile was four minutes twenty
seconds. Cost per thousand documents was one dollar and ten cents, against
two dollars and eighty cents measured for the current loader over the same
sample. Parse stage throughput was roughly two hundred documents per second per
worker; enrichment was the bottleneck at eleven documents per second per
worker, entirely dominated by embedding latency.

These numbers should be treated as optimistic. The prototype ran without the
state table writes and without DLQ handling, and the sample skewed toward
smaller documents because the largest files in the corpus were excluded from
the export used to build it.
