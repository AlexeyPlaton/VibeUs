import React, { useState, useEffect } from 'react';
import { 
  Bug, Sparkles, HelpCircle, MousePointer2, Frame, 
  ArrowRight, Check, CheckCircle2, Mic, MicOff, RefreshCw, AlertTriangle
} from 'lucide-react';
import { useVoiceInput } from '../hooks/useVoiceInput';
import { trackEvent } from '../telemetry';

interface PublicReporterWizardProps {
  state: any;
}

export const PublicReporterWizard: React.FC<PublicReporterWizardProps> = ({ state }) => {
  const {
    t18n, 
    handleSubmitFeedback, 
    newFeedbackText, 
    setNewFeedbackText,
    newFeedbackContact, 
    setNewFeedbackContact, 
    currentLanguage,
    inspectedElementData,
    setInspectedElementData,
    handleToggleInspector,
    setIsOpen
  } = state;

  const [step, setStep] = useState(1);
  const [feedbackType, setFeedbackType] = useState<'bug' | 'idea' | 'question' | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { isListening, isSupported, toggleListening } = useVoiceInput(currentLanguage || 'ru');

  // Load draft from localStorage on mount
  useEffect(() => {
    const draftText = localStorage.getItem('vibus_feedback_draft_text');
    const draftContact = sessionStorage.getItem('vibus_feedback_draft_contact');
    if (draftText) setNewFeedbackText(draftText);
    if (draftContact) setNewFeedbackContact(draftContact);
  }, []);

  // Save drafts
  useEffect(() => {
    if (newFeedbackText) localStorage.setItem('vibus_feedback_draft_text', newFeedbackText);
    if (newFeedbackContact) sessionStorage.setItem('vibus_feedback_draft_contact', newFeedbackContact);
    else sessionStorage.removeItem('vibus_feedback_draft_contact');
  }, [newFeedbackText, newFeedbackContact]);

  // Listen for inspected element completion to jump from Step 2 to Step 3
  useEffect(() => {
    if (step === 2 && inspectedElementData) {
      setStep(3);
    }
  }, [inspectedElementData, step]);

  const handleTypeSelect = (type: 'bug' | 'idea' | 'question') => {
    setFeedbackType(type);
    setStep(2);
    trackEvent('feedback_type_selected', { type });
  };

  const handleVoiceToggle = () => {
    trackEvent('voice_feedback_clicked');
    toggleListening((text) => {
      setNewFeedbackText((prev: string) => prev ? `${prev} ${text}` : text);
      trackEvent('voice_feedback_transcribed');
    });
  };

  const submitFeedback = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFeedbackText.trim()) return;
    
    setIsSubmitting(true);
    setError(null);

    const originalText = newFeedbackText;
    try {
      const typePrefix = feedbackType === 'bug' ? '[Bug] ' : feedbackType === 'idea' ? '[Idea] ' : '[Question] ';
      const payloadText = typePrefix + originalText;
      
      // Calling handler with explicit payload
      await handleSubmitFeedback(e, payloadText);
      
      // Success
      setStep(5);
      trackEvent('feedback_submitted_success', { type: feedbackType });
      
      // Clear drafts and state
      localStorage.removeItem('vibus_feedback_draft_text');
      setNewFeedbackText('');
      setFeedbackType(null);
      setInspectedElementData(null);
      
      // Auto close after 5 seconds
      setTimeout(() => {
        // Double check we are still on step 5 (user didn't click "Send another")
        setStep((s) => {
          if (s === 5) setIsOpen(false);
          return s;
        });
      }, 5000);

    } catch (err) {
      // Revert text
      setNewFeedbackText(originalText);
      setError(t18n("feedback.submit_error", "Failed to submit. Please check your connection and try again."));
      trackEvent('feedback_submit_error', { error: String(err) });
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetFlow = () => {
    setStep(1);
    setFeedbackType(null);
    setNewFeedbackText('');
    setInspectedElementData(null);
  };

  return (
    <div className="flex-1 flex flex-col p-4 sm:p-6 bg-transparent overflow-y-auto space-y-6 font-['Plus_Jakarta_Sans',sans-serif]">
      
      {/* STEPS INDICATOR */}
      {step < 5 && (
        <div className="flex items-center justify-between mb-4 px-2">
          {[1, 2, 3, 4].map((s) => (
            <div key={s} className="flex items-center">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold transition-colors ${
                step >= s ? 'bg-indigo-500 text-white' : 'bg-slate-800 text-slate-500'
              }`}>
                {step > s ? <Check className="w-3 h-3" /> : s}
              </div>
              {s < 4 && (
                <div className={`w-8 sm:w-12 h-px mx-1 transition-colors ${
                  step > s ? 'bg-indigo-500/50' : 'bg-slate-800'
                }`} />
              )}
            </div>
          ))}
        </div>
      )}

      {/* STEP 1: TYPE SELECTION */}
      {step === 1 && (
        <div className="animate-fadeIn space-y-4" role="region" aria-live="polite">
          <h3 className="text-lg font-bold text-white mb-2">How can we help?</h3>
          <p className="text-sm text-slate-400 mb-6">Select the type of feedback you want to leave.</p>
          
          <div className="grid grid-cols-1 gap-3">
            <button 
              onClick={() => handleTypeSelect('bug')}
              className="flex items-start gap-4 p-4 rounded-xl bg-slate-900 border border-white/[0.05] hover:border-rose-500/50 hover:bg-rose-500/10 transition-all text-left cursor-pointer group focus:outline-none focus:ring-2 focus:ring-rose-500"
            >
              <div className="p-2 rounded-lg bg-rose-500/20 text-rose-400 group-hover:scale-110 transition-transform">
                <Bug className="w-5 h-5" />
              </div>
              <div>
                <div className="font-bold text-slate-200">Report an Issue</div>
                <div className="text-xs text-slate-500 mt-1">Something is broken or not working as expected.</div>
              </div>
            </button>

            <button 
              onClick={() => handleTypeSelect('idea')}
              className="flex items-start gap-4 p-4 rounded-xl bg-slate-900 border border-white/[0.05] hover:border-amber-500/50 hover:bg-amber-500/10 transition-all text-left cursor-pointer group focus:outline-none focus:ring-2 focus:ring-amber-500"
            >
              <div className="p-2 rounded-lg bg-amber-500/20 text-amber-400 group-hover:scale-110 transition-transform">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <div className="font-bold text-slate-200">Share an Idea</div>
                <div className="text-xs text-slate-500 mt-1">Feature requests and suggestions for improvement.</div>
              </div>
            </button>

            <button 
              onClick={() => handleTypeSelect('question')}
              className="flex items-start gap-4 p-4 rounded-xl bg-slate-900 border border-white/[0.05] hover:border-blue-500/50 hover:bg-blue-500/10 transition-all text-left cursor-pointer group focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <div className="p-2 rounded-lg bg-blue-500/20 text-blue-400 group-hover:scale-110 transition-transform">
                <HelpCircle className="w-5 h-5" />
              </div>
              <div>
                <div className="font-bold text-slate-200">Ask a Question</div>
                <div className="text-xs text-slate-500 mt-1">Need help or clarification on how things work.</div>
              </div>
            </button>
          </div>
        </div>
      )}

      {/* STEP 2: ELEMENT SELECTION */}
      {step === 2 && (
        <div className="animate-fadeIn space-y-4" role="region" aria-live="polite">
          <button onClick={() => setStep(1)} className="text-xs text-slate-500 hover:text-white flex items-center gap-1 -mt-2 mb-4 focus:outline-none focus:underline">
            &larr; Back
          </button>
          <h3 className="text-lg font-bold text-white mb-2">Point it out</h3>
          <p className="text-sm text-slate-400 mb-6">Show us exactly where on the page this applies.</p>
          
          <div className="grid grid-cols-1 gap-3">
            <button 
              onClick={() => {
                // Minimize widget and activate inspector
                handleToggleInspector();
              }}
              className="flex items-start gap-4 p-4 rounded-xl bg-slate-900 border border-white/[0.05] hover:border-indigo-500/50 hover:bg-indigo-500/10 transition-all text-left cursor-pointer group focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <div className="p-2 rounded-lg bg-indigo-500/20 text-indigo-400 group-hover:scale-110 transition-transform">
                <MousePointer2 className="w-5 h-5" />
              </div>
              <div>
                <div className="font-bold text-slate-200">Select element on page</div>
                <div className="text-xs text-slate-500 mt-1">Point to a specific button, text, or image.</div>
              </div>
            </button>

            <button 
              onClick={() => {
                setInspectedElementData(null);
                setStep(3);
              }}
              className="flex items-start gap-4 p-4 rounded-xl bg-slate-900 border border-white/[0.05] hover:border-slate-500/50 hover:bg-slate-800 transition-all text-left cursor-pointer group focus:outline-none focus:ring-2 focus:ring-slate-500"
            >
              <div className="p-2 rounded-lg bg-slate-800 text-slate-400 group-hover:scale-110 transition-transform">
                <Frame className="w-5 h-5" />
              </div>
              <div>
                <div className="font-bold text-slate-200">Whole page</div>
                <div className="text-xs text-slate-500 mt-1">This feedback applies to the general page.</div>
              </div>
            </button>
          </div>
        </div>
      )}

      {/* STEP 3: PREVIEW */}
      {step === 3 && (
        <div className="animate-fadeIn space-y-4 flex flex-col h-full" role="region" aria-live="polite">
          <button onClick={() => setStep(2)} className="text-xs text-slate-500 hover:text-white flex items-center gap-1 -mt-2 mb-2 focus:outline-none focus:underline">
            &larr; Back
          </button>
          <h3 className="text-lg font-bold text-white">Context captured</h3>
          
          <div className="flex-1 bg-slate-900 rounded-xl border border-white/[0.05] overflow-hidden flex flex-col p-4 justify-center items-center my-4">
            {inspectedElementData ? (
              <div className="text-center space-y-3">
                <div className="inline-flex items-center justify-center p-3 bg-indigo-500/20 text-indigo-400 rounded-full mb-2">
                  <Check className="w-6 h-6" />
                </div>
                <div className="text-sm font-bold text-white">Element Selected</div>
                <div className="text-xs font-mono text-slate-400 bg-black/40 px-3 py-2 rounded-lg max-w-[200px] truncate">
                  {inspectedElementData.selector}
                </div>
                {inspectedElementData.elementText && (
                  <div className="text-xs text-slate-500 italic max-w-[200px] truncate mt-2">
                    "{inspectedElementData.elementText}"
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center space-y-3">
                <div className="inline-flex items-center justify-center p-3 bg-slate-800 text-slate-400 rounded-full mb-2">
                  <Frame className="w-6 h-6" />
                </div>
                <div className="text-sm font-bold text-white">Whole Page</div>
                <div className="text-xs text-slate-500">No specific element selected.</div>
              </div>
            )}
          </div>

          <button 
            onClick={() => setStep(4)}
            className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold transition-colors flex items-center justify-center gap-2 cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-slate-950"
          >
            Continue <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* STEP 4: FORM */}
      {step === 4 && (
        <div className="animate-fadeIn space-y-4 flex flex-col h-full" role="region" aria-live="polite">
          <button onClick={() => setStep(3)} className="text-xs text-slate-500 hover:text-white flex items-center gap-1 -mt-2 mb-2 focus:outline-none focus:underline">
            &larr; Back
          </button>
          <h3 className="text-lg font-bold text-white">Details</h3>
          
          <form onSubmit={submitFeedback} className="flex-1 flex flex-col space-y-4 mt-2">
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Description</label>
              <div className="relative">
                <textarea
                  required
                  autoFocus
                  rows={4}
                  value={newFeedbackText}
                  onChange={(e) => setNewFeedbackText(e.target.value)}
                  placeholder="What's on your mind?"
                  className="w-full bg-slate-900/50 border border-white/[0.1] rounded-xl p-3 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-indigo-500/50 focus:bg-slate-900 transition-all resize-none"
                />
                
                {/* Voice Input Button */}
                {isSupported && (
                  <button
                    type="button"
                    onClick={handleVoiceToggle}
                    className={`absolute bottom-3 right-3 p-2 rounded-lg border cursor-pointer transition-all focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                      isListening 
                        ? 'bg-rose-500/20 border-rose-500/50 text-rose-400 animate-pulse'
                        : 'bg-slate-800 border-white/[0.05] text-slate-400 hover:bg-slate-700 hover:text-white'
                    }`}
                    title="Voice Input"
                  >
                    {isListening ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Contact (Optional)</label>
              <input
                type="text"
                value={newFeedbackContact}
                onChange={(e) => setNewFeedbackContact(e.target.value)}
                placeholder="Email or Telegram handle"
                className="w-full bg-slate-900/50 border border-white/[0.1] rounded-xl p-3 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-indigo-500/50 focus:bg-slate-900 transition-all"
              />
            </div>

            {error && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-lg flex items-center gap-2 text-rose-400 text-xs">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                {error}
              </div>
            )}

            <div className="flex-1 min-h-[20px]" />

            <button 
              type="submit"
              disabled={isSubmitting || !newFeedbackText.trim()}
              className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold transition-colors flex items-center justify-center gap-2 cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-slate-950"
            >
              {isSubmitting ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Sending...
                </>
              ) : (
                'Submit Feedback'
              )}
            </button>
          </form>
        </div>
      )}

      {/* STEP 5: SUCCESS */}
      {step === 5 && (
        <div className="animate-fadeIn flex-1 flex flex-col items-center justify-center text-center space-y-6" role="region" aria-live="assertive">
          <div className="w-20 h-20 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400">
            <CheckCircle2 className="w-10 h-10" />
          </div>
          
          <div className="space-y-2">
            <h3 className="text-xl font-bold text-white">Thank You!</h3>
            <p className="text-sm text-slate-400 max-w-[200px] mx-auto">
              Your feedback has been successfully submitted to the team.
            </p>
          </div>

          <div className="flex flex-col gap-3 w-full pt-8">
            <button 
              onClick={() => setIsOpen(false)}
              className="w-full py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-slate-500"
            >
              Close Widget
            </button>
            <button 
              onClick={resetFlow}
              className="text-xs text-indigo-400 hover:text-indigo-300 font-medium transition-colors cursor-pointer focus:outline-none focus:underline"
            >
              Send another feedback
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
