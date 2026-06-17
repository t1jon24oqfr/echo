// Echo — Phase 2 presence state machine (design spec §1 / circadian lens).
//
// Replaces the hash-only presenceFor with an ENERGY + AGENDA derived machine:
//   asleep  -> energy very low AND inside the sleep block (or asleep flag)
//   busy    -> current agenda block is busy (work/gym/...)
//   online  -> high enough energy AND a FNV flicker coin lands online
//   idle    -> awake but the flicker coin says "recently active"
//   last_seen-> awake-but-away (plausible minutes/hours label from the same hash)
//
// The FNV-1a hash is kept ONLY as the online-flicker RNG seed (so online status
// jitters realistically per 15-min slot) — it no longer decides asleep/busy.
// Memorial mode: remembrance framing, never a fabricated activity.

import type { Clock } from '../engine/state';
import { fnv1a } from '../engine/state';
import type { CurrentActivity } from './agenda.service';

export type Presence =
  | { state: 'online'; label?: string }
  | { state: 'idle'; label: string }
  | { state: 'busy'; label: string }
  | { state: 'asleep'; label: string }
  | { state: 'last_seen'; label: string }
  | { state: 'remembrance'; label: string };

export interface PresenceInput {
  personaId: string;
  ready: boolean;
  energy: number; // [0,1]
  asleep: boolean; // PersonaState.asleep flag
  activity: CurrentActivity | null;
  memorial: boolean;
  clock: Clock;
}

const SLOT_MS = 15 * 60 * 1000;

export function presenceFromState(inp: PresenceInput): Presence | null {
  if (!inp.ready) return null;

  // Memorial: never fabricate a living day. Soft remembrance framing.
  if (inp.memorial) {
    return { state: 'remembrance', label: 'here when you need her' };
  }

  const now = inp.clock.now();
  const slot = Math.floor(now.getTime() / SLOT_MS);
  const h = fnv1a(`${inp.personaId}:${slot}`);

  // ASLEEP: the agenda says she's in the sleep block, or energy is at the floor.
  const sleeping = inp.activity?.activity === 'sleep' || inp.asleep || inp.energy < 0.22;
  if (sleeping) {
    return { state: 'asleep', label: 'asleep' };
  }

  // BUSY: current block is a busy one (work/commute/gym/...). Still reachable but
  // slow to reply — surfaced so latency + openers stay coherent.
  if (inp.activity && inp.activity.busy) {
    return { state: 'busy', label: `probably ${inp.activity.label}` };
  }

  // Awake + free. Higher energy -> more likely to be actively online right now.
  // P(online) scales with energy (~0.12 groggy .. ~0.45 lively), flicker via FNV.
  const pOnline = Math.round(clampPct(0.1 + 0.4 * inp.energy) * 100);
  if (h % 100 < pOnline) return { state: 'online' };

  // Idle: awake-but-just-stepped-away (short tail). A modest slice.
  const idleRoll = (h >>> 7) % 100;
  if (idleRoll < 18) {
    const mins = 1 + ((h >>> 13) % 8);
    return { state: 'idle', label: `active ${mins}m ago` };
  }

  // last_seen: plausible minutes/hours label derived from the same hash.
  const bucket = (h >>> 7) % 100;
  if (bucket >= 90) return { state: 'last_seen', label: 'last seen yesterday' };
  if (bucket >= 58) {
    const hours = 1 + ((h >>> 15) % 6);
    return { state: 'last_seen', label: `last seen ${hours} ${hours === 1 ? 'hour' : 'hours'} ago` };
  }
  const minutes = 3 + ((h >>> 15) % 57);
  return { state: 'last_seen', label: `last seen ${minutes} minutes ago` };
}

function clampPct(x: number): number {
  return x < 0.02 ? 0.02 : x > 0.95 ? 0.95 : x;
}
