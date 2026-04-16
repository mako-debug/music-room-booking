'use client';

import { useState, useCallback } from 'react';

interface VoiceInputProps {
  onResult: (text: string) => void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getSpeechRecognition(): any {
  if (typeof window === 'undefined') return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function VoiceInput({ onResult }: VoiceInputProps) {
  const [listening, setListening] = useState(false);

  const startListening = useCallback(() => {
    const SpeechRecognition = getSpeechRecognition();

    if (!SpeechRecognition) {
      alert('此瀏覽器不支援語音輸入，請使用 Chrome 或 Safari');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'zh-TW';
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onstart = () => setListening(true);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (event: any) => {
      const text = event.results[0][0].transcript;
      onResult(text);
      setListening(false);
    };

    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);

    recognition.start();
  }, [onResult]);

  return (
    <button
      type="button"
      onClick={startListening}
      className={`ml-1 px-1.5 py-1 rounded text-sm ${listening ? 'bg-red-100 text-red-600 animate-pulse' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'}`}
      title="語音輸入"
    >
      🎤
    </button>
  );
}
