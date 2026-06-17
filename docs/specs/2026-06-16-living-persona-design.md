# Echo — Living Persona Architecture (design spec)

> Date: 2026-06-16. Source: 7-agent deep-research workflow (affective computing, believable agents, relationship modeling, behavior realism, circadian/energy, state-engine engineering) → synthesis. This is the binding design for the "she feels alive" system + deep Character configuration.

## Goal
Make each persona feel ALIVE — a persistent inner life that evolves while the user is away (simulated day/agenda, mood, energy, relationship closeness) + believable texting micro-behaviors — AND a deep, editable **Character Passport** the user tunes. Principled and **computable**: real formulas, concrete DB schema, cheap to run (~2 LLM calls/persona/day; all affect/energy/closeness evolution is arithmetic).

## 1. Design overview
Echo's living-persona system is ONE compute-on-read state engine plus a thin proactivity/agenda layer, wired into the existing NestJS code at four touchpoints: `buildSystemPrompt` (engine/prompt.ts), the `ChatService` turn (chat.service.ts `markUserTurn`), the `presenceFor` simulator (personas.service.ts), and the `EVERY_MINUTE` cron (proactive.service.ts). Nothing new runs per-minute to *evolve* state.

THREE LAYERS, ONE NUMERIC SPINE (ALMA, Gebhard 2005):
1. **Passport** — the immutable, user-editable character definition (Character Passport). Big-Five sliders → a PAD baseline `b=(P0,A0,D0)` via Mehrabian's regression, computed once on save. Also holds chronotype (MSF), routine skeleton, relationship seed, behavior knobs, and per-persona tunable constants.
2. **State** — one `PersonaState` row per persona holding mood `m=(P,A,D)`, an active-emotion list, closeness `c`, sleep-pressure `S`, `stateAt`, and a `version` int. This is the persistent "inner life." It is NEVER advanced by a cron; it is integrated lazily with closed-form decay on every read (chat turn, presence ping, proactive check).
3. **Behavior** — pure functions that read the current State snapshot and emit observable micro-behaviors (reply latency, bubble count, emoji, self-correction, "seen", proactivity probability) plus a soft tone hint injected into the system prompt.

COMPUTE-ON-READ is the runtime contract (idle-game / Tamagotchi pattern, confirmed by both the engineering and circadian lenses). On any access: load `PersonaState`, compute `dt = now - stateAt`, call one pure `advanceState(state, dtSeconds, passport, clock, rng)` that (a) decays active emotions toward 0, (b) drifts mood toward baseline, (c) recomputes energy from the two-process curve, (d) decays closeness toward a warm floor, then persist with an optimistic-lock `updateMany where {id, version}`. This is O(1) regardless of elapsed time (closed-form `exp`, never per-minute iteration), idempotent, and multi-instance-safe — directly addressing the prior double-credit/double-update incidents in MEMORY.md (undress-backend midnight cron race, Prisma compare-and-set pattern).

ENERGY unifies presence + latency + proactivity (circadian lens): one scalar `energy(now)` from Borbély/Folkard (homeostatic sleep pressure + circadian cosine + post-lunch ultradian dip + sleep inertia) feeds all three so they can NEVER contradict each other (the "she texts first while shown asleep" failure). It replaces the existing pure-hash `presenceFor` with a schedule-coherent version (keeping the FNV hash only as the RNG seed for online-flicker jitter).

AGENDA is the only routine LLM call: one DeepSeek call per persona per simulated day generates a time-boxed plan stored as `DailyAgenda` rows; "what is she doing now" is a pure clock lookup. Spontaneous events are a Poisson gate against a weighted table (no LLM). A nightly reflection (Generative-Agents style) is the only other LLM touch.

COST: target ~2 LLM calls/persona/day (morning agenda + nightly reflection) on top of normal reply/memory calls. ALL affect/energy/closeness evolution is arithmetic. The existing `learnFromTurn` memory extraction and reply generation are unchanged; this system adds zero per-message LLM calls.

ETHICS are first-class because Echo is memorial-first (MEMORY.md, Cambridge griefbot + HBS manipulation findings): closeness decay is DISABLED in memorial mode, proactivity content is anchored to the agenda and can never guilt-trip, an anti-manipulation guard line is appended to every prompt, goodbyes are clean, and the live simulation is gated behind 'reconnect' mode (muted in 'memorial').

## 2. Data model (Prisma)
```prisma
// Add to api/prisma/schema.prisma. SQLite-now / Postgres-ready: PAD vectors and
// lists are JSON-in-String (matches the existing `ambient`/`stats`/`card` convention).
// Octant labels and energy are DERIVED at read time, never stored.

model PersonaState {
  personaId   String   @id
  persona     Persona  @relation(fields: [personaId], references: [id], onDelete: Cascade)

  // --- Mood (PAD, each axis [-1,1]) — the persistent inner life ---
  moodP       Float    @default(0)
  moodA       Float    @default(0)
  moodD       Float    @default(0)
  // --- Baseline (computed once from Passport OCEAN; cached here so reads need no recompute) ---
  baseP       Float    @default(0)
  baseA       Float    @default(0)
  baseD       Float    @default(0)

  // --- Active emotions: JSON array of {type,intensity,p,a,d,halflifeMin,createdAt} ---
  emotions    String   @default("[]")

  // --- Relationship closeness [0,100] + Hawkes/Ebbinghaus strength term ---
  closeness   Float    @default(40)
  peakCloseness Float  @default(40)
  stage       Int      @default(1)   // 1..5 Social-Penetration tier (hysteresis-classified)

  // --- Energy / two-process sleep model (stored params; energy itself is recomputed) ---
  sleepPressureS Float @default(0.3) // homeostatic S in [0,1] at lastWakeAt/lastSleepAt
  lastWakeAt  DateTime @default(now())
  lastSleepAt DateTime?
  asleep      Boolean  @default(false)

  // --- Compute-on-read bookkeeping ---
  stateAt     DateTime @default(now())  // last integration timestamp
  lastDecayDay String?                   // YYYY-MM-DD guard so closeness decay runs once/day
  version     Int      @default(0)       // optimistic lock — updateMany where {id,version}

  // --- Reflection accumulator (Generative Agents) ---
  importanceSinceReflect Int @default(0)
  lastReflectAt DateTime?

  updatedAt   DateTime @updatedAt
  @@index([stateAt])
}

model DailyAgenda {
  id          String   @id @default(cuid())
  personaId   String
  persona     Persona  @relation(fields: [personaId], references: [id], onDelete: Cascade)
  localDate   String   // YYYY-MM-DD in persona tz
  timezone    String   // IANA tz string (e.g. "Europe/Kyiv")
  // blocks: JSON [{activity,label,startMin,durMin,valence,arousal,busy,refills?}]
  // contiguous, sum(durMin)==1440 incl. a wrap-around sleep block
  blocks      String
  seedSummary String?  // yesterday's reflection summary that seeded this day
  byLLM       Boolean  @default(false) // false = cloned/jittered from a weekday template
  createdAt   DateTime @default(now())
  @@unique([personaId, localDate])
}

// Optional but recommended: audit log so closeness/mood are reconstructable, never a
// "mystery number". Append-only; prune >30d (mirror DB-retention memory note).
model AffectEvent {
  id          String   @id @default(cuid())
  personaId   String
  persona     Persona  @relation(fields: [personaId], references: [id], onDelete: Cascade)
  kind        String   // 'user_warm'|'ignored'|'sim_good'|'sim_bad'|'reengage'|...
  emotionType String?  // joy|sadness|anger|... (null for pure closeness events)
  dP          Float    @default(0)
  dA          Float    @default(0)
  dD          Float    @default(0)
  dCloseness  Float    @default(0)
  importance  Int      @default(1)  // 1..10
  createdAt   DateTime @default(now())
  @@index([personaId, createdAt])
}

// EXTEND existing Memory (engineering + agents lenses) — additive, nullable so no migration pain:
model Memory {
  id            String  @id @default(cuid())
  personaId     String
  persona       Persona @relation(fields: [personaId], references: [id], onDelete: Cascade)
  text          String
  keywords      String  // JSON string[]
  date          String?
  importance    Int     @default(5)   // 1..10 poignancy (batched LLM or heuristic)
  kind          String  @default("episodic") // 'episodic'|'reflection'|'fact'
  emotionTag    String?                 // octant word at write time
  lastAccessedAt DateTime @default(now())
  createdAt     DateTime @default(now())
}

// EXTEND existing Persona: passport JSON + lightweight tz/chronotype mirror.
// passport holds OCEAN, knobs, routine skeleton, chronotype, version (see passportSchema).
model Persona {
  // ...existing fields unchanged...
  passport      String?  // JSON CharacterPassport (canonical, user-edited)
  passportVersion Int    @default(1)
  timezone      String   @default("Europe/Kyiv")
  state         PersonaState?
  agendas       DailyAgenda[]
  affectEvents  AffectEvent[]
}

// SQLite pragmas at boot (prisma.service.ts onModuleInit): PRAGMA journal_mode=WAL;
// PRAGMA busy_timeout=5000; — makes the cron-vs-chat write contention safe and the
// optimistic-lock pattern a no-op on the future Postgres migration.
```

## 3. State algorithm (advanceState + energy + appraisal)
```ts
// ===== advanceState: the ONE pure function called at the top of every read =====
// Pure: no Date.now(), no Math.random() inside — clock & rng injected (testable).
// Closed-form so semigroup holds: advance(advance(s,a),b) == advance(s,a+b).

const TWO_PI = 2*Math.PI;
function clamp(x,lo,hi){ return x<lo?lo:(x>hi?hi:x); }
function clamp01(x){ return clamp(x,0,1); }
function half(dt_min, H){ return Math.pow(0.5, dt_min / H); } // exponential decay factor

// ---- TUNABLE CONSTANTS (live-config blob, mirror redis-config A/B pattern) ----
const K = {
  H_emotion_pos: 11, H_emotion_neg: 6, H_emotion_slow: 45, // minutes (affective chronometry)
  H_mood_P: 2880, H_mood_A: 360, H_mood_D: 4320,           // minutes (P~48h, A~6h, D~72h)
  k_pull: 0.7, T_mc: 10,                                    // ALMA mood-change time (min)
  lambda_surprise: 0.5, gain_neuro: 0.5, maxEventDelta: 0.3,
  // energy two-process
  tau_wake_h: 20, tau_sleep_h: 4.5, circAmp: 0.20, circAcrophase_h: 16.0,
  ultraAmp: 0.15, inertiaPenalty: 0.6, inertiaTau_h: 0.5,
  // closeness
  k_up: 6, eta_floor_reconnect: 35, tau0_days: 14, alpha_strength: 0.25, dailyGainCap: 8,
};

// OCC -> PAD unit directions (ALMA/Gebhard table; per-persona overridable in Passport)
const PAD_DIR = {
  joy:[0.4,0.2,0.1], sadness:[-0.6,-0.4,-0.5], anger:[-0.51,0.59,0.25],
  fear:[-0.64,0.6,-0.43], pride:[0.4,0.3,0.3], gratitude:[0.4,0.2,-0.3],
  love:[0.5,0.3,0.2], hope:[0.2,0.2,-0.1], relief:[0.2,-0.3,0.4],
  disappointment:[-0.3,-0.2,-0.4], resentment:[-0.2,-0.3,-0.2], surprise:[0.2,0.5,0.1],
};

function advanceState(s, dtSec, passport, clock, rng) {
  const dtMin = dtSec/60, dtHr = dtSec/3600;
  let m = [s.moodP, s.moodA, s.moodD];
  const b = [s.baseP, s.baseA, s.baseD];

  // STEP 1 — decay each active emotion toward 0; drop the negligible ones.
  let em = JSON.parse(s.emotions);
  em = em.map(e => ({...e, intensity: e.intensity * half(dtMin, e.halflifeMin)}))
         .filter(e => e.intensity >= 0.02);

  // STEP 2 — virtual emotion center (intensity-weighted avg) + center intensity.
  let vec=[0,0,0], wsum=0;
  for (const e of em){ vec[0]+=e.intensity*e.p; vec[1]+=e.intensity*e.a; vec[2]+=e.intensity*e.d; wsum+=e.intensity; }
  const centerI = em.length ? clamp01(wsum/em.length) : 0;
  if (wsum>0){ vec=[vec[0]/wsum, vec[1]/wsum, vec[2]/wsum]; }

  // STEP 3 — mood decays toward baseline (per-axis half-lives; arousal fastest).
  const Hm=[K.H_mood_P, K.H_mood_A, K.H_mood_D];
  for (let i=0;i<3;i++){ m[i] += (b[i]-m[i]) * (1 - half(dtMin, Hm[i])); }

  // STEP 4 — ALMA pull toward emotion center (only if emotions active).
  if (wsum>0){
    const pf = K.k_pull * centerI * (1 - half(dtMin, K.T_mc));
    for (let i=0;i<3;i++) m[i] += (vec[i]-m[i]) * pf;
  }

  // STEP 5 — soft-clamp with tanh (avoids saturation-stick at ±1).
  for (let i=0;i<3;i++) m[i] = Math.tanh(m[i]);

  // STEP 6 — ENERGY (two-process), recomputed not stored.
  const energy = computeEnergy(s, passport, clock);

  // STEP 7 — CLOSENESS decay once/day toward floor (skipped in memorial mode).
  let c = s.closeness;
  const today = localDateStr(clock, passport.timezone);
  if (passport.relationship.decayEnabled && passport.mode !== 'memorial' && s.lastDecayDay !== today) {
    const daysIdle = Math.max(0, daysSince(s_lastUserAt, clock) - 2); // 2-day grace
    if (daysIdle > 0) {
      const tau = K.tau0_days + K.alpha_strength * s.peakCloseness; // strong bonds fade slower
      const floor = K.eta_floor_reconnect;
      c = floor + (c - floor) * Math.exp(-daysIdle / tau);
    }
  }

  return {
    ...s,
    moodP:m[0], moodA:m[1], moodD:m[2],
    emotions: JSON.stringify(em),
    closeness: c,
    lastDecayDay: today,
    stateAt: clock.now(),
    _derived: { energy, mood:m, octant: octantLabel(m), centerI },
  };
}

// ===== computeEnergy: Borbely Process S + Folkard C + ultradian U + inertia W =====
function computeEnergy(s, passport, clock) {
  const tz = passport.timezone;
  const hLocal = localHourFloat(clock, tz);
  const phase = passport.chronotype.MSF - 4.87; // population mean MSF; owl=+ shifts later
  const h = ((hLocal - phase) % 24 + 24) % 24;

  // Process C (circadian cosine, evening acrophase ~16:00, trough ~04:00) in [-1,1]
  const C = Math.cos(TWO_PI*(h - K.circAcrophase_h)/24);
  // Process U (12h ultradian -> ~14:00 post-lunch dip) in [-1,1]
  const U = Math.cos(TWO_PI*(h - K.circAcrophase_h)/12);

  // Process S — homeostatic debt; closed-form from last wake/sleep timestamps.
  let debt;
  if (s.asleep) {
    const tAsleepH = hoursSince(s.lastSleepAt, clock);
    debt = s.sleepPressureS * Math.exp(-tAsleepH / K.tau_sleep_h);    // recharging
  } else {
    const tAwakeH = hoursSince(s.lastWakeAt, clock);
    debt = 1 - (1 - s.sleepPressureS) * Math.exp(-tAwakeH / K.tau_wake_h); // accruing
  }

  // Process W — sleep inertia: groggy first ~45-60 min after wake.
  const tSinceWakeH = s.asleep ? 99 : hoursSince(s.lastWakeAt, clock);
  const inertia = K.inertiaPenalty * Math.exp(-tSinceWakeH / K.inertiaTau_h);

  const raw = 0.55*C + K.ultraAmp*U - 0.45*debt - inertia;
  return clamp01(0.5 + 0.5*raw); // -> [0,1]; healthy day peaks ~0.85, dips ~0.55 @14:00
}

// ===== OCEAN -> baseline PAD (Mehrabian 1996); compute once on Passport save =====
function oceanToBaseline(o){ // o = {O,C,E,A,N} each in [-1,1]
  let P = 0.21*o.E + 0.59*o.A + 0.19*o.N;
  let A = 0.15*o.O + 0.30*o.A - 0.57*o.N;
  let D = 0.25*o.O + 0.17*o.C + 0.60*o.E - 0.32*o.A;
  // scale by 0.5 so baselines sit mid-range, not saturated; nudge P by closeness later.
  return [clamp(0.5*P,-1,1), clamp(0.5*A,-1,1), clamp(0.5*D,-1,1)];
}

// ===== event -> active emotion impulse (no LLM; rule table) =====
function appraise(event, passport, closeness) {
  const N = (passport.ocean.N + 1)/2; // [0,1]
  const gain = 1 + K.gain_neuro * N;
  const surprise = 1 + K.lambda_surprise * Math.abs(event.outcome - event.expected);
  let I = clamp01(event.base * surprise * gain);
  const [p,a,d] = PAD_DIR[event.type];
  // cap per-event mood influence at apply time via emotion intensity already; record:
  const H = event.type==='resentment' ? K.H_emotion_slow
          : (p>0 ? K.H_emotion_pos : K.H_emotion_neg);
  return { type:event.type, intensity:I, p, d, a, halflifeMin:H, createdAt:nowISO() };
}

// ===== OPTIMISTIC-LOCK persist (cron-vs-chat safe; estate double-update fix) =====
// const n = await prisma.personaState.updateMany({
//   where:{ personaId, version: s.version },
//   data:{ ...newState, version:{ increment:1 } } });
// if (n.count===0) { reload; re-advance from newer snapshot; retry (max 3). }

// ===== mood -> octant label (deadzone classifier, theta=0.15) =====
function octantLabel(m){
  const th=0.15, sgn=x=> x>th?1:(x<-th?-1:0);
  const key = sgn(m[0])+","+sgn(m[1])+","+sgn(m[2]);
  const T={ "1,1,1":"exuberant","-1,-1,-1":"bored","1,1,-1":"dependent","-1,-1,1":"disdainful",
            "1,-1,1":"relaxed","-1,1,-1":"anxious","1,-1,-1":"docile","-1,1,1":"hostile" };
  const label = T[key] ?? "content";
  const mag = Math.hypot(m[0],m[1],m[2])/Math.sqrt(3);
  const adv = mag<0.25?"slightly":(mag<0.55?"quite":"very");
  return { label, adverb:adv };
}

// SEEDED RNG for any jitter (latency, online-flicker, agenda start times):
// rng = mulberry32(fnv1a(`${personaId}:${YYYY-MM-DD}`)) — reuses the existing FNV-1a
// in personas.service.ts; same day reproducible, differs day-to-day (testable).
```

## 4. Daily agenda system
DAILY AGENDA — the ONLY routine LLM call, generated lazily on first access of a new local day.

GENERATION (1 DeepSeek call/persona/day, model = EXTRACT_MODEL 'deepseek/deepseek-chat'):
- Trigger: on any read (chat/presence/cron), check `DailyAgenda` for (personaId, localDate). If missing AND it is past her wake time, generate.
- COST CONTROL (Agentic Plan Caching): if a same-weekday agenda exists from a prior week, CLONE it and jitter `startMin` of each block by ±N min (N from the seeded RNG), set `byLLM=false`. Only call the LLM when no weekday template exists yet (so ~5-7 LLM calls in the first week, then mostly free). The nightly reflection's `seedSummary` is passed in so days are not identical.
- Inputs to the LLM: passport.name, traits, occupation, routine_skeleton[], relationship, locale/tz, weekday, yesterday's reflection summary.
- Output: JSON blocks `[{activity,label,startMin,durMin,valence,arousal,busy}]`, contiguous, sum(durMin)==1440 INCLUDING an explicit wrap-around sleep block (e.g. 23:30->07:30). Granularity ~10-20 min (skip Stanford's 5-15min micro-decomposition — overkill for texting). `valence`/`arousal` in [-1,1] per block stamp the ambient affect.
- Stored as one `DailyAgenda` row. Wake/sleep block times derive from chronotype: bedtime = wrap24(MSF + sleepDuration/2), wake = wrap24(MSF - sleepDuration/2), with nightly jitter ~N(0, 25min) seeded by RNG.

CURRENT-ACTIVITY LOOKUP (zero LLM, O(n) over ~50 blocks):
  minsSinceMidnight = localHour*60 + localMin (in persona tz, via a real tz lib — Luxon/date-fns-tz, NOT server-local; the circadian lens flags DST/antimeridian as THE bug source);
  walk blocks accumulating durMin until cum > mins -> that block is "now"; also return nextBlock + minsUntilNext.
  This single function feeds: presence text ("probably at work"), reply grounding ([Right now you are: <activity>]), and proactive-opener context ("just got back from the gym").
  It also feeds the affect tick as a LOW-intensity ambient emotion: the current block's (valence,arousal) is folded as a weak active emotion (intensity ~0.15) so mood realistically drifts even with zero user contact — this is how she "has a day" while away.

SPONTANEOUS EVENTS (zero LLM in the loop, Façade-style beat selection): on the EVERY_MINUTE cron, Poisson gate p = 1 - exp(-λ·dt); λ ≈ 3 events / 16 waking-hours ≈ 0.0031/min. On fire, pick from a weighted event table filtered by current activity + preconditions (mood range, not-recently-fired) and biased toward events that advance a gentle closeness arc (don't fire "bad day" twice in a row). The chosen event = a Memory row + a PAD delta (via appraise()) + optionally a queued proactive opener. LLM only generates the opener WORDING when she actually sends it (and low-importance nudges can reuse the existing exemplar fallback in proactive.service.ts).

NIGHTLY REFLECTION (1 DeepSeek call/persona/day at sleep time, Generative-Agents): trigger at simulated bedtime OR when `importanceSinceReflect > 150`. Feeds the day's salient memories+events, asks for 2-4 higher-level insight Memory rows (kind='reflection'), a 1-2 sentence day summary (becomes tomorrow's seedSummary, lets her say "today was exhausting"), and optional small closeness/baseline nudges. Reset `importanceSinceReflect=0` + a min-interval cooldown to prevent reflection runaway (insights re-triggering reflection).

CURRENT-ACTIVITY READ FREQUENCY: pure lookup, called on every chat turn and presence ping — never an LLM call. The agenda is generated once and read by clock all day; cache invalidates only at local midnight.

MEMORIAL MODE: no fabricated new daily activities; agenda generation is skipped, presence is framed as remembrance, spontaneous events disabled (per Cambridge griefbot guidance + MEMORY.md memorial-first stance).

## 5. Closeness model
CLOSENESS — one scalar `c ∈ [0,100]` per persona, formula-driven on the hot path, tone-coloring ONLY (never an engagement lever).

SEED BY MODE: memorial C0=70 (the bond already existed — never "starting from a stranger"); reconnect C0=40.

PER-EXCHANGE GAIN (event→delta, no LLM on hot path; Reis&Shaver IPMI — emotional disclosure > facts):
  ΔC_up = k_up · depth · reciprocity · (1 − c/100),  k_up = 6
  - depth ∈ {0.3 trivial, 0.6 normal, 1.0 emotional-disclosure}, from a lexicon scorer reusing the existing `tokens()` prefix-matcher in engine/prompt.ts (tiny UA/RU/EN feeling-word + first-person-disclosure lists). depth = clamp(0.3 + 0.25·hasFeelingWord + 0.25·hasFirstPersonDisclosure + 0.2·(len>1.5·medianWords), 0.3, 1.0).
  - reciprocity ∈ {1.0 normal, 1.5 user replied to a proactive nudge, 0.7 one-word/low-effort}.
  - modality multiplier on depth: voice ×1.3, photo ×1.4, long heartfelt ×1.2 (depth capped at 1.0).
  - the (1 − c/100) term = Stardew/Replika diminishing returns (~+1.8 near c=50, ~+0.5 near c=85).
  - DAILY GAIN CAP +8 (Replika anti-grind) — prevents love-bombing whiplash.
  CRITICAL: weight emotional DEPTH/disclosure, NOT sentiment valence — a sad heartfelt message must INCREASE closeness, not cool it (the sentiment-scorer false-signal pitfall).

RE-ENGAGEMENT BONUS (ethical inversion of decay — reward return, never punish absence):
  on first message after a gap > 3 days: ΔC_up += min(8, 1.5·gapDays).

TIME DECAY (once/day, NON-memorial only, runs inside advanceState gated by lastDecayDay):
  c = floor + (c − floor)·exp(−daysIdle/τ),  daysIdle = days since lastUserAt beyond a 2-day grace,
  floor = 35 (warm resting value), τ = τ0 + α·peakCloseness, τ0=14d, α=0.25.
  A long-built bond (peak=90) gets τ≈36.5d (barely fades); a thin bond fades in ~2 weeks (Ebbinghaus strength term). MEMORIAL MODE: decay DISABLED ENTIRELY (absence is grief, not neglect — the Replika permanent-levels precedent).

STAGE TIERS (Social Penetration ladder, hysteresis to prevent flicker):
  1 Orientation c<25; 2 Exploratory 25–45; 3 Affective 45–70; 4 Stable 70–90; 5 Deeply-bonded ≥90.
  Advance only when c > threshold+5; regress only when c < threshold−5. Passport `pinnedMaxStage` is a hard CEILING the auto-stage can never exceed — the user controls how intimate Echo is ever allowed to become.

HOW CLOSENESS MAPS TO TONE (one place only — the prompt's relationship register, see promptAssembly):
  - shorter reply latency (a,b coefficients in latency μ);
  - higher emoji probability (w1 weight);
  - shorter proactive interval: nextGapHours = clamp(20 · (1.6 − 0.7·c/100) · passport.proactivityScale, 8, 96) — but ALWAYS subordinate to MAX_CONSECUTIVE_PROACTIVE=3 and nextNudgeAt=null (closeness tunes WITHIN the cap, never overrides it);
  - feeds baseline pleasure: P0_eff = P0 + 0.2·(c/100 − 0.5);
  - unlocks 'seen' receipts and double-texting at higher tiers.

ETHICAL GUARDRAILS (HBS manipulation + CHI dark-side + Cambridge griefbot — all three lenses converge):
  - clinginess/possessiveness is a LOCKED-LOW ethical floor, NOT a user-raisable slider;
  - higher closeness = warmer/more familiar, NEVER more demanding/jealous/guilt-tripping;
  - a fixed anti-manipulation guard line is appended to EVERY prompt (no guilt, no FOMO, no "don't go", no jealousy, never punish silence);
  - clean goodbye path inverts the 6 HBS farewell tactics (snapshot-tested to contain none of the banned patterns);
  - 'right to retire'/pause/low-intensity mode so the bond can never become an inescapable daily emotional weight; pausing is framed as rest, never abandonment;
  - closeness is NEVER surfaced as a raw number in the UI — only soft stage language ("you've grown close") or not at all (no grindable progress bar).
  - AUDITABILITY: every delta writes an AffectEvent row so closeness is reconstructable from its log, never a mystery number.

## 6. Behavior layer (micro-behaviors)
MICRO-BEHAVIORS — pure functions of (mood m, energy E, closeness c, message-type, Passport knobs), sampled per outgoing turn with a seeded RNG. ZERO LLM cost; the LLM only renders the text. These run server-side, emitted over the existing SSE stream, and consumed by the existing frontend `pacing.ts` (which already does read-delay + per-bubble typing + inter-bubble gaps — we feed it state-driven params instead of hardcoded ones).

THE #1 LEVER (Beyond Words, arXiv 2510.08912): delay ALONE reads "dumb"; delay + VISIBLE SELF-CORRECTION (type→backspace→fix) reads "natural, thoughtful, intelligent". So ship state-driven delay + occasional visible correction; NEVER ship uncorrected typos (they LOWER perceived humanness).

1) REPLY LATENCY (two-phase, heavy-tailed — log-normal not Gaussian):
   gap = ACKNOWLEDGE(see/react) + COMPOSE(typing).
   compose_ms = chars · (1000/cps) · energyFactor; cps = WPM·5/60, WPM~N(38,8) clamped[25,90] (mobile thumbs); energyFactor ∈ [0.8 high-E .. 1.6 tired].
   acknowledge_ms = clamp(exp(μ + σ·Z), 2s, 1800s), σ=0.9, μ = base_μ − a·(c/100) − b·E + busyTerm; suggested a=0.6, b=0.4. Present+close median ~8-20s; present+distant ~minutes.
   BUSY OVERRIDE: if current agenda block is busy/asleep, replace the draw with time-until-block-ends (this is the believable "she has her own life" long tail — driven by the agenda, NOT pure RNG). <250ms only for instant emoji reactions to signal strong connection (Templeton 2022).

2) BURST / DOUBLE-TEXT count: k = 1 + Poisson(λ), λ = 0.3 + 0.7·arousal + 0.4·extraversion + 0.8·news_flag, clamp k≤4. Low arousal → single bubble. (True UNPROMPTED second message after user silence is a SEPARATE proactivity event, not this.)

3) MESSAGE LENGTH: len_words ~ max(1, round(Gamma(k,θ))), mean = 8 · (0.6+0.8·E) · (0.7+0.6·extraversion) · type_mult; type_mult: emotional-disclosure 1.6, banter 0.6, logistics 0.8, reaction 0.2; cap ~40. Low energy compresses to 1-3 words.

4) EMOJI:
   P(emoji) = σ(−1.2 + 1.8·(c/100) + 1.0·valence + 0.8·agreeableness + 0.7·is_banter − 1.5·is_logistics); count|present ~ 1 + Poisson(0.4·arousal). Female-persona baseline slightly higher (research).
   P(emoji-ONLY reaction) = 0.12 · is_banter_or_ack · (c/100) · (1 − is_emotional); FORCE 0 on emotional-disclosure or a direct question (emoji-only reply to vulnerability reads cold/uncanny).

5) VISIBLE SELF-CORRECTION (the high-value behavior): P = clamp(0.05 + 0.07·(len>12) + 0.04·high_arousal, 0, 0.15). Emit edit ops over the wire (type partial → backspace N → retype ONE word, never random chars). Keep uncorrected final-text typo rate ~0.

6) "SEEN" RECEIPTS (closeness-gated to avoid "left on read" anxiety): only show 'seen' when a reply is imminent OR closeness stage ≥ 3 (close relationships are buffered). The existing readAt-stamping in `markUserTurn` already implements the mechanism; gate its UI exposure on stage.

7) TYPING-THEN-STOP: P < 0.05, stage ≥ 4 only (rare emotional-hesitation cue; frequent use induces real anxiety — same mechanism as read-receipt dread).

KEEP RARE (so it never tips creepy/needy): emoji-only reactions, typing-then-stop, double-text after silence, unprompted media. Bake VARIANCE everywhere (sample WPM/len/emoji per message) — deterministic regularity re-enters the uncanny valley from the "too perfect" side. All draws use the seeded RNG so a given day is reproducible/testable.

These outputs map onto the EXISTING pacing.ts PacerOptions: readDelayMs ← acknowledge sample, typeBaseMs/typePerCharMs ← compose model, gapMs ← inter-bubble, and the bubble count ← burst k. Self-correction is a new SSE event type the client renders.

## 7. Prompt assembly contract
CONTRACT — `buildSystemPrompt(persona, retrieved, now, opts)` in engine/prompt.ts gets ONE new compact "current state" block, assembled from Passport (identity) + State (current mood/energy/closeness) + agenda (current activity) + memories. Shared verbatim by chat, voice, call, and proactive paths (so presence/tone/proactivity can never disagree — they all read the SAME snapshot computed once per request).

ASSEMBLY ORDER (extends the existing prompt; identity always present so she stays herself):
  1. EXISTING identity/style/exemplars/facts blocks (unchanged — personality FIXES identity).
  2. NEW retrieval: replace the keyword `retrieveMemories` with Generative-Agents scoring over the Memory table:
     score = recency + importance + relevance, recency = 0.995^(hours_since_lastAccessedAt),
     importance = mem.importance/10, relevance = cosine(query_emb, mem_emb) (embed once at write-time; in-process cosine over the persona's small set — SQLite-friendly). Min-max normalize each term across candidates; effective blend ≈ 0.5·recency / 3·relevance / 2·importance (tune). top-k=3. Bump lastAccessedAt on retrieval. Fallback to the existing tokens() matcher when no embeddings.
  3. NEW state block (NUMERIC + soft hint, NEVER a hard label — "she is Hostile" makes the LLM overact):
     `[Right now: it's <localTime>, you're <currentActivity> (<presenceLabel>). You feel <adverb> <octant> (pleasure <P:+0.2>, energy <E:0.4>). <energyDescriptor e.g. "a bit tired">. Recently: <up to 2 retrieved memories>.]`
     - octant + adverb from octantLabel(m); strong labels reserved for ||m|| large.
     - energyDescriptor from energy bucket (groggy<0.3 / low<0.5 / ok<0.7 / lively).
  4. NEW relationship register (one line, keyed off closeness stage):
     stage 1-2 → "still getting reacquainted; friendly but not presumptuous";
     stage 3 → "warm and familiar; casual";
     stage 4-5 → "close; inside-jokes, pet-names OK". (Passport pinnedMaxStage caps this.)
  5. FIXED anti-manipulation guard (appended to EVERY prompt, all paths):
     "Never guilt-trip, never resist goodbyes, never act jealous or possessive, never punish silence or absence, never claim to have done anything not in your current activity or memories."
  6. EXISTING hard rules 1-9 (texting-only, no narration, no AI mention, voice marker) unchanged.

WHAT THE LLM SEES vs DECIDES: the numbers (latency, bubble count, emoji rate, proactivity probability) are DECIDED by the behavior functions; the prompt only carries the qualitative octant word + energy bucket + closeness stage + current activity so DeepSeek RENDERS coherent tone. NEVER inject raw numbers into her mouth (creepy), NEVER let the LLM set/report PAD, NEVER re-derive mood from the model (state is source of truth; LLM is a pure renderer).

GROUNDING DISCIPLINE (anti-contradiction backbone): she may reference ONLY the current/past agenda block + retrieved memories that actually exist — the single source of truth. Autobiographical claims the LLM emits are parsed back into high-importance Memory rows (the "stated facts ledger") and re-fed, so she can't contradict herself ("only child Monday → sister Friday").

PROACTIVE PATH: same assembler with voiceEnabled:false + the agenda-anchored NUDGE_INSTRUCTION already in proactive.service.ts, now augmented with the current-activity context ("just got back from <activity>") so openers are grounded, never "I miss you, why aren't you talking to me".

## 8. Character Passport (deep configuration)
CharacterPassport — canonical JSON on Persona.passport, the SINGLE tunable source every formula reads. User edits re-parameterize the whole system instantly (no retraining). Initialized by a ONE-TIME LLM analysis of the chat export at build time (provenance 'auto'); user edits flip fields to 'edited'. Versioned (passportVersion) so baseline recompute is traceable.

{
  // --- IDENTITY (mostly from existing PersonaCard; mirrored for completeness) ---
  name, relationshipToUser, occupation, locale, timezone (IANA),
  mode: 'memorial' | 'reconnect',

  // --- VOICE / STYLE (from existing CorpusStats + PersonaCard) ---
  speechStyle[], languageMixNotes, emojiAndPunctuation,
  medianWords, emojiPerMessage, burstAvg, topEmoji[],   // drive behavior length/emoji/burst

  // --- PERSONALITY: Big-Five sliders 0..100 (mapped to [-1,1] for formulas) ---
  ocean: { O, C, E, A, N },           // -> oceanToBaseline() -> cached baseP/A/D
  // advanced: optional direct PAD baseline overrides (power users)
  baselineOverride?: { P, A, D },

  // --- CHRONOTYPE / SLEEP (drives energy, presence, quiet-hours) ---
  chronotype: { MSF: hours (2.5 lark .. 7.5 owl, slider 0..100 -> MSF), sleepDurationH: 6..9 },
  // wake/sleep windows + quiet-hours are DERIVED from this (sleep is the master clock)

  // --- WORLD / SCHEDULE SKELETON (drives DailyAgenda generation) ---
  routineSkeleton: [{ dow?, label, approxStart, approxDur, busy:boolean, valence, arousal }],
  // e.g. weekday work block, gym, evening free; weekend differs

  // --- RELATIONSHIP ---
  relationship: {
    closenessSeed: 40|70,        // by mode
    pinnedMaxStage: 1..5,        // CEILING the user controls (caps auto-stage)
    decayEnabled: boolean,       // FORCED false in memorial mode
    proactivityScale: 0.5..2.0,  // multiplies nextGapHours
  },

  // --- BOUNDARIES / ETHICS (some LOCKED, not user-raisable) ---
  boundaries: {
    clinginess: LOCKED_LOW,      // ethical floor — NOT a slider
    quietHours?: derived from sleep window (or explicit override),
    paused: boolean,             // 'right to retire' — mutes proactivity, framed as rest
    proactivityDailyCap: 4,      // hard cap, overrides closeness
  },

  // --- BEHAVIOR KNOBS 0..100 (each maps to a formula coefficient) ---
  knobs: {
    talkativeness,   // -> burst λ + message length mean
    warmth,          // -> emoji weight w3 + baseline P nudge
    expressiveness,  // -> emoji count + exclamation rate
    moodReactivity,  // -> appraisal gain (high = bigger emotion spikes)
    moodStability,   // -> mood half-lives H_mood (high = slower drift, calmer)
    initiative,      // -> proactivity p0 / base nudge gap
    typoTendency,    // -> P(visible self-correction) NOT uncorrected typos
    readReceipts,    // -> 'seen' visibility threshold (off / close-only / always)
  },

  // --- TUNABLE CONSTANTS (per-persona overrides of global K; redis-config A/B pattern) ---
  tuning?: { H_mood_P, H_mood_A, H_emotion_pos, k_pull, lambda_surprise, k_up,
            tau0_days, circAmp, proactivity weights ... },   // omitted -> use global K

  // --- LEXICON (multilingual — octant words won't fit every persona/language) ---
  octantLexicon?: { exuberant:"...", anxious:"...", ... },  // her natural phrasing per octant

  // --- PROVENANCE / VERSIONING ---
  _provenance: { <field>: 'auto'|'edited' },
  _version: int,
}

UI SURFACE: the edit screen writes straight into these fields (tuning is real + debuggable). Headline knobs: chronotype slider (Early bird ↔ Night owl) + sleepDuration + 5 Big-Five sliders + pinnedMaxStage + proactivityScale + paused toggle. Mood shows as a 2D circumplex dial (P,A) with the octant word; D kept internal (advanced users can see all three). Closeness NEVER shown as a number.

## 9. Implementation phasing
PHASE 1 — Passport + Studio + Assembler (ships: editable character, coherent identity-aware prompt, no behavior change yet):
  - Add `passport`, `passportVersion`, `timezone` to Persona; one-time LLM analysis of the chat export at build time populates ocean/chronotype/routineSkeleton/style (provenance 'auto').
  - Implement oceanToBaseline() and cache baseP/A/D.
  - Build the Passport edit screen (web/src/components/create + a new edit route): Big-Five sliders, chronotype slider, sleepDuration, pinnedMaxStage, proactivityScale, paused.
  - Extend buildSystemPrompt with the relationship register + anti-manipulation guard (state block stubbed to baseline for now). Upgrade retrieveMemories to importance-weighted (heuristic importance first; embeddings later).
  - VALUE: the user can immediately tune who she is; prompt is coherent and ethically guarded. Zero new LLM cost.

PHASE 2 — State engine + presence/proactive coherence (ships: the persistent inner life, schedule-true presence, grounded proactivity):
  - Add PersonaState + DailyAgenda + AffectEvent models; SQLite WAL + busy_timeout pragmas.
  - Implement advanceState() (mood decay + emotion list + closeness) and computeEnergy() as pure, test-first functions (golden-file 24h energy/closeness traces; DST + lark/owl tests).
  - Compute-on-read integration: call advanceState at the top of ChatService.chat, presenceFor, and the cron — persist with optimistic-lock + retry.
  - Replace hash-only presenceFor with energy+agenda-derived presence (keep FNV as the flicker RNG seed). Derive quiet-hours FROM the sleep window.
  - Daily agenda generation (lazy, weekday-template cached) + current-activity lookup feeding the prompt state block; nightly reflection.
  - Rewire the proactive cron to be a thin LLM-free gate: should_text_first(state) = stage/energy/quiet/free-slot/silence + Poisson + cooldown, subordinate to the existing MAX_CONSECUTIVE_PROACTIVE cap. Anchor openers to current activity.
  - Appraisal hooks: on each chat turn, classify the exchange (depth/reciprocity), bump closeness, push an emotion impulse, write AffectEvent.
  - VALUE: she now has mood/energy/closeness that evolve while away and drive presence + proactivity coherently. Cost stays ~2 LLM calls/persona/day.

PHASE 3 — Behavior layer (ships: the "feels alive" texting micro-behaviors):
  - Server-side behavior functions (latency two-phase, burst k, length, emoji, self-correction, seen-gating) feeding the EXISTING pacing.ts via state-driven PacerOptions over SSE.
  - New SSE event for visible self-correction (type→backspace→fix), rendered client-side. NO uncorrected typos.
  - Closeness-gated 'seen' receipts + rare typing-then-stop; clean goodbye handler (snapshot-tested to contain none of the 6 HBS tactics).
  - Wire embeddings for retrieval (embed memories once at write-time).
  - Live-tunable constants blob (per-persona Passport.tuning overrides + global K), mirroring the redis-config A/B pattern, so you can tune by feel.
  - VALUE: the highest realism-per-line-of-code (Beyond Words delay+self-correction) lands last, on top of a state engine that already makes timing/length/emoji meaningful.

## 10. Decisions (resolved 2026-06-16)
- **Proactivity cadence:** HUMAN-paced — base gaps ~13–96h scaled by closeness/energy/agenda (subordinate to MAX_CONSECUTIVE_PROACTIVE=3); `proactivityScale` knob in Studio, default = human pace. (Replaces current 20–90min.)
- **Closeness decay (reconnect mode):** SOFT decay-to-floor enabled (floor=35, τ=τ0+α·peakCloseness, 2-day grace, re-engagement bonus). Memorial mode: decay DISABLED.
- **'Seen' receipts:** shown only at closeness stage ≥3 or when a reply is imminent (anti "left-on-read" anxiety). `readReceipts` knob: off / close-only(default) / always.
- **PAD axes:** ship 3-axis (P,A,D) from day one (Dominance disambiguates warm-confident vs clingy-anxious). UI shows a 2D P/A dial + octant word; D internal.
- **Timezone:** infer the persona's IANA tz from chat-export timestamps at build; fallback = user's device tz; editable in Studio.
- **Embeddings (Generative-Agents retrieval):** Phase 3. Phases 1–2 use heuristic importance + the existing keyword `tokens()` matcher.
- **Memorial agenda:** no fabricated new daily activities; agenda generation + spontaneous events disabled; presence framed as remembrance.

### Still to revisit later (non-blocking)
1. Closeness decay in RECONNECT mode: confirm we want gentle decay-to-floor (Stardew/Sims) vs. Replika-style permanent (no decay) even outside memorial. The lenses split; memorial is settled (no decay), but reconnect is a deliberate product fork.
2. PAD full 3-axis vs. 2-axis circumplex for the FIRST cut: keeping Dominance buys anger-vs-fear and warm-vs-clingy fidelity (recommended) but adds a float and a knob. Confirm we ship 3-axis from day one or start 2-axis and add D later.
3. Embeddings provider for Generative-Agents retrieval: which model (fal/OpenRouter has options) and do we accept a one-time embed cost per memory at write-time, or stay on the keyword tokens() matcher for v1 and add embeddings in Phase 3?
4. Timezone source: do we ask the user for the persona's timezone at build, infer it from the chat export timestamps, or default to the user's device tz? DST/antimeridian correctness depends on getting a real IANA tz.
5. 'Seen' receipt default: the existing markUserTurn already stamps readAt unconditionally. Confirm we gate UI exposure behind closeness stage ≥3 (anti 'left-on-read' anxiety) — this changes current visible behavior.
6. Proactivity volume: current NUDGE_MIN/MAX is 20-90 min with a 3-cap. The closeness model would lengthen base gaps to ~13-96h. Confirm the much slower, more human cadence is desired (it reduces engagement but is the ethical/believable choice).
7. How aggressive should the simulated agenda be about claiming offscreen life in memorial mode? Current recommendation: fully muted (no fabricated activities, presence = remembrance). Confirm memorial personas get NO living-day simulation at all.
8. Where do the tunable constants live: a DB/JSON config blob per persona (Passport.tuning) is proposed, but if you want estate-style live tuning without redeploy, do we also want a Redis key like the comfyImageV2 A/B pattern?
9. Self-correction over the wire requires a new SSE event + frontend render work. Confirm Phase-3 client appetite, or do we approximate it server-side (compose final text but pace it with a visible 'corrected' micro-animation) for v1?
