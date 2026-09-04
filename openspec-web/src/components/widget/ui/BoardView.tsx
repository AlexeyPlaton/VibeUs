import React, { useEffect, useRef, useState } from 'react';
import { KanbanColumn } from './KanbanColumn';
import { ArchiveRestore, Check, Filter, Layers, Plus, RotateCcw, Search, X } from 'lucide-react';

export const BoardView = ({ state }: { state: any }) => {
  const {
    activeBoardId, setActiveBoardId,
    activeSpecFilter, setActiveSpecFilter,
    handleAddBoard, handleDeleteBoard,
    showArchivedDone, setShowArchivedDone,
    searchQuery, setSearchQuery,
    boardData, activeColumns, getColumnLabel,
    expandedTicketDoD, setExpandedTicketDoD, copiedId,
    addingDoDTicketId, setAddingDoDTicketId, newDoDLabel,
    setNewDoDLabel, setSelectedTicketForEdit, copyPromptForAI,
    handleToggleArchiveTicket, setDeletingTicket, handleToggleChecklist,
    handleDeleteDoDItem, handleAddCustomDoD, handleAcceptTicket,
    setReworkTicketId, setReworkComment, handleStatusChange,
    handleArchiveDoneTickets, allTickets,
    canWrite, canReview,
    handleAddTicket, handleAddColumn, t18n,
  } = state;

  const [isCreatingColumn, setIsCreatingColumn] = useState(false);
  const [inlineColumnTitle, setInlineColumnTitle] = useState('');
  const [isCreatingBoard, setIsCreatingBoard] = useState(false);
  const [inlineBoardTitle, setInlineBoardTitle] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  const customBoards = boardData.custom_boards || boardData.boards || [];
  const normalizedSearch = String(searchQuery || '').trim().toLowerCase();
  const currentBoard = activeBoardId && activeBoardId !== 'all'
    ? customBoards.find((board: any) => board.id === activeBoardId)
    : null;
  const activeSpecNodeIds = new Set<string>(
    activeSpecFilter && activeSpecFilter !== 'all'
      ? [
          activeSpecFilter,
          ...boardData.nodes
            .filter((node: any) => node.parent_id === activeSpecFilter)
            .map((node: any) => node.id),
        ]
      : [],
  );

  const handleInlineColumnSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inlineColumnTitle.trim()) return;
    handleAddColumn?.(e, inlineColumnTitle.trim());
    setInlineColumnTitle('');
    setIsCreatingColumn(false);
  };

  const handleInlineBoardSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inlineBoardTitle.trim()) return;
    handleAddBoard?.(inlineBoardTitle.trim());
    setInlineBoardTitle('');
    setIsCreatingBoard(false);
  };

  const matchesSearch = (ticket: any) => {
    if (!normalizedSearch) return true;
    const haystack = [
      ticket.key,
      ticket.id,
      ticket.title,
      ticket.summary,
      ticket.assignee,
      ...(Array.isArray(ticket.tags) ? ticket.tags : []),
    ].filter(Boolean).join(' ').toLowerCase();
    return haystack.includes(normalizedSearch);
  };

  const matchesScope = (ticket: any) => {
    if (activeBoardId && activeBoardId !== 'all') {
      const inBoard = ticket.board_id === activeBoardId
        || Boolean(currentBoard && ticket.tags && ticket.tags.includes(currentBoard.title));
      if (!inBoard) return false;
    }

    if (activeSpecFilter && activeSpecFilter !== 'all') {
      const nodeId = ticket.node_id || 'general';
      if (!activeSpecNodeIds.has(nodeId)) return false;
    }

    if (!showArchivedDone && ticket.is_archived) return false;
    return true;
  };

  const scopedTickets = allTickets.filter((ticket: any) => matchesScope(ticket));
  const visibleTickets = normalizedSearch
    ? scopedTickets.filter((ticket: any) => matchesSearch(ticket))
    : scopedTickets;
  const hasActiveFilters = Boolean(
    normalizedSearch
    || (activeSpecFilter && activeSpecFilter !== 'all')
    || (activeBoardId && activeBoardId !== 'all')
    || showArchivedDone,
  );
  const filteringEmptyState = Boolean(normalizedSearch || (activeSpecFilter && activeSpecFilter !== 'all'));

  const clearFilters = () => {
    setSearchQuery('');
    setActiveSpecFilter('all');
    setActiveBoardId('all');
    setShowArchivedDone(false);
    searchInputRef.current?.focus();
  };

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping = Boolean(
        target?.closest('input, textarea, select, [contenteditable="true"]'),
      );
      const isSearchShortcut = event.key === '/'
        || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k');

      if (isSearchShortcut && !isTyping) {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }

      if (event.key === 'Escape' && document.activeElement === searchInputRef.current && normalizedSearch) {
        event.preventDefault();
        setSearchQuery('');
      }
    };

    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [normalizedSearch, setSearchQuery]);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-transparent overflow-hidden font-['Plus_Jakarta_Sans',sans-serif]">
      <div className="enterprise-board-toolbar mb-3 flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] pb-3 text-xs xl:flex-nowrap">
        <div className="enterprise-board-tabs flex min-w-0 flex-1 items-center gap-1 overflow-x-auto rounded-lg border border-white/[0.08] bg-slate-900/80 p-1">
          <button
            type="button"
            onClick={() => setActiveBoardId('all')}
            className={`flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${
              activeBoardId === 'all'
                ? 'bg-indigo-600 text-white'
                : 'text-slate-400 hover:bg-white/[0.04] hover:text-white'
            }`}
          >
            <Layers className="h-3.5 w-3.5" />
            <span>{t18n('v7.board.cross_board')}</span>
            <span className="rounded px-1.5 py-0.5 text-[9px] tabular-nums opacity-75">
              {allTickets.filter((ticket: any) => !ticket.is_archived).length}
            </span>
          </button>

          {customBoards.map((board: any) => {
            const isSelected = activeBoardId === board.id;
            const count = allTickets.filter((ticket: any) => !ticket.is_archived && (
              ticket.board_id === board.id || (ticket.tags && ticket.tags.includes(board.title))
            )).length;
            return (
              <div key={board.id} className="group flex items-center">
                <button
                  type="button"
                  onClick={() => setActiveBoardId(board.id)}
                  className={`flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${
                    isSelected
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-400 hover:bg-white/[0.04] hover:text-white'
                  }`}
                >
                  <span>{board.title}</span>
                  <span className="rounded px-1 py-0.5 text-[9px] tabular-nums opacity-70">{count}</span>
                </button>
                {canWrite && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(t18n('v7.board.delete_board_confirm', { title: board.title }))) handleDeleteBoard(board.id);
                    }}
                    title={t18n('v7.board.delete_board')}
                    className="ml-0.5 flex h-5 w-5 items-center justify-center rounded text-slate-500 opacity-0 transition-opacity hover:bg-rose-500/10 hover:text-rose-400 group-hover:opacity-100 group-focus-within:opacity-100"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            );
          })}

          {canWrite && (isCreatingBoard ? (
            <form onSubmit={handleInlineBoardSubmit} className="flex items-center gap-1 pl-1">
              <input
                type="text"
                autoFocus
                value={inlineBoardTitle}
                onChange={(e) => setInlineBoardTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setIsCreatingBoard(false);
                    setInlineBoardTitle('');
                  }
                }}
                placeholder={t18n('v7.board.board_name')}
                className="w-32 rounded-md border border-indigo-500/40 bg-slate-950 px-2 py-1 text-[11px] text-white outline-none placeholder:text-slate-500"
              />
              <button type="submit" className="rounded-md bg-indigo-600 p-1 text-white hover:bg-indigo-500"><Check className="h-3.5 w-3.5" /></button>
              <button
                type="button"
                onClick={() => { setIsCreatingBoard(false); setInlineBoardTitle(''); }}
                className="rounded-md p-1 text-slate-400 hover:bg-white/[0.04] hover:text-white"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setIsCreatingBoard(true)}
              className="flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-1.5 text-[10px] font-medium text-slate-500 transition-colors hover:bg-white/[0.04] hover:text-slate-300"
              title={t18n('v7.board.create_board_title')}
            >
              <Plus className="h-3.5 w-3.5" />
              <span>{t18n('v7.board.board')}</span>
            </button>
          ))}
        </div>

        <div className="enterprise-board-controls flex shrink-0 items-center gap-1.5">
          <label className="enterprise-board-search flex h-8 w-48 items-center gap-1.5 rounded-lg border border-white/[0.08] bg-slate-900 px-2.5 focus-within:border-indigo-500/40 sm:w-56">
            <Search className="h-3.5 w-3.5 shrink-0 text-slate-500" />
            <input
              ref={searchInputRef}
              type="search"
              value={searchQuery || ''}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t18n('v7.board.search_tasks')}
              aria-label={t18n('v7.board.search_tasks')}
              className="min-w-0 flex-1 bg-transparent text-[11px] text-slate-200 outline-none placeholder:text-slate-500"
            />
            <kbd
              className="enterprise-shortcut-key hidden rounded border border-white/[0.08] px-1 py-0.5 font-mono text-[9px] font-medium text-slate-500 sm:inline"
              title={t18n('v7.board.search_shortcut')}
            >/</kbd>
          </label>

          <div className="enterprise-board-filter flex h-8 items-center gap-1.5 rounded-lg border border-white/[0.08] bg-slate-900 px-2.5">
            <Filter className="h-3.5 w-3.5 shrink-0 text-slate-500" />
            <select
              value={activeSpecFilter || 'all'}
              onChange={(e) => setActiveSpecFilter(e.target.value)}
              className="max-w-40 border-0 bg-transparent text-[11px] font-medium text-slate-300 outline-none"
            >
              <option value="all">{t18n('v7.board.all_spec_sections')}</option>
              {boardData.nodes.map((node: any) => (
                <option key={node.id} value={node.id}>{node.parent_id ? `↳ ${node.title}` : node.title}</option>
              ))}
            </select>
          </div>

          <span className="enterprise-board-result-count hidden h-8 items-center whitespace-nowrap rounded-lg border border-white/[0.06] px-2.5 text-[10px] font-semibold tabular-nums text-slate-500 lg:flex">
            {t18n('v7.board.results', { visible: visibleTickets.length, total: scopedTickets.length })}
          </span>

          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="enterprise-clear-filters flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg border border-white/[0.08] px-2.5 text-[10px] font-semibold text-slate-400 transition-colors hover:bg-white/[0.05] hover:text-white"
              title={t18n('v7.board.clear_filters')}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span className="hidden 2xl:inline">{t18n('v7.board.clear_filters')}</span>
            </button>
          )}

          {(() => {
            const archivedCount = allTickets.filter((ticket: any) => ticket.is_archived).length;
            return (
              <button
                type="button"
                onClick={() => setShowArchivedDone(!showArchivedDone)}
                className={`flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 text-[10px] font-semibold transition-colors ${
                  showArchivedDone
                    ? 'border-indigo-500/30 bg-indigo-500/10 text-indigo-300'
                    : 'border-white/[0.08] bg-white/[0.03] text-slate-400 hover:bg-white/[0.06] hover:text-white'
                }`}
                title={showArchivedDone ? t18n('legacy.hide_archived_done_tasks') : t18n('legacy.show_archived_done_tasks')}
              >
                <ArchiveRestore className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{showArchivedDone ? t18n('legacy.hide_archive') : `${t18n('legacy.archive')} (${archivedCount})`}</span>
              </button>
            );
          })()}
        </div>
      </div>

      <div className="enterprise-board-scroll flex-1 overflow-x-auto overflow-y-hidden">
        <div className="enterprise-board-columns flex h-full w-max items-stretch gap-3 pb-1">
          {activeColumns.map((col: any) => {
            const colTickets = visibleTickets.filter((ticket: any) => ticket.status === col.id);

            return (
              <KanbanColumn
                key={col.id}
                col={col}
                colTickets={colTickets}
                showArchivedDone={showArchivedDone}
                boardData={boardData}
                activeColumns={activeColumns}
                expandedTicketDoD={expandedTicketDoD}
                setExpandedTicketDoD={setExpandedTicketDoD}
                copiedId={copiedId}
                addingDoDTicketId={addingDoDTicketId}
                setAddingDoDTicketId={setAddingDoDTicketId}
                newDoDLabel={newDoDLabel}
                setNewDoDLabel={setNewDoDLabel}
                setSelectedTicketForEdit={setSelectedTicketForEdit}
                copyPromptForAI={copyPromptForAI}
                handleToggleArchiveTicket={handleToggleArchiveTicket}
                setDeletingTicket={setDeletingTicket}
                handleToggleChecklist={handleToggleChecklist}
                handleDeleteDoDItem={handleDeleteDoDItem}
                handleAddCustomDoD={handleAddCustomDoD}
                handleAcceptTicket={handleAcceptTicket}
                setReworkTicketId={setReworkTicketId}
                setReworkComment={setReworkComment}
                handleStatusChange={handleStatusChange}
                getColumnLabel={getColumnLabel}
                handleArchiveDoneTickets={handleArchiveDoneTickets}
                canWrite={canWrite}
                canReview={canReview}
                handleAddTicket={handleAddTicket}
                isFiltering={filteringEmptyState}
              />
            );
          })}

          {canWrite && (isCreatingColumn ? (
            <div className="spatial-card w-80 shrink-0 space-y-3 p-3 animate-fadeIn">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
                  <Plus className="h-3.5 w-3.5 text-indigo-400" />
                  {t18n('legacy.new_column')}
                </span>
                <button
                  type="button"
                  onClick={() => { setIsCreatingColumn(false); setInlineColumnTitle(''); }}
                  className="rounded-md p-1 text-slate-400 hover:bg-white/[0.04] hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <form onSubmit={handleInlineColumnSubmit} className="space-y-2.5">
                <input
                  type="text"
                  autoFocus
                  value={inlineColumnTitle}
                  onChange={(e) => setInlineColumnTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setIsCreatingColumn(false);
                      setInlineColumnTitle('');
                    }
                  }}
                  placeholder={t18n('v7.board.example_column')}
                  className="w-full rounded-lg border border-white/[0.08] bg-slate-950 px-3 py-2 text-xs text-white outline-none placeholder:text-slate-500 focus:border-indigo-500"
                />
                <div className="flex items-center gap-2">
                  <button
                    type="submit"
                    disabled={!inlineColumnTitle.trim()}
                    className="flex-1 rounded-md bg-indigo-600 py-2 text-xs font-semibold text-white transition-colors hover:bg-indigo-500 disabled:opacity-50"
                  >
                    {t18n('v7.board.add')}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setIsCreatingColumn(false); setInlineColumnTitle(''); }}
                    className="rounded-md border border-white/[0.08] px-3 py-2 text-xs font-semibold text-slate-400 hover:bg-white/[0.04] hover:text-white"
                  >
                    {t18n('v7.board.cancel')}
                  </button>
                </div>
              </form>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setIsCreatingColumn(true)}
              className="flex w-11 shrink-0 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-white/[0.1] text-slate-500 transition-colors hover:border-indigo-500/30 hover:bg-indigo-500/[0.03] hover:text-indigo-400"
              title={t18n('v7.board.add_column')}
            >
              <Plus className="h-4 w-4" />
              <span className="[writing-mode:vertical-rl] rotate-180 text-[9px] font-semibold tracking-wide">{t18n('v7.board.column')}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
