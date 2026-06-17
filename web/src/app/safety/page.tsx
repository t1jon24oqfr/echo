import type { Metadata } from 'next';
import SafetyContent from './SafetyContent';

export const metadata: Metadata = {
  title: 'Safety — Echo',
};

export default function SafetyPage() {
  return <SafetyContent />;
}
