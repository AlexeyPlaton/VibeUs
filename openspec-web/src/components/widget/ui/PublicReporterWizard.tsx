import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Bug,
  CheckCircle2,
  HelpCircle,
  Lightbulb,
  Mic,
  MicOff,
  MousePointer2,
  RefreshCw,
  Send,
} from 'lucide-react';
import { useVoiceInput } from '../hooks/useVoiceInput';
import { trackEvent } from '../telemetry';

interface PublicReporterWizardProps {
  state: any;
}

type FeedbackType = 'bug' | 'idea' | 'question';

export const PublicReporterWizard: React.FC<PublicReporterWizardProps> = ({ state }) => {
  const {
    t18n,
    projectId,
    handleSubmitFeedback,
    newFeedbackText,
    setNewFeedbackText,
    newFeedbackContact,
    setNewFeedbackContact,
    currentLanguage,
    inspectedElementData,
    setInspectedElementData,
    handleToggleInspector,
    setIsOpen,
  } = state;

  const [feedbackType, setFeedbackType] = useState<FeedbackType>('bug');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const draftKey = useMemo(
    () => `vibus_feedback_draft_text:${String(projectId || 'default')}`,
    [projectId],
  );
  const contactKey = useMemo(
    () => `vibus_feedback_draft_contact:${String(projectId || 'default')}`,
    [projectId],
  );

  const { isListening, isSupported, toggleListening } = useVoiceInput(currentLanguage || 'en');

  useEffect(() => {
    try {
      const draftText = localStorage.getItem(draftKey);
      const draftContact = sessionStorage.getItem(contactKey);
      if (draftText) setNewFeedbackText(draftText);
      if (draftContact) setNewFeedbackContact(draftContact);
    } catch {
      // Storage can be unavailable in privacy/sandboxed browsing contexts.
    }
  }, [draftKey, contactKey, setNewFeedbackContact, setNewFeedbackText]);

  useEffect(() => {
    try {
      if (newFeedbackText) localStorage.setItem(draftKey, newFeedbackText);
      else localStorage.removeItem(draftKey);
      if (newFeedbackContact) sessionStorage.setItem(contactKey, newFeedbackContact);
      else sessionStorage.removeItem(contactKey);
    } catch {
      // Draft persistence is a convenience only and must never block feedback.
    }
  }, [draftKey, contactKey, newFeedbackContact, newFeedbackText]);

  const chooseType = (type: FeedbackType) => {
    setFeedbackType(type);
    trackEvent('feedback_type_selected', { type });
  };

  const handleVoiceToggle = () => {
    trackEvent('voice_feedback_clicked');
    toggleListening((text) => {
      setNewFeedbackText((prev: string) => (prev ? `${prev} ${text}` : text));
      trackEvent('voice_feedback_transcribed');
    });
  };

  const submitFeedback = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = newFeedbackText.trim();
    if (!clean || isSubmitting) return;

    setIsSubmitting(true);
    setError(null);
    const originalText = newFeedbackText;
    const prefix = feedbackType === 'bug' ? '[Bug] ' : feedbackType === 'idea' ? '[Idea] ' : '[Question] ';

    try {
      await handleSubmitFeedback(e, prefix + clean);
      try {
        localStorage.removeItem(draftKey);
        sessionStorage.removeItem(contactKey);
      } catch {}
      setNewFeedbackText('');
      setNewFeedbackContact('');
      setInspectedElementData(null);
      setSubmitted(true);
      trackEvent('feedback_submitted_success', { type: feedbackType });
    } catch (err) {
      setNewFeedbackText(originalText);
      setError(t18n('feedback.submit_error', 'Failed to submit. Please check your connection and try again.'));
      trackEvent('feedback_submit_error', { error: String(err) });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-5 p-6 text-center" role="status" aria-live="polite">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400">
          <CheckCircle2 className="h-8 w-8" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-white">{t18n('public_feedback.success_title', 'Thank you')}</h3>
          <p className="mt-2 max-w-xs text-sm text-slate-400">
            {t18n('public_feedback.success_copy', 'Your feedback has been sent to the team with the captured page context.')}
          </p>
        </div>
        <div className="flex w-full max-w-xs flex-col gap-2">
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            className="rounded-xl bg-white px-4 py-3 text-sm font-bold text-slate-950 hover:bg-slate-200"
          >
            {t18n('public_feedback.close', 'Close')}
          </button>
          <button
            type="button"
            onClick={() => setSubmitted(false)}
            className="rounded-xl px-4 py-2 text-xs font-semibold text-indigo-300 hover:text-indigo-200"
          >
            {t18n('public_feedback.another', 'Send another')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submitFeedback} className="flex flex-1 flex-col gap-4 overflow-y-auto p-4 sm:p-5">
      <div>
        <h3 className="text-lg font-bold text-white">{t18n('public_feedback.title', 'Send feedback')}</h3>
        <p className="mt-1 text-xs leading-relaxed text-slate-400">
          {t18n('public_feedback.subtitle', 'Describe what you noticed. Point to an element only when it helps.')}
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2" aria-label={t18n('public_feedback.type_label', 'Feedback type')}>
        {([
          ['bug', Bug, t18n('public_feedback.type_bug', 'Issue')],
          ['idea', Lightbulb, t18n('public_feedback.type_idea', 'Idea')],
          ['question', HelpCircle, t18n('public_feedback.type_question', 'Question')],
        ] as const).map(([type, Icon, label]) => (
          <button
            key={type}
            type="button"
            onClick={() => chooseType(type)}
            aria-pressed={feedbackType === type}
            className={`flex min-h-11 items-center justify-center gap-1.5 rounded-xl border px-2 text-xs font-bold transition ${
              feedbackType === type
                ? 'border-indigo-400/50 bg-indigo-500/15 text-indigo-100'
                : 'border-white/10 bg-white/[0.03] text-slate-400 hover:bg-white/[0.06] hover:text-white'
            }`}
          >
            <Icon className="h-3.5 w-3.5" />{label}
          </button>
        ))}
      </div>

      <div className="relative">
        <textarea
          required
          autoFocus
          rows={5}
          value={newFeedbackText}
          onChange={(e) => setNewFeedbackText(e.target.value)}
          placeholder={t18n('public_feedback.description_placeholder', 'What happened, what did you expect, or what could be better?')}
          className="min-h-32 w-full resize-y rounded-2xl border border-white/10 bg-slate-950/55 p-4 pr-12 text-sm text-white outline-none placeholder:text-slate-600 focus:border-indigo-400/50"
        />
        {isSupported && (
          <button
            type="button"
            onClick={handleVoiceToggle}
            title={t18n('public_feedback.voice', 'Voice input')}
            className={`absolute bottom-3 right-3 rounded-lg border p-2 transition ${
              isListening
                ? 'border-rose-400/40 bg-rose-500/15 text-rose-300'
                : 'border-white/10 bg-slate-900 text-slate-400 hover:text-white'
            }`}
          >
            {isListening ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
          </button>
        )}
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-bold text-slate-200">
              {inspectedElementData
                ? t18n('public_feedback.context_element', 'Element attached')
                : t18n('public_feedback.context_page', 'Whole page context')}
            </div>
            <div className="mt-1 truncate font-mono text-[10px] text-slate-500">
              {inspectedElementData?.selector || t18n('public_feedback.context_page_help', 'URL + viewport will be attached')}
            </div>
          </div>
          <button
            type="button"
            onClick={handleToggleInspector}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-indigo-400/25 bg-indigo-500/10 px-3 py-2 text-xs font-bold text-indigo-200 hover:bg-indigo-500/15"
          >
            <MousePointer2 className="h-3.5 w-3.5" />
            {inspectedElementData
              ? t18n('public_feedback.change_element', 'Change')
              : t18n('public_feedback.select_element', 'Point to element')}
          </button>
        </div>
      </div>

      <input
        type="text"
        value={newFeedbackContact}
        onChange={(e) => setNewFeedbackContact(e.target.value)}
        placeholder={t18n('public_feedback.contact_placeholder', 'Email or contact (optional)')}
        className="w-full rounded-xl border border-white/10 bg-slate-950/45 px-3.5 py-3 text-sm text-white outline-none placeholder:text-slate-600 focus:border-indigo-400/50"
      />

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-500/25 bg-rose-500/10 p-3 text-xs text-rose-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}
        </div>
      )}

      <button
        type="submit"
        disabled={isSubmitting || !newFeedbackText.trim()}
        className="mt-auto inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-indigo-500 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-indigo-950/30 transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isSubmitting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        {isSubmitting ? t18n('public_feedback.sending', 'Sending…') : t18n('public_feedback.submit', 'Send feedback')}
      </button>
    </form>
  );
};
