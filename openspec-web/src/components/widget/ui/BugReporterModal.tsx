import React, { useState, useEffect } from 'react';
import { X, Code2, AlertTriangle, Database, Check, Bug, Lightbulb, MessageSquare, Sparkles, Mic, MicOff, Server, Trash2 } from 'lucide-react';
import { useVoiceInput } from '../hooks/useVoiceInput';
import { trackEvent } from '../telemetry';
import { telemetry, type NetworkLogEntry, type ConsoleLogEntry } from '../networkTelemetry';

export const BugReporterModal = ({ state }: { state: any }) => {
  const {
    t18n, setIsBugModalOpen, handleCreateBugReportTicket,
    bugCategory, setBugCategory,
    bugTitle, setBugTitle,
    bugExpected, setBugExpected,
    bugActual, setBugActual,
    bugPriority, setBugPriority,
    bugAdditionalInfo,
    inspectedElementData,
    currentLanguage
  } = state;

  const { isListening, isSupported, toggleListening } = useVoiceInput(currentLanguage || 'ru');
  const [activeVoiceTarget, setActiveVoiceTarget] = useState<'title' | 'actual' | 'idea' | null>(null);

  // Live attached logs state with individual deletion and confirmation
  const [attachedLogs, setAttachedLogs] = useState<NetworkLogEntry[]>(() => telemetry.getRecentErrors(false).networkErrors);
  const [attachedConsoleLogs, setAttachedConsoleLogs] = useState<ConsoleLogEntry[]>(() => telemetry.getRecentErrors(false).jsErrors);
  const [deletingLogId, setDeletingLogId] = useState<string | null>(null);

  const handleRemoveLog = (id: string) => {
    setAttachedLogs(prev => prev.filter(l => l.id !== id));
    telemetry.removeNetworkLog(id);
    setDeletingLogId(null);
    trackEvent('telemetry_log_removed', { id });
  };

  const handleClearAllLogs = () => {
    setAttachedLogs([]);
    setAttachedConsoleLogs([]);
    telemetry.clearAllLogs();
    setDeletingLogId(null);
    trackEvent('telemetry_all_logs_cleared');
  };

  const handleVoiceToggle = (target: 'title' | 'actual' | 'idea') => {
    setActiveVoiceTarget(target);
    trackEvent('voice_input_clicked', { target });
    toggleListening((text) => {
      if (target === 'title') {
        setBugTitle((prev: string) => prev ? `${prev} ${text}` : text);
      } else if (target === 'actual') {
        setBugActual((prev: string) => prev ? `${prev} ${text}` : text);
      } else if (target === 'idea') {
        setIdeaDesc((prev: string) => prev ? `${prev} ${text}` : text);
      }
      trackEvent('voice_input_transcribed', { target });
    });
  };

  const [reportType, setReportType] = useState<'bug' | 'idea' | 'question'>('bug');
  
  // Bug fields
  const [bugSteps, setBugSteps] = useState('');
  
  // Idea fields
  const [ideaTitle, setIdeaTitle] = useState('');
  const [ideaCategory, setIdeaCategory] = useState<'ui' | 'feature' | 'ux'>('feature');
  const [ideaDesc, setIdeaDesc] = useState('');
  const [ideaBenefit, setIdeaBenefit] = useState('');
  const [ideaImplementation, setIdeaImplementation] = useState('');

  // Question fields
  const [questionTitle, setQuestionTitle] = useState('');
  const [questionCategory, setQuestionCategory] = useState<'api' | 'tz' | 'ui' | 'general'>('tz');
  const [questionText, setQuestionText] = useState('');
  const [questionContext, setQuestionContext] = useState('');
  const [questionOptions, setQuestionOptions] = useState('');

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsBugModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setIsBugModalOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (reportType === 'idea') {
      if (!ideaTitle.trim()) return;
      handleCreateBugReportTicket(e, {
        reportType: 'idea',
        title: ideaTitle.trim(),
        category: ideaCategory === 'ui' ? t18n('v7.bug.cat_ui') : ideaCategory === 'ux' ? t18n('v7.bug.cat_ux') : t18n('v7.bug.cat_feature'),
        priority: bugPriority,
        ideaDesc: ideaDesc.trim(),
        ideaBenefit: ideaBenefit.trim(),
        ideaImplementation: ideaImplementation.trim(),
      });
    } else if (reportType === 'question') {
      if (!questionTitle.trim()) return;
      handleCreateBugReportTicket(e, {
        reportType: 'question',
        title: questionTitle.trim(),
        category: questionCategory === 'api' ? t18n('v7.bug.cat_api') : questionCategory === 'tz' ? t18n('v7.bug.cat_requirements') : questionCategory === 'ui' ? t18n('v7.bug.cat_design') : t18n('v7.bug.cat_general'),
        priority: bugPriority,
        questionText: questionText.trim(),
        questionContext: questionContext.trim(),
        questionOptions: questionOptions.trim(),
      });
    } else {
      if (!bugTitle.trim()) return;
      handleCreateBugReportTicket(e, {
        reportType: 'bug',
        title: bugTitle.trim(),
        category: bugCategory,
        priority: bugPriority,
        steps: bugSteps.trim(),
        expected: bugExpected.trim(),
        actual: bugActual.trim(),
        additionalInfo: bugAdditionalInfo.trim(),
        attachedNetworkLogs: attachedLogs,
        attachedConsoleLogs: attachedConsoleLogs,
      });
    }
  };

  return (
    <div 
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          setIsBugModalOpen(false);
        }
      }}
      className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-[99999999] flex items-center justify-center p-3 sm:p-6 font-['Plus_Jakarta_Sans',sans-serif] animate-fadeIn"
    >
      <div className="bg-slate-900/95 backdrop-blur-2xl text-slate-100 rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[88vh] border border-slate-700/60 animate-scaleIn">
        {/* HEADER */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-white/[0.08] bg-slate-900/80 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 border ${
              reportType === 'bug' ? 'bg-rose-500/10 border-rose-500/20 text-rose-400' :
              reportType === 'idea' ? 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400' :
              'bg-sky-500/10 border-sky-500/20 text-sky-400'
            }`}>
              {reportType === 'bug' && <Bug className="w-4 h-4" />}
              {reportType === 'idea' && <Lightbulb className="w-4 h-4" />}
              {reportType === 'question' && <MessageSquare className="w-4 h-4" />}
            </div>
            <div>
              <h2 className="text-sm font-bold text-white leading-tight">
                {reportType === 'bug' && t18n('modal.bug_header')}
                {reportType === 'idea' && t18n('modal.idea_header')}
                {reportType === 'question' && t18n('modal.question_header')}
              </h2>
              <p className="text-[11px] text-slate-400">{t18n('modal.subtitle')}</p>
            </div>
          </div>
          <button 
            type="button"
            onClick={() => setIsBugModalOpen(false)} 
            className="w-8 h-8 rounded-full bg-white/[0.05] border border-white/[0.08] flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/[0.1] transition-colors cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* TYPE SWITCHER */}
        <div className="px-5 pt-4">
          <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-950/80 rounded-2xl border border-white/[0.08]">
            <button
              type="button"
              onClick={() => setReportType('bug')}
              className={`flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                reportType === 'bug' ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30 shadow-xs' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Bug className="w-3.5 h-3.5" />
              <span>{t18n('modal.tab_bug')}</span>
            </button>
            <button
              type="button"
              onClick={() => setReportType('idea')}
              className={`flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                reportType === 'idea' ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 shadow-xs' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Lightbulb className="w-3.5 h-3.5" />
              <span>{t18n('modal.tab_idea')}</span>
            </button>
            <button
              type="button"
              onClick={() => setReportType('question')}
              className={`flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                reportType === 'question' ? 'bg-sky-500/20 text-sky-300 border border-sky-500/30 shadow-xs' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>{t18n('modal.tab_question')}</span>
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-5 flex-1 min-h-0 overflow-y-auto space-y-4">
          {/* ===================== BUG MODE FIELDS ===================== */}
          {reportType === 'bug' && (
            <>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300">{t18n('modal.category')}</label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setBugCategory('ui')}
                    className={`flex flex-col items-center justify-center gap-1.5 p-2.5 rounded-2xl border transition-all cursor-pointer ${
                      bugCategory === 'ui' ? 'border-indigo-500 bg-indigo-500/20 text-white shadow-sm' : 'border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.06] text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Code2 className="w-4 h-4 text-pink-400" />
                    <span className="text-[11px] font-semibold">{t18n('modal.category_ui')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setBugCategory('backend')}
                    className={`flex flex-col items-center justify-center gap-1.5 p-2.5 rounded-2xl border transition-all cursor-pointer ${
                      bugCategory === 'backend' ? 'border-indigo-500 bg-indigo-500/20 text-white shadow-sm' : 'border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.06] text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Database className="w-4 h-4 text-sky-400" />
                    <span className="text-[11px] font-semibold">{t18n('modal.category_backend')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setBugCategory('logic')}
                    className={`flex flex-col items-center justify-center gap-1.5 p-2.5 rounded-2xl border transition-all cursor-pointer ${
                      bugCategory === 'logic' ? 'border-indigo-500 bg-indigo-500/20 text-white shadow-sm' : 'border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.06] text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <AlertTriangle className="w-4 h-4 text-indigo-400" />
                    <span className="text-[11px] font-semibold">{t18n('modal.category_logic')}</span>
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-300">{t18n('modal.title_label')}</label>
                  {isSupported && (
                    <button
                      type="button"
                      onClick={() => handleVoiceToggle('title')}
                      className={`flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-lg font-medium transition-all cursor-pointer ${
                        isListening && activeVoiceTarget === 'title'
                          ? 'bg-rose-500 text-white animate-pulse shadow-xs shadow-rose-500/50'
                          : 'bg-white/[0.06] hover:bg-white/[0.12] text-slate-300'
                      }`}
                      title={t18n('modal.voice_dictate_title')}
                    >
                      {isListening && activeVoiceTarget === 'title' ? <MicOff className="w-3 h-3" /> : <Mic className="w-3 h-3 text-rose-400" />}
                      <span>{isListening && activeVoiceTarget === 'title' ? t18n('modal.voice_listening') : t18n('modal.voice_btn')}</span>
                    </button>
                  )}
                </div>
                <input
                  type="text"
                  value={bugTitle}
                  onChange={(e) => setBugTitle(e.target.value)}
                  placeholder={t18n('modal.title_placeholder')}
                  className="w-full bg-slate-900 border border-slate-700/60 rounded-xl px-3 py-2 text-xs text-white placeholder:text-slate-500 outline-none focus:border-indigo-500 font-medium"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300">{t18n('modal.steps_label')}</label>
                <textarea
                  value={bugSteps}
                  onChange={(e) => setBugSteps(e.target.value)}
                  rows={2}
                  placeholder={t18n('modal.steps_placeholder')}
                  className="w-full bg-slate-900 border border-slate-700/60 rounded-xl p-3 text-xs outline-none focus:border-indigo-500 text-slate-200 placeholder:text-slate-500 resize-y"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-emerald-400">{t18n('modal.expected_label')}</label>
                  <textarea
                    value={bugExpected}
                    onChange={(e) => setBugExpected(e.target.value)}
                    rows={2}
                    placeholder={t18n('modal.expected_placeholder')}
                    className="w-full bg-emerald-500/[0.07] border border-emerald-500/20 rounded-xl p-3 text-xs outline-none focus:border-emerald-500/40 text-emerald-200 placeholder:text-emerald-500/50 resize-y"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-rose-400">{t18n('modal.actual_label')}</label>
                    {isSupported && (
                      <button
                        type="button"
                        onClick={() => handleVoiceToggle('actual')}
                        className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-lg font-medium transition-all cursor-pointer ${
                          isListening && activeVoiceTarget === 'actual'
                            ? 'bg-rose-500 text-white animate-pulse'
                            : 'bg-white/[0.06] hover:bg-white/[0.12] text-rose-300'
                        }`}
                        title={t18n('modal.voice_dictate_body')}
                      >
                        <Mic className="w-2.5 h-2.5" />
                        <span>{isListening && activeVoiceTarget === 'actual' ? t18n('modal.voice_recording') : t18n('modal.voice_btn')}</span>
                      </button>
                    )}
                  </div>
                  <textarea
                    value={bugActual}
                    onChange={(e) => setBugActual(e.target.value)}
                    rows={2}
                    placeholder={t18n('modal.actual_placeholder')}
                    className="w-full bg-rose-500/[0.07] border border-rose-500/20 rounded-xl p-3 text-xs outline-none focus:border-rose-500/40 text-rose-200 placeholder:text-rose-500/50 resize-y"
                    required
                  />
                </div>
              </div>

              {inspectedElementData && bugCategory === 'ui' && (
                <div className="bg-slate-900/90 text-slate-300 p-3 rounded-2xl border border-white/[0.08] space-y-1.5 font-mono text-[11px]">
                  <span className="font-semibold text-indigo-300 font-sans block">{t18n('modal.auto_context')}</span>
                  <div><span className="text-slate-500">URL:</span> {inspectedElementData.url}</div>
                  <div><span className="text-slate-500">Selector:</span> {inspectedElementData.selector}</div>
                  <div><span className="text-slate-500">Text:</span> {inspectedElementData.elementText || 'N/A'}</div>
                </div>
              )}

              {/* Telemetry & Network Logs preview with individual delete & confirmation */}
              {attachedLogs.length > 0 && (
                <div className="bg-slate-950/90 p-3 rounded-2xl border border-rose-500/30 space-y-2">
                  <div className="flex items-center justify-between text-xs font-bold text-rose-400">
                    <span className="flex items-center gap-1.5">
                      <Server className="w-3.5 h-3.5" />
                      {t18n('v7.bug.api_failures')}
                    </span>
                    <button
                      type="button"
                      onClick={handleClearAllLogs}
                      className="text-[10px] text-slate-400 hover:text-rose-300 transition-colors underline cursor-pointer"
                    >
                      {t18n('v7.bug.clear_all')}
                    </button>
                  </div>
                  <div className="space-y-1.5 max-h-36 overflow-y-auto font-mono text-[11px]">
                    {attachedLogs.map((net) => (
                      <div key={net.id} className="p-2 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-between gap-2">
                        <div className="min-w-0 flex-1 truncate">
                          <span className="font-bold text-rose-400 mr-1.5">{net.status || 'FAIL'}</span>
                          <span className="text-white font-semibold">{net.method}</span>
                          <span className="text-slate-300 ml-1 truncate">{net.url}</span>
                          <span className="text-slate-500 text-[10px] ml-1.5">({net.durationMs}ms)</span>
                        </div>
                        {deletingLogId === net.id ? (
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleRemoveLog(net.id)}
                              className="px-2 py-0.5 rounded-lg bg-rose-600 text-white text-[10px] font-bold hover:bg-rose-500 transition-colors cursor-pointer"
                            >
                              {t18n('v7.bug.delete_q')}
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeletingLogId(null)}
                              className="px-1.5 py-0.5 rounded-lg bg-white/10 text-slate-300 text-[10px] hover:bg-white/20 transition-colors cursor-pointer"
                            >
                              {t18n('v7.bug.cancel')}
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setDeletingLogId(net.id)}
                            title={t18n('v7.bug.exclude_log')}
                            className="w-6 h-6 rounded-lg bg-white/5 hover:bg-rose-500/20 text-slate-400 hover:text-rose-300 flex items-center justify-center transition-colors cursor-pointer shrink-0"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* ===================== IDEA MODE FIELDS ===================== */}
          {reportType === 'idea' && (
            <>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300">{t18n('modal.category')}</label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setIdeaCategory('feature')}
                    className={`flex flex-col items-center justify-center gap-1.5 p-2.5 rounded-2xl border transition-all cursor-pointer ${
                      ideaCategory === 'feature' ? 'border-indigo-500 bg-indigo-500/20 text-white shadow-sm' : 'border-white/[0.08] bg-white/[0.03] text-slate-400'
                    }`}
                  >
                    <Sparkles className="w-4 h-4 text-indigo-400" />
                    <span className="text-[11px] font-semibold">{t18n('modal.category_feature')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setIdeaCategory('ui')}
                    className={`flex flex-col items-center justify-center gap-1.5 p-2.5 rounded-2xl border transition-all cursor-pointer ${
                      ideaCategory === 'ui' ? 'border-indigo-500 bg-indigo-500/20 text-white shadow-sm' : 'border-white/[0.08] bg-white/[0.03] text-slate-400'
                    }`}
                  >
                    <Code2 className="w-4 h-4 text-pink-400" />
                    <span className="text-[11px] font-semibold">{t18n('modal.category_ui')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setIdeaCategory('ux')}
                    className={`flex flex-col items-center justify-center gap-1.5 p-2.5 rounded-2xl border transition-all cursor-pointer ${
                      ideaCategory === 'ux' ? 'border-indigo-500 bg-indigo-500/20 text-white shadow-sm' : 'border-white/[0.08] bg-white/[0.03] text-slate-400'
                    }`}
                  >
                    <Lightbulb className="w-4 h-4 text-amber-400" />
                    <span className="text-[11px] font-semibold">{t18n('modal.category_ux')}</span>
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300">{t18n('modal.idea_title_label')}</label>
                <input
                  type="text"
                  value={ideaTitle}
                  onChange={(e) => setIdeaTitle(e.target.value)}
                  placeholder={t18n('modal.idea_title_placeholder')}
                  className="w-full bg-slate-900 border border-slate-700/60 rounded-xl px-3 py-2 text-xs text-white placeholder:text-slate-500 outline-none focus:border-indigo-500 font-medium"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-indigo-300">{t18n('modal.idea_desc_label')}</label>
                <textarea
                  value={ideaDesc}
                  onChange={(e) => setIdeaDesc(e.target.value)}
                  rows={3}
                  placeholder={t18n('modal.idea_desc_placeholder')}
                  className="w-full bg-indigo-500/[0.05] border border-indigo-500/20 rounded-xl p-3 text-xs outline-none focus:border-indigo-500 text-indigo-100 placeholder:text-slate-500 resize-y"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-emerald-400">{t18n('modal.idea_benefit_label')}</label>
                <textarea
                  value={ideaBenefit}
                  onChange={(e) => setIdeaBenefit(e.target.value)}
                  rows={2}
                  placeholder={t18n('modal.idea_benefit_placeholder')}
                  className="w-full bg-emerald-500/[0.05] border border-emerald-500/20 rounded-xl p-3 text-xs outline-none focus:border-emerald-500 text-emerald-100 placeholder:text-slate-500 resize-y"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300">{t18n('modal.idea_impl_label')}</label>
                <input
                  type="text"
                  value={ideaImplementation}
                  onChange={(e) => setIdeaImplementation(e.target.value)}
                  placeholder={t18n('modal.idea_impl_placeholder')}
                  className="w-full bg-slate-900 border border-slate-700/60 rounded-xl px-3 py-2 text-xs text-white placeholder:text-slate-500 outline-none focus:border-indigo-500"
                />
              </div>
            </>
          )}

          {/* ===================== QUESTION MODE FIELDS ===================== */}
          {reportType === 'question' && (
            <>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300">{t18n('modal.category')}</label>
                <div className="grid grid-cols-4 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setQuestionCategory('tz')}
                    className={`py-2 px-1 text-center rounded-xl border text-[11px] font-semibold transition-all cursor-pointer ${
                      questionCategory === 'tz' ? 'border-sky-500 bg-sky-500/20 text-white' : 'border-white/[0.08] bg-white/[0.03] text-slate-400'
                    }`}
                  >
                    {t18n('modal.category_tz')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setQuestionCategory('api')}
                    className={`py-2 px-1 text-center rounded-xl border text-[11px] font-semibold transition-all cursor-pointer ${
                      questionCategory === 'api' ? 'border-sky-500 bg-sky-500/20 text-white' : 'border-white/[0.08] bg-white/[0.03] text-slate-400'
                    }`}
                  >
                    {t18n('modal.category_api')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setQuestionCategory('ui')}
                    className={`py-2 px-1 text-center rounded-xl border text-[11px] font-semibold transition-all cursor-pointer ${
                      questionCategory === 'ui' ? 'border-sky-500 bg-sky-500/20 text-white' : 'border-white/[0.08] bg-white/[0.03] text-slate-400'
                    }`}
                  >
                    {t18n('modal.category_design')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setQuestionCategory('general')}
                    className={`py-2 px-1 text-center rounded-xl border text-[11px] font-semibold transition-all cursor-pointer ${
                      questionCategory === 'general' ? 'border-sky-500 bg-sky-500/20 text-white' : 'border-white/[0.08] bg-white/[0.03] text-slate-400'
                    }`}
                  >
                    {t18n('modal.category_general')}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300">{t18n('modal.question_title_label')}</label>
                <input
                  type="text"
                  value={questionTitle}
                  onChange={(e) => setQuestionTitle(e.target.value)}
                  placeholder={t18n('modal.question_title_placeholder')}
                  className="w-full bg-slate-900 border border-slate-700/60 rounded-xl px-3 py-2 text-xs text-white placeholder:text-slate-500 outline-none focus:border-indigo-500 font-medium"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-sky-300">{t18n('modal.question_text_label')}</label>
                <textarea
                  value={questionText}
                  onChange={(e) => setQuestionText(e.target.value)}
                  rows={3}
                  placeholder={t18n('modal.question_text_placeholder')}
                  className="w-full bg-sky-500/[0.05] border border-sky-500/20 rounded-xl p-3 text-xs outline-none focus:border-sky-500 text-sky-100 placeholder:text-slate-500 resize-y"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300">{t18n('modal.question_context_label')}</label>
                <textarea
                  value={questionContext}
                  onChange={(e) => setQuestionContext(e.target.value)}
                  rows={2}
                  placeholder={t18n('modal.question_context_placeholder')}
                  className="w-full bg-slate-900 border border-slate-700/60 rounded-xl p-3 text-xs outline-none focus:border-indigo-500 text-slate-200 placeholder:text-slate-500 resize-y"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300">{t18n('modal.question_options_label')}</label>
                <input
                  type="text"
                  value={questionOptions}
                  onChange={(e) => setQuestionOptions(e.target.value)}
                  placeholder={t18n('modal.question_options_placeholder')}
                  className="w-full bg-slate-900 border border-slate-700/60 rounded-xl px-3 py-2 text-xs text-white placeholder:text-slate-500 outline-none focus:border-indigo-500"
                />
              </div>
            </>
          )}

          {/* ===================== COMMON PRIORITY ===================== */}
          <div className="space-y-1.5 pt-1">
            <label className="text-xs font-semibold text-slate-300">{t18n('modal.priority_label')}</label>
            <select
              value={bugPriority}
              onChange={(e) => setBugPriority(e.target.value as any)}
              style={{ backgroundColor: '#0f172a', color: '#f8fafc' }}
              className="w-full bg-slate-900 border border-slate-700/60 rounded-xl px-3 py-2 text-xs text-slate-200 outline-none cursor-pointer"
            >
              <option value="low" style={{ backgroundColor: '#0f172a', color: '#f8fafc' }} className="bg-slate-900 text-white">{t18n('modal.priority_low')}</option>
              <option value="medium" style={{ backgroundColor: '#0f172a', color: '#f8fafc' }} className="bg-slate-900 text-white">{t18n('modal.priority_medium')}</option>
              <option value="high" style={{ backgroundColor: '#0f172a', color: '#f8fafc' }} className="bg-slate-900 text-white">{t18n('modal.priority_high')}</option>
            </select>
          </div>

          <div className="pt-3 flex items-center justify-end gap-2 border-t border-white/[0.06]">
            <button
              type="button"
              onClick={() => setIsBugModalOpen(false)}
              className="px-4 py-2.5 text-xs font-semibold text-slate-400 hover:text-white rounded-xl cursor-pointer hover:bg-white/[0.05] transition-colors"
            >
              {t18n('modal.cancel')}
            </button>
            <button
              type="submit"
              className="flex-1 sm:flex-initial bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-2.5 px-5 rounded-xl flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-indigo-600/30 transition-all text-xs"
            >
              <Check className="w-4 h-4" />
              <span>
                {reportType === 'bug' ? t18n('modal.submit_bug') : reportType === 'idea' ? t18n('modal.submit_idea') : t18n('modal.submit_question')}
              </span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
