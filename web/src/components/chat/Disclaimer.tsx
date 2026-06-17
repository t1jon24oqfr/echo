'use client';

import { useT } from '@/i18n';

/** Centered system transparency line (EU AI Act). Re-shown every 3h of session. */
export default function Disclaimer() {
  const t = useT();
  return (
    <div
      style={{
        textAlign: 'center',
        fontSize: 12,
        color: 'var(--text-dim)',
        padding: '6px 24px',
      }}
    >
      {t('chat.disclaimer')}
    </div>
  );
}
