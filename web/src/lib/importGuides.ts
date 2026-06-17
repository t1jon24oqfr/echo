/**
 * Typed loader for the verified per-platform export guides
 * (web/src/lib/importGuides.data.json — researched + verified June 2026).
 *
 * The guide BODY text is intentionally English (it lives in the data file);
 * only the static labels around it are localised, in the components.
 */

import data from './importGuides.data.json';

export type ImportPlatformId = 'iPhone' | 'Android' | 'Desktop' | 'Web';

export interface ImportPlatform {
  platform: ImportPlatformId;
  /** Short availability note. When it starts with "no"/"partial" the platform isn't fully supported. */
  available: string;
  steps: string[];
  fileToUpload: string;
  getItToPhone: string;
  timeDelay: string;
  caveats: string[];
}

export interface ImportTroubleshooting {
  problem: string;
  fix: string;
}

export interface ImportGuide {
  displayName: string;
  /** The single most important line — what Echo actually needs uploaded. */
  whatEchoNeeds: string;
  platforms: ImportPlatform[];
  generalCaveats: string[];
  troubleshooting: ImportTroubleshooting[];
}

const GUIDES = data as Record<string, ImportGuide>;

/** Look up the rich export guide for a source id (telegram, whatsapp, …). */
export function getImportGuide(sourceId: string): ImportGuide | null {
  return GUIDES[sourceId] ?? null;
}
