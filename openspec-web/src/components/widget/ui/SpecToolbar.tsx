import React from 'react';
import { useTranslation } from 'react-i18next';
import { Lightbulb, ShieldAlert, GitBranch, Table } from 'lucide-react';

export interface SpecToolbarProps {
  insertSnippet: (snippet: string) => void;
}

export const SpecToolbar: React.FC<SpecToolbarProps> = ({ insertSnippet }) => {
  const { t: t18n } = useTranslation();

  return (
    <div className="flex items-center justify-between flex-wrap gap-2 pb-2.5 border-b border-white/[0.06] font-['Plus_Jakarta_Sans',sans-serif]">
      <span className="text-[11px] font-bold text-slate-400">{t18n("legacy.quick_blocks")}</span>
      <div className="flex items-center gap-1.5 flex-wrap text-xs">
        <button
          type="button"
          onClick={() => insertSnippet(t18n("legacy.context_tip_describe_important_details_for_the_developer"))}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-slate-300 hover:text-white border border-white/[0.08] font-medium cursor-pointer transition-all"
        >
          <Lightbulb className="w-3.5 h-3.5 text-indigo-400" /> <span>{t18n("legacy.info")}</span>
        </button>
        <button
          type="button"
          onClick={() => insertSnippet(t18n("legacy.warning_security_requirement_or_constraint"))}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-slate-300 hover:text-white border border-white/[0.08] font-medium cursor-pointer transition-all"
        >
          <ShieldAlert className="w-3.5 h-3.5 text-rose-400" /> <span>{t18n("legacy.warning")}</span>
        </button>
        <button
          type="button"
          onClick={() => insertSnippet(t18n("legacy.text_client_api_gateway_database"))}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-slate-300 hover:text-white border border-white/[0.08] font-medium cursor-pointer transition-all"
        >
          <GitBranch className="w-3.5 h-3.5 text-indigo-400" /> <span>{t18n("legacy.schema")}</span>
        </button>
        <button
          type="button"
          onClick={() => insertSnippet(t18n("legacy.field_type_description_id_string_key"))}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-slate-300 hover:text-white border border-white/[0.08] font-medium cursor-pointer transition-all"
        >
          <Table className="w-3.5 h-3.5 text-emerald-400" /> <span>{t18n("legacy.table")}</span>
        </button>
      </div>
    </div>
  );
};
