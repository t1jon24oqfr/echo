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
}

export interface MemoryItem {
  text: string;
  keywords: string[];
  date: string; // YYYY-MM (approx)
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
}
