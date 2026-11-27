# ADR-0001: Record architecture decisions

- Status: Accepted
- Date: 2026-11-27

## Context

`CLAUDE.md` requires assumptions to be documented in ADRs, and treats the specification's proposed defaults as unapproved founder decisions. Contributors (people and coding agents) need one place to see what was decided, what was assumed and what still needs approval.

## Decision

Keep lightweight ADRs in `docs/adr/`, numbered `NNNN-title.md`, each with Status, Date, Context, Decision and Consequences. Engineering choices are **Accepted** when merged. Anything that is really a commercial, legal or brand decision stays **Proposed** and is listed in ADR-0007 until the founder approves it.

## Consequences

- A pull request that changes an architectural choice adds or supersedes an ADR.
- Founder approvals are recorded by updating ADR-0007 (or a successor) with date and approver.
