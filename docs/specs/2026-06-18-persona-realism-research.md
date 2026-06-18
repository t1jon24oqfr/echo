# Persona Realism — Research & Design (2026-06-18)

Goal: make an Echo persona feel like the **real person** — a knower says *"that's them"* —
built from chat exports + a few extra onboarding answers, measurably and safely.

Produced by a 12-agent research workflow (codebase audit + 7 web cuts → adversarial
verification → synthesis). All file/line references verified against the live code.
Full raw research digest: workflow run `wf_0a05e91a-7d7` task output.

---

## North star

Maximize **felt-authenticity on low-harm levers** (idiolect, cadence, surzhyk
code-switching, pet-names, inside-jokes, latency/bursts) while keeping **facts strictly
grounded and honestly uncertain** — so a knower says "that's them" AND never gets a
confidently fabricated memory. For a *memorial* product, unbounded fidelity is *partly the
harm* (CHI-2026 *Remember-You*: AI lines overwrite the rater's real memories). So **split
the dial**: push stylometry to the limit; gate every biographical claim behind retrieval +
honest "I don't remember that right." The moat isn't the clone mechanic (commoditized) — it
is memorial framing + UA/RU/surzhyk fidelity + the living-state engine + grief-safety.

**Code reality check:** `CHAT_MODEL` is already `qwen/qwen3-32b` (`engine/llm.ts:115`), not
DeepSeek — Echo is already on an open-weight family, OpenRouter exposes `logit_bias` /
`presence_penalty` today, and a per-character Qwen LoRA serves via the same path. This
shrinks the "LoRA forces you off the hosted model" objection.

---

## Training approach — PROMPT-FIRST, LoRA-LAST-and-gated

The "LoRA vs prompting" debate is a false dichotomy; it's about **sequencing**. IMPersona's
own numbers: plain dense retrieval scored **40.81%** vs **44.44%** for the full
LoRA+hierarchy stack — **~90% of the value is prompt + retrieval**.

- **Phase 0 — Prompt + retrieval (now, days).** The permanent free-tier spine, not a
  placeholder. Ship the rank 1-12 upgrades below.
- **Phase 1 — Instrument feedback NOW (days).** Log every regenerate / "that's them" /
  "not them" as a preference pair into a new `PreferencePair` table. Free, fits the
  delete-corpus privacy model, becomes the Phase-3 DPO corpus. Collect long before training.
- **Phase 2 — Per-character LoRA "Deep Persona" (weeks; PAID, gated at ≥~500–1k messages).**
  Below that floor LoRA only matches prompting, so gate it. Segment exports (≤6h gaps, reuse
  `segment.ts`) → (context→real reply) pairs; QLoRA via Unsloth on a 3090 (~1–3h, ~100MB
  hot-swap adapter, <$5), rank 8 / alpha 16 / LR 1e-4, mix 5–10% general data vs forgetting.
  Base: Qwen-2.5/3 (already the family) or Gemma-2-9B; Vikhr/Saiga-NeMo-12B for RU-dominant.
  **Fence the LoRA to STYLE only** — facts still go through the Phase-0 fact-sheet + guard.
- **Phase 3 — DPO from feedback (weeks).** DPO the per-person adapter toward "them"; no
  reward model, gated on the Layer-1 style-distance harness (moved idiolect WITHOUT raising
  hallucination).
- **Not recommended:** decode-time n-gram logit injection (mostly fails) — but a small
  targeted `logit_bias` ban-list IS worth it.

---

## Pipeline upgrades (ranked, against the current engine)

| # | Upgrade | Impact / Effort | File(s) |
|---|---------|-----------------|---------|
| 1 | **Death-date / knowledge-cutoff grounding** — "you know nothing after `<date>`; say so honestly"; date-gate retrieval | high / hours | `engine/prompt.ts`, Persona+passport |
| 2 | **Pinned structured fact-sheet** — promote `card.facts` to typed `kind='fact'` rows injected UNCONDITIONALLY every prompt (never relies on cosine) | high / days | `prompt.ts`, `build.service.ts`, `Memory.kind` (migrated) |
| 3 | **Post-generation grounding + style guard** — after `finalText`, check every biographical claim traces to a fact/memory (else rewrite to honest uncertainty) + style checks vs `computeStats` | high / days | `chat.service.ts`, `stats.ts` |
| 4 | **Fix the hallucination feedback loop** — `learnFromTurn` extracts memories from the model's OWN reply → self-reinforcing confabulation. Learn from USER turns + verified facts only (or source-tag low-confidence) | high / hours | `memory.service.ts:97`, `chat.service.ts:488` |
| 5 | **Reflection / consolidation pass** — nightly: top memories → ~5 salient beliefs ("teases when affectionate") as `kind='reflection'` (column exists) | high / days | `memory.service.ts` + cron |
| 6 | **ADD/UPDATE/DELETE/NOOP + bi-temporal supersession** — replace append-only writes; close `validUntil` on contradiction (preserve history, don't replay stale as current) | med / days | `memory.service.ts`, Memory schema |
| 7 | **Word-level language ID for surzhyk** — replace whole-message `detectLang`; capture code-switch rate + switch points + transliteration | med / days | `stats.ts:5`, `prompt.ts` |
| 8 | **NPMI signature-phrase mining + numeric style descriptors** — rank distinctive bigrams/trigrams vs the other author; render stats as imperative rules ("median 4 words; 70% no end punctuation; laughs `)))` not haha") | med / days | `stats.ts`, `prompt.ts`, `extract.ts` |
| 9 | **Anti-drift: decoding knobs + style re-injection** — `logit_bias` ban-list ("Furthermore"/em-dash/"As an AI"), `presence_penalty`, per-call opts; re-inject style rule every few turns (drift is measurable by ~8 turns) | med / hours | `llm.ts` streamChat, `chat.service.ts` |
| 10 | **Session summarize-and-recall** above the 30-message window → "you mentioned last week…" | med / days | `chat.service.ts:33`, `memory.service.ts` |
| 11 | **Style-diverse + situation-matched exemplars** — diversify across registers (greeting/goodbye/emotional/code-switch/terse); also retrieve exemplars whose SITUATION matches the current turn | med / days | `exemplars.ts`, retrieval |
| 12 | **Retrieval re-weighting + recency floor** — memorial event-time is frozen; lower recency weight + floor it so old core facts can't decay to ~0; route by kind (fact=pinned, reflection=boosted) | med / hours | `prompt.ts:90` |
| 13 | **Per-character LoRA "Deep Persona"** (gated paid tier) — see Phase 2 above | high / weeks | `segment.ts` + GPU lane + multi-adapter serving |
| 14 | **Anti-idealization + non-manipulative proactivity + dignified retirement** — keep real rough edges; lint proactive templates vs the 6 manipulative-farewell tactics; a "digital funeral" export/closure flow | med / days | `extract.ts`, `proactive.service.ts` |

---

## New onboarding steps (short, gentle, sequenced easy→heavy; mostly optional)

1. **Signature phrases & pet-names** (first, warm): "A few things they always said? Their
   nicknames for you, a catchphrase, how they'd start/sign off a text." → highest-fidelity
   stylometric signal, the bit miners miss. Appends to `pet_names`/`inside_jokes`/exemplars.
2. **One "they would never"** (optional): a phrase/tone/topic they'd never use → explicit
   guardrail feeding the post-gen consistency guard.
3. **OCEAN confirm-or-nudge** (optional): pre-fill 5 sliders from text, observer-form stems
   ("They got stressed easily"), confirm/nudge not a blank quiz → tightens the weak text-only
   prior. Demoted to a stylometry-gated tie-breaker (don't let it caricature).
4. **Attachment / closeness — "how were they WITH YOU"** (optional): Bartholomew 4-paragraph
   single item + 1–2 closeness items → conditions the DYAD; maps to knobs (anxious →
   +initiative/shorter latency; avoidant → −initiative/longer; closeness → `closenessSeed`).
5. **Episodic anchors** (heaviest, last, very optional): 2–4 narrative prompts, photo-cued,
   "A moment you'd never want to lose." Written as high-importance `kind='fact'` so RAG
   surfaces them. "Too much right now?" exit on every screen.
6. **Dignity & consent + knowledge-cutoff date** (optional): "How would they want to be
   remembered? Anything off-limits?" + capture the death/cutoff date → Cambridge safeguard +
   powers rank-1 grounding.

---

## Evaluation harness (three layers, cheapest-first; "good" = self-consistency band, never 1.0)

Build under `api/test/eval/` + a CLI `npm run eval:persona <personaId>`. **Hold out the last
~15–20% of each corpus by time BEFORE build** (`holdoutFrom` cut) so you never train on test.

- **Layer 1 — Auto stylometry diff (hours; the daily CI driver).** Replay held-out user
  messages; re-run the existing `computeStats()` on generated vs real held-out replies; diff
  medianWords, emoji/topEmoji Jaccard, noTrailingPeriod, bracketSmiles, burstAvg, langMix +
  3 new over-fluency metrics (TTR, message-length burstiness, top-5-word coverage — Qwen
  writes "too well"). **PASS = inside the person's own real-vs-real variance** across two
  disjoint held-out windows. Zero extra API cost.
- **Layer 2 — LLM-judge regression gate (days; CI only, never the verdict).** A non-Qwen
  judge (avoid self-preference) scores 1–5 on Linguistic-Habits, Persona-Consistency, and an
  Echo-specific Hallucination/false-memory axis; anchor levels with mined exemplars; ensemble
  two judges; run both orderings for pairwise (position bias ≤75%); length-match. Gate, not
  truth (best judges ~69% vs humans 90.8%).
- **Layer 3 — Human blind test (rare; the authoritative verdict).** IMPersona protocol for
  deceased targets: a knower rates a blind mix of real-replayed vs Echo replies 1–7
  "definitely AI → definitely human"; tag probes STYLISTIC vs CONTEXTUAL. **Grief-safety:**
  cap exposure (each session erodes the rater's real memory), prefer a *second* knower over
  the bereaved, report as "indistinguishable from archived real messages," not a live Turing
  pass. Add an **identity-stability + memory-traceability probe** and gate releases on it — a
  confident false memory is a safety incident, not a quality nit.
- **Goodhart guard:** rotate held-out windows; freeze one never-touched acceptance slice;
  below ~500 messages use the Layer-1 band only and don't claim a Turing number.

---

## Quick wins (high impact, days, on the current engine)

- **Death-date/cutoff line** in `buildSystemPrompt` + a `deathDate` field (rank 1) — hours.
- **Fix the hallucination loop** — stop `learnFromTurn` learning from the model's reply (rank 4) — hours.
- **Wire the already-migrated `Memory.kind`** — pin `fact`, boost `reflection` in retrieval — hours, no migration.
- **`logit_bias` ban-list + `presence_penalty` + per-call opts** in `llm.ts` (Qwen supports it) — hours.
- **Render computed stats as imperative descriptors** in "## How you text" — hours.
- **Floor + down-weight retrieval recency** so old core facts can't vanish — hours.
- **Stand up the Layer-1 stylometry-diff harness** (reuses `computeStats`) — turns "that's them" into a CI number — hours.
- **Instrument a `PreferencePair` table** now so the DPO corpus accumulates — days.

---

## Open questions (founder calls)

- **Data distribution:** what fraction of real users will have ≥500–1k usable messages? Decides whether the LoRA tier serves a meaningful share.
- **Per-persona language split** (UA / RU / surzhyk / mixed) → LoRA base-model fork + how hard the code-switch work must be.
- **Willing to run a self-hosted/served per-character Qwen + a 3090 training lane** for the premium tier?
- **Fidelity ceiling:** actively CAP realism on high-harm levers (no simulated physical presence, honest-uncertainty default) even at some "that's them" cost? (CHI-2026 says yes.)
- **Who judges the blind test** given deceased targets — the bereaved user (each exposure erodes their memory) or a required second knower?
- **Consent/recipient policy:** gate creation to self/close-kin + block unsolicited "in the dead person's voice" messages to third parties?
- **Provenance UI:** ship a visible "real quoted message vs AI-generated" affordance? (Strongest evidence-backed guard against memory distortion; slightly breaks the illusion.)
- **Tier economics:** "Deep Persona" one-time or subscription, and must retirement/export survive a lapse?

---

## Reading list (read these)

1. **IMPersona: Evaluating Individual-Level LM Impersonation** — https://arxiv.org/abs/2504.04332 — the closest analog: per-person clone from messages, blind Turing test with family judges, 25→44→~70% numbers, ≤6h-gap data recipe, LoRA hyperparams. *This is Echo's training+eval spec* (English-only; swap the base model).
2. **Catch Me If You Can? LLMs Still Struggle to Imitate Implicit Writing Styles of Everyday Authors** — https://aclanthology.org/2025.findings-emnlp.532.pdf — proof prompt-only LLMs fail on ordinary idiolect (collapse to 19–44%) → the case for explicit descriptors + eventual per-person fine-tuning.
3. **Generative Agents: Interactive Simulacra of Human Behavior** — https://arxiv.org/pdf/2304.03442 — source of Echo's retrieval blend + the missing reflection pass (copy the spec for rank 5).
4. **MemGPT: Towards LLMs as Operating Systems** — https://arxiv.org/abs/2310.08560 — core/recall/archival hierarchy → why the fact-sheet must be pinned, not cosine-retrieved (rank 2).
5. **Mem0: Production-Ready AI Agents with Scalable Long-Term Memory** — https://arxiv.org/abs/2504.19413 — the ADD/UPDATE/DELETE/NOOP write pipeline (rank 6) + token-cost numbers.
6. **Zep: A Temporal Knowledge Graph Architecture for Agent Memory** — https://arxiv.org/html/2501.13956v1 — bi-temporal supersession (two columns, no graph DB) — exactly right for a memorial.
7. **Remember You: How Users Use Deadbots to Reconstruct Memories (CHI 2026)** — https://arxiv.org/abs/2603.01017 — the load-bearing harm evidence (AI lines overwrite real memories); why the north star caps fidelity and grounding/provenance are non-negotiable.
8. **Griefbots, Deadbots, Postmortem Avatars (Hollanek & Nowaczyk-Basinska, Cambridge)** — https://link.springer.com/article/10.1007/s13347-024-00744-w — the canonical safeguard checklist (consent, dignified retirement, persistent transparency, no manipulation).
9. **PersonaGym / PersonaScore (+ PersonaEval caveat)** — https://arxiv.org/abs/2407.18416 — the exemplar-anchored 1–5 two-judge rubric for the Layer-2 gate; PersonaEval is why judges gate but never own the verdict.
10. **Measuring and Controlling Persona Drift in Language Model Dialogs** — https://arxiv.org/html/2402.10962v1 — quantifies ~8-turn drift to generic voice + the training-free fixes behind rank 9.
11. **StyleTunedLM: Customizing LLM Generation Style using PEFT** — https://arxiv.org/html/2409.04574v1 — reference design for the per-character LoRA (rank 13): learn style not content, preserve instruction-following.
