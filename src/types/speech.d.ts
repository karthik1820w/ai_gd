interface SpeechRecognitionAlternative { transcript: string; }
interface SpeechRecognitionResult { readonly isFinal: boolean; readonly length: number; [index: number]: SpeechRecognitionAlternative; }
interface SpeechRecognitionResultList { readonly length: number; [index: number]: SpeechRecognitionResult; }
interface SpeechRecognitionEvent extends Event { readonly resultIndex: number; readonly results: SpeechRecognitionResultList; }
interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: Event & { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
interface SpeechRecognitionConstructor { new (): SpeechRecognition; }
interface Window {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
}
