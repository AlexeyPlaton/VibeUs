import React from 'react';
import { MessageSquarePlus, Plus, Check, Sparkles, Mic, MicOff } from 'lucide-react';
import { useVoiceInput } from '../hooks/useVoiceInput';
import { trackEvent } from '../telemetry';

export const FeedbackView = ({ state }: { state: any }) => {
  const {
    isPublicMode, t18n, setIsAddingFeedback, isAddingFeedback,
    handleSubmitFeedback, newFeedbackText, setNewFeedbackText,
    newFeedbackContact, setNewFeedbackContact, accentTheme,
    feedbacksList, handleConvertFeedbackToTicket, currentLanguage
  } = state;

  const { isListening, isSupported, toggleListening } = useVoiceInput(currentLanguage || 'ru');

  const handleVoiceToggle = () => {
    trackEvent('voice_feedback_clicked');
    toggleListening((text) => {
      setNewFeedbackText((prev: string) => prev ? `${prev} ${text}` : text);
      trackEvent('voice_feedback_transcribed');
    });
  };

  return (
    <div className="flex-1 flex flex-col p-4 sm:p-6 bg-transparent overflow-y-auto space-y-4 font-['Plus_Jakarta_Sans',sans-serif]">
      <div className="spatial-card flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <MessageSquarePlus className="w-4 h-4 text-indigo-400" />
            {isPublicMode ? t18n('widget.leave_feedback') : t18n('feedback.title')}
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            {isPublicMode 
              ? t18n('feedback.public_desc') 
              : t18n('feedback.description')}
          </p>
        </div>
        <button
          onClick={() => setIsAddingFeedback(true)}
          className="flex items-center justify-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white px-3.5 py-2 rounded-xl text-xs font-semibold cursor-pointer transition-all shadow-md shadow-indigo-600/30"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>{t18n('widget.leave_feedback')}</span>
        </button>
      </div>

      {isAddingFeedback && (
        <form onSubmit={handleSubmitFeedback} className="spatial-card border-indigo-500/30 bg-indigo-500/[0.03] space-y-3 animate-fadeIn">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-200">{t18n('feedback.placeholder')}</span>
            {isSupported && (
              <button
                type="button"
                onClick={handleVoiceToggle}
                className={`flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-lg font-medium transition-all cursor-pointer ${
                  isListening
                    ? 'bg-rose-500 text-white animate-pulse shadow-xs shadow-rose-500/50'
                    : 'bg-white/[0.06] hover:bg-white/[0.12] text-slate-300'
                }`}
                title={t18n('feedback.voice_title')}
              >
                {isListening ? <MicOff className="w-3 h-3" /> : <Mic className="w-3 h-3 text-rose-400" />}
                <span>{isListening ? t18n('feedback.listening') : t18n('feedback.voice')}</span>
              </button>
            )}
          </div>
          <textarea
            value={newFeedbackText}
            onChange={(e) => setNewFeedbackText(e.target.value)}
            rows={3}
            placeholder={t18n('feedback.placeholder')}
            className="w-full bg-slate-900 border border-slate-700/60 rounded-xl p-3 text-xs text-white placeholder:text-slate-500 outline-none focus:border-indigo-500 leading-relaxed font-sans"
            required
            autoFocus
          />
          <div className="flex items-center justify-between gap-2 flex-wrap sm:flex-nowrap">
            <input
              type="text"
              value={newFeedbackContact}
              onChange={(e) => setNewFeedbackContact(e.target.value)}
              placeholder={t18n('feedback.contact_placeholder')}
              className="bg-slate-900 border border-slate-700/60 rounded-xl px-3 py-2 text-xs text-white placeholder:text-slate-500 outline-none flex-1 max-w-[280px] focus:border-indigo-500"
            />
            <div className="flex gap-2">
              <button 
                type="button" 
                onClick={() => setIsAddingFeedback(false)} 
                className="text-xs text-slate-400 hover:text-white px-3 py-1.5 rounded-xl cursor-pointer"
              >
                {t18n('feedback.cancel')}
              </button>
              <button 
                type="submit" 
                className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold px-4 py-2 rounded-xl cursor-pointer shadow-md shadow-indigo-600/30 transition-all"
              >
                {t18n('feedback.send')}
              </button>
            </div>
          </div>
        </form>
      )}

      {feedbacksList.length === 0 ? (
        <div className="p-8 text-center spatial-card border-dashed border-white/[0.08] text-xs text-slate-400 font-medium">
          {t18n('feedback.empty')}
        </div>
      ) : (
        <div className="space-y-3">
          {feedbacksList.map((fb: any) => (
            <div key={fb.id} className="spatial-card stagger-card space-y-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-semibold text-slate-100">{fb.author}</span>
                  {fb.contact && (
                    <span className="tag-spatial font-mono text-[10px]">
                      {fb.contact}
                    </span>
                  )}
                  <span className="text-[10px] text-slate-500">{fb.created_at}</span>
                </div>
                {!isPublicMode && (
                  fb.status === 'converted' ? (
                    <span className="tag-spatial bg-emerald-500/15 text-emerald-300 border-emerald-500/30 flex items-center gap-1">
                      <Check className="w-3 h-3" /> {t18n('feedback.in_backlog')} ({fb.converted_ticket_id})
                    </span>
                  ) : (
                    <button
                      onClick={() => handleConvertFeedbackToTicket(fb)}
                      className="flex items-center gap-1.5 text-[11px] font-semibold bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 border border-indigo-500/30 px-3 py-1 rounded-xl cursor-pointer transition-all shadow-xs"
                    >
                      <Sparkles className="w-3.5 h-3.5" /> {t18n('feedback.convert_to_ai_ticket')}
                    </button>
                  )
                )}
              </div>
              {fb.quote && (
                <p className="text-[11px] text-amber-200 bg-amber-500/10 p-2.5 rounded-xl border border-amber-500/20 italic">
                  💬 {t18n('feedback.site_fragment')} "{fb.quote}"
                </p>
              )}
              <p className="text-xs text-slate-300 leading-relaxed font-normal">{fb.text}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
