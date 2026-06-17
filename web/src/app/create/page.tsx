'use client';

import { Suspense, useCallback, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import AmbientBg from '@/components/AmbientBg';
import GlassBar from '@/components/GlassBar';
import Progress from '@/components/Progress';
import Building from '@/components/create/Building';
import Meet from '@/components/create/Meet';
import StepChat from '@/components/create/StepChat';
import StepConsent from '@/components/create/StepConsent';
import StepDescribe from '@/components/create/StepDescribe';
import StepPhotos from '@/components/create/StepPhotos';
import StepVoice from '@/components/create/StepVoice';
import StepWho, { type Mode } from '@/components/create/StepWho';
import { photoUrl, type IngestResult } from '@/lib/api';
import { useT } from '@/i18n';

type Step = 1 | 2 | 3 | 4 | 5 | 6 | 'building' | 'meet';

const TOTAL = 6;

const TITLE_KEYS: Record<number, string> = {
  1: 'create.title1',
  2: 'create.title2',
  3: 'create.title3',
  4: 'create.title4',
  5: 'create.title5',
  6: 'create.title6',
};

export default function CreatePage() {
  return (
    <Suspense fallback={null}>
      <CreateWizard />
    </Suspense>
  );
}

function CreateWizard() {
  const t = useT();
  const params = useSearchParams();
  const router = useRouter();
  const demo = params.get('demo') === '1';
  const idParam = params.get('id');
  const rawStep = params.get('step');
  const stepParam = Number(rawStep);
  const [step, setStepState] = useState<Step>(
    rawStep === 'building' && idParam
      ? 'building'
      : stepParam >= 1 && stepParam <= 6 && idParam
        ? (stepParam as Step)
        : 1,
  );
  const [personaId, setPersonaId] = useState<string | null>(idParam);
  const [name, setName] = useState('');
  const [mode, setMode] = useState<Mode>('memorial');
  const [ambient, setAmbient] = useState<string[] | undefined>(undefined);
  const [photo, setPhoto] = useState<string | null>(null); // first uploaded photo (server name)
  const [personaName, setPersonaName] = useState('');

  const numeric = typeof step === 'number';
  const photoSrc = personaId && photo ? photoUrl(personaId, photo) : null;
  const displayName = personaName || name;

  /**
   * Advance/rewind the wizard AND mirror the new position into the URL
   * (?id=&step=) so a refresh, OS back, or deep-link resumes the same step
   * instead of unmounting the wizard. `scroll:false` keeps the viewport put.
   */
  const goStep = useCallback(
    (next: Step, id: string | null = personaId) => {
      setStepState(next);
      if (id) {
        router.replace(`/create?id=${encodeURIComponent(id)}&step=${next}${demo ? '&demo=1' : ''}`, {
          scroll: false,
        });
      }
    },
    [router, personaId, demo],
  );

  /** Step-aware back: step 1 leaves the wizard; later steps rewind one step. */
  const onBack = useCallback(() => {
    if (typeof step === 'number' && step > 1) {
      goStep((step - 1) as Step);
    } else {
      router.push('/');
    }
  }, [step, goStep, router]);

  return (
    <main style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <AmbientBg colors={ambient} />
      {numeric ? (
        <GlassBar title={t(TITLE_KEYS[step])} onBack={onBack} />
      ) : (
        <GlassBar
          title={
            step === 'building' ? t('create.buildingTitle') : displayName || t('create.meetTitle')
          }
        />
      )}

      {numeric && (
        <div style={{ padding: '2px 0 6px' }}>
          <Progress step={step} total={TOTAL} />
        </div>
      )}

      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          padding: '6px 16px calc(20px + env(safe-area-inset-bottom))',
        }}
      >
        {step === 1 && (
          <StepWho
            onNext={({ id, name: n, mode: m }) => {
              setPersonaId(id);
              setName(n);
              setMode(m);
              goStep(2, id);
            }}
          />
        )}
        {step === 2 && personaId && (
          <StepPhotos
            personaId={personaId}
            onNext={({ files, colors }) => {
              if (files.length) setPhoto(files[0]);
              if (colors.length) setAmbient(colors);
              goStep(3);
            }}
          />
        )}
        {step === 3 && personaId && (
          <StepChat
            personaId={personaId}
            demo={demo}
            onNext={(r: IngestResult) => {
              setPersonaName(r.personaAuthor);
              goStep(4);
            }}
          />
        )}
        {step === 4 && <StepVoice onNext={() => goStep(5)} />}
        {step === 5 && personaId && (
          <StepDescribe personaId={personaId} name={displayName} onNext={() => goStep(6)} />
        )}
        {step === 6 && <StepConsent mode={mode} onNext={() => goStep('building')} />}
        {step === 'building' && personaId && (
          <Building
            personaId={personaId}
            name={displayName}
            photoUrl={photoSrc}
            onDone={() => goStep('meet')}
          />
        )}
        {step === 'meet' && personaId && (
          <Meet personaId={personaId} name={displayName} mode={mode} photoUrl={photoSrc} />
        )}
      </div>
    </main>
  );
}
