import type { Metadata } from 'next';
import TermsContent from './TermsContent';

export const metadata: Metadata = {
  title: 'Terms — Echo',
};

export default function TermsPage() {
  return <TermsContent />;
}
