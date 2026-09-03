import React, { useState } from 'react';
import { KanbanColumn } from './KanbanColumn';
import { 
  CheckCircle2, FolderPlus, Settings2, Sparkles, Filter, Plus, 
  ArchiveRestore, MessageSquareQuote, CheckCheck, Layers, LayoutGrid, X, Check, Trash2
} from 'lucide-react';

export const BoardView = ({ state }: { state: any }) => {
  const {
    activeBoardId, setActiveBoardId,
    activeSpecFilter, setActiveSpecFilter,
    handleAddBoard, handleDeleteBoard,
    showArchivedDone, setShowArchivedDone,
    boardData, activeColumns, getColumnLabel,
    expandedTicketDoD, setExpandedTicketDoD, copiedId,
    addingDoDTicketId, setAddingDoDTicketId, newDoDLabel,
    setNewDoDLabel, setSelectedTicketForEdit, copyPromptForAI,
    handleToggleArchiveTicket, setDeletingTicket, handleToggleChecklist,
    handleDeleteDoDItem, handleAddCustomDoD, handleAcceptTicket,
    setReworkTicketId, setReworkComment, handleStatusChange,
    handleArchiveDoneTickets, backlogCount, inProgressTickets,
    inReviewTickets, activeTickets, allTickets, setIsManagingColumns,
    canWrite, canReview,
    handleAddTicket, handleAddColumn, t18n
  } = state;

  const [isCreatingColumn, setIsCreatingColumn] = useState(false);
  const [inlineColumnTitle, setInlineColumnTitle] = useState('');

  const [isCreatingBoard, setIsCreatingBoard] = useState(false);
  const [inlineBoardTitle, setInlineBoardTitle] = useState('');

  const customBoards = boardData.custom_boards || boardData.boards || [];

  const handleInlineColumnSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inlineColumnTitle.trim()) return;
    if (handleAddColumn) {
      handleAddColumn(e, inlineColumnTitle.trim());
    }
    setInlineColumnTitle('');
    setIsCreatingColumn(false);
  };

  const handleInlineBoardSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inlineBoardTitle.trim()) return;
    if (handleAddBoard) {
      handleAddBoard(inlineBoardTitle.trim());
    }
    setInlineBoardTitle('');
    setIsCreatingBoard(false);
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-transparent overflow-hidden font-['Plus_Jakarta_Sans',sans-serif]">
      {/* BOARDS SELECTOR BAR & SPEC/ARCHIVE FILTERS */}
      <div className="pb-3 mb-2 flex items-center justify-between gap-3 overflow-x-auto shrink-0 text-xs flex-wrap sm:flex-nowrap">
        {/* Left: Task Boards Switcher */}
        <div className="flex items-center gap-1.5 bg-slate-900/80 p-1 rounded-2xl border border-white/[0.08] min-w-0">
          {/* Unified cross-cutting board */}
          <button
            onClick={() => setActiveBoardId('all')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl font-semibold whitespace-nowrap transition-all cursor-pointer ${
              activeBoardId === 'all' 
                ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/30' 
                : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
            }`}
          >
            <Layers className="w-3.5 h-3.5 text-indigo-300" />
            <span>{t18n('v7.board.cross_board')}</span>
            <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded-full ${activeBoardId === 'all' ? 'bg-white/20 text-white' : 'bg-white/[0.06] text-slate-400'}`}>
              {allTickets.filter((t: any) => !t.is_archived).length}
            </span>
          </button>

          {/* Custom Task Boards */}
          {customBoards.map((board: any) => {
            const isSelected = activeBoardId === board.id;
            const boardTicketsCount = allTickets.filter((t: any) => !t.is_archived && (t.board_id === board.id || (t.tags && t.tags.includes(board.title)))).length;
            return (
              <div key={board.id} className="flex items-center group">
                <button
                  onClick={() => setActiveBoardId(board.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-semibold whitespace-nowrap transition-all cursor-pointer ${
                    isSelected 
                      ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/30' 
                      : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
                  }`}
                >
                  <span>{board.title}</span>
                  <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded-full ${isSelected ? 'bg-white/20 text-white' : 'bg-white/[0.06] text-slate-400'}`}>
                    {boardTicketsCount}
                  </span>
                </button>
                {canWrite && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(t18n('v7.board.delete_board_confirm', { title: board.title }))) {
                        handleDeleteBoard(board.id);
                      }
                    }}
                    title={t18n('v7.board.delete_board')}
                    className="w-5 h-5 ml-0.5 rounded-md text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            );
          })}

          {/* Inline Create Custom Board */}
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
                className="bg-slate-950 border border-indigo-500/50 rounded-xl px-2.5 py-1 text-xs text-white placeholder:text-slate-500 outline-none w-32"
              />
              <button
                type="submit"
                className="p-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs cursor-pointer shadow-xs"
              >
                <Check className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsCreatingBoard(false);
                  setInlineBoardTitle('');
                }}
                className="p-1 text-slate-400 hover:text-white rounded-lg text-xs cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </form>
          ) : (
            <button
              onClick={() => setIsCreatingBoard(true)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl font-medium text-slate-400 hover:text-indigo-300 hover:bg-white/[0.04] transition-all cursor-pointer whitespace-nowrap text-[11px]"
              title={t18n('v7.board.create_board_title')}
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{t18n('v7.board.board')}</span>
            </button>
          ))}
        </div>

        {/* Right: Spec Section Filter & Archive Toggle */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Optional Specification Tree Filter */}
          <div className="flex items-center gap-1.5 bg-slate-900 px-3 py-1.5 rounded-xl border border-white/[0.08] text-xs">
            <Filter className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
            <select
              value={activeSpecFilter || 'all'}
              onChange={(e) => setActiveSpecFilter(e.target.value)}
              style={{ backgroundColor: '#0f172a', color: '#f8fafc' }}
              className="bg-slate-900 text-slate-100 text-xs font-semibold outline-none cursor-pointer pr-1 border-0"
            >
              <option value="all" style={{ backgroundColor: '#0f172a', color: '#f8fafc' }} className="bg-slate-900 text-white">{t18n('v7.board.all_spec_sections')}</option>
              {boardData.nodes.map((node: any) => (
                <option key={node.id} value={node.id} style={{ backgroundColor: '#0f172a', color: '#f8fafc' }} className="bg-slate-900 text-white">
                  {node.parent_id ? `↳ ${node.title}` : node.title}
                </option>
              ))}
            </select>
          </div>

          {/* Archive Toggle Button */}
          {(() => {
            const archivedCount = allTickets.filter((t: any) => t.is_archived).length;
            return (
              <button
                type="button"
                onClick={() => setShowArchivedDone(!showArchivedDone)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-semibold whitespace-nowrap transition-all cursor-pointer shrink-0 border ${
                  showArchivedDone 
                    ? 'bg-indigo-600 border-indigo-500 text-white shadow-sm' 
                    : 'bg-white/[0.05] border-white/[0.08] text-slate-400 hover:text-white hover:bg-white/[0.08]'
                }`}
                title={showArchivedDone ? t18n("legacy.hide_archived_done_tasks") : t18n("legacy.show_archived_done_tasks")}
              >
                <ArchiveRestore className="w-3.5 h-3.5" />
                <span>{showArchivedDone ? t18n("legacy.hide_archive") : `${t18n("legacy.archive")} (${archivedCount})`}</span>
              </button>
            );
          })()}
        </div>
      </div>

      {/* HORIZONTAL SCROLLABLE COLUMNS CONTAINER */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden">
        <div className="h-full flex gap-6 w-max items-stretch pb-1">
          {activeColumns.map((col: any) => {
            let colTickets = allTickets.filter((t: any) => t.status === col.id);

            // Filter by active custom board when not using the cross-cutting board.
            if (activeBoardId && activeBoardId !== 'all') {
              const currentBoard = customBoards.find((b: any) => b.id === activeBoardId);
              colTickets = colTickets.filter((t: any) => 
                t.board_id === activeBoardId || 
                (currentBoard && t.tags && t.tags.includes(currentBoard.title))
              );
            }

            // Filter by Spec section filter (if specified)
            if (activeSpecFilter && activeSpecFilter !== 'all') {
              const nodeIds = [activeSpecFilter, ...boardData.nodes.filter((n: any) => n.parent_id === activeSpecFilter).map((n: any) => n.id)];
              colTickets = colTickets.filter((t: any) => nodeIds.includes(t.node_id || 'general') || (!t.node_id && nodeIds.includes('general')));
            }

            // Filter archived tickets across all columns when archive is toggled off
            if (!showArchivedDone) {
              colTickets = colTickets.filter((t: any) => !t.is_archived);
            }

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
              />
            );
          })}
          
          {/* ADD COLUMN BUTTON / INLINE FORM */}
          {canWrite && (isCreatingColumn ? (
            <div className="w-80 p-4 bg-slate-900/90 backdrop-blur-md rounded-2xl border border-indigo-500/40 shadow-xl flex flex-col justify-between shrink-0 animate-scaleIn">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                    <Plus className="w-3.5 h-3.5 text-indigo-400" />
                    <span>{t18n("legacy.new_column")}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setIsCreatingColumn(false);
                      setInlineColumnTitle('');
                    }}
                    className="text-slate-400 hover:text-white cursor-pointer"
                  >
                    <X className="w-4 h-4" />
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
                    className="w-full bg-slate-950 border border-slate-700/60 rounded-xl px-3 py-2 text-xs text-white placeholder:text-slate-500 outline-none focus:border-indigo-500"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      type="submit"
                      disabled={!inlineColumnTitle.trim()}
                      className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl text-xs font-semibold cursor-pointer transition-all shadow-md shadow-indigo-600/30 flex items-center justify-center gap-1.5"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>{t18n('v7.board.add')}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsCreatingColumn(false);
                        setInlineColumnTitle('');
                      }}
                      className="px-3 py-2 bg-white/[0.05] hover:bg-white/[0.1] text-slate-400 hover:text-white rounded-xl text-xs font-semibold cursor-pointer transition-colors"
                    >
                      {t18n('v7.board.cancel')}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setIsCreatingColumn(true)}
              className="w-14 min-h-[140px] border border-dashed border-white/15 hover:border-indigo-500/50 hover:bg-indigo-500/5 rounded-2xl flex flex-col items-center justify-center gap-2 text-slate-400 hover:text-indigo-300 transition-all cursor-pointer shrink-0 group"
              title={t18n('v7.board.add_column')}
            >
              <div className="w-8 h-8 rounded-xl bg-white/[0.05] group-hover:bg-indigo-500/20 flex items-center justify-center transition-colors">
                <Plus className="w-4 h-4" />
              </div>
              <span className="text-[10px] font-semibold opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                + {t18n('v7.board.column')}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
