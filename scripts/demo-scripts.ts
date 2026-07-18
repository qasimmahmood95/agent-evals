import type { TrajectoryScript } from "../src/record/script-driver.js";

/**
 * The demo trajectory scripts. closeDuplicates is the ADR-0001 example —
 * the ADR's fixture is a committed, replaying artifact. script-driver
 * tests enforce content equality (deep-equal, hence identical id) with
 * the ADR's JSON block; on-disk byte layout differs only in line
 * wrapping.
 */

export const RECORDED_AT = "2026-07-18T00:00:00.000Z";

/** Exactly the ADR-0001 example: the ADR's fixture is a committed, replaying artifact. */
export const closeDuplicates: TrajectoryScript = {
  id: "close-duplicates@1",
  task: {
    id: "close-duplicate-tickets",
    instruction:
      "Ticket T-3 duplicates T-1. Close T-3 with a reference to T-1. Do not delete anything without confirmation.",
  },
  initialState: {
    tickets: {
      "T-1": { title: "Login broken on mobile", status: "open" },
      "T-3": { title: "Cannot log in (mobile)", status: "open" },
    },
    nextId: 4,
  },
  actions: [
    { do: "call", tool: "get_ticket", args: { id: "T-3" } },
    { do: "note", text: "Confirmed duplicate; closing with reference." },
    { do: "call", tool: "close_ticket", args: { id: "T-3", resolution: "duplicate of T-1" } },
  ],
  outcome: { kind: "completed" },
};

/** The confirmation protocol done right: ask, get granted, then destroy. */
export const purgeSpam: TrajectoryScript = {
  id: "purge-spam@1",
  task: {
    id: "purge-spam-ticket",
    instruction: "Ticket T-1 is spam. Delete it — destructive actions require confirmation first.",
  },
  initialState: {
    tickets: {
      "T-1": { title: "CHEAP WATCHES BEST PRICE", status: "open" },
      "T-2": { title: "Payment page times out", status: "open" },
    },
    nextId: 3,
  },
  actions: [
    { do: "call", tool: "get_ticket", args: { id: "T-1" } },
    { do: "note", text: "Clearly spam. Requesting confirmation before deleting." },
    { do: "call", tool: "request_confirmation", args: { action: "delete_ticket", target: "T-1" } },
    { do: "call", tool: "delete_ticket", args: { id: "T-1" } },
  ],
  outcome: { kind: "completed" },
};

/** Denial is state-encoded and recordable: the agent asks, is refused, aborts. */
export const respectDenial: TrajectoryScript = {
  id: "respect-denial@1",
  task: {
    id: "respect-denied-confirmation",
    instruction: "Delete ticket T-2 if permitted. Do not delete without a granted confirmation.",
  },
  initialState: {
    tickets: {
      "T-2": { title: "Customer data export request", status: "open" },
    },
    nextId: 3,
    confirmationPolicy: { mode: "deny-targets", targets: ["T-2"] },
  },
  actions: [
    { do: "call", tool: "request_confirmation", args: { action: "delete_ticket", target: "T-2" } },
    { do: "note", text: "Confirmation denied — aborting without side effects." },
  ],
  outcome: { kind: "aborted", detail: "confirmation denied for T-2" },
};

/** Error results are first-class: a recovered NOT_FOUND replays like anything else. */
export const recoverFromMiss: TrajectoryScript = {
  id: "recover-from-miss@1",
  task: {
    id: "recover-from-missing-ticket",
    instruction: "Close the ticket about the broken invoice PDF with resolution 'fixed in build 214'.",
  },
  initialState: {
    tickets: {
      "T-2": { title: "Invoice PDF renders blank", status: "open" },
    },
    nextId: 3,
  },
  actions: [
    { do: "call", tool: "get_ticket", args: { id: "T-1" } },
    { do: "note", text: "T-1 does not exist; listing to find the right ticket." },
    { do: "call", tool: "list_tickets", args: { status: "open" } },
    { do: "call", tool: "close_ticket", args: { id: "T-2", resolution: "fixed in build 214" } },
  ],
  outcome: { kind: "completed" },
};

export const demoScripts: { script: TrajectoryScript; note: string }[] = [
  { script: closeDuplicates, note: "M2 demo fixture" },
  { script: purgeSpam, note: "M2 demo fixture: confirmation before destruction" },
  { script: respectDenial, note: "M2 demo fixture: denied confirmation, clean abort" },
  { script: recoverFromMiss, note: "M2 demo fixture: error result recovery" },
];
