'use client';

import { useEffect, useRef } from 'react';

/**
 * Reveal — a scroll-into-view wrapper. Renders its children hidden (via the
 * `[data-reveal]` CSS) and adds `.reveal-in` once the element scrolls into the
 * viewport, letting CSS fade+rise it with a per-child stagger (see globals.css).
 * Fires once, then unobserves. If IntersectionObserver is unavailable — or the
 * user prefers reduced motion — it reveals immediately (the CSS guard also
 * forces visibility), so content is never trapped hidden.
 */
export default function Reveal({
  children,
  style,
  className,
  delay = 0,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
  /** Optional extra delay (ms) before this block reveals. */
  delay?: number;
}) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let done = false;
    const reveal = () => {
      if (done) return;
      done = true;
      window.setTimeout(() => el.classList.add('reveal-in'), delay);
    };

    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced || typeof IntersectionObserver === 'undefined') {
      el.classList.add('reveal-in');
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            reveal();
            io.disconnect();
          }
        }
      },
      { threshold: 0.2, rootMargin: '0px 0px -10% 0px' },
    );
    io.observe(el);

    // Safety net: a backgrounded tab pauses intersection callbacks, and we must
    // never leave content stranded at opacity 0. Reveal regardless after a beat.
    const fallback = window.setTimeout(reveal, 2500);

    return () => {
      io.disconnect();
      window.clearTimeout(fallback);
    };
  }, [delay]);

  return (
    <section ref={ref} data-reveal className={className} style={style}>
      {children}
    </section>
  );
}
