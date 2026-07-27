'use client';

import { useEffect, useState } from 'react';

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

export function InstallScanner() {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [help, setHelp] = useState(false);

  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    setInstalled(standalone);
    setIos(/iPad|iPhone|iPod/.test(navigator.userAgent));
    const capture = (event: Event) => { event.preventDefault(); setPrompt(event as InstallPromptEvent); };
    window.addEventListener('beforeinstallprompt', capture);
    return () => window.removeEventListener('beforeinstallprompt', capture);
  }, []);

  if (installed) return null;
  const install = async () => {
    if (!prompt) return;
    await prompt.prompt();
    const choice = await prompt.userChoice;
    if (choice.outcome === 'accepted') setInstalled(true);
    setPrompt(null);
  };

  const showHelp = () => setHelp(true);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
      <button type="button" onClick={prompt ? install : showHelp} style={{ border: 0, borderRadius: 999, padding: '7px 11px', background: '#161618', color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>Install scanner</button>
      {(help || ios) && <span style={{ maxWidth: 160, fontSize: 9, color: '#777', textAlign: 'right', lineHeight: 1.25 }}>{ios ? 'Safari: Share → Add to Home Screen' : 'Use your browser’s install icon in the address bar.'}</span>}
    </div>
  );
}
