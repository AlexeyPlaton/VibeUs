import React from 'react';
import { useTranslation } from 'react-i18next';
import { GitBranch, Plus, CornerDownRight, FileText, MessageCircle, Copy, Check } from 'lucide-react';
import type { BoardData } from '../types';

export interface SpecSidebarProps {
  boardData: BoardData;
  activeSpecNodeId: string;
  setActiveSpecNodeId: (id: string) => void;
  isAddingSection: boolean;
  setIsAddingSection: (val: boolean) => void;
  newSectionTitle: string;
  setNewSectionTitle: (val: string) => void;
  newSectionDesc: string;
  setNewSectionDesc: (val: string) => void;
  handleAddSection: (e: React.FormEvent) => void;
  inlineParentAddId: string | null;
  setInlineParentAddId: (id: string | null) => void;
  inlineChildTitle: string;
  setInlineChildTitle: (val: string) => void;
  handleAddInlineChildSection: (e: React.FormEvent, parentId: string) => void;
  handleDeleteSection?: (id: string) => void;
  copyFullSpecForAI: () => void;
  copiedAllSpec: boolean;
  accentTheme: { lightBg: string; brand: string; };
}

export const SpecSidebar: React.FC<SpecSidebarProps> = ({
  boardData,
  activeSpecNodeId,
  setActiveSpecNodeId,
  isAddingSection,
  setIsAddingSection,
  newSectionTitle,
  setNewSectionTitle,
  newSectionDesc,
  setNewSectionDesc,
  handleAddSection,
  inlineParentAddId,
  setInlineParentAddId,
  inlineChildTitle,
  setInlineChildTitle,
  handleAddInlineChildSection,
  handleDeleteSection,
  copyFullSpecForAI,
  copiedAllSpec,
  accentTheme
}) => {
  const { t: t18n } = useTranslation();

  return (
    <div className="w-64 bg-transparent border-r border-white/[0.06] flex flex-col shrink-0 overflow-y-auto font-['Plus_Jakarta_Sans',sans-serif]">
      <div className="p-3.5 border-b border-white/[0.06] flex items-center justify-between">
        <span className="text-[11px] font-bold text-slate-300 flex items-center gap-2">
          <GitBranch className="w-3.5 h-3.5 text-indigo-400" />
          {t18n("legacy.spec_sections_tree")}
        </span>
        <button
          type="button"
          onClick={() => {
            setIsAddingSection(!isAddingSection);
            setNewSectionTitle('');
            setNewSectionDesc('');
          }}
          title={t18n("legacy.add_root_section")}
          className="w-7 h-7 rounded-lg bg-white/[0.05] border border-white/[0.08] flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/[0.1] transition-colors cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Root Section Creation Form */}
      {isAddingSection && (
        <form onSubmit={handleAddSection} className="m-2 p-2.5 bg-slate-900/90 rounded-2xl border border-indigo-500/40 space-y-2 animate-fadeIn shadow-lg">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-indigo-300">{t18n('v7.spec.new_section')}</span>
            <button
              type="button"
              onClick={() => setIsAddingSection(false)}
              className="text-slate-400 hover:text-white text-xs cursor-pointer p-0.5"
            >
              ✕
            </button>
          </div>
          <input
            type="text"
            value={newSectionTitle}
            onChange={(e) => setNewSectionTitle(e.target.value)}
            placeholder={t18n('v7.spec.section_name')}
            className="w-full bg-slate-950 border border-slate-700/60 rounded-xl px-2.5 py-1.5 text-xs text-white placeholder:text-slate-500 outline-none focus:border-indigo-500"
            autoFocus
            required
          />
          <input
            type="text"
            value={newSectionDesc}
            onChange={(e) => setNewSectionDesc(e.target.value)}
            placeholder={t18n('v7.spec.short_description')}
            className="w-full bg-slate-950 border border-slate-700/60 rounded-xl px-2.5 py-1.5 text-[11px] text-white placeholder:text-slate-500 outline-none focus:border-indigo-500"
          />
          <div className="flex items-center justify-end gap-1.5 pt-1">
            <button
              type="button"
              onClick={() => setIsAddingSection(false)}
              className="px-2.5 py-1 text-slate-400 hover:text-white text-[11px] font-semibold rounded-lg cursor-pointer"
            >
              {t18n('v7.spec.cancel')}
            </button>
            <button
              type="submit"
              className="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-semibold rounded-lg cursor-pointer transition-colors shadow-sm"
            >
              {t18n('v7.spec.create')}
            </button>
          </div>
        </form>
      )}

      <div className="p-2 space-y-1">
        {(() => {
          const allNodes = boardData.nodes || [];
          const rootNodes = allNodes.filter(n => !n.parent_id);
          // Catch any nodes whose parent_id does not match an existing node
          const orphanedNodes = allNodes.filter(n => n.parent_id && !allNodes.some(p => p.id === n.parent_id));

          const renderNodeItem = (node: any, isChild = false) => {
            const isSelected = activeSpecNodeId === node.id;
            const activeDiscussionCount = (node.discussions || []).filter((d: any) => d.status !== 'resolved').length;
            const childNodes = allNodes.filter(n => n.parent_id === node.id);

            return (
              <div key={node.id} className="space-y-1 group/item">
                <div
                  className={"w-full flex items-center justify-between p-2 rounded-xl text-xs font-semibold transition-all cursor-pointer " + (
                    isChild ? 'pl-5 ' : ''
                  ) + (
                    isSelected 
                      ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/30' 
                      : 'text-slate-300 hover:bg-white/[0.05] hover:text-white border border-transparent'
                  )}
                >
                  <div 
                    onClick={() => setActiveSpecNodeId(node.id)}
                    className="flex items-center gap-2 min-w-0 flex-1"
                  >
                    {isChild ? (
                      <CornerDownRight className={"w-3 h-3 shrink-0 " + (isSelected ? 'text-white' : 'text-slate-500')} />
                    ) : (
                      <FileText className={"w-3.5 h-3.5 shrink-0 " + (isSelected ? 'text-white' : 'text-slate-400')} />
                    )}
                    <span className="truncate">{node.title}</span>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {!isChild && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setInlineParentAddId(inlineParentAddId === node.id ? null : node.id);
                          setInlineChildTitle('');
                        }}
                        title={t18n('v7.spec.add_subsection', { title: node.title })}
                        className="p-0.5 rounded-md opacity-0 group-hover/item:opacity-100 text-slate-400 hover:text-white hover:bg-white/10 transition-all cursor-pointer"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    )}

                    {activeDiscussionCount > 0 && (
                      <span className="text-[9px] px-1.5 py-0.2 rounded-full font-bold flex items-center gap-0.5 bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                        <MessageCircle className="w-2.5 h-2.5" />
                        {activeDiscussionCount}
                      </span>
                    )}
                    <span className={"text-[9px] font-bold px-1.5 py-0.2 rounded-full " + (
                      isSelected 
                        ? 'bg-white/20 text-white' 
                        : 'bg-white/[0.06] text-slate-400'
                    )}>
                      {node.tickets ? node.tickets.length : 0}
                    </span>
                  </div>
                </div>

                {/* Inline Child Creation Input Box under this specific parent */}
                {inlineParentAddId === node.id && (
                  <form onSubmit={(e) => handleAddInlineChildSection(e, node.id)} className="pl-6 pr-1 animate-fadeIn flex items-center gap-1.5 pt-1">
                    <input
                      type="text"
                      value={inlineChildTitle}
                      onChange={(e) => setInlineChildTitle(e.target.value)}
                      placeholder={t18n("legacy.subsection_name")}
                      className="flex-1 bg-slate-950 border border-slate-700/60 rounded-xl px-2.5 py-1.5 text-xs text-white placeholder:text-slate-500 outline-none focus:border-indigo-500 font-medium"
                      autoFocus
                      required
                    />
                    <button
                      type="submit"
                      className="px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-xl cursor-pointer transition-colors shadow-sm"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setInlineParentAddId(null);
                        setInlineChildTitle('');
                      }}
                      className="px-2 py-1.5 text-xs text-slate-400 hover:text-white rounded-xl cursor-pointer"
                    >
                      ✕
                    </button>
                  </form>
                )}

                {/* Render child nodes directly under this parent */}
                {childNodes.map(child => renderNodeItem(child, true))}
              </div>
            );
          };

          return (
            <>
              {rootNodes.map(rootNode => renderNodeItem(rootNode, false))}
              {orphanedNodes.map(orphan => renderNodeItem(orphan, true))}
            </>
          );
        })()}
      </div>

      <div className="mt-auto p-3 border-t border-white/[0.06]">
        <button
          type="button"
          onClick={copyFullSpecForAI}
          className="w-full flex items-center justify-center gap-2 bg-white/[0.05] hover:bg-white/[0.1] text-slate-200 hover:text-white border border-white/[0.08] py-2.5 rounded-xl text-xs font-semibold cursor-pointer transition-all shadow-xs"
        >
          {copiedAllSpec ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          {copiedAllSpec ? t18n("legacy.spec_copied") : t18n("legacy.export_spec_for_ai")}
        </button>
      </div>
    </div>
  );
};
