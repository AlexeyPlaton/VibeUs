import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { 
  KanbanSquare, X, Plus, CheckCircle2, Circle, Clock, Zap, Copy, Check, 
  Trash2, FolderPlus, Settings2, AlertTriangle, MessageSquare, FileText, 
  LayoutGrid, Edit3, ChevronDown, ChevronRight, Sparkles, MessageCircle, 
  CornerDownRight, Globe, Image, Table, Lightbulb, ShieldAlert, ArrowRight,
  GitBranch, CheckSquare, Palette, RefreshCw, Layers, CheckCheck, ChevronUp,
  Users, Send, Play, UserCheck, AtSign, MessageSquarePlus, ExternalLink,
  Crosshair, Bug, Terminal, Monitor, Compass, Archive, Search, Filter, Eye, EyeOff,
  Lock, Unlock, Shield, Bell, MessageSquareQuote, CheckCheck as CheckIcon,
  ArchiveRestore, AlertCircle, Server, Code2, Database
} from 'lucide-react';
import { TicketDetailModal } from './TicketDetailModal';
import type { BoardData } from './widget/types';
import { WidgetLauncher } from './widget/ui/WidgetLauncher';
import { BugReporterModal } from './widget/ui/BugReporterModal';
import { FeedbackView } from './widget/ui/FeedbackView';
import { PublicReporterWizard } from './widget/ui/PublicReporterWizard';
import { SpecView } from './widget/ui/SpecView';
import { BoardView } from './widget/ui/BoardView';
import { WidgetHeader } from './widget/ui/WidgetHeader';
import { SettingsPanel } from './widget/ui/SettingsPanel';
import { VisualInspectorOverlay } from './widget/ui/VisualInspectorOverlay';
import { useWidgetState } from './widget/hooks/useWidgetState';

export const VibusWidgetUI = ({
  projectId = 'demo_saas_platform', 
  serverUrl = 'http://localhost:8000', 
  apiToken = '',
  publicKey = '',
  initialBoardData = null,
  theme = 'auto',
  accentColor = 'indigo',
  mode = 'studio'
}: { 
  projectId?: string; 
  serverUrl?: string; 
  apiToken?: string;
  publicKey?: string;
  initialBoardData?: BoardData | null;
  theme?: 'dark' | 'light' | 'auto';
  accentColor?: string;
  mode?: 'studio' | 'public_feedback' | 'client_preview';
}) => {
  const state = useWidgetState(projectId, serverUrl, apiToken, initialBoardData, theme, accentColor, mode, publicKey);
  const {
    accentTheme,
    activeColumns,
    activeDiscussionThread,
    allTickets,
    boardData,
    connected,
    convertedTicketTitle,
    copyPromptForAI,
    currentAccent,
    currentAccessMode,
    customRolesList,
    deleteConfirmationInput,
    deletingTicket,
    feedbacksList,
    getColumnLabel,
    getRoleLabel,
    globalSelection,
    groupChatId,
    handleAISummarizeDiscussion,
    handleAddColumn,
    handleAddCommentToDiscussion,
    handleAddCustomRole,
    handleAddTeamMember,
    handleConfirmDeleteProject,
    handleConfirmDeleteTicket,
    handleCreateTicketFromDiscussion,
    handleDeleteColumn,
    handleGlobalSelectionClick,
    handleOpenBugModal,
    handleSaveGroupChat,
    handleSavePrivacySettings,
    telemetryEnabled,
    setTelemetryEnabled,
    aiDataSharing,
    setAiDataSharing,
    handleToggleArchiveTicket,
    handleToggleDiscussionStatus,
    handleUpdateTicketFields,
    isBugModalOpen,
    isConvertingToTicket,
    isDeletingProject,
    isInspectingElement,
    isManagingRoles,
    isOpen,
    isProjectDeleteModalOpen,
    isSettingsOpen,
    newColumnLabel,
    newDiscussionComment,
    newMemberName,
    newMemberRole,
    newMemberTg,
    newRoleBadge,
    newRoleLabel,
    notifyDiscussions,
    notifyFeedback,
    notifyReview,
    notifyRework,
    selectedTicketForEdit,
    setActiveDiscussionThread,
    setConvertedTicketTitle,
    setCurrentAccent,
    setCurrentAccessMode,
    setDeleteConfirmationInput,
    setDeletingTicket,
    setGroupChatId,
    setIsConvertingToTicket,
    setIsInspectingElement,
    setIsManagingRoles,
    setIsOpen,
    setIsProjectDeleteModalOpen,
    setIsSettingsOpen,
    setNewColumnLabel,
    setNewDiscussionComment,
    setNewMemberName,
    setNewMemberRole,
    setNewMemberTg,
    setNewRoleBadge,
    setNewRoleLabel,
    setNotifyDiscussions,
    setNotifyFeedback,
    setNotifyReview,
    setNotifyRework,
    setSelectedTicketForEdit,
    setViewMode,
    t18n,
    viewMode,
    isPublicMode,
    activeTickets,
    newFeedbacksCount,
    inReviewTickets
  } = state;

  return (
    <div className="fixed bottom-6 right-6 z-[999999] flex flex-col items-end gap-3 font-['Plus_Jakarta_Sans',sans-serif] text-slate-100 antialiased selection:bg-indigo-600 selection:text-white">

      {/* GLOBAL SELECTION QUICK ACTION */}
      {globalSelection && !isOpen && (
        <button
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            handleGlobalSelectionClick(globalSelection);
          }}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            handleGlobalSelectionClick(globalSelection);
          }}
          style={{ left: globalSelection.x, top: globalSelection.y, transform: 'translateX(-50%)' }}
          className="fixed z-[999999] flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-full shadow-2xl hover:bg-indigo-500 hover:scale-105 active:scale-95 transition-all cursor-pointer border border-white/20 animate-fadeIn font-semibold text-xs"
        >
          <MessageSquarePlus className="w-4 h-4" />
          <span>{currentAccessMode === 'public_feedback' ? t18n('widget.leave_feedback') : t18n('widget.submit_bug')}</span>
        </button>
      )}

      {/* DRAWER / MAIN KANBAN WINDOW */}
      <div 
        id="vibeKanban"
        onWheel={(e) => e.stopPropagation()}
        className={
          "flex flex-col overflow-hidden spatial-kanban text-white p-6 sm:p-8 " +
          (isOpen ? 'active' : '')
        }
      >

        {/* PREMIUM GLASSMORPHISM HEADER */}
        <WidgetHeader
          isPublicMode={isPublicMode}
          connected={connected}
          projectId={projectId}
          viewMode={viewMode}
          setViewMode={setViewMode}
          feedbacksList={feedbacksList}
          handleOpenBugModal={handleOpenBugModal}
          isBugModalOpen={isBugModalOpen}
          isSettingsOpen={isSettingsOpen}
          setIsSettingsOpen={setIsSettingsOpen}
          setIsOpen={setIsOpen}
          isInspectorActive={state.isInspectorActive}
          handleToggleInspector={state.handleToggleInspector}
          canManageSettings={state.canManageSettings}
          isReadOnly={state.isReadOnly}
        />

        {/* MAIN BODY */}
        {isPublicMode ? (
          <PublicReporterWizard state={state} />
        ) : viewMode === 'feedback' ? (
          <FeedbackView state={state} />
        ) : viewMode === 'spec' ? (
          <SpecView state={state} />
        ) : (
          <BoardView state={state} />
        )}

        {/* WHITE-LABEL BRANDING FOOTER (Shown only for Free tier) */}
        {(!boardData?.subscription_tier || boardData.subscription_tier === 'free') && (
          <div className="shrink-0 border-t border-white/[0.06] bg-slate-950/60 px-4 py-2 flex items-center justify-center">
            <a 
              href="https://vibeus.pro" 
              target="_blank" 
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-[10px] text-slate-400 hover:text-white transition-colors no-underline font-medium"
            >
              <Zap className="w-3 h-3 text-indigo-400" />
              Powered by <span className="font-bold text-white tracking-wide">VibeUs</span>
            </a>
          </div>
        )}
      </div>

      {/* TOP-LEVEL OVERLAYS & MODALS (Outside transformed spatial-kanban to avoid CSS containment issues) */}

      {/* 1. UNIFIED SETTINGS MODAL (GLASSMORPHISM) */}
      <SettingsPanel
        isSettingsOpen={isSettingsOpen}
        setIsSettingsOpen={setIsSettingsOpen}
        isPublicMode={isPublicMode}
        currentAccessMode={currentAccessMode}
        setCurrentAccessMode={setCurrentAccessMode}
        setViewMode={setViewMode}
        projectId={projectId}
        apiToken={apiToken}
        groupChatId={groupChatId}
        setGroupChatId={setGroupChatId}
        handleSaveGroupChat={handleSaveGroupChat}
        handleSavePrivacySettings={handleSavePrivacySettings}
        telemetryEnabled={telemetryEnabled}
        setTelemetryEnabled={setTelemetryEnabled}
        aiDataSharing={aiDataSharing}
        setAiDataSharing={setAiDataSharing}
        notifyReview={notifyReview}
        setNotifyReview={setNotifyReview}
        notifyRework={notifyRework}
        setNotifyRework={setNotifyRework}
        notifyFeedback={notifyFeedback}
        setNotifyFeedback={setNotifyFeedback}
        notifyDiscussions={notifyDiscussions}
        setNotifyDiscussions={setNotifyDiscussions}
        customRolesList={customRolesList}
        isManagingRoles={isManagingRoles}
        setIsManagingRoles={setIsManagingRoles}
        getRoleLabel={getRoleLabel}
        handleAddCustomRole={handleAddCustomRole}
        newRoleBadge={newRoleBadge}
        setNewRoleBadge={setNewRoleBadge}
        newRoleLabel={newRoleLabel}
        setNewRoleLabel={setNewRoleLabel}
        boardData={boardData}
        handleAddTeamMember={handleAddTeamMember}
        newMemberName={newMemberName}
        setNewMemberName={setNewMemberName}
        newMemberTg={newMemberTg}
        setNewMemberTg={setNewMemberTg}
        newMemberRole={newMemberRole}
        setNewMemberRole={setNewMemberRole}
        accentTheme={accentTheme}
        currentAccent={currentAccent}
        setCurrentAccent={setCurrentAccent}
        activeColumns={activeColumns}
        getColumnLabel={getColumnLabel}
        handleDeleteColumn={handleDeleteColumn}
        handleAddColumn={handleAddColumn}
        newColumnLabel={newColumnLabel}
        setNewColumnLabel={setNewColumnLabel}
        allTickets={allTickets}
        setDeleteConfirmationInput={setDeleteConfirmationInput}
        setIsProjectDeleteModalOpen={setIsProjectDeleteModalOpen}
      />

      {/* 2. RICH TICKET DETAIL & EDIT MODAL */}
      {selectedTicketForEdit && (
        <TicketDetailModal
          isOpen={!!selectedTicketForEdit}
          ticket={selectedTicketForEdit as any}
          nodes={boardData.nodes}
          columns={activeColumns}
          accentTheme={accentTheme}
          projectId={projectId}
          apiToken={apiToken}
          onClose={() => setSelectedTicketForEdit(null)}
          onUpdateTicket={(tId, updates) => handleUpdateTicketFields(tId, updates as any)}
          onDeleteTicket={(t) => {
            setSelectedTicketForEdit(null);
            setDeletingTicket(t as any);
          }}
          onCopyPrompt={(t, nodeTitle) => copyPromptForAI(t as any, nodeTitle)}
        />
      )}

      {/* 3. UNIVERSAL BUG REPORTER MODAL */}
      {isBugModalOpen && <BugReporterModal state={state} />}

      {/* 3. PROJECT / BOARD DELETION CONFIRMATION DIALOG (DANGER ZONE PROTECTION) */}
      {isProjectDeleteModalOpen && (
        <div 
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsProjectDeleteModalOpen(false);
          }}
          className="fixed inset-0 z-[99999999] bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 animate-fadeIn"
        >
          <div className="bg-slate-900/95 backdrop-blur-2xl text-slate-100 rounded-3xl max-w-md w-full p-6 shadow-2xl border border-rose-500/30 space-y-4 animate-scaleIn">
            <div className="flex items-center gap-3 text-rose-400">
              <div className="w-10 h-10 rounded-2xl bg-rose-500/20 border border-rose-500/30 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h4 className="text-base font-bold text-white tracking-tight">{t18n('widget.delete_project_title')}</h4>
                <p className="text-xs text-rose-400 font-medium">{t18n('widget.delete_project_warning')}</p>
              </div>
            </div>

            <div className="p-4 bg-rose-500/10 rounded-2xl border border-rose-500/20 text-xs space-y-2 text-slate-300">
              <p className="leading-relaxed">
                {t18n('widget.delete_project_items')}
              </p>
              <ul className="list-disc list-inside space-y-1 font-medium text-slate-200 text-[11px]">
                <li>{t18n('widget.delete_tickets_count', { count: allTickets.length })}</li>
                <li>{t18n('widget.delete_nodes_count', { count: boardData.nodes.length })}</li>
                <li>{t18n('widget.delete_feedback_count', { count: feedbacksList.length })}</li>
              </ul>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-300 block">
                {t18n('widget.delete_project_prompt')}{' '}
                <span className="font-mono font-bold text-indigo-400 bg-white/5 px-2 py-0.5 rounded-lg border border-white/10 select-all">{projectId}</span>
              </label>
              <input
                type="text"
                value={deleteConfirmationInput}
                onChange={(e) => setDeleteConfirmationInput(e.target.value)}
                placeholder={t18n('widget.delete_project_placeholder', { projectId })}
                className="w-full bg-slate-950 border border-slate-700/60 focus:border-rose-500/50 rounded-xl px-3 py-2.5 text-xs text-white font-mono outline-none"
                autoFocus
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/[0.08]">
              <button
                type="button"
                onClick={() => setIsProjectDeleteModalOpen(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-white rounded-xl cursor-pointer"
              >
                {t18n('widget.cancel')}
              </button>
              <button
                type="button"
                disabled={deleteConfirmationInput.trim() !== projectId || isDeletingProject}
                onClick={handleConfirmDeleteProject}
                className={`px-5 py-2.5 text-xs font-semibold rounded-xl transition-all cursor-pointer shadow-sm flex items-center gap-1.5 ${
                  deleteConfirmationInput.trim() === projectId && !isDeletingProject
                    ? 'bg-rose-600 hover:bg-rose-500 text-white cursor-pointer'
                    : 'bg-white/5 text-slate-600 cursor-not-allowed opacity-50 border border-white/5'
                }`}
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{isDeletingProject ? t18n('widget.deleting') : t18n('widget.confirm_delete_project')}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. DELETION CONFIRMATION DIALOG (TICKET DELETION PROTECTION) */}
      {deletingTicket && (
        <div 
          onClick={(e) => {
            if (e.target === e.currentTarget) setDeletingTicket(null);
          }}
          className="fixed inset-0 z-[99999999] bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 animate-fadeIn"
        >
          <div className="bg-slate-900/95 backdrop-blur-2xl text-slate-100 rounded-3xl max-w-sm w-full p-6 shadow-2xl border border-slate-700/60 space-y-4 animate-scaleIn">
            <div className="flex items-center gap-3 text-rose-400">
              <div className="w-9 h-9 rounded-2xl bg-rose-500/20 border border-rose-500/30 flex items-center justify-center shrink-0">
                <AlertCircle className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-white">{t18n('widget.delete_task_title')}</h4>
                <p className="text-[11px] text-slate-400">{t18n('widget.delete_task_desc')}</p>
              </div>
            </div>

            <div className="p-3.5 bg-slate-950 rounded-2xl border border-white/[0.06] text-xs space-y-1">
              <div className="font-mono font-bold text-indigo-400 text-[11px]">#{deletingTicket.key || deletingTicket.id}</div>
              <div className="font-medium text-slate-200 leading-snug">{deletingTicket.title}</div>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              {t18n('widget.delete_task_confirm')}
            </p>

            <div className="space-y-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  handleToggleArchiveTicket(deletingTicket.id);
                  setDeletingTicket(null);
                }}
                className="w-full py-2.5 px-3 bg-white/[0.08] hover:bg-white/[0.12] text-white font-semibold text-xs rounded-xl cursor-pointer border border-white/[0.08] transition-colors flex items-center justify-center gap-1.5"
              >
                <Archive className="w-3.5 h-3.5" />
                {t18n('widget.move_to_archive_rec')}
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setDeletingTicket(null)}
                  className="flex-1 py-2 px-3 bg-white/[0.04] hover:bg-white/[0.08] text-slate-400 hover:text-white font-semibold text-xs rounded-xl cursor-pointer transition-colors"
                >
                  {t18n('widget.cancel')}
                </button>
                <button
                  type="button"
                  onClick={handleConfirmDeleteTicket}
                  className="py-2 px-3 bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs rounded-xl cursor-pointer transition-colors"
                >
                  {t18n('widget.delete_forever')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 5. DISCUSSION THREAD / CONVERT TO TICKET MODAL */}
      {activeDiscussionThread && (
        <div 
          onClick={(e) => {
            if (e.target === e.currentTarget) setActiveDiscussionThread(null);
          }}
          className="fixed inset-0 z-[99999999] bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 animate-fadeIn"
        >
          <div className="bg-slate-900/95 backdrop-blur-2xl text-slate-100 rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-700/60 space-y-4 animate-scaleIn">
            <div className="flex items-start justify-between border-b border-white/[0.08] pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center">
                  <MessageCircle className="w-4 h-4" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-xs font-bold text-white">{t18n('widget.discussion_title')}</h3>
                    <button
                      type="button"
                      onClick={handleToggleDiscussionStatus}
                      className={"text-[9px] font-bold px-2 py-0.5 rounded-full cursor-pointer " + (
                        activeDiscussionThread.status === 'resolved' 
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' 
                          : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                      )}
                    >
                      {activeDiscussionThread.status === 'resolved' ? t18n('widget.discussion_resolved') : t18n('widget.discussion_in_progress')}
                    </button>
                  </div>
                  <p className="text-[10px] text-slate-400">{t18n('widget.discussion_history_desc')}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setActiveDiscussionThread(null)}
                className="w-7 h-7 rounded-full bg-white/[0.05] border border-white/[0.08] flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/[0.1] transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Quote box */}
            <div className="p-3 bg-amber-500/10 rounded-2xl border border-amber-500/20 text-xs text-amber-200 font-medium italic">
              💬 "{activeDiscussionThread.quote}"
            </div>

            {/* Comments Thread */}
            <div className="max-h-48 overflow-y-auto space-y-2 pr-1">
              {activeDiscussionThread.comments.map((c: any) => (
                <div key={c.id} className="p-2.5 bg-slate-950 rounded-xl border border-white/[0.05] text-xs space-y-1">
                  <div className="flex items-center justify-between text-[9px] text-slate-400 font-semibold">
                    <span className="text-white">{c.author}</span>
                    <span>{c.date}</span>
                  </div>
                  <p className="text-slate-300">{c.text}</p>
                </div>
              ))}
            </div>

            {/* Add comment input */}
            <form onSubmit={handleAddCommentToDiscussion} className="flex items-center gap-2">
              <input
                type="text"
                value={newDiscussionComment}
                onChange={(e) => setNewDiscussionComment(e.target.value)}
                placeholder={t18n('widget.discussion_comment_placeholder')}
                className="flex-1 bg-slate-950 border border-slate-700/60 rounded-xl px-3 py-2 text-xs text-white placeholder:text-slate-500 outline-none focus:border-indigo-500"
              />
              <button
                type="submit"
                className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs px-3.5 py-2 rounded-xl cursor-pointer transition-all"
              >
                {t18n('widget.send_comment')}
              </button>
            </form>

            {/* Linked created tickets list */}
            {activeDiscussionThread.created_ticket_ids && activeDiscussionThread.created_ticket_ids.length > 0 && (
              <div className="p-2.5 bg-emerald-500/10 rounded-xl border border-emerald-500/20 text-[10px] text-emerald-300 flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>{t18n('widget.created_tasks')} <b>{activeDiscussionThread.created_ticket_ids.join(', ')}</b></span>
              </div>
            )}

            {/* Convert To Ticket Button / Form */}
            <div className="border-t border-white/[0.08] pt-3 flex flex-col gap-2">
              {isConvertingToTicket ? (
                <div className="p-3 bg-white/[0.04] rounded-2xl border border-white/[0.08] space-y-2 animate-fadeIn">
                  <span className="text-[10px] font-semibold text-slate-300">{t18n('widget.task_name_for_ai')}</span>
                  <input
                    type="text"
                    value={convertedTicketTitle}
                    onChange={(e) => setConvertedTicketTitle(e.target.value)}
                    placeholder={t18n('widget.task_name_placeholder')}
                    className="w-full bg-slate-950 border border-slate-700/60 rounded-xl p-2.5 text-xs text-white outline-none focus:border-indigo-500"
                    autoFocus
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setIsConvertingToTicket(false)}
                      className="text-xs text-slate-400 hover:text-white px-3 py-1.5 rounded-xl cursor-pointer"
                    >
                      {t18n('widget.cancel')}
                    </button>
                    <button
                      type="button"
                      onClick={handleCreateTicketFromDiscussion}
                      className="bg-indigo-600 hover:bg-indigo-500 font-semibold text-xs px-3.5 py-1.5 rounded-xl cursor-pointer text-white transition-all shadow-md shadow-indigo-600/30"
                    >
                      {t18n('widget.create_on_board')}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleAISummarizeDiscussion}
                    className="flex-1 flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs py-2.5 rounded-xl cursor-pointer transition-all shadow-md shadow-indigo-600/30"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>{t18n('widget.generate_ticket_for_ai')}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* VISUAL ELEMENT INSPECTOR (AUTO-ATTACHED LOGS - TOP LEVEL) */}
      <VisualInspectorOverlay
        isActive={state.isInspectorActive}
        onClose={() => {
          state.setIsInspectorActive(false);
          setIsOpen(true);
        }}
        onElementSelect={state.handleElementInspected}
      />

      {/* FLOATING ACTION BUTTON */}
      <WidgetLauncher 
        isOpen={isOpen}
        isInspectorActive={state.isInspectorActive}
        onToggle={() => setIsOpen(!isOpen)}
        isPublicMode={isPublicMode}
        inReviewTicketsLength={inReviewTickets.length}
        activeTicketsLength={activeTickets.length}
        newFeedbacksCount={newFeedbacksCount}
        subscriptionTier={boardData?.subscription_tier || 'free'}
      />
    </div>
  );
};
