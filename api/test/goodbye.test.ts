// Phase 3 clean-goodbye snapshot test (node --test). The contract: a farewell is
// detected, and the produced close contains NONE of the 6 HBS dark-pattern
// farewell tactics (guilt / FOMO / neediness / re-ask / coercion / restraint).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isFarewell,
  cleanGoodbye,
  detectHbsTactics,
  HBS_FAREWELL_TACTICS,
} from '../dist/engine/goodbye.js';

// ---- INTENT DETECTION ------------------------------------------------------

test('isFarewell: detects EN/UA/RU farewells, ignores non-goodbyes', () => {
  for (const f of ['bye', 'goodnight', 'gn', 'talk later', 'gotta go', 'see ya', 'пока', 'бувай', 'добраніч', 'спокойной ночи', 'пойду спать']) {
    assert.ok(isFarewell(f), `should detect: ${f}`);
  }
  for (const n of ['hey what are you doing', 'i love this song', 'tell me about your day', 'the goodbye scene in that movie was so long and dramatic and i cried for ten whole minutes honestly']) {
    assert.equal(isFarewell(n), false, `should NOT detect: ${n}`);
  }
});

// ---- THE SNAPSHOT: every clean close is manipulation-free -------------------

test('cleanGoodbye: NONE of the 6 HBS dark-pattern tactics appear in any close', () => {
  // exhaustively cover both languages, day/night, and the full pick range.
  for (const english of [false, true]) {
    for (const night of [false, true]) {
      for (let i = 0; i <= 10; i++) {
        const out = cleanGoodbye({ english, night, pick: i / 10 });
        const tripped = detectHbsTactics(out);
        assert.equal(
          tripped.length,
          0,
          `close "${out}" (en=${english},night=${night}) tripped: ${tripped.join(', ')}`,
        );
        assert.ok(out.length > 0, 'a close must be non-empty');
      }
    }
  }
});

test('cleanGoodbye: deterministic given pick', () => {
  assert.equal(cleanGoodbye({ pick: 0 }), cleanGoodbye({ pick: 0 }));
  assert.equal(cleanGoodbye({ english: true, night: true, pick: 0.5 }), cleanGoodbye({ english: true, night: true, pick: 0.5 }));
});

// ---- the detector itself catches manipulation (so the snapshot is meaningful)

test('detectHbsTactics: catches each banned tactic (the test guard is real)', () => {
  const samples: Record<string, string> = {
    guilt: "don't leave me",
    fomo: "wait, one more thing before you go",
    neediness: 'i need you, please stay',
    reask: 'are you sure? so soon?',
    coercion: 'you owe me after everything i did',
    restraint: "i won't let you go yet",
  };
  for (const [tactic, text] of Object.entries(samples)) {
    const hit = detectHbsTactics(text);
    assert.ok(hit.includes(tactic), `"${text}" should trip ${tactic}, got: ${hit.join(',')}`);
  }
  // all six tactics are defined
  assert.equal(HBS_FAREWELL_TACTICS.length, 6);
});
