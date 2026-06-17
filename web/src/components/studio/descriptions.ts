/**
 * One-line, human-friendly descriptions for Big-Five sliders and behavior knobs.
 * Each returns an i18n KEY (low / mid / high band) so the live description under
 * a slider reads naturally as the user drags. Closeness/stage are handled in the
 * relationship section — never as a number.
 */

/** 0..100 -> 'Low' | 'Mid' | 'High' band key suffix. */
export function band(v: number): 'Low' | 'Mid' | 'High' {
  if (v < 34) return 'Low';
  if (v > 66) return 'High';
  return 'Mid';
}

/** i18n key for a Big-Five trait's current band, e.g. studio.oceanO.High. */
export function oceanDescKey(trait: 'O' | 'C' | 'E' | 'A' | 'N', v: number): string {
  return `studio.ocean${trait}.${band(v)}`;
}

/** i18n key for a behavior knob's current band, e.g. studio.knob.warmth.High. */
export function knobDescKey(knob: string, v: number): string {
  return `studio.knob.${knob}.${band(v)}`;
}

/**
 * Chronotype slider 0..100 -> MSF hours (2.5 lark .. 7.5 owl), matching the
 * passport's `chronotype.MSF` range. Linear map.
 */
export function sliderToMSF(v: number): number {
  return Math.round((2.5 + (v / 100) * 5) * 10) / 10;
}

/** Inverse: MSF hours -> slider 0..100. */
export function msfToSlider(msf: number): number {
  return Math.round(((msf - 2.5) / 5) * 100);
}

/** Chronotype band key (early bird ↔ night owl). */
export function chronotypeDescKey(sliderV: number): string {
  if (sliderV < 34) return 'studio.chronotype.lark';
  if (sliderV > 66) return 'studio.chronotype.owl';
  return 'studio.chronotype.mid';
}

/** proactivityScale 0.5..2.0 -> band key for the live description. */
export function proactivityDescKey(scale: number): string {
  if (scale < 0.85) return 'studio.proactivity.Low';
  if (scale > 1.3) return 'studio.proactivity.High';
  return 'studio.proactivity.Mid';
}
