'use client';

/**
 * Lightweight client-side i18n for the Echo PWA — no locale routing,
 * no heavy deps. The locale is device-personal:
 *   localStorage 'echo.locale' → navigator.language match → 'en'.
 * `en.json` is the source of truth; missing keys fall back to English,
 * then to the key itself. Interpolation uses {var} placeholders.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import en from './en.json';
import uk from './uk.json';
import ru from './ru.json';
import de from './de.json';
import pl from './pl.json';
import es from './es.json';

export const LOCALES = ['en', 'uk', 'ru', 'de', 'pl', 'es'] as const;
export type Locale = (typeof LOCALES)[number];

/** Native language names for the Settings picker. */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English',
  uk: 'Українська',
  ru: 'Русский',
  de: 'Deutsch',
  pl: 'Polski',
  es: 'Español',
};

type Dict = Record<string, string>;
const DICTS: Record<Locale, Dict> = { en, uk, ru, de, pl, es };

const LOCALE_KEY = 'echo.locale';

export type Vars = Record<string, string | number>;
export type TFunc = (key: string, vars?: Vars) => string;

function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (m, name: string) =>
    name in vars ? String(vars[name]) : m,
  );
}

function detectLocale(): Locale {
  try {
    const stored = localStorage.getItem(LOCALE_KEY);
    if (stored && (LOCALES as readonly string[]).includes(stored)) return stored as Locale;
  } catch {
    /* localStorage unavailable */
  }
  if (typeof navigator !== 'undefined') {
    const langs = navigator.languages?.length ? navigator.languages : [navigator.language];
    for (const l of langs) {
      const base = (l || '').toLowerCase().split('-')[0];
      if ((LOCALES as readonly string[]).includes(base)) return base as Locale;
    }
  }
  return 'en';
}

interface LocaleContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: TFunc;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  // Start with 'en' for a hydration-stable first render, then resolve the
  // real device locale in an effect (device-personal PWA — no SSR locale).
  const [locale, setLocaleState] = useState<Locale>('en');

  useEffect(() => {
    setLocaleState(detectLocale());
  }, []);

  // Keep <html lang> in sync with the active locale.
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try {
      localStorage.setItem(LOCALE_KEY, l);
    } catch {
      /* ignore */
    }
  }, []);

  const t = useCallback<TFunc>(
    (key, vars) => {
      const template = DICTS[locale][key] ?? DICTS.en[key] ?? key;
      return interpolate(template, vars);
    },
    [locale],
  );

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

function useLocaleContext(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error('useT/useLocale must be used inside <LocaleProvider>');
  return ctx;
}

/** Translate hook: `const t = useT(); t('chat.writeFirst', { name })`. */
export function useT(): TFunc {
  return useLocaleContext().t;
}

/** Current locale + setter (Settings language picker). */
export function useLocale(): { locale: Locale; setLocale: (l: Locale) => void } {
  const { locale, setLocale } = useLocaleContext();
  return { locale, setLocale };
}

/**
 * Presence labels come from the BACKEND in English. Phase 2 (state engine) adds
 * the richer states alongside the legacy ones:
 *   online      → "online" (no label)
 *   asleep      → "asleep"
 *   busy        → "probably <activity>"   (e.g. "probably at work")
 *   idle        → "active Nm ago"
 *   last_seen   → "last seen yesterday" / "last seen N hour(s) ago" / "… N minutes ago"
 *   remembrance → memorial framing ("here when you need her")
 * Map them into translatable forms; unknown shapes fall back to the raw label.
 */
type PresenceLike =
  | { state: 'online'; label?: string }
  | { state: 'idle'; label: string }
  | { state: 'busy'; label: string }
  | { state: 'asleep'; label: string }
  | { state: 'last_seen'; label: string }
  | { state: 'remembrance'; label: string };

export function presenceText(p: PresenceLike, t: TFunc): string {
  const label = ('label' in p ? p.label : undefined) ?? '';
  switch (p.state) {
    case 'online':
      return t('presence.online');
    case 'asleep':
      return t('presence.asleep');
    case 'remembrance':
      return t('presence.remembrance');
    case 'busy': {
      // Backend emits "probably <activity>"; keep just the activity for the slot.
      const activity = label.replace(/^probably\s+/i, '').trim();
      return activity ? t('presence.busy', { activity }) : t('presence.busyGeneric');
    }
    case 'idle': {
      const m = /^active (\d+)m ago$/i.exec(label);
      if (m) return t('presence.activeMinutes', { n: Number(m[1]) });
      return label || t('presence.online');
    }
    case 'last_seen':
    default: {
      if (/^last seen yesterday$/i.test(label)) return t('presence.lastSeenYesterday');
      const hours = /^last seen (\d+) hours? ago$/i.exec(label);
      if (hours) {
        const n = Number(hours[1]);
        return n === 1 ? t('presence.lastSeenHoursOne') : t('presence.lastSeenHours', { n });
      }
      const minutes = /^last seen (\d+) minutes? ago$/i.exec(label);
      if (minutes) return t('presence.lastSeenMinutes', { n: Number(minutes[1]) });
      return label;
    }
  }
}
