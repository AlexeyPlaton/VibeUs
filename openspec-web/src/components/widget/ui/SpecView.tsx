import React from 'react';
import { SpecSidebar } from './SpecSidebar';
import { SpecToolbar } from './SpecToolbar';
import { MarkdownRenderer } from '../../MarkdownRenderer';
import { 
  CheckSquare, MessageCircle, Clock, Zap, Check, Edit3, Trash2, Plus, FileText
} from 'lucide-react';

export const SpecView = ({ state }: { state: any }) => {
  const {
    boardData, activeSpecNodeId, setActiveSpecNodeId,
    isAddingSection, setIsAddingSection,
    newSectionTitle, setNewSectionTitle,
    newSectionDesc, setNewSectionDesc,
    handleAddSection,
    inlineParentAddId, setInlineParentAddId,
    inlineChildTitle, setInlineChildTitle,
    handleAddInlineChildSection, handleDeleteSection,
    copyFullSpecForAI, copiedAllSpec, accentTheme,
    currentSpecNode,
    editingNodeId, setEditingNodeId,
    editingMarkdown, setEditingMarkdown,
    editingNodeTitle, setEditingNodeTitle,
    editingNodeDesc, setEditingNodeDesc,
    handleSaveNode, handleSaveNodeMarkdown,
    handleSpecMouseUp,
    selectedQuote, setSelectedQuote, handleStartDiscussion,
    setActiveDiscussionThread, setActiveDiscussionNodeId, setConvertedTicketTitle,
    insertSnippet, t18n
  } = state;

  return (
    <div className="flex-1 min-h-0 min-w-0 h-full flex overflow-hidden bg-transparent font-['Plus_Jakarta_Sans',sans-serif]">
      <SpecSidebar
        boardData={boardData}
        activeSpecNodeId={activeSpecNodeId}
        setActiveSpecNodeId={setActiveSpecNodeId}
        isAddingSection={isAddingSection}
        setIsAddingSection={setIsAddingSection}
        newSectionTitle={newSectionTitle}
        setNewSectionTitle={setNewSectionTitle}
        newSectionDesc={newSectionDesc}
        setNewSectionDesc={setNewSectionDesc}
        handleAddSection={handleAddSection}
        inlineParentAddId={inlineParentAddId}
        setInlineParentAddId={setInlineParentAddId}
        inlineChildTitle={inlineChildTitle}
        setInlineChildTitle={setInlineChildTitle}
        handleAddInlineChildSection={handleAddInlineChildSection}
        handleDeleteSection={handleDeleteSection}
        copyFullSpecForAI={copyFullSpecForAI}
        copiedAllSpec={copiedAllSpec}
        accentTheme={accentTheme}
      />

      {/* RIGHT MAIN SPEC DOCUMENT READER / EDITOR */}
      <div 
        onWheel={(e) => e.stopPropagation()}
        className="flex-1 min-h-0 min-w-0 h-full flex flex-col overflow-y-auto p-4 sm:p-6 space-y-4 relative custom-scrollbar overscroll-contain select-text"
      >
        {currentSpecNode ? (
          <>
            {/* DOCUMENT TITLE & HEADER */}
            <div className="flex items-start justify-between border-b border-white/[0.06] pb-4">
              <div className="flex-1 min-w-0 pr-3">
                <div className="flex items-center gap-2.5">
                  <span className="tag-spatial bg-indigo-500/10 text-indigo-300 border-indigo-500/20">
                    {t18n("legacy.spec_section")}
                  </span>
                  <h2 className="text-lg md:text-xl font-bold text-slate-100 tracking-tight truncate">{currentSpecNode.title}</h2>
                </div>
                {currentSpecNode.description && (
                  <p className="text-xs text-slate-400 mt-1 italic">
                    {currentSpecNode.description}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  if (editingNodeId === currentSpecNode.id) {
                    if (handleSaveNode) {
                      handleSaveNode(currentSpecNode.id);
                    } else if (handleSaveNodeMarkdown) {
                      handleSaveNodeMarkdown(currentSpecNode.id);
                    } else {
                      setEditingNodeId(null);
                    }
                  } else {
                    setEditingNodeId(currentSpecNode.id);
                    setEditingNodeTitle(currentSpecNode.title || '');
                    setEditingNodeDesc(currentSpecNode.description || '');
                    setEditingMarkdown(currentSpecNode.content_markdown || '');
                  }
                }}
                className="flex items-center gap-1.5 text-xs text-slate-200 hover:text-white font-semibold cursor-pointer px-3.5 py-2 hover:bg-white/[0.08] rounded-xl border border-white/[0.08] transition-all shadow-xs shrink-0"
              >
                <Edit3 className="w-3.5 h-3.5" />
                {editingNodeId === currentSpecNode.id ? t18n("legacy.complete") : t18n("legacy.edit")}
              </button>
            </div>

            {/* EDITING MODE WITH TITLE, DESC, CONFLUENCE SNIPPET TOOLBAR, AND MARKDOWN */}
            {editingNodeId === currentSpecNode.id ? (
              <div className="space-y-3.5 spatial-card border-indigo-500/30 bg-indigo-500/[0.03] animate-fadeIn p-4 sm:p-5">
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-slate-300 block">
                    {t18n('v7.spec.section_title')}
                  </label>
                  <input
                    type="text"
                    value={editingNodeTitle}
                    onChange={(e) => setEditingNodeTitle(e.target.value)}
                    placeholder={t18n('v7.spec.section_title_placeholder')}
                    className="w-full bg-slate-950 border border-slate-700/60 rounded-xl px-3 py-2 text-xs font-semibold text-white outline-none focus:border-indigo-500"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-semibold text-slate-300 block">
                    {t18n('v7.spec.section_desc')}
                  </label>
                  <input
                    type="text"
                    value={editingNodeDesc}
                    onChange={(e) => setEditingNodeDesc(e.target.value)}
                    placeholder={t18n('v7.spec.section_desc_placeholder')}
                    className="w-full bg-slate-950 border border-slate-700/60 rounded-xl px-3 py-2 text-xs text-slate-200 outline-none focus:border-indigo-500"
                  />
                </div>

                <div className="space-y-2 pt-1">
                  <label className="text-xs font-semibold text-slate-300 block">
                    {t18n('v7.spec.markdown')}
                  </label>
                  <SpecToolbar insertSnippet={insertSnippet} />

                  <textarea
                    value={editingMarkdown}
                    onChange={(e) => setEditingMarkdown(e.target.value)}
                    rows={14}
                    className="w-full max-w-full bg-slate-950 border border-slate-700/60 rounded-xl p-3.5 text-xs font-mono outline-none focus:border-indigo-500 leading-relaxed text-slate-200 overflow-y-auto whitespace-pre-wrap break-words resize-y min-h-[260px] max-h-[550px] shadow-inner selection:bg-indigo-600"
                    placeholder={t18n("legacy.write_specification_text")}
                  />
                </div>

                <div className="flex items-center justify-between gap-2 pt-2 border-t border-white/[0.06]">
                  {handleDeleteSection && (
                    <button
                      type="button"
                      onClick={() => handleDeleteSection(currentSpecNode.id)}
                      className="px-3 py-1.5 text-xs text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 rounded-xl cursor-pointer transition-colors flex items-center gap-1.5 font-semibold"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>{t18n('v7.spec.delete_section')}</span>
                    </button>
                  )}

                  <div className="flex items-center gap-2 ml-auto">
                    <button
                      type="button"
                      onClick={() => setEditingNodeId(null)}
                      className="px-3.5 py-2 text-xs font-semibold text-slate-400 hover:text-white rounded-xl cursor-pointer"
                    >
                      {t18n("legacy.cancel")}
                    </button>
                    <button
                      type="button"
                      onClick={() => (handleSaveNode ? handleSaveNode(currentSpecNode.id) : handleSaveNodeMarkdown(currentSpecNode.id))}
                      className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold px-5 py-2 rounded-xl cursor-pointer transition-all shadow-md shadow-indigo-600/30 flex items-center gap-1.5"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>{t18n("legacy.save")}</span>
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              /* RICH STYLED MARKDOWN VIEWER */
              <div className="bg-slate-900/60 rounded-2xl border border-white/[0.08] p-5 sm:p-6 space-y-4 select-text shadow-sm">
                <MarkdownRenderer 
                  content={currentSpecNode.content_markdown || ''}
                  onMouseUp={(e: any) => handleSpecMouseUp(e, currentSpecNode.id)}
                />
              </div>
            )}

            {/* FLOATING TEXT SELECTION BUBBLE */}
            {selectedQuote && (
              <div className="fixed bottom-20 right-10 z-50 bg-slate-900/95 backdrop-blur-2xl text-white px-4 py-2.5 rounded-2xl shadow-2xl flex items-center gap-3 animate-fadeIn border border-slate-700/60">
                <MessageCircle className="w-4 h-4 text-indigo-400" />
                <div className="text-xs">
                  <span className="text-slate-400">{t18n("legacy.quote")}</span> <b className="text-white italic">"{selectedQuote.slice(0, 25)}..."</b>
                </div>
                <button
                  type="button"
                  onClick={handleStartDiscussion}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold px-3 py-1 rounded-xl shadow-xs cursor-pointer ml-1 transition-colors"
                >
                  {t18n("legacy.discuss")}
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedQuote('')}
                  className="text-slate-400 hover:text-white text-sm cursor-pointer px-1"
                >
                  ×
                </button>
              </div>
            )}

            {/* ACTIVE DISCUSSIONS THREADS LIST */}
            {currentSpecNode.discussions && currentSpecNode.discussions.length > 0 && (
              <div className="spatial-card border-amber-500/20 bg-amber-500/5 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-amber-300 flex items-center gap-1.5">
                    <MessageCircle className="w-3.5 h-3.5 text-amber-400" />
                    {t18n("legacy.discussions_on_spec_text")} ({currentSpecNode.discussions.length}):
                  </span>
                </div>

                <div className="space-y-1.5">
                  {currentSpecNode.discussions.map((disc: any) => (
                    <div 
                      key={disc.id}
                      className="bg-slate-900/80 p-2.5 rounded-xl border border-white/[0.06] space-y-1.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="text-[11px] text-slate-300 truncate">
                          <span className="font-semibold text-amber-300 mr-1">{t18n("legacy.quote")}</span>
                          <span className="bg-amber-500/15 px-1.5 py-0.5 rounded text-amber-200 italic">"{disc.quote}"</span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {disc.status === 'resolved' ? (
                            <span className="text-[9px] font-bold text-emerald-300 bg-emerald-500/20 border border-emerald-500/30 px-2 py-0.5 rounded-full flex items-center gap-0.5">
                              <Check className="w-2.5 h-2.5" /> {t18n("legacy.resolved")}
                            </span>
                          ) : (
                            <span className="text-[9px] font-bold text-amber-300 bg-amber-500/20 border border-amber-500/30 px-2 py-0.5 rounded-full">
                              {t18n("legacy.in_discussion")}
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              setActiveDiscussionThread(disc);
                              setActiveDiscussionNodeId(currentSpecNode.id);
                              setConvertedTicketTitle(t18n('v7.spec.implement_prefix', { quote: disc.quote.slice(0, 45) }));
                            }}
                            className="text-[10px] font-semibold bg-white/[0.06] hover:bg-white/[0.1] text-white border border-white/[0.08] px-2.5 py-0.5 rounded-lg cursor-pointer transition-colors"
                          >
                            {t18n("legacy.thread")} ({disc.comments.length})
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* LINKED TASKS OF THIS SPEC SECTION */}
            <div className="space-y-2.5 pt-1">
              <h4 className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                <CheckSquare className="w-3.5 h-3.5 text-emerald-400" />
                {t18n("legacy.section_tasks")} ({currentSpecNode.tickets ? currentSpecNode.tickets.length : 0})
              </h4>

              {(!currentSpecNode.tickets || currentSpecNode.tickets.length === 0) ? (
                <div className="spatial-card border-dashed border-white/[0.08] text-center text-xs text-slate-400">
                  {t18n("legacy.no_tasks_highlight_a_phrase_in_the_text_above_or_use_the_bug_reporter")}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                  {currentSpecNode.tickets.map((t: any) => {
                    const isBack = t.bug_context?.type === 'backend';
                    return (
                      <div key={t.id} className="spatial-card stagger-card space-y-2">
                        <div className="flex items-center justify-between">
                          <span className={"tag-spatial font-mono text-[10px] " + (isBack ? 'tag-vibe' : '')}>
                            #{t.key || t.id}
                          </span>
                          <div className="flex items-center gap-1.5">
                            {t.assignee && (
                              <span className="text-[10px] text-slate-400 font-mono">
                                {t.assignee}
                              </span>
                            )}
                            <span className={"text-[9px] font-bold px-2 py-0.5 rounded-full " + (
                              t.status === 'done' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' :
                              t.status === 'review' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' :
                              t.status === 'in_progress' ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30' : 
                              'bg-white/[0.06] text-slate-300'
                            )}>
                              {t.status}
                            </span>
                          </div>
                        </div>
                        <h5 className="text-xs font-semibold text-slate-100 truncate">{t.title}</h5>
                        {(t.tags || t.deadline || t.estimate) && (
                          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                            {t.tags?.map((tag: any) => (
                              <span key={tag} className="tag-spatial text-[8px] py-0.5">
                                {tag}
                              </span>
                            ))}
                            {t.deadline && (
                              <span className="tag-spatial bg-rose-500/15 text-rose-300 border-rose-500/25 text-[8px] flex items-center gap-1" title="Deadline">
                                <Clock className="w-2.5 h-2.5" /> {t.deadline}
                              </span>
                            )}
                            {t.estimate && (
                              <span className="tag-spatial text-[8px] flex items-center gap-1" title="Estimate">
                                <Zap className="w-2.5 h-2.5 text-amber-400" /> {t.estimate}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8 space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
              <FileText className="w-7 h-7" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">{t18n('v7.spec.empty_title')}</h3>
              <p className="text-xs text-slate-400 mt-1 max-w-xs">{t18n('v7.spec.empty_desc')}</p>
            </div>
            <button
              type="button"
              onClick={() => setIsAddingSection(true)}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold px-4 py-2.5 rounded-xl shadow-md shadow-indigo-600/30 cursor-pointer transition-all"
            >
              <Plus className="w-4 h-4" />
              <span>{t18n('v7.spec.create_first')}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
