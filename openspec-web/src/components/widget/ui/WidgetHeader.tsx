import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { 
  Sparkles, LayoutGrid, FileText, Globe, Shield, 
  Bug, ChevronDown, Check, Settings2, X, Layers, Crosshair 
} from 'lucide-react';
import { LANGUAGES } from '../constants';
import type { PublicFeedback } from '../types';

export const FlagIcon: React.FC<{ code: string; className?: string }> = ({ code, className = "w-4 h-3 rounded-xs inline-block" }) => {
  if (code === 'ru') {
    return (
      <svg className={className} viewBox="0 0 640 480">
        <path fill="#fff" d="M0 0h640v160H0z"/>
        <path fill="#0039a6" d="M0 160h640v160H0z"/>
        <path fill="#d52b1e" d="M0 320h640v160H0z"/>
      </svg>
    );
  }
  if (code === 'en') {
    return (
      <svg className={className} viewBox="0 0 640 480">
        <path fill="#bd3d44" d="M0 0h640v480H0z"/>
        <path stroke="#fff" strokeWidth="37" d="M0 55.5h640M0 129.5h640M0 203.5h640M0 277.5h640M0 351.5h640M0 425.5h640"/>
        <path fill="#192f5d" d="M0 0h260v260H0z"/>
        <g fill="#fff">
          <circle cx="35" cy="35" r="8"/>
          <circle cx="95" cy="35" r="8"/>
          <circle cx="155" cy="35" r="8"/>
          <circle cx="215" cy="35" r="8"/>
          <circle cx="65" cy="75" r="8"/>
          <circle cx="125" cy="75" r="8"/>
          <circle cx="185" cy="75" r="8"/>
          <circle cx="35" cy="115" r="8"/>
          <circle cx="95" cy="115" r="8"/>
          <circle cx="155" cy="115" r="8"/>
          <circle cx="215" cy="115" r="8"/>
          <circle cx="65" cy="155" r="8"/>
          <circle cx="125" cy="155" r="8"/>
          <circle cx="185" cy="155" r="8"/>
          <circle cx="35" cy="195" r="8"/>
          <circle cx="95" cy="195" r="8"/>
          <circle cx="155" cy="195" r="8"/>
          <circle cx="215" cy="195" r="8"/>
          <circle cx="65" cy="235" r="8"/>
          <circle cx="125" cy="235" r="8"/>
          <circle cx="185" cy="235" r="8"/>
        </g>
      </svg>
    );
  }
  if (code === 'zh') {
    return (
      <svg className={className} viewBox="0 0 640 480">
        <path fill="#ee1c25" d="M0 0h640v480H0z"/>
        <circle cx="120" cy="120" r="30" fill="#ffff00"/>
        <circle cx="200" cy="60" r="10" fill="#ffff00"/>
        <circle cx="240" cy="100" r="10" fill="#ffff00"/>
        <circle cx="240" cy="160" r="10" fill="#ffff00"/>
        <circle cx="200" cy="200" r="10" fill="#ffff00"/>
      </svg>
    );
  }
  if (code === 'hi') {
    return (
      <svg className={className} viewBox="0 0 640 480">
        <path fill="#ff9933" d="M0 0h640v160H0z"/>
        <path fill="#ffffff" d="M0 160h640v160H0z"/>
        <path fill="#128807" d="M0 320h640v160H0z"/>
        <circle cx="320" cy="240" r="32" fill="none" stroke="#000080" strokeWidth="6"/>
      </svg>
    );
  }
  return null;
};

export interface WidgetHeaderProps {
  isPublicMode: boolean;
  connected: boolean;
  projectId: string;
  viewMode: 'board' | 'spec' | 'feedback';
  setViewMode: (mode: 'board' | 'spec' | 'feedback') => void;
  feedbacksList: PublicFeedback[];
  handleOpenBugModal: (type: 'ui' | 'backend' | 'logic') => void;
  isBugModalOpen: boolean;
  isSettingsOpen: boolean;
  setIsSettingsOpen: (isOpen: boolean) => void;
  setIsOpen: (isOpen: boolean) => void;
  isInspectorActive?: boolean;
  handleToggleInspector?: () => void;
  canManageSettings?: boolean;
  isReadOnly?: boolean;
}

export const WidgetHeader: React.FC<WidgetHeaderProps> = ({
  isPublicMode,
  connected,
  projectId,
  viewMode,
  setViewMode,
  feedbacksList,
  handleOpenBugModal,
  isBugModalOpen,
  isSettingsOpen,
  setIsSettingsOpen,
  setIsOpen,
  isInspectorActive = false,
  handleToggleInspector,
  canManageSettings = true,
  isReadOnly = false
}) => {
  const { t: t18n, i18n } = useTranslation();
  
  const [isLangDropdownOpen, setIsLangDropdownOpen] = useState(false);
  const langDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const path = event.composedPath ? event.composedPath() : [];
      if (langDropdownRef.current && !langDropdownRef.current.contains(event.target as Node) && !path.includes(langDropdownRef.current)) {
        setIsLangDropdownOpen(false);
      }
    };
    if (isLangDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isLangDropdownOpen]);

  const currentLang = useMemo(() => {
    const currentCode = (i18n.language || 'en').split('-')[0];
    return LANGUAGES.find(l => l.code === currentCode) || LANGUAGES[0]!;
  }, [i18n.language]);

  return (
    <div className="flex justify-between items-center mb-6 pb-4 border-b border-white/[0.07] shrink-0 font-['Plus_Jakarta_Sans',sans-serif]">
      {/* Brand & Project Info */}
      <div className="flex items-center gap-3.5">
        <div className="w-10 h-10 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center shadow-inner text-indigo-400 shrink-0">
          <Layers className="w-5 h-5" />
        </div>
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-lg md:text-xl font-bold text-slate-100 tracking-tight leading-tight">
              {isPublicMode ? 'VibeUs Feedback' : 'VibeUs'}
            </h2>
            <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              {connected ? t18n('v7.header.online') : t18n('v7.header.syncing')}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            {projectId || 'Spatial Interface V1'}
          </p>
        </div>
      </div>

      {/* SEGMENTED VIEW SWITCHER */}
      {!isPublicMode && (
        <div className="hidden md:flex items-center bg-slate-900/60 p-1 rounded-2xl border border-white/[0.08] shadow-inner">
          <button
            onClick={() => setViewMode('board')}
            className={`flex items-center gap-2 px-4 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
              viewMode === 'board' 
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30' 
                : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            <span>{t18n("legacy.board")}</span>
          </button>
          <button
            onClick={() => setViewMode('spec')}
            className={`flex items-center gap-2 px-4 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
              viewMode === 'spec' 
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30' 
                : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>{t18n("legacy.spec_requirements")}</span>
          </button>
          <button
            onClick={() => setViewMode('feedback')}
            className={`flex items-center gap-2 px-4 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer relative ${
              viewMode === 'feedback' 
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30' 
                : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
            }`}
          >
            <Globe className="w-3.5 h-3.5" />
            <span>{t18n('widget.feedback')}</span>
            {feedbacksList.filter(f => f.status === 'new').length > 0 && (
              <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
            )}
          </button>
        </div>
      )}

      {/* ACTION BUTTONS & CLOSE */}
      <div className="flex items-center gap-2">
        {/* Visual Inspector button */}
        {handleToggleInspector && (
          <button
            type="button"
            onClick={handleToggleInspector}
            title={t18n('v7.header.inspector_title')}
            className={"flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer backdrop-blur-md " + (
              isInspectorActive
                ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40 shadow-sm'
                : 'bg-white/[0.05] hover:bg-white/[0.09] text-slate-300 border border-white/[0.08]'
            )}
          >
            <Crosshair className={"w-3.5 h-3.5 " + (isInspectorActive ? 'text-rose-400 animate-spin-slow' : 'text-slate-300')} />
            <span className="hidden sm:inline">{t18n('v7.header.inspector')}</span>
          </button>
        )}

        {/* Universal Bug / Idea / Feedback Reporter Button */}
        <button
          onClick={() => handleOpenBugModal('ui')}
          title={t18n('v7.header.report_title')}
          className={"flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer backdrop-blur-md " + (
            isBugModalOpen 
              ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 shadow-sm' 
              : 'bg-white/[0.05] hover:bg-white/[0.09] text-slate-300 border border-white/[0.08]'
          )}
        >
          <Sparkles className={"w-3.5 h-3.5 " + (isBugModalOpen ? 'text-indigo-300' : 'text-indigo-400')} />
          <span className="hidden sm:inline">{t18n('v7.header.bug_idea')}</span>
        </button>

        {/* Language Selector Dropdown */}
        <div className="relative" ref={langDropdownRef}>
          <button
            type="button"
            onClick={() => setIsLangDropdownOpen(!isLangDropdownOpen)}
            title={t18n('widget.language')}
            className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer bg-white/[0.05] border border-white/[0.08] hover:bg-white/[0.09] text-slate-300 hover:text-white"
          >
            <FlagIcon code={currentLang.code} className="w-4 h-3 rounded-xs shadow-xs" />
            <span className="hidden md:inline text-[11px] font-semibold">{currentLang.code.toUpperCase()}</span>
            <ChevronDown className={`w-3 h-3 text-slate-400 transition-transform duration-200 ${isLangDropdownOpen ? 'rotate-180' : ''}`} />
          </button>

          {isLangDropdownOpen && (
            <div className="absolute right-0 top-full mt-2 w-44 bg-slate-900/95 backdrop-blur-2xl border border-slate-700/60 rounded-2xl shadow-2xl py-1.5 z-50 animate-scaleIn select-none">
              <div className="px-3 py-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-white/[0.06]">
                {t18n('widget.language')}
              </div>
              <div className="p-1 space-y-0.5">
                {LANGUAGES.map((lang) => {
                  const isActive = currentLang.code === lang.code;
                  return (
                    <button
                      key={lang.code}
                      type="button"
                      onClick={() => {
                        i18n.changeLanguage(lang.code);
                        setIsLangDropdownOpen(false);
                      }}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-all cursor-pointer ${
                        isActive
                          ? 'bg-indigo-600 text-white font-semibold shadow-xs'
                          : 'text-slate-300 hover:bg-white/[0.06] hover:text-white'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <FlagIcon code={lang.code} className="w-4 h-3 rounded-xs shadow-xs" />
                        <span>{lang.label}</span>
                      </div>
                      {isActive && <Check className="w-3.5 h-3.5 text-white" />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Unified Settings Button */}
        {canManageSettings && (
          <button
            onClick={() => setIsSettingsOpen(!isSettingsOpen)}
            title={t18n("widget.settings")}
            className={"w-9 h-9 rounded-xl bg-white/[0.05] border border-white/[0.08] flex items-center justify-center transition-all cursor-pointer " + (
              isSettingsOpen 
                ? 'bg-indigo-600 text-white border-indigo-500 shadow-md shadow-indigo-600/30' 
                : 'text-slate-400 hover:text-white hover:bg-white/[0.09]'
            )}
          >
            <Settings2 className="w-4 h-4" />
          </button>
        )}

        {/* Close Button */}
        <button 
          onClick={() => setIsOpen(false)}
          className="close-kanban w-9 h-9 rounded-xl bg-white/[0.05] border border-white/[0.08] flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/[0.09] transition-all cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
