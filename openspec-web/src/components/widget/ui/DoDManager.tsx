import React, { useState, useEffect } from 'react';
import { 
  X, Check, Plus, Trash2, Sparkles, BookOpen, ShieldCheck, 
  Layers, Package, CheckSquare, Search, Send, ArrowRight, Lightbulb
} from 'lucide-react';
import { 
  GOLDEN_DOD_CATALOG, 
  PREPACKAGED_DOD_PRESETS, 
  getCustomChecks, 
  saveCustomCheck, 
  deleteCustomCheck,
  getEngineeringQualityMode,
  setEngineeringQualityMode
} from '../../../utils/dodCatalog';
import type { DoDItem, EngineeringQualityMode } from '../../../utils/dodCatalog';
import { generateSmartDoDWithAI } from '../../../utils/aiDoDMatcher';
import type { GeneratedDoDCriterion } from '../../../utils/aiDoDMatcher';

interface DoDManagerProps {
  isOpen: boolean;
  onClose: () => void;
  ticketTitle: string;
  ticketSummary?: string;
  category?: string;
  currentChecklists: Record<string, boolean>;
  onAddCriteria: (items: DoDItem[], qualityMode: EngineeringQualityMode) => void;
  t18n: (key: string, params?: any) => string;
}

export const DoDManager: React.FC<DoDManagerProps> = ({
  isOpen,
  onClose,
  ticketTitle,
  ticketSummary = '',
  category = '',
  currentChecklists,
  onAddCriteria,
  t18n
}) => {
  const [activeTab, setActiveTab] = useState<'presets' | 'catalog' | 'custom' | 'ai' | 'suggest'>('presets');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<string>('all');
  const [selectedCheckIds, setSelectedCheckIds] = useState<Set<string>>(new Set());
  const [qualityMode, setQualityMode] = useState<EngineeringQualityMode>(() => getEngineeringQualityMode());

  const [customChecks, setCustomChecks] = useState<DoDItem[]>([]);
  const [newCustomTitle, setNewCustomTitle] = useState('');
  const [newCustomCat, setNewCustomCat] = useState<DoDItem['category']>('boundary');

  const [suggestTitle, setSuggestTitle] = useState('');
  const [suggestReason, setSuggestReason] = useState('');
  const [suggestSent, setSuggestSent] = useState(false);

  const [aiItems, setAiItems] = useState<GeneratedDoDCriterion[]>([]);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [selectedAiIndices, setSelectedAiIndices] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (isOpen) {
      setCustomChecks(getCustomChecks());
      setSelectedCheckIds(new Set());
      setSuggestSent(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const existingTitles = Object.keys(currentChecklists);
  const allCatalogItems = [...GOLDEN_DOD_CATALOG, ...customChecks];
  const filteredCatalogItems = allCatalogItems.filter(item => {
    const matchesSearch = item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.description && item.description.toLowerCase().includes(searchQuery.toLowerCase())) ||
      item.tags.some(t => t.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesCat = selectedCategoryFilter === 'all' || item.category === selectedCategoryFilter;
    return matchesSearch && matchesCat;
  });

  const qualityLabel = (mode: EngineeringQualityMode) => t18n(`v7.dod.quality.${mode}`);
  const severityLabel = (severity: string) => t18n(`v7.dod.severity.${severity}`, { defaultValue: severity });
  const categoryLabel = (itemCategory: string) => t18n(`v7.dod.category.${itemCategory}`, { defaultValue: itemCategory });

  const handleToggleCheckSelection = (id: string) => {
    const next = new Set(selectedCheckIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedCheckIds(next);
  };

  const handleApplySelectedFromCatalog = () => {
    const itemsToAdd: DoDItem[] = [];
    allCatalogItems.forEach(item => {
      if (selectedCheckIds.has(item.id) && !currentChecklists[item.title]) {
        itemsToAdd.push(item);
      }
    });
    if (itemsToAdd.length > 0) {
      onAddCriteria(itemsToAdd, qualityMode);
    }
    onClose();
  };

  const handleApplyPreset = (checkIds: string[]) => {
    const itemsToAdd: DoDItem[] = [];
    checkIds.forEach(id => {
      const found = allCatalogItems.find(c => c.id === id);
      if (found && !currentChecklists[found.title]) {
        itemsToAdd.push(found);
      }
    });
    if (itemsToAdd.length > 0) {
      onAddCriteria(itemsToAdd, qualityMode);
    }
    onClose();
  };

  const handleCreateCustomCheck = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCustomTitle.trim()) return;
    const created = saveCustomCheck({
      title: newCustomTitle.trim(),
      category: newCustomCat,
      tags: ['custom', newCustomCat]
    });
    setCustomChecks(prev => [...prev, created]);
    setNewCustomTitle('');
  };

  const handleDeleteCustomCheck = (id: string) => {
    deleteCustomCheck(id);
    setCustomChecks(prev => prev.filter(c => c.id !== id));
  };

  const handleSendCommunitySuggestion = (e: React.FormEvent) => {
    e.preventDefault();
    if (!suggestTitle.trim()) return;
    setSuggestSent(true);
    setTimeout(() => {
      setSuggestTitle('');
      setSuggestReason('');
    }, 2000);
  };

  const handleRunAiGeneration = async () => {
    setIsAiLoading(true);
    try {
      const result = await generateSmartDoDWithAI(
        ticketTitle,
        ticketSummary,
        category,
        existingTitles,
        qualityMode
      );
      setAiItems(result.criteria);
      setSelectedAiIndices(new Set(result.criteria.map((_, i) => i)));
    } finally {
      setIsAiLoading(false);
    }
  };

  const handleApplyAiItems = () => {
    const selected = aiItems.filter((_, idx) => selectedAiIndices.has(idx));
    const existingByTitle = new Map(customChecks.map(item => [item.title.trim().toLowerCase(), item]));
    const newlySaved: DoDItem[] = [];
    const itemsToAdd: DoDItem[] = [];
    for (const item of selected) {
      const titleKey = item.title.trim().toLowerCase();
      let persisted = existingByTitle.get(titleKey);
      if (!persisted) {
        persisted = saveCustomCheck({
          id: item.id.startsWith('AI_') ? item.id : `AI_${item.id}`,
          title: item.title,
          category: item.category,
          severity: item.severity,
          requirement: item.requirement,
          why: item.why,
          applicability: item.applicability,
          verification: {
            type: item.verificationType,
            adapter: item.verificationAdapter || undefined,
            target: item.verificationTarget || undefined,
            requiredTest: item.requiredTest || undefined,
            passCondition: item.passCondition,
          },
          negativeCase: item.negativeCase || undefined,
          positiveControl: item.positiveControl || undefined,
          requiredArtifacts: item.requiredArtifacts,
          forbiddenShortcuts: item.forbiddenShortcuts,
          tags: ['ai-generated', item.category, item.severity],
          profiles: ['ai-generated', item.category],
          minQuality: qualityMode,
        });
        newlySaved.push(persisted);
        existingByTitle.set(titleKey, persisted);
      }
      itemsToAdd.push(persisted);
    }
    if (newlySaved.length) setCustomChecks(prev => [...prev, ...newlySaved]);
    if (itemsToAdd.length > 0) onAddCriteria(itemsToAdd, qualityMode);
    onClose();
  };

  const categories = [
    { id: 'all', label: t18n('v7.dod.cat_all'), icon: '📂' },
    { id: 'security', label: t18n('v7.dod.cat_security'), icon: '🛡️' },
    { id: 'boundary', label: t18n('v7.dod.cat_boundary'), icon: '🧪' },
    { id: 'spec', label: t18n('v7.dod.cat_spec'), icon: '📐' },
    { id: 'ui_ux', label: t18n('v7.dod.cat_uiux'), icon: '🎨' },
    { id: 'backend_perf', label: t18n('v7.dod.cat_backend'), icon: '⚙️' }
  ];

  return (
    <div 
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-[99999999] bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 animate-fadeIn font-['Plus_Jakarta_Sans',sans-serif]"
    >
      <div className="bg-slate-900/95 backdrop-blur-2xl text-slate-100 rounded-3xl max-w-3xl w-full p-5 sm:p-6 shadow-2xl border border-slate-700/60 flex flex-col max-h-[90vh] space-y-4 animate-scaleIn">
        <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-indigo-500/20 border border-indigo-500/30 text-indigo-400 flex items-center justify-center">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                {t18n('v7.dod.title')}
                <span className="text-[10px] font-mono text-indigo-300 bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded-full">
                  {t18n('v7.dod.assist_badge')}
                </span>
              </h3>
              <p className="text-[11px] text-slate-400">
                {t18n('v7.dod.subtitle')}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full bg-white/[0.05] hover:bg-white/[0.1] text-slate-400 hover:text-white flex items-center justify-center cursor-pointer transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/[0.06] bg-slate-950/60 px-3 py-2">
          <div>
            <div className="text-[11px] font-bold text-slate-200">{t18n('v7.dod.quality_title')}</div>
            <div className="text-[10px] text-slate-500">{t18n('v7.dod.quality_help')}</div>
          </div>
          <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-900 border border-white/[0.06]">
            {(['standard', 'strict', 'critical'] as EngineeringQualityMode[]).map(mode => (
              <button
                key={mode}
                type="button"
                onClick={() => { setQualityMode(mode); setEngineeringQualityMode(mode); }}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all ${qualityMode === mode ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'}`}
              >
                {qualityLabel(mode)}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-1.5 p-1 bg-slate-950/80 rounded-2xl border border-white/[0.05] overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveTab('presets')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer transition-all shrink-0 ${
              activeTab === 'presets' 
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30' 
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Package className="w-3.5 h-3.5" />
            <span>{t18n('v7.dod.tab_presets')}</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('catalog')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer transition-all shrink-0 ${
              activeTab === 'catalog' 
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30' 
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>{t18n('v7.dod.tab_catalog', { count: filteredCatalogItems.length })}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('ai');
              if (aiItems.length === 0) handleRunAiGeneration();
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer transition-all shrink-0 ${
              activeTab === 'ai' 
                ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-md shadow-indigo-600/30' 
                : 'text-indigo-300 hover:text-white bg-indigo-500/10 border border-indigo-500/20'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-indigo-300" />
            <span>{t18n('v7.dod.tab_ai')}</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('custom')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer transition-all shrink-0 ${
              activeTab === 'custom' 
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30' 
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>{t18n('v7.dod.tab_custom', { count: customChecks.length })}</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('suggest')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer transition-all shrink-0 ${
              activeTab === 'suggest' 
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30' 
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Lightbulb className="w-3.5 h-3.5" />
            <span>{t18n('v7.dod.tab_suggest')}</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto pr-1 min-h-[320px]">
          {activeTab === 'presets' && (
            <div className="space-y-3">
              <p className="text-xs text-slate-400">
                {t18n('v7.dod.presets_help')}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {PREPACKAGED_DOD_PRESETS.map(preset => (
                  <div 
                    key={preset.id}
                    className="p-3.5 bg-slate-950/70 hover:bg-slate-950 border border-white/[0.06] hover:border-indigo-500/40 rounded-2xl transition-all space-y-2 group flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-center gap-2 font-bold text-xs text-slate-100">
                        <span>{preset.icon}</span>
                        <span>{preset.title}</span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                        {preset.description}
                      </p>
                      <div className="mt-2 text-[10px] text-slate-500 font-mono">
                        {t18n('v7.dod.criteria_count', { count: preset.checkIds.length })}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleApplyPreset(preset.checkIds)}
                      className="w-full mt-2 py-1.5 bg-indigo-600/20 hover:bg-indigo-600 group-hover:text-white text-indigo-300 border border-indigo-500/30 rounded-xl text-xs font-semibold transition-all cursor-pointer flex items-center justify-center gap-1.5"
                    >
                      <span>{t18n('v7.dod.apply_pack')}</span>
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'catalog' && (
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="relative flex-1">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={t18n('v7.dod.search_placeholder')}
                    className="w-full bg-slate-950 border border-slate-700/60 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder:text-slate-500 outline-none focus:border-indigo-500"
                  />
                </div>
                <div className="flex gap-1 overflow-x-auto pb-1">
                  {categories.map(cat => (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setSelectedCategoryFilter(cat.id)}
                      className={`px-2.5 py-1.5 rounded-xl text-[11px] font-semibold whitespace-nowrap cursor-pointer transition-all border ${
                        selectedCategoryFilter === cat.id
                          ? 'bg-indigo-500/20 border-indigo-500/40 text-indigo-300'
                          : 'bg-white/[0.03] border-white/[0.06] text-slate-400 hover:text-white'
                      }`}
                    >
                      {cat.icon} {cat.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5 max-h-72 overflow-y-auto">
                {filteredCatalogItems.length === 0 ? (
                  <div className="p-8 text-center border border-dashed border-white/[0.08] rounded-2xl text-xs text-slate-500">
                    {t18n('v7.dod.nothing_found')}
                  </div>
                ) : (
                  filteredCatalogItems.map(item => {
                    const isAlreadyAdded = !!currentChecklists[item.title];
                    const isSelected = selectedCheckIds.has(item.id);

                    return (
                      <div
                        key={item.id}
                        onClick={() => !isAlreadyAdded && handleToggleCheckSelection(item.id)}
                        className={`p-2.5 rounded-xl border transition-all flex items-start justify-between gap-3 ${
                          isAlreadyAdded 
                            ? 'opacity-40 bg-slate-950 border-white/[0.04] cursor-not-allowed'
                            : isSelected
                            ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-200 cursor-pointer'
                            : 'bg-slate-950/60 hover:bg-slate-950 border-white/[0.05] text-slate-300 cursor-pointer'
                        }`}
                      >
                        <div className="flex items-start gap-2.5">
                          <input
                            type="checkbox"
                            checked={isSelected || isAlreadyAdded}
                            disabled={isAlreadyAdded}
                            onChange={() => {}}
                            className="w-4 h-4 rounded mt-0.5 cursor-pointer accent-indigo-500"
                          />
                          <div className="space-y-0.5">
                            <div className="text-xs font-semibold leading-snug">
                              {item.title}
                            </div>
                            {item.description && (
                              <p className="text-[11px] text-slate-400 font-normal">
                                {item.description}
                              </p>
                            )}
                          </div>
                        </div>
                        {isAlreadyAdded && (
                          <span className="text-[10px] font-mono text-emerald-400 shrink-0 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-lg">
                            {t18n('v7.dod.already_ticket')}
                          </span>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {activeTab === 'ai' && (
            <div className="space-y-3">
              <div className="p-3.5 bg-gradient-to-r from-indigo-950/40 to-purple-950/40 rounded-2xl border border-indigo-500/20 flex items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <div className="text-xs font-bold text-white flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                    <span>{t18n('v7.dod.ai_title')}</span>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    {t18n('v7.dod.ai_desc', { title: ticketTitle })}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={isAiLoading}
                  onClick={handleRunAiGeneration}
                  className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl text-xs font-semibold cursor-pointer transition-all shadow-md shadow-indigo-600/30 flex items-center gap-1.5 shrink-0"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>{isAiLoading ? t18n('v7.dod.generating') : t18n('v7.dod.regenerate')}</span>
                </button>
              </div>

              {isAiLoading ? (
                <div className="p-12 text-center space-y-2">
                  <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto" />
                  <p className="text-xs text-slate-400">{t18n('v7.dod.ai_analyzing')}</p>
                </div>
              ) : aiItems.length === 0 ? (
                <div className="p-8 text-center border border-dashed border-white/[0.08] rounded-2xl text-xs text-slate-400">
                  {t18n('v7.dod.ai_prompt')}
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="text-[11px] font-semibold text-slate-400">
                    {t18n('v7.dod.suggested_criteria')}
                  </div>
                  {aiItems.map((item, idx) => {
                    const isSelected = selectedAiIndices.has(idx);
                    return (
                      <div
                        key={idx}
                        onClick={() => {
                          const next = new Set(selectedAiIndices);
                          if (next.has(idx)) next.delete(idx);
                          else next.add(idx);
                          setSelectedAiIndices(next);
                        }}
                        className={`p-3 rounded-xl border transition-all cursor-pointer flex items-start gap-2.5 ${
                          isSelected
                            ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-200'
                            : 'bg-slate-950/60 hover:bg-slate-950 border-white/[0.05] text-slate-300'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {}}
                          className="w-4 h-4 rounded mt-0.5 cursor-pointer accent-indigo-500"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-[9px] font-black uppercase tracking-wide text-slate-400">{severityLabel(item.severity)}</span>
                            <span className="text-[9px] font-mono text-slate-500">{categoryLabel(item.category)}</span>
                          </div>
                          <div className="text-xs font-medium leading-relaxed">{item.title}</div>
                          {item.requiredTest ? <div className="mt-1 text-[10px] text-slate-400">{t18n('v7.dod.verify_label')}: {item.requiredTest}</div> : null}
                          <div className="mt-1 text-[10px] text-slate-500">{t18n('v7.dod.pass_label')}: {item.passCondition}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {activeTab === 'custom' && (
            <div className="space-y-4">
              <form onSubmit={handleCreateCustomCheck} className="p-3.5 bg-slate-950 rounded-2xl border border-white/[0.08] space-y-3">
                <div className="text-xs font-bold text-white">{t18n('v7.dod.custom_title')}</div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newCustomTitle}
                    onChange={(e) => setNewCustomTitle(e.target.value)}
                    placeholder={t18n('v7.dod.custom_placeholder')}
                    className="flex-1 bg-slate-900 border border-slate-700/60 rounded-xl px-3 py-2 text-xs text-white placeholder:text-slate-500 outline-none focus:border-indigo-500"
                    required
                  />
                  <select
                    value={newCustomCat}
                    onChange={(e) => setNewCustomCat(e.target.value as any)}
                    className="bg-slate-900 border border-slate-700/60 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-indigo-500"
                  >
                    <option value="security">🛡️ {t18n('v7.dod.category.security')}</option>
                    <option value="boundary">🧪 {t18n('v7.dod.category.boundary')}</option>
                    <option value="spec">📐 {t18n('v7.dod.category.spec')}</option>
                    <option value="ui_ux">🎨 {t18n('v7.dod.category.ui_ux')}</option>
                    <option value="backend_perf">⚙️ {t18n('v7.dod.category.backend_perf')}</option>
                  </select>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold cursor-pointer transition-colors flex items-center gap-1 shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>{t18n('v7.dod.save')}</span>
                  </button>
                </div>
              </form>

              <div className="space-y-1.5">
                <div className="text-[11px] font-semibold text-slate-400">{t18n('v7.dod.saved_title')}</div>
                {customChecks.length === 0 ? (
                  <div className="p-6 text-center border border-dashed border-white/[0.08] rounded-2xl text-xs text-slate-500">
                    {t18n('v7.dod.saved_empty')}
                  </div>
                ) : (
                  customChecks.map(item => (
                    <div
                      key={item.id}
                      className="p-2.5 bg-slate-950/60 border border-white/[0.05] rounded-xl flex items-center justify-between gap-2"
                    >
                      <div className="text-xs text-slate-200 font-medium truncate">{item.title}</div>
                      <button
                        type="button"
                        onClick={() => handleDeleteCustomCheck(item.id)}
                        className="p-1 hover:bg-rose-500/20 text-slate-400 hover:text-rose-300 rounded cursor-pointer transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {activeTab === 'suggest' && (
            <div className="space-y-3">
              <div className="p-3.5 bg-indigo-500/10 rounded-2xl border border-indigo-500/20 space-y-1">
                <div className="text-xs font-bold text-indigo-300">{t18n('v7.dod.suggest_title')}</div>
                <p className="text-[11px] text-slate-300 leading-relaxed">
                  {t18n('v7.dod.suggest_desc')}
                </p>
              </div>

              {suggestSent ? (
                <div className="p-6 text-center bg-emerald-500/10 border border-emerald-500/20 rounded-2xl text-xs text-emerald-300 font-semibold flex items-center justify-center gap-2">
                  <Check className="w-4 h-4" />
                  <span>{t18n('v7.dod.suggest_thanks')}</span>
                </div>
              ) : (
                <form onSubmit={handleSendCommunitySuggestion} className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-300">{t18n('v7.dod.suggest_label')}</label>
                    <input
                      type="text"
                      value={suggestTitle}
                      onChange={(e) => setSuggestTitle(e.target.value)}
                      placeholder={t18n('v7.dod.suggest_placeholder')}
                      className="w-full bg-slate-950 border border-slate-700/60 rounded-xl px-3 py-2 text-xs text-white placeholder:text-slate-500 outline-none focus:border-indigo-500"
                      required
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-300">{t18n('v7.dod.suggest_why')}</label>
                    <textarea
                      value={suggestReason}
                      onChange={(e) => setSuggestReason(e.target.value)}
                      rows={2}
                      placeholder={t18n('v7.dod.suggest_why_placeholder')}
                      className="w-full bg-slate-950 border border-slate-700/60 rounded-xl p-3 text-xs text-white placeholder:text-slate-500 outline-none focus:border-indigo-500"
                    />
                  </div>

                  <button
                    type="submit"
                    className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold cursor-pointer transition-all shadow-md shadow-indigo-600/30 flex items-center justify-center gap-2"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>{t18n('v7.dod.send_suggestion')}</span>
                  </button>
                </form>
              )}
            </div>
          )}
        </div>

        <div className="border-t border-white/[0.08] pt-3 flex items-center justify-between">
          <div className="text-[11px] text-slate-400">
            {activeTab === 'catalog' && selectedCheckIds.size > 0 && (
              <span>{t18n('v7.dod.selected_catalog', { count: selectedCheckIds.size })}</span>
            )}
            {activeTab === 'ai' && selectedAiIndices.size > 0 && (
              <span>{t18n('v7.dod.selected_ai', { count: selectedAiIndices.size, total: aiItems.length })}</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-white rounded-xl cursor-pointer"
            >
              {t18n('v7.dod.close')}
            </button>

            {activeTab === 'catalog' && (
              <button
                type="button"
                disabled={selectedCheckIds.size === 0}
                onClick={handleApplySelectedFromCatalog}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl text-xs font-semibold cursor-pointer transition-all shadow-md shadow-indigo-600/30 flex items-center gap-1.5"
              >
                <Check className="w-3.5 h-3.5" />
                <span>{t18n('v7.dod.add_selected', { count: selectedCheckIds.size })}</span>
              </button>
            )}

            {activeTab === 'ai' && (
              <button
                type="button"
                disabled={selectedAiIndices.size === 0}
                onClick={handleApplyAiItems}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl text-xs font-semibold cursor-pointer transition-all shadow-md shadow-indigo-600/30 flex items-center gap-1.5"
              >
                <Check className="w-3.5 h-3.5" />
                <span>{t18n('v7.dod.add_ticket', { count: selectedAiIndices.size })}</span>
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  );
};
