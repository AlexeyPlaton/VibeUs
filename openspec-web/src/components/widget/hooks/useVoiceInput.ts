import { useState, useRef, useCallback } from 'react';
import { tr } from '../../../i18n/config';

export interface UseVoiceInputOptions {
  lang?: string;
  onResult?: (transcript: string) => void;
  onError?: (error: string) => void;
}

export const useVoiceInput = (currentLang: string = 'en') => {
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);

  const getLanguageCode = (lang: string): string => {
    switch (lang) {
      case 'ru': return 'ru-RU';
      case 'zh': return 'zh-CN';
      case 'hi': return 'hi-IN';
      default: return 'en-US';
    }
  };

  const isSupported = typeof window !== 'undefined' && ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window);

  const startListening = useCallback((callback?: (text: string) => void) => {
    if (!isSupported) {
      setError(tr('v7.voice.unsupported'));
      return;
    }

    try {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      const recognition = new SpeechRecognition();
      recognitionRef.current = recognition;

      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = getLanguageCode(currentLang);

      recognition.onstart = () => {
        setIsListening(true);
        setError(null);
      };

      recognition.onresult = (event: any) => {
        let finalTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          }
        }
        if (finalTranscript && callback) {
          callback(finalTranscript.trim());
        }
      };

      recognition.onerror = (event: any) => {
        console.warn('Speech recognition error:', event.error);
        if (event.error === 'not-allowed') {
          setError(tr('v7.voice.mic_blocked'));
        }
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognition.start();
    } catch (e: any) {
      console.error('Failed to start voice recognition:', e);
      setError(e.message || tr('v7.voice.start_error'));
      setIsListening(false);
    }
  }, [currentLang, isSupported]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
    }
  }, []);

  const toggleListening = useCallback((callback?: (text: string) => void) => {
    if (isListening) {
      stopListening();
    } else {
      startListening(callback);
    }
  }, [isListening, startListening, stopListening]);

  return {
    isListening,
    isSupported,
    error,
    startListening,
    stopListening,
    toggleListening
  };
};
