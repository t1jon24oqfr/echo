'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { listPersonas } from '@/lib/api';
import { useT } from '@/i18n';

/**
 * The landing is for first-time visitors. If this device already has
 * personas, send the user straight to their chats (Telegram-style:
 * the app opens where the conversations are). While redirecting, show
 * a small "Open my chats" link as an instant manual escape hatch.
 */
export default function ReturningUser() {
  const t = useT();
  const router = useRouter();
  const [hasPersonas, setHasPersonas] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listPersonas()
      .then((list) => {
        if (!cancelled && list.length > 0) {
          setHasPersonas(true);
          router.replace('/home');
        }
      })
      .catch(() => {
        /* API offline — stay on the landing */
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (!hasPersonas) return null;
  return (
    <div style={{ textAlign: 'center', marginTop: 14 }}>
      <Link href="/home" style={{ color: 'var(--accent)', fontSize: 15, fontWeight: 500 }}>
        {t('landing.openMyChats')}
      </Link>
    </div>
  );
}
