import type { Metadata, Viewport } from 'next';
import { Manrope } from 'next/font/google';
import { LocaleProvider } from '@/i18n';
import InboxProvider from '@/components/InboxProvider';
import './globals.css';

const manrope = Manrope({
  subsets: ['latin', 'cyrillic'],
  weight: ['400', '500', '600'],
  variable: '--font-sans',
});

export const metadata: Metadata = {
  title: 'Echo — keep their words',
  description: 'Rebuild a person from your chats and photos — and talk once more.',
  manifest: '/manifest.json',
  icons: { icon: '/icon.svg' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#EFEFF4',
  // Draw under the notch/home-indicator so env(safe-area-inset-*) is non-zero,
  // and let the layout reflow (rather than the page zooming/panning) when the
  // on-screen keyboard opens — pairs with the --kb tracking in template.tsx.
  viewportFit: 'cover',
  interactiveWidget: 'resizes-content',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={manrope.variable}>
        <LocaleProvider>
          <InboxProvider>
            <div className="phone">{children}</div>
          </InboxProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
