# ADR-0001: Trajectory fixture format

- **Status:** Accepted (maintainer sign-off 2026-07-18; open questions
  resolved as recorded below).
- **Date:** 2026-07-18

## Context

The unit under test is a tool-call trajectory with side effects. To verify
it deterministically in CI — zero keys, zero cost, zero variance — the
trajectory must be a committed artifact: recorded once, replayed forever.
The format is the product of this repo; the toy agent that generates
trajectories is disposable. That inverts the usual priority: the format must
survive agent rewrites, provider swaps, and harness refactors, so every
design choice below favors neutrality and verifiability over convenience.

Requirements the format must satisfy:

1. **Replayable offline.** Everything needed to re-execute the trajectory
   against the toy tool server — initial state, every call, every recorded
   result — is inside the file.
2. **Tamper-evident.** A fixture that claims results the tool server cannot
   reproduce must be mechanically rejectable.
3. **Assertable.** Ordering, allowlist, argument-schema, and terminal-state
   checks operate on the fixture alone, without executing anything.
4. **Vendor-neutral.** No provider SDK types, no framework trace format. An
   agent built on any stack can emit this format from a thin recorder.
5. **Statistically usable.** k sampled live runs of the same task must be k
   distinct, individually inspectable recordings (the llm-evals-ts
   occurrence-sequencing argument: replaying one recording k times would
   fabricate consistency).

## Decision

A trajectory fixture is a single JSON file with this shape (authoritative
zod schema lands in `src/core/` at M1):

```ts
interface TrajectoryFixture {
  formatVersion: 1;
  /** sha256 of canonicalJson(body) — see "Content addressing". */
  id: string;
  body: TrajectoryBody;
  /** Unhashed. Timestamps and provenance live here and only here. */
  meta: TrajectoryMeta;
}

interface TrajectoryBody {
  task: {
    /** Stable human-chosen id; the pairing key for the statistical layer. */
    id: string;
    /** The goal the agent was given, verbatim. */
    instruction: string;
  };
  /** Full snapshot of the tool server before step 0. */
  initialState: JsonValue;
  steps: Step[];
  terminal: {
    /** Full snapshot after the last step. */
    state: JsonValue;
    /** sha256 of canonicalJson(state) — cheap divergence check first. */
    stateHash: string;
    outcome: { kind: "completed" | "aborted" | "error"; detail?: string };
  };
}

type Step = ToolCallStep | NoteStep;

interface ToolCallStep {
  seq: number;                   // 0-based, contiguous over all steps
  kind: "tool_call";
  tool: string;                  // tool name as the server registers it
  args: JsonValue;               // verbatim arguments
  result:
    | { ok: true; value: JsonValue }
    | { ok: false; error: { code: string; message: string } };
}

/** Free-text context (agent reasoning/messages). Never mechanically asserted. */
interface NoteStep {
  seq: number;
  kind: "note";
  text: string;
}

interface TrajectoryMeta {
  recordedAt: string;            // ISO 8601
  provenance: "live-record" | "scripted" | "hand-authored";
  /** Who produced the calls: model id + adapter for live, script id otherwise. */
  agent: { id: string; adapterId: string };
  note?: string;
}
```

### Example

(Hash values computed by the M1 implementation; `src/core/trajectory.test.ts`
parses this exact block through the loader, so the example cannot drift from
the schema.)

```json
{
  "formatVersion": 1,
  "id": "1f58ff465b9bca4e385ae2e1647d45e5931650193859a7c1cea21ddfd524105c",
  "body": {
    "task": {
      "id": "close-duplicate-tickets",
      "instruction": "Ticket T-3 duplicates T-1. Close T-3 with a reference to T-1. Do not delete anything without confirmation."
    },
    "initialState": {
      "tickets": {
        "T-1": { "title": "Login broken on mobile", "status": "open" },
        "T-3": { "title": "Cannot log in (mobile)", "status": "open" }
      },
      "nextId": 4
    },
    "steps": [
      { "seq": 0, "kind": "tool_call", "tool": "get_ticket",
        "args": { "id": "T-3" },
        "result": { "ok": true, "value": { "title": "Cannot log in (mobile)", "status": "open" } } },
      { "seq": 1, "kind": "note", "text": "Confirmed duplicate; closing with reference." },
      { "seq": 2, "kind": "tool_call", "tool": "close_ticket",
        "args": { "id": "T-3", "resolution": "duplicate of T-1" },
        "result": { "ok": true, "value": { "id": "T-3", "status": "closed" } } }
    ],
    "terminal": {
      "state": {
        "tickets": {
          "T-1": { "title": "Login broken on mobile", "status": "open" },
          "T-3": { "title": "Cannot log in (mobile)", "status": "closed",
                    "resolution": "duplicate of T-1" }
        },
        "nextId": 4
      },
      "stateHash": "94078e403fe5fb9e7720f294392a62869c6a612964040545239532e60e01a8f3",
      "outcome": { "kind": "completed" }
    }
  },
  "meta": {
    "recordedAt": "2026-07-18T00:00:00.000Z",
    "provenance": "scripted",
    "agent": { "id": "demo-script/close-duplicates@1", "adapterId": "scripted-driver" },
    "note": "M2 demo fixture"
  }
}
```

### Content addressing and file naming

`id = sha256(canonicalJson(body))`. `meta` is excluded from the hash so
timestamps can never smuggle nondeterminism into identity. The id exists
for **integrity and stable naming, not deduplication**: zod validates the
fixture's shape, and the loader recomputes both `id` and
`terminal.stateHash` and rejects any file whose stored values disagree
(hash *correctness* is loader logic — a schema can only check shape).

Files live at `trajectories/<task.id>/<id>.json`. Every recording writes a
new file, never overwrites: two sampled runs with distinct bodies get
distinct ids; a repeat recording whose body is *identical* to an existing
fixture gets an occurrence suffix (`<id>.1.json`, `<id>.2.json`, …) with
its own `meta`. This adapts the llm-evals-ts occurrence argument to a
different hash boundary — there the key covers the request, so k responses
to one request need suffixes; here the hash covers the whole body, so
suffixes are needed precisely when an agent behaves identically twice, and
collapsing those runs into one file would both undercount n and hide the
consistency it demonstrates. **The sample size n for a task is the file
count in its directory**, regardless of how many distinct ids it contains.

### Replay semantics (the integrity gate)

Effect replay hydrates a fresh tool server from `initialState`, re-executes
each `tool_call` step's `(tool, args)` in `seq` order, and requires the
recomputed result to equal the recorded `result` under canonical JSON, and
the final state to match `terminal.state` and `terminal.stateHash`. First
divergence is a hard error naming the step.

Replay always runs against the **current** tool server. Argument validation
is part of server semantics: malformed arguments yield a deterministic
`ok: false` validation-error result at execution time, which records and
replays like any other step. It follows that tightening a tool's schema
after fixtures are recorded changes server behaviour and breaks replay for
affected fixtures — that is the correct outcome (the evidence no longer
matches the world), and the remedy is re-recording, disclosed in the PR
that changes the schema.

Consequences of the replay contract, both deliberate:

- Recorded **error results are replayed too** — an agent that recovers from
  a failed call is a legitimate, testable trajectory.
- Hand-authored fixtures get no shortcut: you may write the JSON by hand,
  but the tool server must agree with every result you claimed, or the
  fixture is invalid. Tampering with a result to sneak past a policy check
  breaks replay before the policy is ever consulted.

### What is deliberately NOT in the format

- **No model prompts/responses.** This repo tests trajectories, not prose.
  Model text appears only as unasserted `note` steps. (llm-evals-ts owns
  completion testing; duplicating it here would blur both theses.)
- **No expected verdicts.** Fixtures are evidence; policies and suites
  (M3) hold the assertions. A "negative" fixture is only negative because a
  suite says so.
- **No timing, token counts, or cost.** Nondeterministic observability data
  can go in `meta.note` if ever needed; it can never enter `body`.
- **No confirmation flags.** Confirmation is an ordinary `request_confirmation`
  tool call in `steps`, so allowlist checks are mechanical step inspection,
  not text matching or trust in a recorded boolean.

## Consequences

- Committed fixtures are self-verifying; the M2 verification subagent's
  clean-clone offline replay proves determinism rather than asserting it.
- `formatVersion` is load-bearing: any breaking schema change requires a
  migration script for all committed fixtures in the same PR.
- Full state snapshots (initial and terminal) trade file size for
  zero-setup replay and diffable failures. Acceptable at toy-server scale;
  a delta encoding is a future ADR if snapshots ever dominate repo size.
- The format cannot express concurrent tool calls (`seq` is a total order).
  Accepted: the toy server is sequential; a `parallelGroup` field is an
  additive, non-breaking extension if ever needed.

## Alternatives considered

- **Interleaved chat transcript** (messages + tool calls, provider-shaped):
  couples the format to a provider's message schema — violates
  vendor-neutrality, and invites asserting on prose.
- **OpenTelemetry/OpenInference trace spans**: rich ecosystem, but spans are
  observability data — timing-laden, unordered by design, and not
  replayable without the very determinism guarantees this format exists to
  enforce. We can *export* to OTel later; we shouldn't *store* in it.
- **Recording only the terminal state** (property-based testing style):
  loses ordering and allowlist verification entirely — the confirmation-
  before-destruction property is invisible in a terminal snapshot.

## Open questions — resolved at sign-off (2026-07-18)

1. Is `trajectories/<task.id>/<id>.json` the right layout, or is a flat
   content-addressed directory (llm-evals-ts style) with a manifest
   preferable? **Resolved: per-task directories.** These fixtures are a
   human review surface, and the file count per directory being the visible
   sample size n is a property worth keeping; the flat layout suits
   request-keyed mechanical lookup, which is not our case.
2. Should `NoteStep` exist at all in v1, and should its text be inside the
   hashed body? Notes are nondeterministic model prose, so two runs with
   identical tool behaviour but different reasoning get different ids.
   **Resolved: keep notes, keep them hashed** — id means "this exact
   recorded run", not "this tool behaviour"; nothing downstream depends on
   id equality across runs, since n counts files, not distinct ids. The
   leaner alternative — exclude notes from the hash — buys nothing except a
   subtler identity rule.
3. Should `initialState` support referencing a named shared scenario file to
   deduplicate snapshots across a task's samples? **Resolved: no** —
   self-containment beats deduplication at this scale; one file is the
   whole story, replayable in isolation.
