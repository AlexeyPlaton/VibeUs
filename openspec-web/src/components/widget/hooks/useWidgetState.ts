import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { getDefaultRoles, getDefaultColumns, LANGUAGES } from '../constants';
import { getDeviceEnvironment } from '../../../utils/deviceInfo';
import { buildTicketExecutionPrompt, ENGINEERING_EXECUTION_CONTRACT_V2 } from '../../../utils/engineeringContract';
import { getEngineeringQualityMode } from '../../../utils/dodCatalog';
import { telemetry } from '../networkTelemetry';
import { trackEvent } from '../telemetry';
import { WsMutationQueue } from '../mutations/mutationQueue';
import { getOrCreateDeviceId } from '../deviceIdentity';
import {
  createTicket, updateTicket, reviewTicket, deleteTicket, moveTicket, batchTickets,
  createNode, updateNode, deleteNode, updateProjectSettings, deleteColumn,
  createDiscussion, addDiscussionComment, updateDiscussion,
  convertDiscussionToTicket, convertFeedbackToTicket
} from '../api/client';
import type { 
  Ticket, NodeItem, BoardColumn, CustomRole, TeamMember, 
  PublicFeedback, GroupChatConfig, BoardData, BugContext,
  Checklist, DiscussionThread, DiscussionComment, CustomBoard
} from '../types';

export const useWidgetState = (
  projectId: string, 
  serverUrl: string, 
  apiToken: string, 
  initialBoardData: any, 
  theme: string, 
  accentColor: string, 
  mode: 'studio' | 'public_feedback' | 'client_preview' | string,
  publicKey: string = ''
) => {
  const { t: t18n, i18n } = useTranslation();
  const DEFAULT_ROLES = useMemo(() => getDefaultRoles(t18n), [t18n]);
  const DEFAULT_COLUMNS = useMemo(() => getDefaultColumns(t18n), [t18n]);

  const getColumnLabel = (col: BoardColumn) => {
    if (col.id === 'backlog' || col.label === 'Бэклог') return t18n('legacy.backlog');
    if (col.id === 'in_progress' || col.label === 'В работе у ИИ') return t18n('legacy.in_progress');
    if (col.id === 'review' || col.label === 'Приемка / QA' || col.label.toLowerCase().includes('qa') || col.label.toLowerCase().includes('приемка') || col.label.toLowerCase().includes('review')) return t18n('legacy.review_qa');
    if (col.id === 'done' || col.label === 'Готово') return t18n('legacy.done');
    return col.label;
  };

  const getRoleLabel = (roleIdOrObj: string | CustomRole) => {
    const roleId = typeof roleIdOrObj === 'string' ? roleIdOrObj : roleIdOrObj.id;
    if (roleId === 'client') return t18n('legacy.customer_po');
    if (roleId === 'developer') return t18n('legacy.developer');
    if (roleId === 'qa') return t18n('legacy.tester_qa');
    if (roleId === 'designer') return t18n('legacy.designer_ui');
    if (roleId === 'devops') return t18n('legacy.devops_infra');
    if (typeof roleIdOrObj === 'object') return roleIdOrObj.label;
    return roleId;
  };


  const [isOpen, setIsOpen] = useState(false);
  const [connected, setConnected] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  
  // DOM Context Capture
  const lastClickedRef = useRef<{ url: string; element_html: string } | null>(null);
  useEffect(() => {
    const handleGlobalClick = (e: MouseEvent) => {
      // Don't capture clicks inside the widget
      const target = e.target as HTMLElement;
      if (target.closest('.vibus-widget-container')) return;
      
      let html = target.tagName.toLowerCase();
      if (target.id) html += `#${target.id}`;
      
      lastClickedRef.current = {
        url: window.location.pathname,
        element_html: html
      };
    };
    document.addEventListener('click', handleGlobalClick, true);
    return () => document.removeEventListener('click', handleGlobalClick, true);
  }, []);

  const [copiedAllSpec, setCopiedAllSpec] = useState(false);
  const [loading, setLoading] = useState(initialBoardData ? false : true);
  
  // Languages configuration imported from constants


  // Access mode state
  const [currentAccessMode, setCurrentAccessMode] = useState<'studio' | 'public_feedback' | 'client_preview'>(
    mode === 'public_feedback' ? 'public_feedback' : mode === 'client_preview' ? 'client_preview' : 'studio'
  );
  const [viewMode, setViewMode] = useState<'board' | 'spec' | 'feedback'>(mode === 'public_feedback' ? 'feedback' : 'board');
  
  // Filtering & Kanban Management
  const [searchQuery, setSearchQuery] = useState('');
  const [showArchivedDone, setShowArchivedDone] = useState(false);

  // Deletion Protection State
  const [deletingTicket, setDeletingTicket] = useState<Ticket | null>(null);
  
  // Project / Board Deletion Protection State
  const [isProjectDeleteModalOpen, setIsProjectDeleteModalOpen] = useState(false);
  const [deleteConfirmationInput, setDeleteConfirmationInput] = useState('');
  const [isDeletingProject, setIsDeletingProject] = useState(false);

  // Selected Ticket for Rich Detail & Editing Modal
  const [selectedTicketForEdit, setSelectedTicketForEdit] = useState<Ticket | null>(null);

  // Global Text Selection for Quick Feedback
  const [globalSelection, setGlobalSelection] = useState<{text: string, x: number, y: number, context: BugContext | null} | null>(null);
  const globalSelectionRef = useRef<{text: string, x: number, y: number, context: BugContext | null} | null>(null);

  useEffect(() => {
    const handleMouseUp = (e: MouseEvent) => {
      // Ignore if clicking inside the widget
      const target = e.target as HTMLElement;
      if (target.closest('.vibus-widget-root') || target.closest('button')) {
        return;
      }
      
      const selection = window.getSelection();
      const text = selection?.toString().trim();
      
      if (text && text.length > 2) {
        const range = selection!.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        
        // Prevent setting if the text is inside the widget itself
        if (target.closest('.fixed.bottom-6.right-6')) return;

        
        let domContext: BugContext | null = null;
        try {
          const container = range.commonAncestorContainer;
          const element = container.nodeType === 3 ? container.parentElement : container as HTMLElement;
          if (element) {
            
            const sel = element.tagName.toLowerCase() + (element.id ? '#' + element.id : '') + (element.className ? '.' + element.className.split(' ').filter(Boolean).join('.') : '');
            domContext = {
              selector: sel,
              elementText: element.textContent?.substring(0, 50) || '',
              url: window.location.pathname,
              viewport: `${window.innerWidth}x${window.innerHeight}`
            };

          }
        } catch(e) {}

        const selObj = {
          text,
          x: rect.left + rect.width / 2,
          y: rect.top - 45,
          context: domContext
        };
        globalSelectionRef.current = selObj;
        setGlobalSelection(selObj);
      } else {
        setGlobalSelection(null);
      }
    };
    
    document.addEventListener('mouseup', handleMouseUp);
    return () => document.removeEventListener('mouseup', handleMouseUp);
  }, []);




  // Custom Theme State
  const [currentAccent, setCurrentAccent] = useState<string>(accentColor);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isThemingOpen, setIsThemingOpen] = useState(false);
  const [isTeamModalOpen, setIsTeamModalOpen] = useState(false);
  const [isManagingRoles, setIsManagingRoles] = useState(false);
  const [isAccessModalOpen, setIsAccessModalOpen] = useState(false);

  // Multi-type Bug Reporter State (UI vs Backend vs Logic)
  const [isInspectingElement, setIsInspectingElement] = useState(false);
  const [isBugModalOpen, setIsBugModalOpen] = useState(false);
  const [bugCategory, setBugCategory] = useState<'ui' | 'backend' | 'logic'>('ui');
  const [inspectedElementData, setInspectedElementData] = useState<BugContext | null>(null);
  const [bugTitle, setBugTitle] = useState('');
  const [bugExpected, setBugExpected] = useState('');
  const [bugActual, setBugActual] = useState('');
  const [bugAdditionalInfo, setBugAdditionalInfo] = useState('');
  const [bugPriority, setBugPriority] = useState<'high' | 'medium' | 'low'>('high');
  
  // Backend bug specific fields
  const [backendEndpoint, setBackendEndpoint] = useState('');
  const [backendHttpStatus, setBackendHttpStatus] = useState('500');
  const [backendPayload, setBackendPayload] = useState('');
  const [backendTraceback, setBackendTraceback] = useState('');

  const handleGlobalSelectionClick = (explicitData?: {text: string, x: number, y: number, context: BugContext | null}) => {
    const data = explicitData || globalSelection || globalSelectionRef.current;
    if (!data) return;
    
    setIsOpen(true);
    
    if (currentAccessMode === 'public_feedback') {
      setViewMode('feedback');
      setIsAddingFeedback(true);
      setNewFeedbackText(t18n("legacy.quote") + data.text + t18n("legacy.comment_on"));
    } else {
      setIsBugModalOpen(true);
      
      // Contextual pre-fill!
      const shortText = data.text.length > 35 ? data.text.substring(0, 35) + '...' : data.text;
      setBugTitle(t18n("legacy.contextual_error") + shortText);
      setBugCategory('ui');
      setBugExpected(data.text);
      setBugActual(t18n("legacy.text_requires_correction_clarification"));
      
      if (data.context) {
        setInspectedElementData(data.context);
      }
    }
    
    setGlobalSelection(null);
    globalSelectionRef.current = null;
    try {
      window.getSelection()?.removeAllRanges();
    } catch(e) {}
  };

  // Expanded ticket DoD cards
  const [expandedTicketDoD, setExpandedTicketDoD] = useState<Record<string, boolean>>({});



  // Adding child section under specific parent ID
  const [inlineParentAddId, setInlineParentAddId] = useState<string | null>(null);
  const [inlineChildTitle, setInlineChildTitle] = useState('');

  // Board Data State
  const [boardData, setBoardData] = useState<BoardData>(initialBoardData || {
    project_id: projectId,
    access_mode: mode,
    columns: DEFAULT_COLUMNS,
    custom_roles: DEFAULT_ROLES,
    group_chat: {
      chat_id: '',
      title: '',
      notify_review: true,
      notify_rework: true,
      notify_feedback: true,
      notify_discussions: true
    },
    subscribers: [],
    feedbacks: [],
    nodes: []
  });

  // Active section filter & spec reader
  const [activeSpecNodeId, setActiveSpecNodeId] = useState<string>('');
  const [activeBoardId, setActiveBoardId] = useState<string>('all');
  const [activeSectionFilter, setActiveSectionFilter] = useState<string>('all');
  const [activeSpecFilter, setActiveSpecFilter] = useState<string>('all');

  // Form State
  const [newTitle, setNewTitle] = useState('');
  const [newPriority, setNewPriority] = useState<'high' | 'medium' | 'low'>('medium');
  const [selectedNodeId, setSelectedNodeId] = useState<string>('');
  const [isAddingSection, setIsAddingSection] = useState(false);
  const [newSectionTitle, setNewSectionTitle] = useState('');
  const [newSectionDesc, setNewSectionDesc] = useState('');
  const [newSectionParentId, setNewSectionParentId] = useState<string>('');
  const [isManagingColumns, setIsManagingColumns] = useState(false);
  const [newColumnLabel, setNewColumnLabel] = useState('');

  // Team Member Form
  const [newMemberName, setNewMemberName] = useState('');
  const [newMemberRole, setNewMemberRole] = useState('developer');
  const [newMemberTg, setNewMemberTg] = useState('');

  // Group Chat Form State
  const [groupChatId, setGroupChatId] = useState(boardData.group_chat?.chat_id || '');
  const [telemetryEnabled, setTelemetryEnabled] = useState(boardData.telemetry_enabled ?? false);
  const [aiDataSharing, setAiDataSharing] = useState(boardData.ai_data_sharing ?? false);
  const [notifyReview, setNotifyReview] = useState(boardData.group_chat?.notify_review ?? true);
  const [notifyRework, setNotifyRework] = useState(boardData.group_chat?.notify_rework ?? true);
  const [notifyFeedback, setNotifyFeedback] = useState(boardData.group_chat?.notify_feedback ?? true);
  const [notifyDiscussions, setNotifyDiscussions] = useState(boardData.group_chat?.notify_discussions ?? true);
 // Custom Roles Form
  const [newRoleLabel, setNewRoleLabel] = useState('');
  const [newRoleBadge, setNewRoleBadge] = useState('⚡');
  const [newRoleColor, setNewRoleColor] = useState('indigo');

  // Public Feedback Form
  const [newFeedbackText, setNewFeedbackText] = useState('');
  const [newFeedbackContact, setNewFeedbackContact] = useState('');
  const [isAddingFeedback, setIsAddingFeedback] = useState(false);
  
  // Custom DoD addition on ticket
  const [addingDoDTicketId, setAddingDoDTicketId] = useState<string | null>(null);
  const [newDoDLabel, setNewDoDLabel] = useState('');

  // Editing node spec markdown state
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [editingMarkdown, setEditingMarkdown] = useState('');
  const [editingNodeTitle, setEditingNodeTitle] = useState('');
  const [editingNodeDesc, setEditingNodeDesc] = useState('');

  // Rework / Feedback modal state
  const [reworkTicketId, setReworkTicketId] = useState<string | null>(null);
  const [reworkComment, setReworkComment] = useState('');

  // Text selection & Discussion state
  const [selectedQuote, setSelectedQuote] = useState<string>('');
  const [activeDiscussionNodeId, setActiveDiscussionNodeId] = useState<string | null>(null);
  const [activeDiscussionThread, setActiveDiscussionThread] = useState<DiscussionThread | null>(null);
  const [newDiscussionComment, setNewDiscussionComment] = useState('');
  const [isConvertingToTicket, setIsConvertingToTicket] = useState(false);
  const [convertedTicketTitle, setConvertedTicketTitle] = useState('');

  const currentRevisionRef = useRef<number>(0);
  const [, setCurrentRevision] = useState<number>(0);
  const wsRef = useRef<WebSocket | null>(null);
  const wsQueueRef = useRef<WsMutationQueue | null>(null);

  // Fetch full board snapshot via REST
  const fetchBoard = useCallback(async () => {
    if (!serverUrl || serverUrl === 'mock') return;
    try {
      const cleanServer = serverUrl.replace(/\/$/, '');
      const headers: Record<string, string> = {};
      const fingerprint = getOrCreateDeviceId();
      if (fingerprint) {
        headers['X-Device-Fingerprint'] = fingerprint;
      }
      if (apiToken) {
        headers['X-API-Token'] = apiToken;
        headers['Authorization'] = `Bearer ${apiToken}`;
      }
      const res = await fetch(`${cleanServer}/api/projects/${encodeURIComponent(projectId)}/board`, { headers });
      if (res.ok) {
        const data = await res.json();
        if (data && data.nodes) {
          if (typeof data.revision === 'number') {
            currentRevisionRef.current = data.revision;
            setCurrentRevision(data.revision);
          }
          setBoardData(prev => ({
            ...data,
            columns: (data.columns && data.columns.length > 0) ? data.columns : prev.columns || DEFAULT_COLUMNS,
            custom_roles: data.custom_roles || prev.custom_roles || DEFAULT_ROLES,
            group_chat: data.group_chat || prev.group_chat,
            subscribers: data.subscribers || prev.subscribers || [],
            feedbacks: data.feedbacks || prev.feedbacks || []
          }));
          setLoading(false);
        }
      }
    } catch (e) {
      console.warn('Fetch board error', e);
    }
  }, [projectId, serverUrl, apiToken, DEFAULT_COLUMNS, DEFAULT_ROLES]);

  // Authentication capabilities from server auth_ok
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const canWrite = useMemo(() => capabilities.includes('project:write'), [capabilities]);
  const canComment = useMemo(() => capabilities.includes('ticket:comment'), [capabilities]);
  const canReview = useMemo(() => capabilities.includes('ticket:review'), [capabilities]);
  const canManageSettings = useMemo(() => capabilities.includes('settings:manage'), [capabilities]);
  const isReadOnly = useMemo(() => !canWrite, [canWrite]);

  const persistOrResync = useCallback(
    async <T,>(operation: Promise<T>): Promise<T> => {
      try {
        return await operation;
      } catch (error) {
        await fetchBoard();
        throw error;
      }
    },
    [fetchBoard]
  );

  const persistAndReconcile = useCallback(
    async <T,>(operation: Promise<T>): Promise<T> => {
      const result = await operation;
      await fetchBoard();
      return result;
    },
    [fetchBoard]
  );

  useEffect(() => {
    wsQueueRef.current = new WsMutationQueue({
      send: (msg: any) => {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          try {
            wsRef.current.send(JSON.stringify(msg));
          } catch (e) {
            console.warn('WS Send Error', e);
          }
        }
      },
      getRevision: () => currentRevisionRef.current,
      setRevision: (r: number) => {
        currentRevisionRef.current = r;
        setCurrentRevision(r);
      },
      resync: async () => {
        await fetchBoard();
        return currentRevisionRef.current;
      },
      onError: (err) => {
        console.warn('Mutation rejected by server:', err);
      }
    });
  }, [fetchBoard]);

  // Setup WebSocket connection
  useEffect(() => {
    if (!serverUrl || serverUrl === 'mock') {
      setLoading(false);
      setConnected(true);
      return;
    }

    const wsUrl = serverUrl.replace(/^http/, 'ws').replace(/\/$/, '') + '/ws/sync/' + encodeURIComponent(projectId);
    
    function initWs() {
      try {
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          if (apiToken) {
            const deviceFingerprint = getOrCreateDeviceId();
            ws.send(JSON.stringify({
              type: "auth",
              token: apiToken,
              fingerprint: deviceFingerprint
            }));
          }
          setConnected(true);
          wsQueueRef.current?.setConnected(true);
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (!data || typeof data !== 'object') return;

            if (data.type === 'auth_ok') {
              if (Array.isArray(data.capabilities)) {
                setCapabilities(data.capabilities);
              }
              return;
            }

            if (data.type === 'board.refresh') {
              if (typeof data.revision === 'number') {
                currentRevisionRef.current = data.revision;
                setCurrentRevision(data.revision);
              }
              fetchBoard();
              return;
            }

            if (data.type === 'board.snapshot') {
              const board = data.data;
              if (board) {
                if (typeof data.revision === 'number') {
                  currentRevisionRef.current = data.revision;
                  setCurrentRevision(data.revision);
                }
                setBoardData(prev => ({
                  ...board,
                  columns: (board.columns && board.columns.length > 0) ? board.columns : prev.columns || DEFAULT_COLUMNS,
                  custom_roles: board.custom_roles || prev.custom_roles || DEFAULT_ROLES,
                  group_chat: board.group_chat || prev.group_chat,
                  subscribers: board.subscribers || prev.subscribers || [],
                  feedbacks: board.feedbacks || prev.feedbacks || []
                }));
                setLoading(false);
              }
              return;
            }

            if (data.type === 'event.ack') {
              if (typeof data.revision === 'number') {
                currentRevisionRef.current = data.revision;
                setCurrentRevision(data.revision);
              }
              wsQueueRef.current?.handleAck(data);
              return;
            }

            if (data.type === 'event.error') {
              console.warn('WS Event Error', data);
              wsQueueRef.current?.handleError(data);
              return;
            }

            if (data.type === 'ticket.status.change') {
              if (typeof data.revision === 'number') {
                currentRevisionRef.current = data.revision;
                setCurrentRevision(data.revision);
              }
              const ticketId = data.entity_id;
              const newStatus = data.payload?.status;
              if (ticketId && newStatus) {
                setBoardData(prev => ({
                  ...prev,
                  nodes: prev.nodes.map(n => ({
                    ...n,
                    tickets: n.tickets.map(t => t.id === ticketId ? { ...t, status: newStatus } : t)
                  }))
                }));
              }
              return;
            }

            if (data.type === 'ticket.comment.add') {
              if (typeof data.revision === 'number') {
                currentRevisionRef.current = data.revision;
                setCurrentRevision(data.revision);
              }
              const ticketId = data.entity_id;
              const commentText = data.payload?.text || data.payload;
              if (ticketId && commentText) {
                const newC = { id: `c_${Date.now()}`, text: String(commentText), date: new Date().toISOString(), created_at: new Date().toISOString() };
                setBoardData(prev => ({
                  ...prev,
                  nodes: prev.nodes.map(n => ({
                    ...n,
                    tickets: n.tickets.map(t => t.id === ticketId ? {
                      ...t,
                      comments: [...(t.comments || []), newC]
                    } : t)
                  }))
                }));
              }
              return;
            }

            if (data.type === 'ticket.checklist.change') {
              if (typeof data.revision === 'number') {
                currentRevisionRef.current = data.revision;
                setCurrentRevision(data.revision);
              }
              const ticketId = data.entity_id;
              const key = data.payload?.key;
              const isDone = data.payload?.is_done;
              if (ticketId && key !== undefined) {
                setBoardData(prev => ({
                  ...prev,
                  nodes: prev.nodes.map(n => ({
                    ...n,
                    tickets: n.tickets.map(t => t.id === ticketId ? {
                      ...t,
                      checklists: { ...(t.checklists || {}), [key]: Boolean(isDone) },
                      criteria_evidence: isDone ? (t.criteria_evidence || {}) : Object.fromEntries(Object.entries(t.criteria_evidence || {}).filter(([evidenceKey]) => evidenceKey !== key))
                    } : t)
                  }))
                }));
              }
              return;
            }

            if (data.type === 'ticket.criteria.evidence') {
              if (typeof data.revision === 'number') {
                currentRevisionRef.current = data.revision;
                setCurrentRevision(data.revision);
              }
              const ticketId = data.entity_id;
              const key = data.payload?.key;
              const receipt = data.payload?.receipt;
              if (ticketId && key && receipt) {
                setBoardData(prev => ({
                  ...prev,
                  nodes: prev.nodes.map(n => ({
                    ...n,
                    tickets: n.tickets.map(t => t.id === ticketId ? {
                      ...t,
                      criteria_evidence: { ...(t.criteria_evidence || {}), [key]: receipt }
                    } : t)
                  }))
                }));
              }
              return;
            }

            if (data.nodes) {
              setBoardData(prev => ({
                ...data,
                columns: (data.columns && data.columns.length > 0) ? data.columns : prev.columns || DEFAULT_COLUMNS,
                custom_roles: data.custom_roles || prev.custom_roles || DEFAULT_ROLES,
                group_chat: data.group_chat || prev.group_chat,
                subscribers: data.subscribers || prev.subscribers || [],
                feedbacks: data.feedbacks || prev.feedbacks || []
              }));
              setLoading(false);
            }
          } catch (e) {
            console.error('WS Parse Error', e);
          }
        };

        ws.onclose = () => {
          setConnected(false);
          wsQueueRef.current?.setConnected(false);
          setTimeout(initWs, 3000);
        };

        ws.onerror = () => {
          setConnected(false);
          wsQueueRef.current?.setConnected(false);
        };
      } catch (e) {
        setConnected(false);
        wsQueueRef.current?.setConnected(false);
      }
    }

    initWs();

    const safetyTimer = setTimeout(() => {
      setLoading(false);
    }, 800);

    return () => {
      clearTimeout(safetyTimer);
      if (wsRef.current) wsRef.current.close();
    };
  }, [projectId, serverUrl, apiToken, fetchBoard, DEFAULT_COLUMNS, DEFAULT_ROLES]);

  const sendWsEvent = useCallback((
    type: string,
    entityId: string,
    payload: any,
    options: { queueWhenOffline?: boolean } = {},
  ): boolean => {
    const queueWhenOffline = options.queueWhenOffline !== false;
    if (!wsQueueRef.current) return false;
    // Some mutations have an explicit REST fallback. Do not also retain those
    // in the reconnect queue, or the same logical action is applied twice.
    if (!connected && !queueWhenOffline) return false;
    wsQueueRef.current.enqueue({ type, entity_id: entityId, payload });
    return true;
  }, [connected]);

  // Reactive state changes (no raw board overwrite)
  const broadcastChange = useCallback((updated: BoardData) => {
    setBoardData(updated);
  }, []);
  // Visual Bug Inspector (UI Element Click)
  const startElementInspector = () => {
    setIsOpen(false);
    setIsInspectingElement(true);

    let lastTarget: HTMLElement | null = null;

    const highlightElement = (target: HTMLElement) => {
      if (!target || target.closest('.vibus-widget-root') || target.closest('#vibus-inspector-banner') || target.tagName === 'HTML' || target.tagName === 'BODY') return;
      if (lastTarget && lastTarget !== target) {
        lastTarget.style.outline = '';
      }
      lastTarget = target;
      target.style.outline = '3px dashed #6366f1';
      target.style.outlineOffset = '2px';
      target.style.cursor = 'crosshair';
    };

    const onMouseOver = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      highlightElement(target);
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches && e.touches.length > 0 && e.touches[0]) {
        const touch = e.touches[0];
        const target = document.elementFromPoint(touch.clientX, touch.clientY) as HTMLElement;
        if (target) {
          highlightElement(target);
        }
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        cleanup();
        setIsInspectingElement(false);
        setIsOpen(true);
      }
    };

    const selectElement = (target: HTMLElement) => {
      if (!target || target.closest('.vibus-widget-root') || target.closest('#vibus-inspector-banner') || target.tagName === 'HTML' || target.tagName === 'BODY') return;

      let selector = target.tagName.toLowerCase();
      if (target.id) {
        selector += `#${target.id}`;
      } else if (target.className && typeof target.className === 'string') {
        selector += `.${target.className.split(' ').filter(Boolean).slice(0, 2).join('.')}`;
      }

      const bugData: BugContext = {
        type: 'ui',
        url: window.location.pathname,
        selector: selector,
        elementText: target.innerText ? target.innerText.slice(0, 80).trim() : '',
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        userAgent: navigator.userAgent.slice(0, 70),
        logs: 'OK (Captured from UI Inspector)'
      };

      cleanup();
      setBugCategory('ui');
      setInspectedElementData(bugData);
      setBugTitle(t18n('v7.generated.ui_bug_title', { tag: target.tagName.toLowerCase() }));
      setBugExpected(t18n("legacy.element_should_display_correctly_and_respond_to_clicks"));
      setBugActual(t18n('v7.generated.interaction_error', { selector }));
      setIsInspectingElement(false);
      setIsOpen(true);
      setIsBugModalOpen(true);
    };

    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target || target.closest('.vibus-widget-root') || target.closest('#vibus-inspector-banner') || target.tagName === 'HTML' || target.tagName === 'BODY') return;
      e.preventDefault();
      e.stopPropagation();
      selectElement(target);
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (lastTarget) {
        e.preventDefault();
        e.stopPropagation();
        selectElement(lastTarget);
      } else if (e.changedTouches && e.changedTouches.length > 0 && e.changedTouches[0]) {
        const touch = e.changedTouches[0];
        const target = document.elementFromPoint(touch.clientX, touch.clientY) as HTMLElement;
        if (target) {
          e.preventDefault();
          e.stopPropagation();
          selectElement(target);
        }
      }
    };

    const cleanup = () => {
      document.removeEventListener('mouseover', onMouseOver, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('touchstart', onTouchMove, true);
      document.removeEventListener('touchmove', onTouchMove, true);
      document.removeEventListener('touchend', onTouchEnd, true);
      document.removeEventListener('keydown', onKeyDown, true);
      if (lastTarget) lastTarget.style.outline = '';
    };

    document.addEventListener('mouseover', onMouseOver, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('touchstart', onTouchMove, { passive: true, capture: true });
    document.addEventListener('touchmove', onTouchMove, { passive: true, capture: true });
    document.addEventListener('touchend', onTouchEnd, true);
    document.addEventListener('keydown', onKeyDown, true);
  };

  // Visual Inspector state
  const [isInspectorActive, setIsInspectorActive] = useState(false);

  const handleToggleInspector = () => {
    const next = !isInspectorActive;
    setIsInspectorActive(next);
    if (next) {
      setIsOpen(false);
    }
    trackEvent('visual_inspector_toggled', { active: next });
  };

  const handleElementInspected = (info: any) => {
    setIsInspectorActive(false);
    setIsOpen(true);
    setInspectedElementData({
      selector: info.selector,
      url: typeof window !== 'undefined' ? window.location.pathname : '',
      elementText: info.innerText || '',
      xpath: info.tagName
    });

    if (currentAccessMode !== 'public_feedback') {
      if (info.correlatedError) {
        setBugCategory('backend');
        setBackendEndpoint(`${info.correlatedError.method} ${info.correlatedError.url}`);
        setBackendHttpStatus(String(info.correlatedError.status || 500));
        setBackendTraceback(info.correlatedError.responseSnippet || '');
        setBugTitle(t18n('v7.generated.failure_click_title', { status: info.correlatedError.status, method: info.correlatedError.method, url: info.correlatedError.url, selector: info.selector }));
        setBugExpected(t18n('v7.generated.request_success'));
        setBugActual(t18n('v7.generated.server_returned_detail', { status: info.correlatedError.status, statusText: info.correlatedError.statusText, snippet: info.correlatedError.responseSnippet || '' }));
      } else {
        setBugCategory('ui');
        setBugTitle(t18n('v7.generated.ui_element_bug', { selector: info.selector }));
        setBugExpected(t18n('v7.generated.ui_expected'));
        setBugActual(t18n('v7.generated.ui_actual', { selector: info.selector }));
      }
  
      setIsBugModalOpen(true);
    }
    trackEvent('element_inspected_selected', { selector: info.selector, hasError: !!info.correlatedError });
  };

  // Open or toggle Universal Bug Modal (for Backend or UI or Logic)
  const handleOpenBugModal = (category: 'ui' | 'backend' | 'logic' = 'ui') => {
    if (isBugModalOpen) {
      setIsBugModalOpen(false);
      return;
    }
    setIsSettingsOpen(false);
    setBugCategory(category);
    if (category === 'backend') {
      const recentErrors = telemetry.getRecentErrors().networkErrors;
      const latestError = recentErrors[0];
      if (latestError) {
        setBugTitle(t18n('v7.generated.failure_title', { status: latestError.status, method: latestError.method, url: latestError.url }));
        setBackendEndpoint(`${latestError.method} ${latestError.url}`);
        setBackendHttpStatus(String(latestError.status || 500));
        setBackendPayload('');
        setBackendTraceback('');
        setBugExpected(t18n('v7.generated.api_expected'));
        setBugActual(t18n('v7.generated.server_status', { status: latestError.status, statusText: latestError.statusText }));
      } else {
        setBugTitle(t18n("legacy.api_bug_500_internal_server_error"));
        setBackendEndpoint('POST /api/v1/auth/telegram');
        setBackendHttpStatus('500');
        setBackendPayload('{\n  "tg_id": "12345678"\n}');
        setBackendTraceback('Traceback: KeyError "hash" in auth_handler.py line 42');
        setBugExpected(t18n("legacy.api_should_return_200_ok_and_jwt_token"));
        setBugActual(t18n("legacy.server_crashes_with_code_500"));
      }
    } else if (category === 'logic') {
      setBugTitle(t18n("legacy.logic_error_incorrect_balance_calculation"));
      setBugExpected(t18n("legacy.upon_subscription_cancellation_access_should_remain_valid_until_the_end_"));
      setBugActual(t18n("legacy.access_is_blocked_immediately"));
    } else {
      setBugTitle(t18n("legacy.ui_bug_incorrect_block_display"));
      setBugExpected(t18n("legacy.button_should_be_centered"));
      setBugActual(t18n("legacy.button_shifts_to_the_left"));
    }
    setIsBugModalOpen(true);
  };

  // Create Bug / Idea / Discussion Ticket
  const handleCreateBugReportTicket = (e: React.FormEvent, customPayload?: {
    reportType?: 'bug' | 'idea' | 'question';
    title?: string;
    category?: string;
    priority?: 'high' | 'medium' | 'low';
    steps?: string;
    expected?: string;
    actual?: string;
    ideaDesc?: string;
    ideaBenefit?: string;
    ideaImplementation?: string;
    questionText?: string;
    questionContext?: string;
    questionOptions?: string;
    additionalInfo?: string;
    attachedNetworkLogs?: any[];
    attachedConsoleLogs?: any[];
  }) => {
    e.preventDefault();
    const type = customPayload?.reportType || 'bug';
    const titleVal = customPayload?.title || bugTitle;
    if (!titleVal.trim()) return;

    const targetNode = boardData.nodes?.[0] || { id: 'general', title: t18n("legacy.main_section") };
    const priorityVal = customPayload?.priority || bugPriority || 'medium';
    const categoryVal = customPayload?.category || bugCategory || 'ui';

    let summaryText = '';
    let checklistsObj: Checklist = {};
    let prefix = 'BUG';
    let formattedTitle = titleVal.trim();

    if (type === 'idea') {
      prefix = 'IDEA';
      formattedTitle = t18n('v7.generated.idea_prefix', { title: titleVal.trim() });
      summaryText = t18n('v7.generated.idea_summary', { description: customPayload?.ideaDesc || '', benefit: customPayload?.ideaBenefit || '', implementation: customPayload?.ideaImplementation || t18n('v7.generated.not_specified'), category: categoryVal });
      checklistsObj = {
        [t18n('v7.generated.idea_described')]: true,
        [t18n('v7.generated.effort_estimated')]: false,
        [t18n('v7.generated.architecture_decision')]: false,
        [t18n('v7.generated.implemented')]: false
      };
    } else if (type === 'question') {
      prefix = 'DISC';
      formattedTitle = t18n('v7.generated.question_prefix', { title: titleVal.trim() });
      summaryText = t18n('v7.generated.question_summary', { question: customPayload?.questionText || '', context: customPayload?.questionContext || '', options: customPayload?.questionOptions || t18n('v7.generated.discussion_required'), category: categoryVal });
      checklistsObj = {
        [t18n('v7.generated.question_raised')]: true,
        [t18n('v7.generated.team_discussed')]: false,
        [t18n('v7.generated.decision_in_spec')]: false
      };
    } else {
      // Bug
      prefix = 'BUG';
      formattedTitle = t18n('v7.generated.bug_prefix', { title: titleVal.trim() });
      const stepsText = customPayload?.steps ? t18n('v7.generated.steps', { steps: customPayload.steps }) : '';
      const expText = customPayload?.expected || bugExpected;
      const actText = customPayload?.actual || bugActual;
      const addText = customPayload?.additionalInfo || bugAdditionalInfo;
      const env = getDeviceEnvironment();

      const envDiagnosticsMarkdown = t18n('v7.generated.env', { os: env.os, browser: env.browser, viewport: env.viewport, dpr: env.dpr, touch: env.isTouch ? t18n('v7.generated.yes') : t18n('v7.generated.no'), orientation: env.orientation, url: env.url });

      if (categoryVal === 'backend') {
        summaryText = t18n('v7.generated.backend_summary', { endpoint: backendEndpoint, status: backendHttpStatus, steps: stepsText, expected: expText, actual: actText, traceback: backendTraceback, additional: addText ? t18n('v7.generated.additional', { text: addText }) : '', environment: envDiagnosticsMarkdown });
        checklistsObj = {
          [t18n('v7.generated.api_reproduced')]: true,
          [t18n('v7.generated.endpoint_fixed')]: false,
          [t18n('v7.generated.boundary_test')]: false,
          [t18n('v7.generated.spec_contracts_updated')]: false
        };
      } else if (categoryVal === 'ui') {
        const sel = inspectedElementData?.selector || 'UI Element';
        summaryText = t18n('v7.generated.ui_summary', { selector: sel, steps: stepsText, expected: expText, actual: actText, additional: addText ? t18n('v7.generated.additional', { text: addText }) : '', environment: envDiagnosticsMarkdown });
        checklistsObj = {
          [t18n('v7.generated.selector_localized')]: true,
          [t18n('v7.generated.layout_fixed')]: false,
          [t18n('v7.generated.responsive_checked')]: false,
          [t18n('v7.generated.spec_updated')]: false
        };
      } else {
        summaryText = t18n('v7.generated.logic_summary', { steps: stepsText, expected: expText, actual: actText, additional: addText ? t18n('v7.generated.additional', { text: addText }) : '', environment: envDiagnosticsMarkdown });
        checklistsObj = {
          [t18n('v7.generated.scenario_reproduced')]: true,
          [t18n('v7.generated.logic_fixed')]: false,
          [t18n('v7.generated.boundaries_checked')]: false,
          [t18n('v7.generated.spec_updated')]: false
        };
      }

      // Append live network telemetry & JS console errors
      const telemetryDiagnostics = telemetry.generateDiagnosticsMarkdown(
        customPayload?.attachedNetworkLogs,
        customPayload?.attachedConsoleLogs,
        inspectedElementData?.selector
      );
      if (telemetryDiagnostics) {
        summaryText += telemetryDiagnostics;
      }
    }

    const envInfo = getDeviceEnvironment();
    const bugContextObj: BugContext = {
      type: categoryVal as any,
      url: envInfo.url,
      selector: inspectedElementData?.selector || '',
      elementText: inspectedElementData?.elementText || '',
      viewport: envInfo.viewport,
      screen: envInfo.screen,
      os: envInfo.os,
      browser: envInfo.browser,
      dpr: envInfo.dpr,
      isTouch: envInfo.isTouch,
      orientation: envInfo.orientation,
      lang: envInfo.lang,
      userAgent: envInfo.userAgent,
      apiEndpoint: categoryVal === 'backend' ? backendEndpoint : undefined,
      httpStatus: categoryVal === 'backend' ? backendHttpStatus : undefined,
      requestPayload: categoryVal === 'backend' ? backendTraceback : undefined,
      responseTraceback: categoryVal === 'backend' ? backendTraceback : undefined
    };

    const nextKeyNum = (allTickets.length + 1);
    const newTicket: Ticket = {
      id: `${prefix}-${Date.now().toString().slice(-4)}_${Math.floor(10 + Math.random() * 90)}`,
      key: `${prefix}-${nextKeyNum}`,
      node_id: targetNode.id,
      title: formattedTitle,
      summary: summaryText,
      source_quote: categoryVal === 'backend' ? `[API: ${backendEndpoint}]` : (inspectedElementData?.selector ? t18n('v7.generated.selector_source', { selector: inspectedElementData.selector }) : ''),
      bug_context: bugContextObj,
      status: (boardData.columns && boardData.columns[0]?.id) || 'backlog',
      priority: priorityVal || 'medium',
      order: 0,
      checklists: checklistsObj,
      rework_notes: ''
    };

    let updated: BoardData;
    if (!boardData.nodes || boardData.nodes.length === 0) {
      updated = {
        ...boardData,
        nodes: [{
          id: 'general',
          parent_id: null,
          title: t18n("legacy.general_tasks"),
          description: t18n('v7.generated.general_desc'),
          content_markdown: t18n('v7.generated.general_md'),
          discussions: [],
          tickets: [newTicket]
        }]
      };
    } else {
      updated = {
        ...boardData,
        nodes: boardData.nodes.map(n => n.id === targetNode.id ? {
          ...n,
          tickets: [newTicket, ...(n.tickets || [])]
        } : n)
      };
    }

    broadcastChange(updated);
    setIsBugModalOpen(false);
    setInspectedElementData(null);
    setViewMode('board');

    void persistOrResync(createTicket(serverUrl, projectId, targetNode.id, {
      title: formattedTitle,
      summary: summaryText,
      source_quote: newTicket.source_quote,
      bug_context: bugContextObj,
      priority: priorityVal || 'medium',
      status: newTicket.status,
      checklists: checklistsObj
    }, apiToken)).catch((err) => { console.warn('Persistence error', err); });
  };

  // Text selection listener on spec document
  const handleSpecMouseUp = (e: React.MouseEvent, nodeId: string) => {
    const selection = window.getSelection();
    if (!selection) return;
    const text = selection.toString().trim();
    if (text.length >= 3) {
      setSelectedQuote(text);
      setActiveDiscussionNodeId(nodeId);
    }
  };

  const handleStartDiscussion = () => {
    if (!selectedQuote || !activeDiscussionNodeId) return;
    const newThread: DiscussionThread = {
      id: `disc_${Date.now()}`,
      quote: selectedQuote,
      status: 'active',
      created_ticket_ids: [],
      comments: [
        {
          id: `c_${Date.now()}`,
          author: t18n("legacy.you"),
          text: t18n('v7.generated.discussion_started', { quote: selectedQuote }),
          date: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }
      ]
    };

    const updated = {
      ...boardData,
      nodes: boardData.nodes.map(n => n.id === activeDiscussionNodeId ? {
        ...n,
        discussions: [...(n.discussions || []), newThread]
      } : n)
    };

    broadcastChange(updated);
    setActiveDiscussionThread(newThread);
    setConvertedTicketTitle(t18n('v7.generated.implement_quote', { quote: selectedQuote.slice(0, 50) }));
    setSelectedQuote('');

    void persistOrResync(createDiscussion(serverUrl, projectId, activeDiscussionNodeId, {
      quote: selectedQuote,
      text: t18n('v7.generated.discussion_started', { quote: selectedQuote })
    }, apiToken)).catch((err) => { console.warn('Persistence error', err); });
  };
  const handleAddCommentToDiscussion = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDiscussionComment.trim() || !activeDiscussionThread || !activeDiscussionNodeId) return;

    const newComment: DiscussionComment = {
      id: `c_${Date.now()}`,
      author: t18n("legacy.you"),
      text: newDiscussionComment.trim(),
      date: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    const updatedThread: DiscussionThread = {
      ...activeDiscussionThread,
      comments: [...activeDiscussionThread.comments, newComment]
    };

    const updated = {
      ...boardData,
      nodes: boardData.nodes.map(n => n.id === activeDiscussionNodeId ? {
        ...n,
        discussions: (n.discussions || []).map(d => d.id === activeDiscussionThread.id ? updatedThread : d)
      } : n)
    };

    broadcastChange(updated);
    setActiveDiscussionThread(updatedThread);
    setNewDiscussionComment('');

    void persistOrResync(addDiscussionComment(serverUrl, projectId, activeDiscussionNodeId, activeDiscussionThread.id, {
      text: newDiscussionComment.trim()
    }, apiToken)).catch((err) => { console.warn('Persistence error', err); });
  };

  const handleToggleDiscussionStatus = () => {
    if (!activeDiscussionThread || !activeDiscussionNodeId) return;
    const newStatus = activeDiscussionThread.status === 'resolved' ? 'active' : 'resolved';
    const updatedThread: DiscussionThread = {
      ...activeDiscussionThread,
      status: newStatus,
      resolved: newStatus === 'resolved'
    };

    const updated = {
      ...boardData,
      nodes: boardData.nodes.map(n => n.id === activeDiscussionNodeId ? {
        ...n,
        discussions: (n.discussions || []).map(d => d.id === activeDiscussionThread.id ? updatedThread : d)
      } : n)
    };

    broadcastChange(updated);
    setActiveDiscussionThread(updatedThread);

    void persistOrResync(updateDiscussion(serverUrl, projectId, activeDiscussionNodeId, activeDiscussionThread.id, {
      status: newStatus,
      resolved: newStatus === 'resolved'
    }, apiToken)).catch((err) => { console.warn('Persistence error', err); });
  };

  const handleAISummarizeDiscussion = () => {
    if (!activeDiscussionThread) return;
    setConvertedTicketTitle(t18n('v7.generated.implement_solution', { quote: activeDiscussionThread.quote.slice(0, 45) }));
    setIsConvertingToTicket(true);
  };


  const handleCreateTicketFromDiscussion = () => {
    if (!activeDiscussionThread || !activeDiscussionNodeId || !convertedTicketTitle.trim()) return;

    const newTicket: Ticket = {
      id: `TKT-${Math.floor(100 + Math.random() * 900)}`,
      title: convertedTicketTitle.trim(),
      summary: t18n('v7.generated.from_discussion', { quote: activeDiscussionThread.quote }),
      source_quote: activeDiscussionThread.quote,
      status: (boardData.columns && boardData.columns[0]?.id) || 'backlog',
      priority: 'high',
      order: 0,
      checklists: {
        [t18n("legacy.spec_described")]: true,
        [t18n("legacy.backend_ready")]: false,
        [t18n("legacy.frontend_ready")]: false,
        [t18n("legacy.autotests")]: false,
      },
      rework_notes: ''
    };

    const updatedThread: DiscussionThread = {
      ...activeDiscussionThread,
      status: 'resolved',
      resolved: true,
      created_ticket_ids: [...(activeDiscussionThread.created_ticket_ids || []), newTicket.id]
    };

    const updated = {
      ...boardData,
      nodes: boardData.nodes.map(n => n.id === activeDiscussionNodeId ? {
        ...n,
        tickets: [newTicket, ...n.tickets],
        discussions: (n.discussions || []).map(d => d.id === activeDiscussionThread.id ? updatedThread : d)
      } : n)
    };

    broadcastChange(updated);
    setActiveDiscussionThread(updatedThread);
    setIsConvertingToTicket(false);
    setViewMode('board');

    void persistAndReconcile(convertDiscussionToTicket(serverUrl, projectId, activeDiscussionNodeId, activeDiscussionThread.id, {
      title: convertedTicketTitle.trim(),
      priority: 'high',
      summary: activeDiscussionThread.quote
    }, apiToken)).catch((err) => { console.warn('Persistence error', err); });
  };

  // Batch Sprint Action
  const handleSendSprintToAI = () => {
    const updated = {
      ...boardData,
      nodes: boardData.nodes.map(n => ({
        ...n,
        tickets: n.tickets.map(t => t.status === 'backlog' ? { ...t, status: 'in_progress' } : t)
      }))
    };
    broadcastChange(updated);

    void persistOrResync(batchTickets(serverUrl, projectId, { operation: 'start_backlog' }, apiToken)).catch((err) => { console.warn('Persistence error', err); });
  };

  // Toggle Individual Ticket Archive
  const handleToggleArchiveTicket = (ticketId: string) => {
    let isArchived = false;
    let expectedRev: number | undefined;
    const updated = {
      ...boardData,
      nodes: boardData.nodes.map(n => ({
        ...n,
        tickets: n.tickets.map(t => {
          if (t.id === ticketId) {
            isArchived = !t.is_archived;
            expectedRev = t.revision;
            return { ...t, is_archived: isArchived };
          }
          return t;
        })
      }))
    };
    broadcastChange(updated);

    void persistOrResync(updateTicket(serverUrl, projectId, ticketId, { is_archived: isArchived }, apiToken, expectedRev)).catch((err) => { console.warn('Persistence error', err); });
  };

  // Archive all Done tickets
  const handleArchiveDoneTickets = () => {
    const updated = {
      ...boardData,
      nodes: boardData.nodes.map(n => ({
        ...n,
        tickets: n.tickets.map(t => t.status === 'done' ? { ...t, is_archived: true } : t)
      }))
    };
    broadcastChange(updated);

    void persistOrResync(batchTickets(serverUrl, projectId, { operation: 'archive_done' }, apiToken)).catch((err) => { console.warn('Persistence error', err); });
  };

  // Confirm and Execute Ticket Deletion (Deletion Protection)
  const handleConfirmDeleteTicket = () => {
    if (!deletingTicket) return;
    const ticketId = deletingTicket.id;

    const updated = {
      ...boardData,
      nodes: boardData.nodes.map(n => ({
        ...n,
        tickets: n.tickets.filter(t => t.id !== ticketId)
      }))
    };
    broadcastChange(updated);
    setDeletingTicket(null);

    void persistOrResync(deleteTicket(serverUrl, projectId, ticketId, apiToken)).catch((err) => { console.warn('Persistence error', err); });
  };

  // Confirm and Execute Entire Project / Board Deletion (Danger Zone)
  const handleConfirmDeleteProject = async () => {
    if (deleteConfirmationInput.trim() !== projectId) return;
    setIsDeletingProject(true);
    try {
      const headers: Record<string, string> = {};
      if (apiToken) {
        headers['X-API-Token'] = apiToken;
      }
      const res = await fetch(`${serverUrl}/api/projects/${projectId}?confirmation_slug=${encodeURIComponent(projectId)}`, {
        method: 'DELETE',
        headers
      });
      if (res.ok) {
        setIsProjectDeleteModalOpen(false);
        setIsSettingsOpen(false);
        setIsOpen(false);
        alert(t18n('widget.delete_project_success'));
        window.location.reload();
      } else {
        const data = await res.json();
        alert(`${t18n('widget.delete_project_error')} ${data.detail || ''}`);
      }
    } catch (err: any) {
      alert(`${t18n('widget.network_error')} ${err.message}`);
    } finally {
      setIsDeletingProject(false);
    }
  };

  // Save Corporate Telegram Group Chat Settings
  const handleSavePrivacySettings = (telEnabled: boolean, aiSharing: boolean) => {
    setTelemetryEnabled(telEnabled);
    setAiDataSharing(aiSharing);
    const updated = {
      ...boardData,
      telemetry_enabled: telEnabled,
      ai_data_sharing: aiSharing
    };
    broadcastChange(updated);

    void persistOrResync(updateProjectSettings(serverUrl, projectId, {
      telemetry_enabled: telEnabled,
      ai_data_sharing: aiSharing
    }, apiToken)).catch((err) => { console.warn('Persistence error', err); });
  };

  const handleSaveGroupChat = (e: React.FormEvent) => {
    e.preventDefault();
    const groupChatObj = {
      chat_id: groupChatId.trim(),
      title: t18n("legacy.project_team_chat"),
      notify_review: notifyReview,
      notify_rework: notifyRework,
      notify_feedback: notifyFeedback,
      notify_discussions: notifyDiscussions
    };
    const updated = {
      ...boardData,
      group_chat: groupChatObj
    };
    broadcastChange(updated);

    void persistOrResync(updateProjectSettings(serverUrl, projectId, {
      group_chat: groupChatObj
    }, apiToken)).catch((err) => { console.warn('Persistence error', err); });
  };
  // Inline Child Section creation from Tree Node [+]
  const handleAddInlineChildSection = (e: React.FormEvent, parentId: string) => {
    e.preventDefault();
    if (!inlineChildTitle.trim()) return;

    const slug = inlineChildTitle.trim().toLowerCase().replace(/[^a-zа-я0-9]+/gi, '_');
    const newNodeId = `node_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const newNode: NodeItem = {
      id: newNodeId,
      parent_id: parentId,
      title: inlineChildTitle.trim(),
      description: t18n("legacy.subsection"),
      content_markdown: t18n('v7.generated.subsection_md', { title: inlineChildTitle.trim() }),
      discussions: [],
      tickets: []
    };

    const updated = {
      ...boardData,
      nodes: [...boardData.nodes, newNode]
    };

    broadcastChange(updated);
    setActiveSpecNodeId(newNode.id);
    setInlineParentAddId(null);
    setInlineChildTitle('');

    void persistAndReconcile(createNode(serverUrl, projectId, {
      title: inlineChildTitle.trim(),
      description: t18n("legacy.subsection"),
      parent_id: parentId
    }, apiToken)).catch((err) => { console.warn('Persistence error', err); });
  };

  // Custom boards management (cross-cutting vs separate boards)
  const handleAddBoard = (title: string, description: string = '') => {
    if (!title.trim()) return;
    const boardId = `board_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const newBoard: CustomBoard = {
      id: boardId,
      title: title.trim(),
      description: description.trim()
    };
    const currentBoards = boardData.custom_boards || boardData.boards || [];
    const updatedBoards = [...currentBoards, newBoard];
    const updated = {
      ...boardData,
      custom_boards: updatedBoards,
      boards: updatedBoards
    };
    broadcastChange(updated);
    setActiveBoardId(boardId);

    void persistOrResync(updateProjectSettings(serverUrl, projectId, {
      custom_boards: updatedBoards
    }, apiToken)).catch((err) => { console.warn('Persistence error', err); });
  };

  const handleDeleteBoard = (boardId: string) => {
    const currentBoards = boardData.custom_boards || boardData.boards || [];
    const updatedBoards = currentBoards.filter(b => b.id !== boardId);
    const updated = {
      ...boardData,
      custom_boards: updatedBoards,
      boards: updatedBoards
    };
    broadcastChange(updated);
    if (activeBoardId === boardId) {
      setActiveBoardId('all');
    }

    void persistOrResync(updateProjectSettings(serverUrl, projectId, {
      custom_boards: updatedBoards
    }, apiToken)).catch((err) => { console.warn('Persistence error', err); });
  };

  // Custom Roles management
  const handleAddCustomRole = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRoleLabel.trim()) return;

    const newRole: CustomRole = {
      id: newRoleLabel.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_'),
      label: newRoleLabel.trim(),
      badge: newRoleBadge.trim() || '⚡',
      color: newRoleColor
    };

    const updatedRoles = [...(boardData.custom_roles || DEFAULT_ROLES), newRole];
    const updated = {
      ...boardData,
      custom_roles: updatedRoles
    };

    broadcastChange(updated);
    setNewRoleLabel('');

    void persistOrResync(updateProjectSettings(serverUrl, projectId, {
      custom_roles: updatedRoles
    }, apiToken)).catch((err) => { console.warn('Persistence error', err); });
  };

  // Team Member addition
  const handleAddTeamMember = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMemberName.trim()) return;

    const newMember: TeamMember = {
      id: `u_${Date.now()}`,
      name: newMemberName.trim(),
      role: newMemberRole,
      tg_username: newMemberTg.trim().startsWith('@') ? newMemberTg.trim() : `@${newMemberTg.trim()}`
    };

    const updatedSubscribers = [...(boardData.subscribers || []), newMember];
    const updated = {
      ...boardData,
      subscribers: updatedSubscribers
    };

    broadcastChange(updated);
    setNewMemberName('');
    setNewMemberTg('');

    void persistOrResync(updateProjectSettings(serverUrl, projectId, {
      subscribers: updatedSubscribers
    }, apiToken)).catch((err) => { console.warn('Persistence error', err); });
  };

  // Submit Public Feedback
  const handleSubmitFeedback = async (e?: React.FormEvent, customText?: string) => {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    const textToSubmit = customText || newFeedbackText;
    if (!textToSubmit.trim()) return;

    const recentErrors = telemetry.getRecentErrors().networkErrors;
    const latestErrorWithReqId = recentErrors.find(n => !!n.requestId);

    const payload = {
      text: textToSubmit.trim(),
      author: t18n("legacy.visitor_beta_tester"),
      contact: newFeedbackContact.trim(),
      category: 'idea',
      ...(latestErrorWithReqId?.requestId ? { request_id: latestErrorWithReqId.requestId } : {})
    };

    try {
      const resp = await fetch(`${serverUrl.replace(/\/$/, '')}/api/projects/${encodeURIComponent(projectId)}/feedback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(publicKey ? { 'X-Vibus-Public-Key': publicKey, 'X-Public-Widget-Key': publicKey } : {}),
          'Idempotency-Key': `idemp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
        },
        body: JSON.stringify(payload)
      });
      if (!resp.ok) {
        throw new Error('Failed to submit feedback');
      }
      const data = await resp.json().catch(() => ({}));
      const newFb: PublicFeedback = {
        id: data.id || data.feedback_id || `fb_${Date.now()}`,
        author: t18n("legacy.visitor_beta_tester"),
        contact: newFeedbackContact.trim(),
        text: textToSubmit.trim(),
        created_at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        status: 'new'
      };
      setBoardData(prev => ({
        ...prev,
        feedbacks: [...(prev.feedbacks || []), newFb]
      }));
      setNewFeedbackText('');
      setNewFeedbackContact('');
      setIsAddingFeedback(false);
    } catch (err) {
      console.error('Feedback submit error:', err);
      throw err;
    }
  };

  // Convert Public Feedback to Dev Task
  const handleConvertFeedbackToTicket = (fb: PublicFeedback) => {
    const targetNode = boardData.nodes[0] || { id: 'general', title: t18n("legacy.core_functionality") };
    const newTicket: Ticket = {
      id: `TKT-${Math.floor(100 + Math.random() * 900)}`,
      title: t18n('v7.generated.feedback_title', { text: fb.text.slice(0, 45) }),
      summary: t18n('v7.generated.feedback_summary', { contact: fb.contact || t18n('legacy.visitor'), text: fb.text }),
      source_quote: fb.quote || '',
      status: 'backlog',
      priority: 'medium', deadline: '2026-08-30', tags: ['frontend', 'bug'], estimate: '4h',
      order: 0,
      checklists: {
        [t18n("legacy.spec_described")]: true,
        [t18n("legacy.backend_ready")]: false,
        [t18n("legacy.frontend_ready")]: false,
        [t18n("legacy.autotests")]: false,
      },
      rework_notes: ''
    };

    const updated = {
      ...boardData,
      feedbacks: (boardData.feedbacks || []).map(f => f.id === fb.id ? { ...f, status: 'converted' as const, converted_ticket_id: newTicket.id } : f),
      nodes: boardData.nodes.map(n => n.id === targetNode.id ? { ...n, tickets: [newTicket, ...n.tickets] } : n)
    };

    broadcastChange(updated);
    setViewMode('board');

    void persistAndReconcile(convertFeedbackToTicket(serverUrl, projectId, fb.id, {
      node_id: targetNode.id,
      title: newTicket.title,
      priority: 'medium',
    }, apiToken)).catch((err) => { console.warn('Persistence error', err); });
  };


  // Custom DoD Management per Ticket
  const handleAddCustomDoD = (e: React.FormEvent, ticketId: string) => {
    e.preventDefault();
    if (!newDoDLabel.trim()) return;

    let updatedChecklists: Record<string, boolean> = {};
    let expectedRev: number | undefined;
    const updated = {
      ...boardData,
      nodes: boardData.nodes.map(n => ({
        ...n,
        tickets: n.tickets.map(t => {
          if (t.id !== ticketId) return t;
          expectedRev = t.revision;
          const current: Record<string, boolean> = {};
          if (t.checklists) {
            for (const [k, v] of Object.entries(t.checklists)) {
              if (typeof v === 'boolean') current[k] = v;
            }
          }
          current[newDoDLabel.trim()] = false;
          updatedChecklists = current;
          return {
            ...t,
            checklists: updatedChecklists
          };
        })
      }))
    };

    broadcastChange(updated);
    setNewDoDLabel('');
    setAddingDoDTicketId(null);

    void persistOrResync(updateTicket(serverUrl, projectId, ticketId, { checklists: updatedChecklists }, apiToken, expectedRev)).catch((err) => { console.warn('Persistence error', err); });
  };

  const handleDeleteDoDItem = (ticketId: string, dodKey: string) => {
    let updatedChecklists: Record<string, boolean> = {};
    let expectedRev: number | undefined;
    const updated = {
      ...boardData,
      nodes: boardData.nodes.map(n => ({
        ...n,
        tickets: n.tickets.map(t => {
          if (t.id !== ticketId) return t;
          expectedRev = t.revision;
          const copy: Record<string, boolean> = {};
          if (t.checklists) {
            for (const [k, v] of Object.entries(t.checklists)) {
              if (k !== dodKey && typeof v === 'boolean') copy[k] = v;
            }
          }
          updatedChecklists = copy;
          return { ...t, checklists: copy };
        })
      }))
    };
    broadcastChange(updated);

    void persistOrResync(updateTicket(serverUrl, projectId, ticketId, { checklists: updatedChecklists }, apiToken, expectedRev)).catch((err) => { console.warn('Persistence error', err); });
  };

  const insertSnippet = (snippet: string) => {
    setEditingMarkdown(prev => prev + '\n\n' + snippet);
  };

  // Quick ticket creation
  const handleAddTicket = (e?: React.FormEvent, customTitle?: string, customPriority?: 'high' | 'medium' | 'low', targetColId?: string) => {
    if (e && e.preventDefault) e.preventDefault();
    const titleToUse = customTitle || newTitle;
    if (!titleToUse.trim()) return;

    const targetNodeId = selectedNodeId || (activeSpecFilter !== 'all' ? activeSpecFilter : (activeSectionFilter !== 'all' ? activeSectionFilter : boardData.nodes?.[0]?.id)) || 'general';
    const nextKeyNum = (allTickets.length + 1);
    const currentCustomBoard = (boardData.custom_boards || boardData.boards || []).find(b => b.id === activeBoardId);
    
    const newTicket: Ticket = {
      id: `TKT-${Date.now().toString().slice(-4)}_${Math.floor(10 + Math.random() * 90)}`,
      key: `TKT-${nextKeyNum}`,
      node_id: targetNodeId,
      board_id: activeBoardId !== 'all' ? activeBoardId : undefined,
      tags: currentCustomBoard ? [currentCustomBoard.title] : [],
      title: titleToUse.trim(),
      summary: t18n("legacy.task_created_from_vibeus_widget"),
      status: targetColId || (boardData.columns && boardData.columns[0]?.id) || 'backlog',
      priority: customPriority || newPriority || 'medium',
      order: 0,
      checklists: {
        [t18n("legacy.spec_described")]: true,
        [t18n("legacy.backend_ready")]: false,
        [t18n("legacy.frontend_ready")]: false,
        [t18n("legacy.autotests")]: false,
      },
      rework_notes: ''
    };

    let updated: BoardData;
    const nodeExists = boardData.nodes && boardData.nodes.some(n => n.id === targetNodeId);
    
    if (!nodeExists) {
      const defaultNode: NodeItem = {
        id: targetNodeId,
        parent_id: null,
        title: t18n("legacy.main_section"),
        description: t18n('v7.generated.main_desc'),
        content_markdown: t18n('v7.generated.main_md'),
        discussions: [],
        tickets: [newTicket]
      };
      updated = {
        ...boardData,
        nodes: [defaultNode, ...(boardData.nodes || [])]
      };
    } else {
      updated = {
        ...boardData,
        nodes: boardData.nodes.map(n => n.id === targetNodeId ? {
          ...n,
          tickets: [newTicket, ...(n.tickets || [])]
        } : n)
      };
    }

    broadcastChange(updated);
    setNewTitle('');

    void persistAndReconcile(createTicket(serverUrl, projectId, targetNodeId, {
      title: newTicket.title,
      summary: newTicket.summary,
      priority: newTicket.priority,
      status: newTicket.status,
      checklists: newTicket.checklists
    }, apiToken)).catch((err) => { console.warn('Persistence error', err); });
  };

  const handleAddSection = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSectionTitle.trim()) return;
    const slug = newSectionTitle.trim().toLowerCase().replace(/[^a-zа-я0-9]+/gi, '_');
    const newNodeId = `${slug || 'sec'}_${Date.now()}`;
    const newNode: NodeItem = {
      id: newNodeId,
      parent_id: newSectionParentId || null,
      title: newSectionTitle.trim(),
      description: newSectionDesc.trim() || t18n('v7.generated.section_desc'),
      content_markdown: t18n('v7.generated.section_md', { title: newSectionTitle.trim() }),
      discussions: [],
      tickets: []
    };
    const updated = {
      ...boardData,
      nodes: [...(boardData.nodes || []), newNode]
    };
    broadcastChange(updated);
    setSelectedNodeId(newNode.id);
    setActiveSpecNodeId(newNode.id);
    setNewSectionTitle('');
    setNewSectionDesc('');
    setNewSectionParentId('');
    setIsAddingSection(false);

    void persistAndReconcile(createNode(serverUrl, projectId, {
      title: newNode.title,
      ...(newNode.description ? { description: newNode.description } : {}),
      ...(newNode.parent_id ? { parent_id: newNode.parent_id } : {})
    }, apiToken)).catch((err) => { console.warn('Persistence error', err); });
  };

  const handleSaveNode = (nodeId: string) => {
    const updated = {
      ...boardData,
      nodes: boardData.nodes.map(n => n.id === nodeId ? {
        ...n,
        title: editingNodeTitle.trim() || n.title,
        description: editingNodeDesc.trim(),
        content_markdown: editingMarkdown
      } : n)
    };
    broadcastChange(updated);
    setEditingNodeId(null);

    void persistOrResync(updateNode(serverUrl, projectId, nodeId, {
      title: editingNodeTitle.trim(),
      description: editingNodeDesc.trim(),
      content_markdown: editingMarkdown
    }, apiToken)).catch((err) => { console.warn('Persistence error', err); });
  };

  const handleSaveNodeMarkdown = (nodeId: string) => {
    handleSaveNode(nodeId);
  };

  const handleDeleteSection = (nodeId: string) => {
    const nodeToDelete = boardData.nodes.find(n => n.id === nodeId);
    if (!nodeToDelete) return;

    const remainingNodes = boardData.nodes.filter(n => n.id !== nodeId && n.parent_id !== nodeId);
    const updated = {
      ...boardData,
      nodes: remainingNodes
    };
    broadcastChange(updated);
    if (activeSpecNodeId === nodeId) {
      setActiveSpecNodeId(remainingNodes[0]?.id || '');
    }
    if (editingNodeId === nodeId) {
      setEditingNodeId(null);
    }

    void persistOrResync(deleteNode(serverUrl, projectId, nodeId, apiToken)).catch((err) => { console.warn('Persistence error', err); });
  };

  const handleAddColumn = (e?: React.FormEvent, customLabel?: string) => {
    if (e && e.preventDefault) e.preventDefault();
    const labelToAdd = customLabel !== undefined ? customLabel : newColumnLabel;
    if (!labelToAdd || !labelToAdd.trim()) return;
    
    let colId = labelToAdd.trim().toLowerCase()
      .replace(/[\s-]+/g, '_')
      .replace(/[^a-z0-9_а-яё]+/gi, '');
    if (!colId || colId === '_' || /^_+$|^\s*$/.test(colId)) {
      colId = `col_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`;
    }
    
    const currentCols = boardData.columns || DEFAULT_COLUMNS;
    if (currentCols.some(c => c.id === colId)) {
      colId = `${colId}_${Date.now().toString().slice(-4)}`;
    }

    const updatedCols: BoardColumn[] = [
      ...currentCols,
      { id: colId, label: labelToAdd.trim(), color: 'slate' }
    ];
    const updated = {
      ...boardData,
      columns: updatedCols
    };
    broadcastChange(updated);
    setNewColumnLabel('');

    void persistOrResync(updateProjectSettings(serverUrl, projectId, {
      columns: updatedCols
    }, apiToken)).catch((err) => { console.warn('Persistence error', err); });
  };

  const handleDeleteColumn = (colId: string) => {
    const currentCols = boardData.columns || DEFAULT_COLUMNS;
    if (currentCols.length <= 1) return;
    const updatedCols = currentCols.filter(c => c.id !== colId);
    const fallbackStatus = (updatedCols[0] && updatedCols[0].id) || 'backlog';
    
    const updatedNodes = boardData.nodes.map(n => ({
      ...n,
      tickets: n.tickets.map(t => t.status === colId ? { ...t, status: fallbackStatus } : t)
    }));

    const updated = {
      ...boardData,
      columns: updatedCols,
      nodes: updatedNodes
    };
    broadcastChange(updated);

    void persistOrResync(deleteColumn(serverUrl, projectId, colId, apiToken)).catch((err) => { console.warn('Persistence error', err); });
  };

  const handleToggleChecklist = (ticketId: string, key: string) => {
    let nextDone = false;
    const updated = {
      ...boardData,
      nodes: boardData.nodes.map(n => ({
        ...n,
        tickets: n.tickets.map(t => {
          if (t.id !== ticketId) return t;
          nextDone = !t.checklists[key];
          return {
            ...t,
            checklists: {
              ...t.checklists,
              [key]: nextDone
            }
          };
        })
      }))
    };
    broadcastChange(updated);
    sendWsEvent("ticket.checklist.change", ticketId, { key, is_done: nextDone });
  };

  const handleUpdateTicketFields = (ticketId: string, updates: Partial<Ticket>) => {
    let destNodeId = updates.node_id;
    let oldTicket: Ticket | undefined;
    
    // Find old ticket
    for (const n of boardData.nodes) {
      const found = n.tickets.find(t => t.id === ticketId);
      if (found) {
        oldTicket = found;
        break;
      }
    }
    if (!oldTicket) return;

    const mergedTicket: Ticket = {
      ...oldTicket,
      ...updates
    };

    let updatedNodes = boardData.nodes.map(n => ({
      ...n,
      tickets: n.tickets.filter(t => t.id !== ticketId)
    }));

    const finalNodeId = destNodeId || oldTicket.node_id || (boardData.nodes[0] ? boardData.nodes[0].id : 'general');
    updatedNodes = updatedNodes.map(n => {
      if (n.id === finalNodeId) {
        return {
          ...n,
          tickets: [...n.tickets, mergedTicket]
        };
      }
      return n;
    });

    const updated = {
      ...boardData,
      nodes: updatedNodes
    };
    broadcastChange(updated);

    if (selectedTicketForEdit && selectedTicketForEdit.id === ticketId) {
      setSelectedTicketForEdit(mergedTicket);
    }

    if (destNodeId && destNodeId !== oldTicket.node_id) {
      void persistOrResync(moveTicket(serverUrl, projectId, ticketId, { node_id: destNodeId }, apiToken)).catch((err) => { console.warn('Persistence error', err); });
    }

    void persistOrResync(updateTicket(serverUrl, projectId, ticketId, {
      title: mergedTicket.title,
      summary: mergedTicket.summary,
      source_quote: mergedTicket.source_quote,
      status: mergedTicket.status,
      priority: mergedTicket.priority,
      assignee: mergedTicket.assignee,
      checklists: mergedTicket.checklists,
      rework_notes: mergedTicket.rework_notes,
      is_archived: mergedTicket.is_archived
    }, apiToken, oldTicket.revision)).catch((err) => { console.warn('Persistence error', err); });
  };

  const handleStatusChange = (ticketId: string, newStatus: string) => {
    let expectedRev: number | undefined;
    const updated = {
      ...boardData,
      nodes: boardData.nodes.map(n => ({
        ...n,
        tickets: n.tickets.map(t => {
          if (t.id === ticketId) {
            expectedRev = t.revision;
            return { ...t, status: newStatus };
          }
          return t;
        })
      }))
    };
    broadcastChange(updated);
    const sentViaWs = sendWsEvent("ticket.status.change", ticketId, { status: newStatus }, { queueWhenOffline: false });

    if (!sentViaWs) {
      void persistOrResync(updateTicket(serverUrl, projectId, ticketId, { status: newStatus }, apiToken, expectedRev)).catch((err) => { console.warn('Persistence error', err); });
    }
  };

  const handleSubmitRework = (e: React.FormEvent) => {
    e.preventDefault();
    if (!reworkTicketId) return;

    const updated = {
      ...boardData,
      nodes: boardData.nodes.map(n => ({
        ...n,
        tickets: n.tickets.map(t => {
          if (t.id !== reworkTicketId) return t;
          return {
            ...t,
            status: 'in_progress',
            rework_notes: reworkComment.trim()
          };
        })
      }))
    };

    broadcastChange(updated);
    const tId = reworkTicketId;
    const notes = reworkComment.trim();
    const sentViaWs = sendWsEvent("ticket.status.change", tId, { status: "in_progress", rework_notes: notes }, { queueWhenOffline: false });
    setReworkTicketId(null);
    setReworkComment('');

    if (!sentViaWs) {
      void persistOrResync(reviewTicket(serverUrl, projectId, tId, 'rework', notes, apiToken)).catch((err) => { console.warn('Persistence error', err); });
    }
  };

  const handleAcceptTicket = (ticketId: string) => {
    const updated = {
      ...boardData,
      nodes: boardData.nodes.map(n => ({
        ...n,
        tickets: n.tickets.map(t => {
          if (t.id !== ticketId) return t;
          return {
            ...t,
            status: 'done',
            rework_notes: ''
          };
        })
      }))
    };
    broadcastChange(updated);
    const sentViaWs = sendWsEvent("ticket.status.change", ticketId, { status: "done", rework_notes: "" }, { queueWhenOffline: false });

    if (!sentViaWs) {
      void persistOrResync(reviewTicket(serverUrl, projectId, ticketId, 'accept', '', apiToken)).catch((err) => { console.warn('Persistence error', err); });
    }
  };

  const copyPromptForAI = (t: Ticket, nodeTitle: string) => {
    const prompt = buildTicketExecutionPrompt({
      ticketId: t.id,
      title: t.title,
      section: nodeTitle,
      summary: t.summary,
      status: t.status,
      assignee: t.assignee,
      sourceQuote: t.source_quote,
      reworkNotes: t.rework_notes,
      bugContext: t.bug_context as unknown as Record<string, unknown>,
      checklists: t.checklists || {},
      criteriaContract: t.criteria_contract || {},
      criteriaEvidence: t.criteria_evidence || {},
      qualityMode: t.quality_mode || getEngineeringQualityMode(),
    });
    navigator.clipboard.writeText(prompt);
    setCopiedId(t.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const copyFullSpecForAI = () => {
    let fullDoc = `${ENGINEERING_EXECUTION_CONTRACT_V2}\n\n---\n\n# Project specification: ${projectId}\n\n`;
    boardData.nodes.forEach((node, i) => {
      fullDoc += `## ${i + 1}. ${node.title}\n`;
      if (node.description) fullDoc += `*${node.description}*\n\n`;
      if (node.content_markdown) fullDoc += `${node.content_markdown}\n\n`;
      if (node.tickets && node.tickets.length > 0) {
        fullDoc += t18n("legacy.section_tasks");
        node.tickets.forEach(t => {
          fullDoc += `- [${t.status === 'done' ? 'x' : ' '}] **${t.id}: ${t.title}** (${t.status})\n`;
          if (t.source_quote) fullDoc += t18n('v7.generated.context_quote', { quote: t.source_quote });
          if (t.summary) fullDoc += `  ${t.summary}\n`;
        });
        fullDoc += `\n`;
      }
      fullDoc += `---\n\n`;
    });
    navigator.clipboard.writeText(fullDoc);
    setCopiedAllSpec(true);
    setTimeout(() => setCopiedAllSpec(false), 2000);
  };

  const allTickets = useMemo(() => boardData.nodes.flatMap(n => n.tickets), [boardData.nodes]);
  const activeTickets = useMemo(() => allTickets.filter(t => t.status !== 'done' && !t.is_archived), [allTickets]);
  const inReviewTickets = useMemo(() => allTickets.filter(t => (t.status === 'review' || t.status === 'qa') && !t.is_archived), [allTickets]);
  const inProgressTickets = useMemo(() => allTickets.filter(t => t.status === 'in_progress' && !t.is_archived), [allTickets]);
  // Auto-select first node if none is active
  useEffect(() => {
    if (boardData.nodes && boardData.nodes.length > 0 && boardData.nodes[0]) {
      if (!activeSpecNodeId || !boardData.nodes.some(n => n.id === activeSpecNodeId)) {
        setActiveSpecNodeId(boardData.nodes[0].id);
      }
    }
  }, [boardData.nodes, activeSpecNodeId]);

  const activeColumns = useMemo(() => boardData.columns && boardData.columns.length > 0 ? boardData.columns : DEFAULT_COLUMNS, [boardData.columns]);
  const currentSpecNode = useMemo(() => {
    if (!boardData.nodes || boardData.nodes.length === 0) return null;
    return boardData.nodes.find(n => n.id === activeSpecNodeId) || boardData.nodes[0] || null;
  }, [boardData.nodes, activeSpecNodeId]);
  const backlogCount = useMemo(() => allTickets.filter(t => t.status === 'backlog' && !t.is_archived).length, [allTickets]);
  const feedbacksList = useMemo(() => boardData.feedbacks || [], [boardData.feedbacks]);
  const newFeedbacksCount = useMemo(() => (boardData.feedbacks || []).filter(f => f.status === 'new').length, [boardData.feedbacks]);
  const customRolesList = useMemo(() => boardData.custom_roles || DEFAULT_ROLES, [boardData.custom_roles]);


  // Modern Accent color definitions
  const accentTheme = useMemo(() => {
    const map: Record<string, { brand: string; lightBg: string; text: string; ring: string; gradient: string; border: string; hover: string }> = {
      indigo: { 
        brand: 'bg-indigo-600 hover:bg-indigo-500 text-white', 
        lightBg: 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800', 
        text: 'text-indigo-600 dark:text-indigo-400', 
        ring: 'focus:border-indigo-500',
        gradient: 'bg-gradient-to-r from-indigo-600 via-indigo-500 to-violet-600',
        border: 'border-indigo-200 dark:border-indigo-800',
        hover: 'hover:bg-indigo-500'
      },
      emerald: { 
        brand: 'bg-emerald-600 hover:bg-emerald-500 text-white', 
        lightBg: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800', 
        text: 'text-emerald-600 dark:text-emerald-400', 
        ring: 'focus:border-emerald-500',
        gradient: 'bg-gradient-to-r from-emerald-600 to-teal-600',
        border: 'border-emerald-200 dark:border-emerald-800',
        hover: 'hover:bg-emerald-500'
      },
      cyan: { 
        brand: 'bg-cyan-600 hover:bg-cyan-500 text-white', 
        lightBg: 'bg-cyan-50 dark:bg-cyan-950/40 text-cyan-700 dark:text-cyan-300 border-cyan-200 dark:border-cyan-800', 
        text: 'text-cyan-600 dark:text-cyan-400', 
        ring: 'focus:border-cyan-500',
        gradient: 'bg-gradient-to-r from-cyan-600 to-blue-600',
        border: 'border-cyan-200 dark:border-cyan-800',
        hover: 'hover:bg-cyan-500'
      },
      violet: { 
        brand: 'bg-violet-600 hover:bg-violet-500 text-white', 
        lightBg: 'bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-800', 
        text: 'text-violet-600 dark:text-violet-400', 
        ring: 'focus:border-violet-500',
        gradient: 'bg-gradient-to-r from-violet-600 to-purple-600',
        border: 'border-violet-200 dark:border-violet-800',
        hover: 'hover:bg-violet-500'
      },
      rose: { 
        brand: 'bg-rose-600 hover:bg-rose-500 text-white', 
        lightBg: 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800', 
        text: 'text-rose-600 dark:text-rose-400', 
        ring: 'focus:border-rose-500',
        gradient: 'bg-gradient-to-r from-rose-500 to-pink-600',
        border: 'border-rose-200 dark:border-rose-800',
        hover: 'hover:bg-rose-500'
      },
      amber: { 
        brand: 'bg-amber-600 hover:bg-amber-500 text-white', 
        lightBg: 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800', 
        text: 'text-amber-600 dark:text-amber-400', 
        ring: 'focus:border-amber-500',
        gradient: 'bg-gradient-to-r from-amber-500 to-orange-600',
        border: 'border-amber-200 dark:border-amber-800',
        hover: 'hover:bg-amber-500'
      }
    };
    return map[currentAccent] || map.indigo;
  }, [currentAccent]);

  // Public Feedback mode condition
  const isPublicMode = currentAccessMode === 'public_feedback';

  return {
    DEFAULT_COLUMNS,
    DEFAULT_ROLES,
    accentTheme,
    activeColumns,
    activeDiscussionNodeId,
    activeDiscussionThread,
    activeBoardId,
    setActiveBoardId,
    activeSectionFilter,
    setActiveSectionFilter,
    activeSpecFilter,
    setActiveSpecFilter,
    handleAddBoard,
    handleDeleteBoard,
    activeSpecNodeId,
    addingDoDTicketId,
    allTickets,
    backendEndpoint,
    backendHttpStatus,
    backendPayload,
    backendTraceback,
    boardData,
    bugActual,
    bugAdditionalInfo,
    bugCategory,
    bugExpected,
    bugPriority,
    bugTitle,
    connected,
    convertedTicketTitle,
    copiedAllSpec,
    copiedId,
    copyFullSpecForAI,
    copyPromptForAI,
    currentAccent,
    currentAccessMode,
    customRolesList,
    deleteConfirmationInput,
    deletingTicket,
    editingMarkdown,
    editingNodeId,
    editingNodeTitle,
    editingNodeDesc,
    setEditingNodeTitle,
    setEditingNodeDesc,
    handleSaveNode,
    handleDeleteSection,
    expandedTicketDoD,
    feedbacksList,
    getColumnLabel,
    getRoleLabel,
    globalSelection,
    globalSelectionRef,
    groupChatId,
    handleAISummarizeDiscussion,
    handleAcceptTicket,
    handleAddColumn,
    handleAddCommentToDiscussion,
    handleAddCustomDoD,
    handleAddCustomRole,
    handleAddInlineChildSection,
    handleAddSection,
    handleAddTeamMember,
    handleAddTicket,
    handleArchiveDoneTickets,
    handleConfirmDeleteProject,
    handleConfirmDeleteTicket,
    handleConvertFeedbackToTicket,
    handleCreateBugReportTicket,
    handleCreateTicketFromDiscussion,
    handleDeleteColumn,
    handleDeleteDoDItem,
    handleGlobalSelectionClick,
    handleOpenBugModal,
    handleSavePrivacySettings,
    telemetryEnabled,
    setTelemetryEnabled,
    aiDataSharing,
    setAiDataSharing,
    handleSaveGroupChat,
    handleSaveNodeMarkdown,
    handleSendSprintToAI,
    handleSpecMouseUp,
    handleStartDiscussion,
    handleStatusChange,
    handleSubmitFeedback,
    handleSubmitRework,
    handleToggleArchiveTicket,
    handleToggleChecklist,
    handleToggleDiscussionStatus,
    handleUpdateTicketFields,
    i18n,
    inlineChildTitle,
    inlineParentAddId,
    insertSnippet,
    inspectedElementData,
    isAccessModalOpen,
    isAddingFeedback,
    isAddingSection,
    isBugModalOpen,
    isConvertingToTicket,
    isDeletingProject,
    isInspectingElement,
    isManagingColumns,
    isManagingRoles,
    isOpen,
    isProjectDeleteModalOpen,
    isSettingsOpen,
    isTeamModalOpen,
    isThemingOpen,
    lastClickedRef,
    loading,
    newColumnLabel,
    newDiscussionComment,
    newDoDLabel,
    newFeedbackContact,
    newFeedbackText,
    newMemberName,
    newMemberRole,
    newMemberTg,
    newPriority,
    newRoleBadge,
    newRoleColor,
    newRoleLabel,
    newSectionDesc,
    newSectionParentId,
    newSectionTitle,
    newTitle,
    notifyDiscussions,
    notifyFeedback,
    notifyReview,
    notifyRework,
    reworkComment,
    reworkTicketId,
    searchQuery,
    selectedNodeId,
    selectedQuote,
    selectedTicketForEdit,
    setActiveDiscussionNodeId,
    setActiveDiscussionThread,
    
    setActiveSpecNodeId,
    setAddingDoDTicketId,
    setBackendEndpoint,
    setBackendHttpStatus,
    setBackendPayload,
    setBackendTraceback,
    setBoardData,
    setBugActual,
    setBugAdditionalInfo,
    setBugCategory,
    setBugExpected,
    setBugPriority,
    setBugTitle,
    setConnected,
    setConvertedTicketTitle,
    setCopiedAllSpec,
    setCopiedId,
    setCurrentAccent,
    setCurrentAccessMode,
    setDeleteConfirmationInput,
    setDeletingTicket,
    setEditingMarkdown,
    setEditingNodeId,
    setExpandedTicketDoD,
    setGlobalSelection,
    setGroupChatId,
    setInlineChildTitle,
    setInlineParentAddId,
    setInspectedElementData,
    setIsAccessModalOpen,
    setIsAddingFeedback,
    setIsAddingSection,
    setIsBugModalOpen,
    setIsConvertingToTicket,
    setIsDeletingProject,
    setIsInspectingElement,
    setIsManagingColumns,
    setIsManagingRoles,
    setIsOpen,
    setIsProjectDeleteModalOpen,
    setIsSettingsOpen,
    setIsTeamModalOpen,
    setIsThemingOpen,
    setLoading,
    setNewColumnLabel,
    setNewDiscussionComment,
    setNewDoDLabel,
    setNewFeedbackContact,
    setNewFeedbackText,
    setNewMemberName,
    setNewMemberRole,
    setNewMemberTg,
    setNewPriority,
    setNewRoleBadge,
    setNewRoleColor,
    setNewRoleLabel,
    setNewSectionDesc,
    setNewSectionParentId,
    setNewSectionTitle,
    setNewTitle,
    setNotifyDiscussions,
    setNotifyFeedback,
    setNotifyReview,
    setNotifyRework,
    setReworkComment,
    setReworkTicketId,
    setSearchQuery,
    setSelectedNodeId,
    setSelectedQuote,
    setSelectedTicketForEdit,
    setShowArchivedDone,
    setViewMode,
    showArchivedDone,
    t18n,
    viewMode,
    currentSpecNode,
    isPublicMode,
    startElementInspector,
    isInspectorActive,
    setIsInspectorActive,
    handleToggleInspector,
    handleElementInspected,
    activeTickets,
    backlogCount,
    inProgressTickets,
    newFeedbacksCount,
    inReviewTickets,
    wsRef,
    capabilities,
    canWrite,
    canComment,
    canReview,
    canManageSettings,
    isReadOnly
  };
};
