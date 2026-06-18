import type { CharacterPassport } from './passport';

export type MsgKind = 'text' | 'media' | 'voice' | 'system';

export interface Msg {
  author: string;
  text: string;
  ts: number; // epoch ms
  kind: MsgKind;
}

export interface Conversation {
  start: number;
  end: number;
  messages: Msg[];
}

export interface AuthorStats {
  messages: number;
  avgWords: number;
  medianWords: number;
  emojiPerMessage: number;
  topEmoji: [string, number][];
  langMix: Record<string, number>; // uk/ru/en/cyr/other -> share 0..1
  noTrailingPeriod: number; // share of messages ending without . ! ?
  bracketSmiles: number; // share of messages containing ")" smiles
  burstAvg: number; // avg consecutive messages per turn
  // Share of messages that mix scripts WITHIN one message (Cyrillic + Latin) —
  // the surzhyk / borrowed-English code-switching that whole-message detectLang
  // erases. Optional: older builds omit it; the prompt tolerates its absence.
  codeSwitch?: number;
}

export interface CorpusStats {
  totalMessages: number;
  voiceNotes: number;
  media: number;
  from: string; // ISO date
  to: string;
  byAuthor: Record<string, AuthorStats>;
}

export interface Corpus {
  source: string;
  personaAuthor: string;
  userAuthor: string;
  conversations: Conversation[];
  stats: CorpusStats;
}

export interface PersonaCard {
  name: string;
  relationship_to_user: string;
  traits: string[];
  speech_style: string[];
  language_mix_notes: string;
  emoji_and_punctuation: string;
  pet_names: string[];
  inside_jokes: string[];
  recurring_topics: string[];
  dynamics_with_user: string;
  facts: string[];
  // Mined distinctive high-frequency phrases (greetings/sign-offs/fillers/laugh).
  // Deterministic (engine/phrases.ts), set at build; optional for older personas.
  signature_phrases?: string[];
}

export interface MemoryItem {
  text: string;
  keywords: string[];
  date: string; // YYYY-MM (approx)
  importance?: number; // 1..10 poignancy (heuristic); used by retrieval ranking
  lastAccessedAt?: string; // ISO; used by recency term (defaults to createdAt/builtAt)
  // 'episodic' | 'reflection' | 'fact' — routes retrieval (fact pinned, reflection boosted).
  kind?: string;
  // 'user' | 'card' | 'reflection' | 'model' — provenance; 'model' never pins.
  source?: string;
  // Phase 3 — Generative-Agents retrieval. Optional: when present, retrieval
  // blends cosine relevance; when absent it falls back to the keyword matcher.
  id?: string; // Memory row id (so retrieval can bump lastAccessedAt)
  embedding?: number[]; // parsed embedding vector (omitted when not yet embedded)
}

export interface PersonaFile {
  builtAt: string;
  source: string;
  personaAuthor: string;
  userAuthor: string;
  card: PersonaCard;
  exemplars: string[]; // rendered multi-line snippets
  memories: MemoryItem[];
  stats: CorpusStats;
  // Phase 1 Character Passport (parsed). Optional so older/unbuilt personas and
  // existing call sites keep working; the prompt assembler tolerates its absence.
  passport?: CharacterPassport;
  // Realism: the persona knows nothing after this date ('YYYY-MM-DD'|'YYYY-MM').
  // Grounds the prompt + gates retrieval. Absent ⇒ no cutoff applied.
  knowledgeCutoff?: string;
}
