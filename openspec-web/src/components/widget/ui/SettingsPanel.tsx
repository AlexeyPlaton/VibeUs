import React, { useMemo, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { 
  Settings2, Globe, Shield, Lock, Send, ExternalLink, 
  Users, AlertTriangle, Trash2, Sparkles, Key, Check, Server, 
  Eye, EyeOff, RefreshCw, Palette, Bell, X, Link, Copy, Clock, Laptop,
  GitBranch, Cpu, Terminal, CheckCircle2
} from 'lucide-react';
import { LANGUAGES } from '../constants';
import { getAISettings, saveAISettings, testAIConnection } from '../../../utils/aiDoDMatcher';
import type { AISettings } from '../../../utils/aiDoDMatcher';
import { 
  getProjectAccessTokens, 
  generateAccessLink,
  generateAccessLinkServer,
  revokeToken, 
  revokeAllTokens, 
  getPublicFeedbackEnabled, 
  setPublicFeedbackEnabled 
} from '../../../utils/accessTokens';
import type { AccessLinkToken, AccessRole, AccessTTL } from '../../../utils/accessTokens';
import type { BoardData, Ticket, BoardColumn, CustomRole, TeamMember } from '../types';

export interface SettingsPanelProps {
  isSettingsOpen: boolean;
  setIsSettingsOpen: (open: boolean) => void;
  isPublicMode: boolean;
  currentAccessMode: string;
  setCurrentAccessMode: (mode: 'studio' | 'public_feedback' | 'client_preview') => void;
  setViewMode: (mode: 'board' | 'spec' | 'feedback') => void;
  projectId: string;
  apiToken?: string;
  groupChatId: string;
  setGroupChatId: (val: string) => void;
  handleSaveGroupChat: (e: React.FormEvent) => void;
    handleSavePrivacySettings: (telEnabled: boolean, aiSharing: boolean) => void;
    telemetryEnabled: boolean;
    setTelemetryEnabled: (val: boolean) => void;
    aiDataSharing: boolean;
    setAiDataSharing: (val: boolean) => void;
  notifyReview: boolean;
  setNotifyReview: (val: boolean) => void;
  notifyRework: boolean;
  setNotifyRework: (val: boolean) => void;
  notifyFeedback: boolean;
  setNotifyFeedback: (val: boolean) => void;
  notifyDiscussions: boolean;
  setNotifyDiscussions: (val: boolean) => void;
  customRolesList: CustomRole[];
  isManagingRoles: boolean;
  setIsManagingRoles: (val: boolean) => void;
  getRoleLabel: (r: CustomRole) => string;
  handleAddCustomRole: (e: React.FormEvent) => void;
  newRoleBadge: string;
  setNewRoleBadge: (val: string) => void;
  newRoleLabel: string;
  setNewRoleLabel: (val: string) => void;
  boardData: BoardData;
  handleAddTeamMember: (e: React.FormEvent) => void;
  newMemberName: string;
  setNewMemberName: (val: string) => void;
  newMemberTg: string;
  setNewMemberTg: (val: string) => void;
  newMemberRole: string;
  setNewMemberRole: (val: string) => void;
  accentTheme?: { brand: string } | undefined;
  currentAccent: string;
  setCurrentAccent: (val: string) => void;
  activeColumns: BoardColumn[];
  getColumnLabel: (col: BoardColumn) => string;
  handleDeleteColumn: (id: string) => void;
  handleAddColumn: (e?: React.FormEvent, customLabel?: string) => void;
  newColumnLabel: string;
  setNewColumnLabel: (val: string) => void;
  allTickets: Ticket[];
  setDeleteConfirmationInput: (val: string) => void;
  setIsProjectDeleteModalOpen: (val: boolean) => void;
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  isSettingsOpen,
  setIsSettingsOpen,
  isPublicMode,
  currentAccessMode,
  setCurrentAccessMode,
  setViewMode,
  projectId,
  apiToken,
  groupChatId,
  setGroupChatId,
  handleSaveGroupChat,
    handleSavePrivacySettings,
    telemetryEnabled,
    setTelemetryEnabled,
    aiDataSharing,
    setAiDataSharing,
  notifyReview,
  setNotifyReview,
  notifyRework,
  setNotifyRework,
  notifyFeedback,
  setNotifyFeedback,
  notifyDiscussions,
  setNotifyDiscussions,
  customRolesList,
  isManagingRoles,
  setIsManagingRoles,
  getRoleLabel,
  handleAddCustomRole,
  newRoleBadge,
  setNewRoleBadge,
  newRoleLabel,
  setNewRoleLabel,
  boardData,
  handleAddTeamMember,
  newMemberName,
  setNewMemberName,
  newMemberTg,
  setNewMemberTg,
  newMemberRole,
  setNewMemberRole,
  accentTheme,
  currentAccent,
  setCurrentAccent,
  activeColumns,
  getColumnLabel,
  handleDeleteColumn,
  handleAddColumn,
  newColumnLabel,
  setNewColumnLabel,
  allTickets,
  setDeleteConfirmationInput,
  setIsProjectDeleteModalOpen
}) => {
  const { t: t18n } = useTranslation();

  const [activeTab, setActiveTab] = useState<'access' | 'ai' | 'notifications' | 'team' | 'github' | 'appearance' | 'danger'>('access');
  const [aiSettings, setAiSettings] = useState<AISettings>(getAISettings());
  const [showApiKey, setShowApiKey] = useState(false);
  const [isTestingAI, setIsTestingAI] = useState(false);
  const [aiTestResult, setAiTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  // GitHub & MCP States
  const [githubRepo, setGithubRepo] = useState<string>('');
  const [githubToken, setGithubToken] = useState<string>('');
  const [githubSyncEnabled, setGithubSyncEnabled] = useState<boolean>(false);
  const [hasGithubToken, setHasGithubToken] = useState<boolean>(false);
  const [showGithubToken, setShowGithubToken] = useState<boolean>(false);
  const [isSavingGithub, setIsSavingGithub] = useState<boolean>(false);
  const [isTestingGithub, setIsTestingGithub] = useState<boolean>(false);
  const [githubTestResult, setGithubTestResult] = useState<{ ok: boolean; message: string; repo_name?: string } | null>(null);
  const [isSyncingGithub, setIsSyncingGithub] = useState<boolean>(false);
  const [githubSyncResult, setGithubSyncResult] = useState<{ ok: boolean; synced_count: number; message?: string } | null>(null);
  const [mcpConfigTab, setMcpConfigTab] = useState<'cursor' | 'claude' | 'cli'>('cursor');
  const [copiedMcpConfig, setCopiedMcpConfig] = useState<boolean>(false);

  // Access Link Generator State
  const [isPublicFeedbackActive, setIsPublicFeedbackActive] = useState<boolean>(getPublicFeedbackEnabled(projectId));
  const [linkRole, setLinkRole] = useState<AccessRole>('team');
  const [linkTTL, setLinkTTL] = useState<AccessTTL>('7d');
  const [linkSingleUse, setLinkSingleUse] = useState<boolean>(false);
  const [linkLabel, setLinkLabel] = useState<string>('');
  const [generatedLinkUrl, setGeneratedLinkUrl] = useState<string>('');
  const [copiedLink, setCopiedLink] = useState<boolean>(false);
  const [tokensList, setTokensList] = useState<AccessLinkToken[]>([]);

  useEffect(() => {
    if (isSettingsOpen) {
      setAiSettings(getAISettings());
      setAiTestResult(null);
      setIsPublicFeedbackActive(getPublicFeedbackEnabled(projectId));
      setTokensList(getProjectAccessTokens(projectId));

      // Load GitHub config from server
      fetch(`/api/projects/${projectId}/github`, {
        headers: apiToken ? { 'Authorization': `Bearer ${apiToken}`, 'X-API-Token': apiToken } : {}
      })
        .then(res => res.json())
        .then(data => {
          if (data && !data.detail) {
            setGithubRepo(data.github_repo || '');
            setGithubSyncEnabled(!!data.github_sync_enabled);
            setHasGithubToken(!!data.has_token);
          }
        })
        .catch(() => {});
    }
  }, [isSettingsOpen, projectId, apiToken]);

  const handleSaveGithubConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingGithub(true);
    setGithubTestResult(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/github`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiToken ? { 'Authorization': `Bearer ${apiToken}`, 'X-API-Token': apiToken } : {})
        },
        body: JSON.stringify({
          github_repo: githubRepo.trim(),
          github_token: githubToken.trim() || undefined,
          github_sync_enabled: githubSyncEnabled
        })
      });
      const data = await res.json();
      if (res.ok) {
        setHasGithubToken(data.has_token);
        setGithubTestResult({ ok: true, message: t18n('v7.settings.github_saved') });
      } else {
        setGithubTestResult({ ok: false, message: data.detail || t18n('v7.settings.save_error') });
      }
    } catch (err: any) {
      setGithubTestResult({ ok: false, message: err.message || t18n('v7.settings.network_error') });
    } finally {
      setIsSavingGithub(false);
    }
  };

  const handleTestGithub = async () => {
    setIsTestingGithub(true);
    setGithubTestResult(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/github/test`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiToken ? { 'Authorization': `Bearer ${apiToken}`, 'X-API-Token': apiToken } : {})
        },
        body: JSON.stringify({
          github_repo: githubRepo.trim(),
          github_token: githubToken.trim() || undefined
        })
      });
      const data = await res.json();
      setGithubTestResult(data);
    } catch (err: any) {
      setGithubTestResult({ ok: false, message: err.message || t18n('v7.settings.github_connect_error') });
    } finally {
      setIsTestingGithub(false);
    }
  };

  const handleSyncGithubTickets = async () => {
    setIsSyncingGithub(true);
    setGithubSyncResult(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/github/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiToken ? { 'Authorization': `Bearer ${apiToken}`, 'X-API-Token': apiToken } : {})
        }
      });
      const data = await res.json();
      if (res.ok) {
        setGithubSyncResult({
          ok: true,
          synced_count: data.synced_count,
          message: t18n('v7.settings.synced_count', { count: data.synced_count })
        });
      } else {
        setGithubSyncResult({
          ok: false,
          synced_count: 0,
          message: data.detail || t18n('v7.settings.sync_error')
        });
      }
    } catch (err: any) {
      setGithubSyncResult({
        ok: false,
        synced_count: 0,
        message: err.message || t18n('v7.settings.network_error')
      });
    } finally {
      setIsSyncingGithub(false);
    }
  };

  const getMcpConfigSnippet = () => {
    const serverUrl = window.location.origin;
    if (mcpConfigTab === 'cursor') {
      return JSON.stringify({
        "mcpServers": {
          "vibus": {
            "command": "npx",
            "args": ["vibus", "mcp", "--project", projectId, "--server", serverUrl]
          }
        }
      }, null, 2);
    } else if (mcpConfigTab === 'claude') {
      return JSON.stringify({
        "mcpServers": {
          "vibus": {
            "command": "npx",
            "args": ["-y", "vibus", "mcp", "--project", projectId, "--server", serverUrl]
          }
        }
      }, null, 2);
    } else {
      return `npx vibus mcp --project ${projectId} --server ${serverUrl}`;
    }
  };

  const handleTogglePublicFeedback = (enabled: boolean) => {
    setIsPublicFeedbackActive(enabled);
    setPublicFeedbackEnabled(projectId, enabled);
  };

  const handleCreateAccessLink = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await generateAccessLinkServer(projectId, {
      label: linkLabel.trim(),
      role: linkRole,
      ttl: linkTTL,
      singleUse: linkSingleUse
    }, apiToken);
    setGeneratedLinkUrl(res.url);
    setTokensList(getProjectAccessTokens(projectId));
    setLinkLabel('');
  };

  const handleCopyLink = (url: string) => {
    if (!url) return;
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleRevokeSingleToken = (tokenId: string) => {
    revokeToken(projectId, tokenId, apiToken);
    setTokensList(getProjectAccessTokens(projectId));
    if (generatedLinkUrl.includes(tokenId)) {
      setGeneratedLinkUrl('');
    }
  };

  const handleRevokeAllProjectTokens = () => {
    if (window.confirm(t18n('v7.settings.revoke_all_confirm'))) {
      revokeAllTokens(projectId);
      setTokensList([]);
      setGeneratedLinkUrl('');
    }
  };

  useEffect(() => {
    if (isSettingsOpen) {
      const prevOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = prevOverflow;
      };
    }
  }, [isSettingsOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isSettingsOpen) {
        setIsSettingsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSettingsOpen, setIsSettingsOpen]);

  const handleUpdateAISettings = (updates: Partial<AISettings>) => {
    const updated = { ...aiSettings, ...updates };
    setAiSettings(updated);
    saveAISettings(updated);
    setAiTestResult(null);
  };

  const handleTestConnection = async () => {
    setIsTestingAI(true);
    setAiTestResult(null);
    try {
      const res = await testAIConnection(aiSettings);
      setAiTestResult(res);
    } finally {
      setIsTestingAI(false);
    }
  };

  if (!isSettingsOpen) return null;

  return (
    <div 
      onClick={(e) => {
        if (e.target === e.currentTarget) setIsSettingsOpen(false);
      }}
      className="fixed inset-0 z-[99999999] bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 animate-fadeIn font-['Plus_Jakarta_Sans',sans-serif] overscroll-contain"
    >
      <div className="bg-slate-900/95 backdrop-blur-2xl text-slate-100 rounded-3xl max-w-3xl w-full p-5 sm:p-6 shadow-2xl border border-slate-700/60 flex flex-col max-h-[88vh] overflow-hidden animate-scaleIn">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/[0.08] pb-3 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-indigo-500/20 border border-indigo-500/30 text-indigo-400 flex items-center justify-center">
              <Settings2 className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                {t18n('widget.settings')}
                <span className="text-[10px] font-mono text-slate-400 bg-white/[0.05] border border-white/[0.08] px-2 py-0.5 rounded-full">
                  ID: {projectId}
                </span>
              </h3>
              <p className="text-[11px] text-slate-400">
                {t18n('v7.settings.subtitle')}
              </p>
            </div>
          </div>
          <button 
            onClick={() => setIsSettingsOpen(false)} 
            className="w-7 h-7 rounded-full bg-white/[0.05] hover:bg-white/[0.1] text-slate-400 hover:text-white flex items-center justify-center cursor-pointer transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-1.5 p-1 bg-slate-950/80 rounded-2xl border border-white/[0.05] overflow-x-auto shrink-0 my-3">
          <button
            type="button"
            onClick={() => setActiveTab('access')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer transition-all shrink-0 ${
              activeTab === 'access' 
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30' 
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Shield className="w-3.5 h-3.5" />
            <span>{t18n('v7.settings.tab_access')}</span>
          </button>

          {!isPublicMode && (
            <button
              type="button"
              onClick={() => setActiveTab('ai')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer transition-all shrink-0 ${
                activeTab === 'ai' 
                  ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-md shadow-indigo-600/30' 
                  : 'text-indigo-300 hover:text-white bg-indigo-500/10 border border-indigo-500/20'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>{t18n('v7.settings.tab_ai')}</span>
            </button>
          )}

          {!isPublicMode && (
            <button
              type="button"
              onClick={() => setActiveTab('notifications')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer transition-all shrink-0 ${
                activeTab === 'notifications' 
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30' 
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Bell className="w-3.5 h-3.5" />
              <span>{t18n('v7.settings.tab_notifications')}</span>
            </button>
          )}

          {!isPublicMode && (
            <button
              type="button"
              onClick={() => setActiveTab('team')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer transition-all shrink-0 ${
                activeTab === 'team' 
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30' 
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>{t18n('v7.settings.tab_team')}</span>
            </button>
          )}

          {!isPublicMode && (
            <button
              type="button"
              onClick={() => setActiveTab('github')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer transition-all shrink-0 ${
                activeTab === 'github' 
                  ? 'bg-gradient-to-r from-slate-700 to-indigo-700 text-white shadow-md shadow-slate-700/30 border border-slate-600' 
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <GitBranch className="w-3.5 h-3.5 text-indigo-400" />
              <span>GitHub & MCP</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setActiveTab('appearance')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer transition-all shrink-0 ${
              activeTab === 'appearance' 
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30' 
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Palette className="w-3.5 h-3.5" />
            <span>{t18n('v7.settings.tab_appearance')}</span>
          </button>

          {!isPublicMode && (
            <button
              type="button"
              onClick={() => setActiveTab('danger')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer transition-all shrink-0 ${
                activeTab === 'danger' 
                  ? 'bg-rose-600 text-white shadow-md shadow-rose-600/30' 
                  : 'text-rose-400 hover:text-rose-200'
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>{t18n('v7.settings.tab_danger')}</span>
            </button>
          )}
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto pr-1 min-h-[300px] space-y-4">
          
          {/* TAB 1: ACCESS & LINK GENERATOR */}
          {activeTab === 'access' && (
            <div className="space-y-4">
              
              {/* SECTION 1: PUBLIC FEEDBACK TOGGLE */}
              <div className="p-4 bg-slate-950/70 rounded-2xl border border-white/[0.06] space-y-3">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <div className="text-xs font-bold text-slate-100 flex items-center gap-2">
                      <Globe className="w-4 h-4 text-emerald-400" />
                      <span>{t18n('v7.settings.public_title')}</span>
                    </div>
                    <p className="text-[11px] text-slate-400">
                      {t18n('v7.settings.public_desc')}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleTogglePublicFeedback(!isPublicFeedbackActive)}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      isPublicFeedbackActive ? 'bg-emerald-500' : 'bg-slate-800'
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                        isPublicFeedbackActive ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                <div className={`p-2.5 rounded-xl border text-[11px] flex items-start gap-2 ${
                  isPublicFeedbackActive
                    ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
                    : 'bg-indigo-500/10 border-indigo-500/20 text-indigo-300'
                }`}>
                  {isPublicFeedbackActive ? (
                    <span>📢 <b>{t18n('v7.settings.public_on_title')}</b> {t18n('v7.settings.public_on_body')}</span>
                  ) : (
                    <span>🔒 <b>{t18n('v7.settings.public_off_title')}</b> {t18n('v7.settings.public_off_body')}</span>
                  )}
                </div>
              </div>

              {/* SECTION 2: PREVIEW MODE (FOR DEVELOPER) */}
              <div className="p-4 bg-slate-950/70 rounded-2xl border border-white/[0.06] space-y-3">
                <div className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                  <Eye className="w-3.5 h-3.5 text-indigo-400" />
                  <span>{t18n('v7.settings.preview_mode')}</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => {
                      setCurrentAccessMode('studio');
                      setViewMode('board');
                    }}
                    className={"p-3 rounded-xl border text-left cursor-pointer transition-all " + (
                      currentAccessMode === 'studio' 
                        ? 'bg-indigo-600/20 border-indigo-500/40 text-white shadow-xs' 
                        : 'bg-slate-900 border-white/[0.05] text-slate-400 hover:text-slate-200'
                    )}
                  >
                    <div className="font-bold text-xs flex items-center gap-1.5 text-white">
                      <Lock className="w-3.5 h-3.5 text-indigo-400" /> {t18n('widget.studio_mode')}
                    </div>
                    <p className="text-[10px] text-slate-400 mt-1 leading-snug">
                      {t18n('v7.settings.studio_desc')}
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setCurrentAccessMode('public_feedback');
                      setViewMode('feedback');
                    }}
                    className={"p-3 rounded-xl border text-left cursor-pointer transition-all " + (
                      currentAccessMode === 'public_feedback' 
                        ? 'bg-emerald-500/15 border-emerald-500/30 text-white shadow-xs' 
                        : 'bg-slate-900 border-white/[0.05] text-slate-400 hover:text-slate-200'
                    )}
                  >
                    <div className="font-bold text-xs flex items-center gap-1.5 text-white">
                      <Globe className="w-3.5 h-3.5 text-emerald-400" /> {t18n('widget.public_mode')}
                    </div>
                    <p className="text-[10px] text-slate-400 mt-1 leading-snug">
                      {t18n('v7.settings.guest_desc')}
                    </p>
                  </button>
                </div>
              </div>

              {/* SECTION 3: ACCESS LINK GENERATOR */}
              {!isPublicMode && (
                <div className="p-4 bg-gradient-to-r from-indigo-950/30 to-purple-950/30 rounded-2xl border border-indigo-500/20 space-y-3.5">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-bold text-white flex items-center gap-1.5">
                      <Link className="w-4 h-4 text-indigo-400" />
                      <span>{t18n('v7.settings.links_title')}</span>
                    </div>
                    <span className="text-[10px] font-mono text-purple-300 bg-purple-500/10 border border-purple-500/20 px-2 py-0.5 rounded-full">
                      {t18n('v7.settings.secure_tokens')}
                    </span>
                  </div>

                  <form onSubmit={handleCreateAccessLink} className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {/* Role selection */}
                      <div className="space-y-1">
                        <label className="text-[11px] font-semibold text-slate-300">{t18n('v7.settings.role')}</label>
                        <select
                          value={linkRole}
                          onChange={(e) => setLinkRole(e.target.value as AccessRole)}
                          className="w-full bg-slate-950 border border-slate-700/60 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-indigo-500"
                        >
                          <option value="team">{t18n('v7.settings.role_team')}</option>
                          <option value="reviewer">{t18n('v7.settings.role_reviewer')}</option>
                          <option value="tester">{t18n('v7.settings.role_tester')}</option>
                        </select>
                      </div>

                      {/* TTL selection */}
                      <div className="space-y-1">
                        <label className="text-[11px] font-semibold text-slate-300">{t18n('v7.settings.ttl')}</label>
                        <select
                          value={linkTTL}
                          onChange={(e) => setLinkTTL(e.target.value as AccessTTL)}
                          className="w-full bg-slate-950 border border-slate-700/60 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-indigo-500"
                        >
                          <option value="24h">{t18n('v7.settings.hours_24')}</option>
                          <option value="7d">{t18n('v7.settings.days_7')}</option>
                          <option value="30d">{t18n('v7.settings.days_30')}</option>
                          <option value="forever">{t18n('v7.settings.forever')}</option>
                        </select>
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-2 items-center justify-between">
                      {/* Single Use Checkbox */}
                      <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-300 select-none py-1">
                        <input
                          type="checkbox"
                          checked={linkSingleUse}
                          onChange={(e) => setLinkSingleUse(e.target.checked)}
                          className="w-4 h-4 rounded accent-indigo-500 cursor-pointer"
                        />
                        <span className="flex items-center gap-1">
                          <Laptop className="w-3.5 h-3.5 text-indigo-400" />
                          <span><b>{t18n('v7.settings.single_use_title')}</b> {t18n('v7.settings.single_use_body')}</span>
                        </span>
                      </label>

                      {/* Generate button */}
                      <button
                        type="submit"
                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold cursor-pointer transition-all shadow-md shadow-indigo-600/30 flex items-center gap-1.5 shrink-0"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>{t18n('v7.settings.generate_link')}</span>
                      </button>
                    </div>
                  </form>

                  {/* Generated link display */}
                  {generatedLinkUrl && (
                    <div className="p-3 bg-slate-950 rounded-xl border border-indigo-500/30 space-y-2 animate-fadeIn">
                      <div className="text-[10px] text-slate-400 font-semibold">{t18n('v7.settings.generated_link')}</div>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          readOnly
                          value={generatedLinkUrl}
                          className="w-full bg-slate-900 border border-slate-700/60 rounded-xl px-3 py-1.5 text-xs text-indigo-300 font-mono outline-none select-all"
                        />
                        <button
                          type="button"
                          onClick={() => handleCopyLink(generatedLinkUrl)}
                          className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold cursor-pointer transition-all flex items-center gap-1.5 shrink-0"
                        >
                          {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-300" /> : <Copy className="w-3.5 h-3.5" />}
                          <span>{copiedLink ? t18n('v7.settings.copied') : t18n('v7.settings.copy')}</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Active Tokens List */}
                  {tokensList.length > 0 && (
                    <div className="space-y-2 pt-2 border-t border-white/[0.06]">
                      <div className="flex items-center justify-between text-[11px] font-semibold text-slate-300">
                        <span>{t18n('v7.settings.active_tokens', { count: tokensList.length })}</span>
                        <button
                          type="button"
                          onClick={handleRevokeAllProjectTokens}
                          className="text-[10px] text-rose-400 hover:text-rose-300 cursor-pointer"
                        >
                          {t18n('v7.settings.revoke_all')}
                        </button>
                      </div>
                      <div className="space-y-1.5 max-h-36 overflow-y-auto">
                        {tokensList.map(tkn => (
                          <div
                            key={tkn.id}
                            className="p-2.5 bg-slate-950/80 border border-white/[0.05] rounded-xl flex items-center justify-between gap-2 text-xs"
                          >
                            <div className="space-y-0.5 truncate">
                              <div className="flex items-center gap-1.5">
                                <span className="font-semibold text-slate-200">{tkn.label}</span>
                                <span className="text-[9px] px-1.5 py-0.2 rounded-full font-mono bg-white/[0.06] text-slate-300">
                                  {tkn.role === 'team' ? t18n('v7.settings.team') : tkn.role === 'reviewer' ? t18n('v7.settings.client') : t18n('v7.settings.tester')}
                                </span>
                                {tkn.singleUse && (
                                  <span className="text-[9px] px-1.5 py-0.2 rounded-full font-mono bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                                    {t18n('v7.settings.one_device')}
                                  </span>
                                )}
                              </div>
                              <div className="text-[10px] text-slate-500 font-mono">
                                {t18n('v7.settings.token_meta', { ttl: tkn.ttl === 'forever' ? t18n('v7.settings.no_expiry') : tkn.ttl, date: new Date(tkn.createdAt).toLocaleDateString() })}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleRevokeSingleToken(tkn.id)}
                              className="p-1 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded cursor-pointer transition-colors"
                              title={t18n('v7.settings.revoke_link')}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* SECTION 4: LOCALHOST LIVE PREVIEW TUNNEL */}
              {!isPublicMode && (
                <div className="p-4 bg-slate-950/70 rounded-2xl border border-sky-500/20 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sky-400 font-bold text-xs">
                      <Server className="w-4 h-4" />
                      <span>{t18n('v7.settings.preview_title')}</span>
                    </div>
                    <span className="text-[9px] font-mono bg-sky-500/15 text-sky-300 border border-sky-500/30 px-2 py-0.5 rounded-full">
                      Vibus Gateway
                    </span>
                  </div>

                  <p className="text-[11px] text-slate-300 leading-relaxed">
                    {t18n('v7.settings.preview_desc')}
                  </p>

                  <div className="flex items-center gap-2 bg-slate-900 border border-slate-700/60 rounded-xl p-2.5">
                    <code className="text-xs font-mono text-emerald-400 flex-1 select-all">
                      npx vibus share --port 5173
                    </code>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText('npx vibus share --port 5173');
                        setCopiedLink(true);
                        setTimeout(() => setCopiedLink(false), 2000);
                      }}
                      className="px-3 py-1 bg-white/[0.08] hover:bg-white/[0.15] text-white rounded-lg text-xs font-semibold cursor-pointer transition-colors"
                    >
                      {t18n('v7.settings.copy')}
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[10px] text-slate-400 pt-1">
                    <div className="flex items-center gap-1.5">
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span>{t18n('v7.settings.instant_https')}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span>{t18n('v7.settings.widget_embedded')}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span>{t18n('v7.settings.ide_sync')}</span>
                    </div>
                  </div>
                </div>
              )}

            </div>
          )}

          {/* TAB 2: AI PROVIDER / BYOK */}
          {activeTab === 'ai' && !isPublicMode && (
            <div className="p-4 bg-indigo-950/20 border border-indigo-500/20 rounded-2xl space-y-3.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-indigo-300 font-bold text-xs">
                  <Sparkles className="w-4 h-4 text-indigo-400" />
                  <span>{t18n('v7.settings.ai_title')}</span>
                </div>
                <span className="text-[9px] font-mono bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 px-2.5 py-0.5 rounded-full">
                  {aiSettings.providerType === 'heuristic' ? t18n('v7.settings.offline_heuristic') : 'Custom API'}
                </span>
              </div>

              <p className="text-[11px] text-slate-300 leading-relaxed">
                {t18n('v7.settings.ai_desc')}
              </p>

              {/* Mode Selector */}
              <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-950 rounded-xl border border-white/[0.05]">
                <button
                  type="button"
                  onClick={() => handleUpdateAISettings({ providerType: 'heuristic' })}
                  className={`py-2 px-3 text-xs font-semibold rounded-lg transition-all cursor-pointer text-center ${
                    aiSettings.providerType === 'heuristic'
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {t18n('v7.settings.builtin_offline')}
                </button>
                <button
                  type="button"
                  onClick={() => handleUpdateAISettings({ providerType: 'custom' })}
                  className={`py-2 px-3 text-xs font-semibold rounded-lg transition-all cursor-pointer text-center ${
                    aiSettings.providerType === 'custom'
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {t18n('v7.settings.custom_model')}
                </button>
              </div>

              {/* Custom API Config Fields */}
              {aiSettings.providerType === 'custom' && (
                <div className="space-y-3 pt-1 animate-fadeIn">
                  {/* Quick Presets */}
                  <div className="space-y-1.5">
                    <span className="text-[11px] text-slate-400 block font-medium">{t18n('v7.settings.provider_presets')}</span>
                    <div className="flex gap-1.5 flex-wrap">
                      <button
                        type="button"
                        onClick={() => handleUpdateAISettings({
                          baseUrl: 'https://llmost.ru/v1',
                          model: 'gemma-2-9b-it'
                        })}
                        className="px-2.5 py-1 bg-white/[0.05] hover:bg-indigo-500/20 text-slate-300 hover:text-indigo-300 border border-white/[0.08] rounded-lg text-xs cursor-pointer"
                      >
                        LLMost (Gemma 2)
                      </button>
                      <button
                        type="button"
                        onClick={() => handleUpdateAISettings({
                          baseUrl: 'https://api.groq.com/openai/v1',
                          model: 'llama-3.3-70b-versatile'
                        })}
                        className="px-2.5 py-1 bg-white/[0.05] hover:bg-indigo-500/20 text-slate-300 hover:text-indigo-300 border border-white/[0.08] rounded-lg text-xs cursor-pointer"
                      >
                        Groq (Llama 3.3)
                      </button>
                      <button
                        type="button"
                        onClick={() => handleUpdateAISettings({
                          baseUrl: 'https://openrouter.ai/api/v1',
                          model: 'google/gemma-2-9b-it:free'
                        })}
                        className="px-2.5 py-1 bg-white/[0.05] hover:bg-indigo-500/20 text-slate-300 hover:text-indigo-300 border border-white/[0.08] rounded-lg text-xs cursor-pointer"
                      >
                        OpenRouter (Free)
                      </button>
                      <button
                        type="button"
                        onClick={() => handleUpdateAISettings({
                          baseUrl: 'http://localhost:11434/v1',
                          model: 'gemma2:9b'
                        })}
                        className="px-2.5 py-1 bg-white/[0.05] hover:bg-indigo-500/20 text-slate-300 hover:text-indigo-300 border border-white/[0.08] rounded-lg text-xs cursor-pointer"
                      >
                        Ollama (Local)
                      </button>
                    </div>
                  </div>

                  {/* Base URL */}
                  <div className="space-y-1">
                    <label className="text-xs text-slate-300 block font-semibold">Base URL (OpenAI-compatible):</label>
                    <div className="flex items-center gap-2 bg-slate-950 border border-slate-700/60 rounded-xl px-3 py-2">
                      <Server className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                      <input
                        type="text"
                        value={aiSettings.baseUrl}
                        onChange={(e) => handleUpdateAISettings({ baseUrl: e.target.value })}
                        placeholder={t18n('v7.settings.endpoint_placeholder')}
                        className="w-full bg-transparent text-xs text-white outline-none font-mono placeholder:text-slate-600"
                      />
                    </div>
                  </div>

                  {/* API Key */}
                  <div className="space-y-1">
                    <label className="text-xs text-slate-300 block font-semibold">{t18n('v7.settings.api_key')}</label>
                    <div className="flex items-center gap-2 bg-slate-950 border border-slate-700/60 rounded-xl px-3 py-2">
                      <Key className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                      <input
                        type={showApiKey ? 'text' : 'password'}
                        value={aiSettings.apiKey}
                        onChange={(e) => handleUpdateAISettings({ apiKey: e.target.value })}
                        placeholder="sk-..."
                        className="w-full bg-transparent text-xs text-white outline-none font-mono placeholder:text-slate-600"
                      />
                      <button
                        type="button"
                        onClick={() => setShowApiKey(!showApiKey)}
                        className="text-slate-500 hover:text-white cursor-pointer"
                      >
                        {showApiKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5 text-slate-400" />}
                      </button>
                    </div>
                  </div>

                  {/* Model Name */}
                  <div className="space-y-1">
                    <label className="text-xs text-slate-300 block font-semibold">{t18n('v7.settings.model_id')}</label>
                    <input
                      type="text"
                      value={aiSettings.model}
                      onChange={(e) => handleUpdateAISettings({ model: e.target.value })}
                      placeholder="gemma-2-9b-it, llama-3.3-70b-versatile, gpt-4o-mini"
                      className="w-full bg-slate-950 border border-slate-700/60 rounded-xl px-3 py-2 text-xs text-white outline-none font-mono placeholder:text-slate-600"
                    />
                  </div>

                  {/* Test Connection Button & Result */}
                  <div className="pt-1 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      disabled={isTestingAI}
                      onClick={handleTestConnection}
                      className="px-3.5 py-2 bg-white/[0.06] hover:bg-white/[0.12] text-slate-200 border border-white/[0.08] rounded-xl text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isTestingAI ? 'animate-spin' : ''}`} />
                      <span>{isTestingAI ? t18n('v7.settings.testing') : t18n('v7.settings.test_connection')}</span>
                    </button>

                    {aiTestResult && (
                      <span className={`text-xs font-medium truncate max-w-[280px] ${aiTestResult.ok ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {aiTestResult.ok ? t18n('v7.settings.connected_ok') : `❌ ${aiTestResult.message}`}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: TELEGRAM NOTIFICATIONS */}
          {activeTab === 'notifications' && !isPublicMode && (
            <div className="p-4 bg-slate-950/60 rounded-2xl border border-white/[0.06] space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                  <Send className="w-3.5 h-3.5 text-sky-400" />
                  {t18n("legacy.team_and_corporate_telegram_chat")}
                </span>
                <a
                  href={`https://t.me/Vibe_us_Bot?start=proj_${projectId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-[11px] font-semibold bg-sky-500/15 text-sky-300 border border-sky-500/25 px-3 py-1 rounded-xl hover:bg-sky-500/25 transition-colors"
                >
                  <span>{t18n("legacy.bot_vibe_us_bot")}</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>

              <form onSubmit={handleSaveGroupChat} className="space-y-3">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={groupChatId}
                    onChange={(e) => setGroupChatId(e.target.value)}
                    placeholder={t18n("legacy.vibus_team_chat_or_supergroup_id")}
                    className="flex-1 bg-slate-950 border border-slate-700/60 rounded-xl px-3 py-2 text-xs text-white placeholder:text-slate-500 outline-none focus:border-indigo-500"
                  />
                  <button type="submit" className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white font-semibold px-3.5 py-2 rounded-xl cursor-pointer transition-colors shadow-xs">
                    {t18n("legacy.save_chat")}
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2 pt-1 text-xs text-slate-300">
                  <label className="flex items-center gap-2 cursor-pointer p-2 bg-slate-900 rounded-xl border border-white/[0.05]">
                    <input type="checkbox" checked={notifyReview} onChange={(e) => setNotifyReview(e.target.checked)} className="rounded accent-indigo-500" />
                    <span>{t18n("legacy.ready_for_qa")}</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer p-2 bg-slate-900 rounded-xl border border-white/[0.05]">
                    <input type="checkbox" checked={notifyRework} onChange={(e) => setNotifyRework(e.target.checked)} className="rounded accent-indigo-500" />
                    <span>{t18n("legacy.bug_reports")}</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer p-2 bg-slate-900 rounded-xl border border-white/[0.05]">
                    <input type="checkbox" checked={notifyFeedback} onChange={(e) => setNotifyFeedback(e.target.checked)} className="rounded accent-indigo-500" />
                    <span>{t18n("legacy.ph_feedback")}</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer p-2 bg-slate-900 rounded-xl border border-white/[0.05]">
                    <input type="checkbox" checked={notifyDiscussions} onChange={(e) => setNotifyDiscussions(e.target.checked)} className="rounded accent-indigo-500" />
                    <span>{t18n("legacy.spec_discussions")}</span>
                  </label>
                </div>
              </form>
            </div>
          )}

          {/* TAB 4: TEAM MEMBERS & ROLES */}
          {activeTab === 'team' && !isPublicMode && (
            <div className="space-y-3">
              <div className="p-4 bg-slate-950/60 rounded-2xl border border-white/[0.06] space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5 text-indigo-400" />
                    {t18n("legacy.custom_project_roles")}
                  </span>
                  <button
                    type="button"
                    onClick={() => setIsManagingRoles(!isManagingRoles)}
                    className="text-xs text-slate-300 hover:text-white bg-white/[0.05] hover:bg-white/[0.1] px-3 py-1 rounded-xl cursor-pointer border border-white/[0.08] transition-colors"
                  >
                    {isManagingRoles ? t18n("legacy.hide_roles") : t18n("legacy.configure_roles")}
                  </button>
                </div>

                <div className="flex items-center gap-1.5 flex-wrap">
                  {customRolesList.map(r => (
                    <span key={r.id} className="tag-spatial">
                      <span className="mr-1">{r.badge}</span>
                      <span>{getRoleLabel(r)}</span>
                    </span>
                  ))}
                </div>

                {isManagingRoles && (
                  <form onSubmit={handleAddCustomRole} className="flex items-center gap-2 pt-1">
                    <input
                      type="text"
                      value={newRoleBadge}
                      onChange={(e) => setNewRoleBadge(e.target.value)}
                      placeholder={t18n("legacy.emoji")}
                      className="bg-slate-950 border border-slate-700/60 rounded-xl px-2 py-1.5 text-xs text-white outline-none w-14 text-center placeholder:text-slate-500 focus:border-indigo-500"
                    />
                    <input
                      type="text"
                      value={newRoleLabel}
                      onChange={(e) => setNewRoleLabel(e.target.value)}
                      placeholder={t18n("legacy.role_name_e_g_team_lead_investor")}
                      className="bg-slate-950 border border-slate-700/60 rounded-xl px-3 py-1.5 text-xs text-white outline-none flex-1 placeholder:text-slate-500 focus:border-indigo-500"
                    />
                    <button type="submit" className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs px-3.5 py-1.5 rounded-xl cursor-pointer transition-colors">
                      {t18n("legacy.role")}
                    </button>
                  </form>
                )}
              </div>

              {/* Members List & Form */}
              <div className="p-4 bg-slate-950/60 rounded-2xl border border-white/[0.06] space-y-3">
                <div className="text-xs font-bold text-slate-200">{t18n('v7.settings.team_members')}</div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {(boardData.subscribers || []).map(member => {
                    const roleObj = customRolesList.find(r => r.id === member.role);
                    return (
                      <div key={member.id} className="flex items-center gap-2 bg-slate-900 px-3 py-1.5 rounded-xl border border-white/[0.06] text-xs">
                        <span className="font-bold text-white">{member.name}</span>
                        <span className="text-[11px] text-slate-400 font-mono">{member.tg_username}</span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-white/[0.06] text-slate-300">
                          {roleObj ? `${roleObj.badge} ${getRoleLabel(roleObj)}` : member.role}
                        </span>
                      </div>
                    );
                  })}
                </div>

                <form onSubmit={handleAddTeamMember} className="flex items-center gap-2 pt-1">
                  <input
                    type="text"
                    value={newMemberName}
                    onChange={(e) => setNewMemberName(e.target.value)}
                    placeholder={t18n("legacy.participant_name")}
                    className="bg-slate-950 border border-slate-700/60 rounded-xl px-3 py-2 text-xs text-white placeholder:text-slate-500 outline-none flex-1 focus:border-indigo-500"
                  />
                  <input
                    type="text"
                    value={newMemberTg}
                    onChange={(e) => setNewMemberTg(e.target.value)}
                    placeholder={t18n("legacy.username_in_telegram")}
                    className="bg-slate-950 border border-slate-700/60 rounded-xl px-3 py-2 text-xs text-white placeholder:text-slate-500 outline-none flex-1 focus:border-indigo-500"
                  />
                  <select
                    value={newMemberRole}
                    onChange={(e: any) => setNewMemberRole(e.target.value)}
                    className="bg-slate-950 border border-slate-700/60 rounded-xl px-3 py-2 text-xs text-slate-200 outline-none focus:border-indigo-500"
                  >
                    {customRolesList.map(r => (
                      <option key={r.id} value={r.id}>{r.badge} {getRoleLabel(r)}</option>
                    ))}
                  </select>
                  <button type="submit" className="bg-indigo-600 hover:bg-indigo-500 font-semibold text-xs px-4 py-2 rounded-xl cursor-pointer text-white transition-colors">
                    {t18n("legacy.add")}
                  </button>
                </form>
              </div>
            </div>
          )}

          {/* TAB 5: APPEARANCE & COLUMNS */}
          {activeTab === 'appearance' && (
            <div className="space-y-3">
              {/* Theme Accent Color */}
              <div className="p-4 bg-slate-950/60 rounded-2xl border border-white/[0.06] flex items-center justify-between gap-2">
                <div>
                  <span className="text-xs font-bold text-slate-200 block">{t18n("legacy.accent_color")}</span>
                  <span className="text-[11px] text-slate-400">{t18n('v7.settings.palette')}</span>
                </div>
                <div className="flex items-center gap-2">
                  {[
                    { id: 'indigo', bg: 'bg-indigo-500' },
                    { id: 'emerald', bg: 'bg-emerald-500' },
                    { id: 'cyan', bg: 'bg-cyan-500' },
                    { id: 'violet', bg: 'bg-violet-500' },
                    { id: 'amber', bg: 'bg-amber-500' }
                  ].map(c => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setCurrentAccent(c.id)}
                      className={`w-6 h-6 rounded-full ${c.bg} border-2 transition-all cursor-pointer ${currentAccent === c.id ? 'border-white scale-110 shadow-md shadow-indigo-500/50' : 'border-transparent opacity-60 hover:opacity-100'}`}
                    />
                  ))}
                </div>
              </div>

              {/* Board Columns Manager (if not public mode) */}
              {!isPublicMode && (
                <div className="p-4 bg-slate-950/60 rounded-2xl border border-white/[0.06] space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-200">{t18n("legacy.columns")}</span>
                    <span className="text-[11px] text-slate-400">{t18n('v7.settings.kanban_statuses')}</span>
                  </div>

                  <div className="flex items-center gap-1.5 flex-wrap">
                    {activeColumns.map(col => (
                      <span key={col.id} className="tag-spatial flex items-center gap-1.5">
                        <span>{getColumnLabel(col)}</span>
                        {activeColumns.length > 1 && (
                          <button 
                            type="button"
                            onClick={() => handleDeleteColumn(col.id)} 
                            className="text-slate-400 hover:text-rose-400 cursor-pointer ml-1"
                          >
                            ×
                          </button>
                        )}
                      </span>
                    ))}
                  </div>

                  <form 
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!newColumnLabel.trim()) return;
                      handleAddColumn(e, newColumnLabel.trim());
                    }} 
                    className="flex items-center gap-2 pt-1"
                  >
                    <input 
                      type="text" 
                      value={newColumnLabel} 
                      onChange={(e) => setNewColumnLabel(e.target.value)}
                      placeholder={t18n("legacy.new_column")}
                      className="flex-1 bg-slate-950 border border-slate-700/60 rounded-xl px-3 py-2 text-xs text-white placeholder:text-slate-500 outline-none focus:border-indigo-500"
                    />
                    <button type="submit" className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer transition-colors">
                      + {t18n('v7.settings.add')}
                    </button>
                  </form>
                </div>
              )}
            </div>
          )}

          {/* TAB: GITHUB & MCP (AI AGENTS BRIDGE) */}
          {activeTab === 'github' && !isPublicMode && (
            <div className="space-y-4 animate-fadeIn">
              
              {/* SECTION 1: GITHUB ISSUES INTEGRATION */}
              <div className="p-4 bg-slate-950/60 rounded-2xl border border-white/[0.06] space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-100">
                    <GitBranch className="w-4 h-4 text-indigo-400" />
                    <span>{t18n('v7.settings.github_title')}</span>
                  </div>
                  {hasGithubToken && (
                    <span className="text-[10px] font-medium bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 px-2 py-0.5 rounded-full flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" />
                      {t18n('v7.settings.connected')}
                    </span>
                  )}
                </div>

                <p className="text-[11px] text-slate-400 leading-relaxed">
                  {t18n('v7.settings.github_desc')}
                </p>

                <form onSubmit={handleSaveGithubConfig} className="space-y-3 pt-1">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-300 block">
                      {t18n('v7.settings.repo_label')}<span className="text-indigo-400 font-mono">owner/repo</span>):
                    </label>
                    <input 
                      type="text" 
                      value={githubRepo}
                      onChange={(e) => setGithubRepo(e.target.value)}
                      placeholder="octocat/Hello-World"
                      className="w-full bg-slate-950 border border-slate-700/60 focus:border-indigo-500 rounded-xl px-3.5 py-2 text-xs text-white placeholder:text-slate-500 outline-none transition-all font-mono"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-semibold text-slate-300 block">
                        {t18n('v7.settings.pat_label')}<span className="text-indigo-400 font-mono">issues:write</span>):
                      </label>
                      {hasGithubToken && (
                        <span className="text-[10px] text-emerald-400">{t18n('v7.settings.token_saved')}</span>
                      )}
                    </div>
                    <div className="relative">
                      <input 
                        type={showGithubToken ? 'text' : 'password'}
                        value={githubToken}
                        onChange={(e) => setGithubToken(e.target.value)}
                        placeholder={hasGithubToken ? '••••••••••••••••••••••••••••••••' : 'github_pat_...'}
                        className="w-full bg-slate-950 border border-slate-700/60 focus:border-indigo-500 rounded-xl pl-3.5 pr-10 py-2 text-xs text-white placeholder:text-slate-500 outline-none transition-all font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => setShowGithubToken(!showGithubToken)}
                        className="absolute right-3 top-2.5 text-slate-500 hover:text-slate-300 cursor-pointer"
                      >
                        {showGithubToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  {/* Auto Sync Toggle */}
                  <label className="flex items-center gap-2.5 p-3 rounded-xl bg-white/[0.02] border border-white/[0.05] cursor-pointer hover:bg-white/[0.04] transition-all">
                    <input 
                      type="checkbox"
                      checked={githubSyncEnabled}
                      onChange={(e) => setGithubSyncEnabled(e.target.checked)}
                      className="w-4 h-4 rounded text-indigo-600 bg-slate-900 border-slate-700 focus:ring-indigo-500 focus:ring-offset-slate-900"
                    />
                    <div className="text-[11px] text-slate-300">
                      <span className="font-semibold block text-white">{t18n('v7.settings.auto_sync')}</span>
                      {t18n('v7.settings.auto_sync_desc')}
                    </div>
                  </label>

                  {/* Test or Save Result Alert */}
                  {githubTestResult && (
                    <div className={`p-3 rounded-xl text-xs flex items-center gap-2 ${
                      githubTestResult.ok 
                        ? 'bg-emerald-500/10 border border-emerald-500/25 text-emerald-300' 
                        : 'bg-rose-500/10 border border-rose-500/25 text-rose-300'
                    }`}>
                      {githubTestResult.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
                      <span>{githubTestResult.message}</span>
                    </div>
                  )}

                  {githubSyncResult && (
                    <div className={`p-3 rounded-xl text-xs flex items-center gap-2 ${
                      githubSyncResult.ok 
                        ? 'bg-indigo-500/10 border border-indigo-500/25 text-indigo-300' 
                        : 'bg-rose-500/10 border border-rose-500/25 text-rose-300'
                    }`}>
                      {githubSyncResult.ok ? <Check className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
                      <span>{githubSyncResult.message}</span>
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-2">
                    <button
                      type="button"
                      onClick={handleTestGithub}
                      disabled={isTestingGithub || (!githubRepo && !hasGithubToken)}
                      className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold cursor-pointer transition-colors disabled:opacity-40 flex items-center gap-1.5"
                    >
                      {isTestingGithub ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Globe className="w-3.5 h-3.5" />}
                      <span>{t18n('v7.settings.test_github')}</span>
                    </button>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleSyncGithubTickets}
                        disabled={isSyncingGithub || (!githubRepo && !hasGithubToken)}
                        className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-indigo-300 rounded-xl text-xs font-semibold cursor-pointer transition-colors disabled:opacity-40 flex items-center gap-1.5"
                      >
                        {isSyncingGithub ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                        <span>{t18n('v7.settings.sync_tasks')}</span>
                      </button>

                      <button
                        type="submit"
                        disabled={isSavingGithub}
                        className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold cursor-pointer transition-colors disabled:opacity-40 flex items-center gap-1.5 shadow-md shadow-indigo-600/30"
                      >
                        {isSavingGithub ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                        <span>{t18n('v7.settings.save')}</span>
                      </button>
                    </div>
                  </div>
                </form>
              </div>

              {/* SECTION 2: MODEL CONTEXT PROTOCOL (MCP) FOR AI AGENTS */}
              <div className="p-4 bg-indigo-950/20 border border-indigo-500/20 rounded-2xl space-y-3.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-bold text-indigo-300">
                    <Cpu className="w-4 h-4 text-indigo-400" />
                    <span>AI Bridge: Model Context Protocol (MCP)</span>
                  </div>
                  <span className="text-[9px] font-mono bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 px-2 py-0.5 rounded-full">
                    Claude Desktop / Cursor / Antigravity
                  </span>
                </div>

                <p className="text-[11px] text-slate-300 leading-relaxed">
                  {t18n('v7.settings.mcp_desc')}
                </p>

                {/* Tabs for IDE snippet */}
                <div className="flex items-center gap-2 border-b border-white/[0.06] pb-2">
                  <button
                    type="button"
                    onClick={() => setMcpConfigTab('cursor')}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold cursor-pointer transition-all ${
                      mcpConfigTab === 'cursor' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Cursor (.cursor/mcp.json)
                  </button>
                  <button
                    type="button"
                    onClick={() => setMcpConfigTab('claude')}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold cursor-pointer transition-all ${
                      mcpConfigTab === 'claude' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Claude Desktop
                  </button>
                  <button
                    type="button"
                    onClick={() => setMcpConfigTab('cli')}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold cursor-pointer transition-all ${
                      mcpConfigTab === 'cli' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {t18n('v7.settings.cli_terminal')}
                  </button>
                </div>

                {/* Code block with copy button */}
                <div className="relative group">
                  <pre className="p-3 bg-slate-950/90 border border-white/[0.08] rounded-xl text-[11px] font-mono text-slate-300 overflow-x-auto">
                    {getMcpConfigSnippet()}
                  </pre>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(getMcpConfigSnippet());
                      setCopiedMcpConfig(true);
                      setTimeout(() => setCopiedMcpConfig(false), 2000);
                    }}
                    className="absolute top-2.5 right-2.5 px-2.5 py-1 bg-white/[0.08] hover:bg-white/[0.15] text-white rounded-lg text-[10px] font-semibold transition-all flex items-center gap-1 cursor-pointer"
                  >
                    {copiedMcpConfig ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedMcpConfig ? t18n('v7.settings.copied') : t18n('v7.settings.copy')}</span>
                  </button>
                </div>

                <div className="text-[10px] text-slate-400 flex items-center gap-1.5">
                  <Terminal className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                  <span>{t18n('v7.settings.available_tools')} <code className="text-indigo-300 font-mono">vibus_list_tickets</code>, <code className="text-indigo-300 font-mono">vibus_get_ticket_details</code>, <code className="text-indigo-300 font-mono">vibus_update_ticket_status</code></span>
                </div>
              </div>

            </div>
          )}

          {/* TAB 6: DANGER ZONE */}
          {activeTab === 'danger' && !isPublicMode && (
            <div className="p-4 bg-rose-950/20 border border-rose-500/20 rounded-2xl space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-rose-400 font-bold text-xs">
                  <AlertTriangle className="w-4 h-4 text-rose-400" />
                  <span>{t18n('settings.danger_zone')}</span>
                </div>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                {t18n('settings.danger_zone_desc')}
              </p>
              <button
                type="button"
                onClick={() => {
                  setDeleteConfirmationInput('');
                  setIsProjectDeleteModalOpen(true);
                }}
                className="w-full py-2.5 px-4 bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 hover:text-white border border-rose-500/30 rounded-xl text-xs font-semibold transition-all cursor-pointer flex items-center justify-center gap-2"
              >
                <Trash2 className="w-4 h-4" />
                <span>{t18n('settings.delete_project_btn')}</span>
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-white/[0.08] pt-3 flex justify-end">
          <button
            type="button"
            onClick={() => setIsSettingsOpen(false)}
            className="px-5 py-2 bg-white/[0.08] hover:bg-white/[0.12] text-white rounded-xl text-xs font-semibold cursor-pointer transition-colors"
          >
            {t18n('v7.settings.close')}
          </button>
        </div>

      </div>
    </div>
  );
};
