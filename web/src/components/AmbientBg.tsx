const FALLBACK = ['#2E8B86', '#C77B33', '#8A4460'];

// Personalization signature: soft pastel wash derived from the persona's photos.
// On the light theme every color is clamped into a gentle pastel range so the
// background stays Telegram-light and text contrast is never at risk.
function pastel(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return pastel(FALLBACK[0]);
  const n = parseInt(m[1], 16);
  const r = (n >> 16) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  const d = max - min;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return `hsl(${Math.round(h)}, 65%, 80%)`;
}

export default function AmbientBg({ colors }: { colors?: string[] }) {
  const src = colors && colors.length >= 3 ? colors : FALLBACK;
  const c = src.map(pastel);
  const blob = (bg: string, extra: React.CSSProperties): React.CSSProperties => ({
    position: 'absolute',
    borderRadius: '50%',
    filter: 'blur(90px)',
    background: bg,
    ...extra,
  });
  return (
    <div
      aria-hidden
      style={{
        position: 'fixed',
        top: 0,
        bottom: 0,
        left: '50%',
        transform: 'translateX(-50%)',
        width: 'min(430px, 100vw)',
        zIndex: -1,
        overflow: 'hidden',
        pointerEvents: 'none',
        background: 'var(--bg)',
      }}
    >
      <div className="ambient-blob" style={blob(c[0], { width: 420, height: 420, top: '-14%', left: '-26%', opacity: 0.55 })} />
      <div className="ambient-blob slow" style={blob(c[1], { width: 380, height: 380, top: '24%', right: '-30%', opacity: 0.45 })} />
      <div className="ambient-blob slower" style={blob(c[2], { width: 440, height: 440, bottom: '-16%', left: '-20%', opacity: 0.5 })} />
    </div>
  );
}
