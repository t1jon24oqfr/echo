import { IsArray, IsBoolean, IsIn, IsObject, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

// 'YYYY' | 'YYYY-MM' | 'YYYY-MM-DD' — the knowledge-cutoff / death date.
const CUTOFF_RE = /^\d{4}(-\d{2}(-\d{2})?)?$/;

export class CreatePersonaDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  relationship!: string;

  @IsIn(['memorial', 'reconnect'])
  mode!: 'memorial' | 'reconnect';

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  ambient?: string[];

  // Realism: the persona knows nothing after this date (death / last-active date).
  @IsOptional()
  @IsString()
  @Matches(CUTOFF_RE, { message: 'knowledgeCutoff must be YYYY, YYYY-MM or YYYY-MM-DD' })
  knowledgeCutoff?: string;
}

export class UpdatePersonaDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  ambient?: string[];

  @IsOptional()
  @IsString()
  @Matches(CUTOFF_RE, { message: 'knowledgeCutoff must be YYYY, YYYY-MM or YYYY-MM-DD' })
  knowledgeCutoff?: string;
}

// PATCH /personas/:id/enrich — user-described onboarding enrichment merged into
// the persona (post-build). Every field optional; arrays are bounded + trimmed.
export class EnrichPersonaDto {
  @IsOptional()
  @IsString()
  @Matches(CUTOFF_RE, { message: 'knowledgeCutoff must be YYYY, YYYY-MM or YYYY-MM-DD' })
  knowledgeCutoff?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  petNames?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  signaturePhrases?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  neverSay?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  traits?: string[];

  // Episodic anchors: hand-verified high-poignancy memories ("a moment with them
  // you'd never want to lose"). Written as high-importance pinned memories.
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(600, { each: true })
  anchors?: string[];
}

export class IngestDto {
  @IsOptional()
  @IsIn(['telegram', 'whatsapp', 'instagram', 'facebook', 'line', 'vk'])
  source?: 'telegram' | 'whatsapp' | 'instagram' | 'facebook' | 'line' | 'vk';

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsString()
  me?: string;

  @IsOptional()
  @IsBoolean()
  demo?: boolean;
}

export class VisualConfirmDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  me!: string;
}

export class ChatDto {
  // Optional so multipart image/audio-only turns pass validation; the controller
  // enforces "at least one of message|image|audio". JSON callers still send message.
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  message?: string;

  // Call mode (V8): when 'call', force a voice reply, shorten the turn, and never
  // emit a selfie. Accepted as a JSON body field and a multipart form field.
  @IsOptional()
  @IsIn(['call'])
  mode?: 'call';
}

export class SelfieDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  hint?: string;
}

export class SetAvatarDto {
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  file!: string;
}

// PATCH /personas/:id/profile — partial Character Passport patch + optional tz.
// `passport` is validated as a free-form object here; the ProfileService runs
// normalizePassport() which clamps/whitelists every field server-side.
export class UpdateProfileDto {
  @IsOptional()
  @IsObject()
  passport?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;
}
