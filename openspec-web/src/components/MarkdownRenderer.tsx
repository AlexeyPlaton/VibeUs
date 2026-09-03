import React from 'react';
import { useTranslation } from 'react-i18next';
import { Lightbulb, AlertTriangle, Target, Info, CheckCircle2, Circle, FileText } from 'lucide-react';
import { MermaidDiagram } from './MermaidDiagram';

interface MarkdownRendererProps {
  content: string;
  onMouseUp?: (e: React.MouseEvent) => void;
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content, onMouseUp }) => {
  const { t } = useTranslation();
  if (!content || !content.trim()) {
    return (
      <div className="p-6 rounded-2xl border border-dashed border-white/10 text-center space-y-2 bg-white/[0.02]">
        <FileText className="w-8 h-8 text-slate-500 mx-auto" />
        <p className="text-xs font-semibold text-slate-300">{t('v7.markdown.empty_title')}</p>
        <p className="text-[11px] text-slate-500">{t('v7.markdown.empty_desc')}</p>
      </div>
    );
  }

  // Split into paragraphs / blocks
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const elements: React.ReactNode[] = [];

  let inCodeBlock = false;
  let codeBlockLang = '';
  let codeBlockContent: string[] = [];
  let inTable = false;
  let tableRows: string[][] = [];

  const renderInline = (text: string) => {
    let parts: React.ReactNode[] = [];
    let remaining = text;

    // Simple parser for **bold**, `code`, *italic*
    const regex = /(\*\*.*?\*\*|`.*?`|\*.*?\*)/g;
    let match;
    let lastIdx = 0;

    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIdx) {
        parts.push(text.slice(lastIdx, match.index));
      }
      const token = match[0];
      if (token.startsWith('**') && token.endsWith('**')) {
        parts.push(<strong key={match.index} className="font-bold text-white">{token.slice(2, -2)}</strong>);
      } else if (token.startsWith('`') && token.endsWith('`')) {
        parts.push(<code key={match.index} className="bg-slate-950 text-indigo-300 px-1.5 py-0.5 rounded font-mono text-[11px] border border-white/[0.08]">{token.slice(1, -1)}</code>);
      } else if (token.startsWith('*') && token.endsWith('*')) {
        parts.push(<em key={match.index} className="italic text-slate-300">{token.slice(1, -1)}</em>);
      }
      lastIdx = regex.lastIndex;
    }

    if (lastIdx < text.length) {
      parts.push(text.slice(lastIdx));
    }

    return parts.length > 0 ? parts : text;
  };

  const flushTable = (key: string) => {
    if (tableRows.length === 0) return null;
    const header = tableRows[0];
    if (!header) return null;
    const body = tableRows.slice(1).filter(r => !r.every(c => c.trim().startsWith('---') || c.trim().startsWith(':---')));

    const tableEl = (
      <div key={key} className="overflow-x-auto my-3 rounded-2xl border border-white/[0.08] shadow-sm">
        <table className="w-full text-left text-xs border-collapse bg-slate-900/60">
          <thead>
            <tr className="bg-slate-950/80 border-b border-white/[0.08]">
              {header.map((col, idx) => (
                <th key={idx} className="p-2.5 font-bold text-slate-200">
                  {renderInline(col.trim())}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.04]">
            {body.map((row, rIdx) => (
              <tr key={rIdx} className="hover:bg-white/[0.03] transition-colors">
                {row.map((cell, cIdx) => (
                  <td key={cIdx} className="p-2.5 text-slate-300">
                    {renderInline(cell.trim())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
    tableRows = [];
    inTable = false;
    return tableEl;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;

    // Code blocks
    if (line.trim().startsWith('```')) {
      if (inCodeBlock) {
        if (codeBlockLang === 'mermaid') {
          elements.push(
            <MermaidDiagram key={`mermaid-${i}`} chart={codeBlockContent.join('\n')} />
          );
        } else {
          elements.push(
            <div key={`code-${i}`} className="my-3 p-3.5 bg-slate-950 text-slate-100 rounded-2xl font-mono text-[11px] overflow-x-auto border border-slate-800 leading-relaxed shadow-inner">
              <pre>{codeBlockContent.join('\n')}</pre>
            </div>
          );
        }
        codeBlockContent = [];
        codeBlockLang = '';
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
        codeBlockLang = line.trim().replace(/^```/, '').trim().toLowerCase();
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockContent.push(line);
      continue;
    }

    // Tables: | col1 | col2 |
    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      inTable = true;
      const cells = line.split('|').slice(1, -1);
      tableRows.push(cells);
      continue;
    } else if (inTable) {
      elements.push(flushTable(`tbl-${i}`));
    }

    // Headings
    if (line.startsWith('# ')) {
      elements.push(<h1 key={i} className="text-xl sm:text-2xl font-bold text-white mt-5 mb-2.5 pb-2 border-b border-white/10">{renderInline(line.slice(2))}</h1>);
      continue;
    }
    if (line.startsWith('## ')) {
      elements.push(<h2 key={i} className="text-base sm:text-lg font-bold text-white mt-4 mb-2">{renderInline(line.slice(3))}</h2>);
      continue;
    }
    if (line.startsWith('### ')) {
      elements.push(<h3 key={i} className="text-sm sm:text-base font-semibold text-indigo-300 mt-3 mb-1.5">{renderInline(line.slice(4))}</h3>);
      continue;
    }

    // Callout alerts: > 💡, > ⚠️, > 🎯, > [!NOTE]
    if (line.trim().startsWith('>')) {
      let rawCallout = line.replace(/^>\s*/, '');
      const isWarning = rawCallout.includes('⚠️') || rawCallout.includes('Внимание');
      const isGoal = rawCallout.includes('🎯') || rawCallout.includes('Бизнес-цель');
      const isIdea = rawCallout.includes('💡') || rawCallout.includes('Совет') || rawCallout.includes('Контекст') || rawCallout.includes('Раздел');

      // Strip leading emoji so we don't have duplicate icon + emoji
      const cleanedText = rawCallout.replace(/^[💡⚠️🎯\s]+/, '');

      elements.push(
        <div 
          key={i} 
          className={"my-2.5 p-3 rounded-2xl border flex items-start gap-2.5 text-xs leading-relaxed " + (
            isWarning 
              ? 'bg-rose-500/10 border-rose-500/25 text-rose-200' 
              : isGoal 
              ? 'bg-indigo-500/10 border-indigo-500/25 text-indigo-200'
              : isIdea
              ? 'bg-slate-800/80 border-slate-700/60 text-slate-200'
              : 'bg-slate-900/80 border-white/[0.08] text-slate-300'
          )}
        >
          <div className="shrink-0 mt-0.5">
            {isWarning ? <AlertTriangle className="w-4 h-4 text-rose-400" /> :
             isGoal ? <Target className="w-4 h-4 text-indigo-400" /> :
             isIdea ? <Lightbulb className="w-4 h-4 text-indigo-400" /> :
             <Info className="w-4 h-4 text-slate-400" />}
          </div>
          <div className="flex-1 font-medium">
            {renderInline(cleanedText)}
          </div>
        </div>
      );
      continue;
    }

    // Lists & Checklists
    if (line.trim().startsWith('- [x]') || line.trim().startsWith('- [ ]')) {
      const isChecked = line.trim().startsWith('- [x]');
      const itemText = line.replace(/^-\s*\[[ xX]\]\s*/, '');
      elements.push(
        <div key={i} className="flex items-center gap-2 my-1.5 text-xs text-slate-300 pl-1">
          {isChecked ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" /> : <Circle className="w-3.5 h-3.5 text-slate-500 shrink-0" />}
          <span className={isChecked ? 'line-through text-slate-500' : ''}>{renderInline(itemText)}</span>
        </div>
      );
      continue;
    }

    if (line.trim().startsWith('- ') || line.trim().startsWith('* ')) {
      elements.push(
        <li key={i} className="ml-4 list-disc text-xs sm:text-sm text-slate-200 my-1 leading-relaxed">
          {renderInline(line.replace(/^[-*]\s*/, ''))}
        </li>
      );
      continue;
    }

    // Regular paragraph
    if (line.trim().length > 0) {
      elements.push(
        <p key={i} className="text-xs sm:text-sm text-slate-200 leading-relaxed my-2 font-normal">
          {renderInline(line)}
        </p>
      );
    }
  }

  if (inTable) {
    elements.push(flushTable('tbl-final'));
  }

  return (
    <div onMouseUp={onMouseUp} className="space-y-1.5 select-text selection:bg-indigo-600 selection:text-white">
      {elements}
    </div>
  );
};
