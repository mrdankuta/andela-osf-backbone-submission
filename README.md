# Backbone Africa

**Verified opportunities for Nigerian MSMEs, made actionable.**

Backbone Africa is an opportunity compass for Nigerian micro, small,
and medium enterprises. It answers three questions entrepreneurs actually ask:
*can I trust this, am I eligible, and what do I do next?* Every listing is
source-linked and verified, every eligibility verdict is backed by claim-level
evidence, and every next step carries its uncertainty honestly — including when
the answer is "we don't know yet."

> **PoC scope:** Nigeria only. The public catalog carries **six verified
> official-source records** — GLOW (Guaranteed Loans for Women, BOI); MTN ICT
> and Business Skills Training — Phase 8; NiYA Startup 2.0; Student Venture
> Capital Grant (S-VCG); BOI–iDICE Debt Fund; and RAPID — Rural Area Programme
> on Investment for Development. GLOW remains the primary demo journey. MTN is
> the only listing with a published deadline; the others show their actual
> state — open application, expression of interest, or registration route —
> rather than an invented date. The project deliberately shows nothing
> unverified rather than a long list of untrusted leads.

## How it works

1. **Verified catalog** — Opportunities appear publicly only when `verified`,
   marked `public`, and linked to safe official URLs. Anything else stays
   hidden. Each listing shows its source, last-verified date, and scam
   warnings where relevant.
2. **Business profile** — Three-step onboarding (state, sector, stage, CAC
   status, team size, women/youth-led, support needed). You can also describe
   the business in free text: a TypeSafe (Jev) judgment model interprets it
   into structured fields that **you confirm** — nothing is auto-applied.
3. **Evidence-backed readiness verdicts** — Each eligibility criterion is
   evaluated against your profile and the claim-level evidence
   (`met / unmet / unknown / ambiguous / needs-evidence`), composed into an
   overall verdict (`ready / can-become-ready / not-currently-eligible /
   needs-information`). Hard requirements block honestly; missing facts ask
   for information instead of guessing.
4. **Feasible next-action plans** — The top gap becomes one concrete action
   with sourced guidance, time/cost estimates (or "not published"), explicit
   uncertainty, dependencies, deterministic deadline feasibility, and a
   realistic alternative when the path is blocked or too late.
5. **Grounded assistant** — Chat requests route through a bounded router into
   the same typed readiness functions (evidence, criterion, next step,
   alternatives). The agent explains results but **cannot override**
   deterministic verdicts. It works degraded-but-cited when the AI gateway is
   unavailable.
6. **Tracking & reminders** — Save plans to a checklist, get deadline email
   reminders, and receive full-fidelity typed explanations in English or
   Pidgin, with limited/fallback Hausa, Yoruba, and Igbo modes where official
   English governs.

## App map

| Route | What it does |
|---|---|
| `/` | Value proposition + entry |
| `/onboarding` | 3-step profile + free-text interpretation |
| `/home` | Ranked For-You feed |
| `/explore` | Search, filter, sort the catalog |
| `/opportunity/[id]` | Evidence, readiness verdict, next-action plan, checklist |
| `/assistant` | Grounded chat about an opportunity |
| `/track` | Saved checklists and progress |
| `/profile`, `/report` | Business profile, flags/reports |
| `/admin` | Curation review workflow |

## Running it

Prerequisites: Node 20+, a [Convex](https://convex.dev) account (free tier works).

```sh
cd backbone-app
bun install
bunx convex dev        # start the backend; creates your dev deployment
bun run dev           # start the frontend (separate terminal)
```

Seed the verified six-listing catalog:

```sh
bunx convex run seed:seed
```

Environment variables (Convex dashboard → Settings → Environment Variables):

| Variable | Purpose | Required for |
|---|---|---|
| `OPENROUTER_API_KEY` | TypeSafe Jev judgments + benchmark reruns | Profile interpretation, `bun run benchmark:typesafe` |
| Resend API key | Deadline email reminders | Not needed for PoC: `reminders.ts` runs the Resend component in `testMode` |

Checks:

```sh
bunx vitest run            # unit + Convex logic tests
bun run check             # svelte-check (must be 0 errors)
bun run build             # production build (Cloudflare adapter)
bun run benchmark:typesafe  # rerun the Jev benchmark vs pinned + alias models
```

## Trust model

- **Sources first:** every important fact links to an official passage; support
  statuses (`supported / pending-review / contradicted / ...`) are visible.
- **Deterministic rules:** hardness (`hard / remediable / preference`),
  deadline feasibility, and routing thresholds are explicit configuration, not
  model vibes. Thresholds were derived from observed benchmark confidences
  (see `benchmarks/typesafe/README.md`).
- **Human review points:** ambiguous criteria, contradictory evidence, and all
  profile interpretations route to a person (curator or the user), never to
  auto-accept.
- **Unknowns stay unknown:** unpublished deadlines, unlisted documents, and
  missing profile facts are stated as such — never invented. Each of the five
  newly added records carries a manual-review gate for programme rules the
  profile cannot yet model, so incomplete modeling can never produce a
  `ready` verdict.

## AI usage

- **TypeSafe Jev** (`typesafe/jev-1.13`, pinned): interprets free-text business
  descriptions into confirmable fields; evaluated by the versioned 19-case
  benchmark (`benchmarks/typesafe/`) covering clear, ambiguous, absent,
  contradictory, and adversarial inputs.
- **Chat agent** (`openai/gpt-4o-mini` via Convex gateway): explains typed
  results in plain language with citations; tightly instructed and
  architecturally unable to override verdicts.
- **Local fallback:** onboarding ships a heuristic interpreter so the flow
  works with no key and no network.

## Privacy

No account is required. Profiles, threads, and checklists are keyed to an
anonymous device id stored in the browser's local storage. Business data is
used only to evaluate readiness for the opportunities you open.

Adding the free account backs this device up: an explicit **Back up this
device** step merges the anonymous profile and plans into the account
(account data wins ties, checklist ticks union, nothing is lost), and the
same data appears on every signed-in device. Reads and writes derive identity
server-side from the session — a guessed device identifier can never reach
another person's records, and the reserved account namespace is rejected from
anonymous callers.

Retention: signed-in users can inspect their data (profile fields, plans,
conversations), export a portable copy, or permanently delete it by typing
DELETE on the profile page. Deletion removes the profile, plans, and
conversation threads including agent message history; shared catalog data
and other users' records are never touched. Anonymous device data stays on
the device until claimed or swept during an authenticated delete.

## Limitations (honest list)

- Six verified seed records are still a deliberately narrow catalog; source
  status can change and must be rechecked.
- Nigeria PoC — states, sectors, and sources are Nigeria-specific.
- Unpublished information (deadlines, fees, documents) is marked unknown.
- AI outputs (interpretation, explanations, translations) can be wrong —
  confirm before acting; official portals prevail.
- Document storage caps files at 256 KB (PDF/JPEG/PNG) in this PoC.
- Offline queue covers ticks, plan states, and link suggestions; other writes need connectivity.
- Email reminders run via Resend in test mode in this PoC.

## Roadmap direction

Broader continuously maintained catalog coverage through the working URL
import + curation pipeline; fuller profile modeling for programme-specific
rules; full multilingual fidelity; PDF/JS-rendered import; production
hardening and monitoring; and native store release with device certification —
tracked as issues in the repo.
