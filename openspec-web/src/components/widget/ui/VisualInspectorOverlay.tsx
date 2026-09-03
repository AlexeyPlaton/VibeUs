import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Crosshair, X, AlertTriangle, Sparkles, Server } from 'lucide-react';
import { telemetry, type NetworkLogEntry } from '../networkTelemetry';

export interface InspectedElementInfo {
  tagName: string;
  selector: string;
  id?: string | undefined;
  className?: string | undefined;
  innerText?: string | undefined;
  rect: { top: number; left: number; width: number; height: number };
  correlatedError?: NetworkLogEntry | undefined;
}

export interface VisualInspectorOverlayProps {
  isActive: boolean;
  onClose: () => void;
  onElementSelect: (info: InspectedElementInfo) => void;
}

export const VisualInspectorOverlay: React.FC<VisualInspectorOverlayProps> = ({
  isActive,
  onClose,
  onElementSelect
}) => {
  const { t: t18n } = useTranslation();
  const [hoveredRect, setHoveredRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  const [hoveredInfo, setHoveredInfo] = useState<InspectedElementInfo | null>(null);
  const currentTargetRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isActive) {
      setHoveredRect(null);
      setHoveredInfo(null);
      return;
    }

    const handleMouseMove = (e: MouseEvent) => {
      const x = e.clientX;
      const y = e.clientY;

      // Find element under pointer excluding widget itself and its shadow tree/banner
      const elements = document.elementsFromPoint(x, y);
      const target = elements.find(el => {
        if (!(el instanceof HTMLElement)) return false;
        const tag = el.tagName.toLowerCase();
        if (tag.includes('vibus') || tag.includes('vibeus') || tag === 'html' || tag === 'body') return false;
        if (el.closest('vibus-widget, vibeus-widget, .vibus-widget-root, .vibeus-widget-root, #vibus-inspector-banner')) return false;
        return true;
      }) as HTMLElement | undefined;

      if (!target || target === currentTargetRef.current) return;
      currentTargetRef.current = target;

      const rect = target.getBoundingClientRect();
      const tagName = target.tagName.toLowerCase();
      const id = target.id || undefined;
      const className = typeof target.className === 'string' ? target.className : undefined;
      
      let selector = tagName;
      if (id) selector += `#${id}`;
      if (className) {
        const firstClasses = className.split(/\s+/).filter(c => c && !c.includes(':') && !c.includes('[') && !c.includes(']')).slice(0, 2).join('.');
        if (firstClasses) selector += `.${firstClasses}`;
      }

      const correlatedError = telemetry.getErrorForElement(selector);

      const info: InspectedElementInfo = {
        tagName,
        selector,
        id,
        className,
        innerText: (target.innerText || target.textContent || '').slice(0, 100).trim(),
        rect: {
          top: rect.top + window.scrollY,
          left: rect.left + window.scrollX,
          width: rect.width,
          height: rect.height
        },
        correlatedError
      };

      setHoveredRect({
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height
      });
      setHoveredInfo(info);
    };

    const handleClick = (e: MouseEvent) => {
      const path = (e.composedPath && e.composedPath()) || [];
      const isBannerClick = path.some((el: any) => el && (el.id === 'vibus-inspector-banner' || (el.classList && (el.classList.contains('vibus-widget-root') || el.classList.contains('vibeus-widget-root')))));
      if (isBannerClick) return;

      e.preventDefault();
      e.stopPropagation();

      if (hoveredInfo) {
        onElementSelect(hoveredInfo);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    window.addEventListener('click', handleClick, true);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('click', handleClick, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isActive, hoveredInfo, onClose, onElementSelect]);

  if (!isActive) return null;

  return (
    <div className="fixed inset-0 z-[99999999] pointer-events-none select-none font-['Plus_Jakarta_Sans',sans-serif]">
      {/* Top Floating Guide Banner */}
      <div 
        id="vibus-inspector-banner"
        className="fixed top-6 left-1/2 -translate-x-1/2 bg-slate-900/95 backdrop-blur-2xl border border-indigo-500/50 px-6 py-3.5 rounded-2xl shadow-2xl flex items-center gap-4 pointer-events-auto animate-slideDown z-[99999999]"
      >
        <div className="w-8 h-8 rounded-xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center border border-indigo-500/30">
          <Crosshair className="w-4 h-4 animate-spin-slow" />
        </div>
        <div>
          <div className="text-xs font-bold text-white flex items-center gap-2">
            <span>{t18n('v7.inspector.title')}</span>
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              Active Picker
            </span>
          </div>
          <p className="text-[11px] text-slate-300 mt-0.5">
            {t18n('v7.inspector.desc')}
          </p>
        </div>
        <button
          onClick={onClose}
          className="ml-2 w-8 h-8 rounded-xl bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
          title={t18n('v7.inspector.cancel')}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Target Element Highlight Box */}
      {hoveredRect && (
        <div
          className={`fixed border-2 rounded-lg transition-all duration-75 pointer-events-none ${
            hoveredInfo?.correlatedError 
              ? 'border-rose-500 bg-rose-500/10 shadow-[0_0_20px_rgba(244,63,94,0.4)]' 
              : 'border-indigo-500 bg-indigo-500/10 shadow-[0_0_20px_rgba(99,102,241,0.3)]'
          }`}
          style={{
            top: `${hoveredRect.top}px`,
            left: `${hoveredRect.left}px`,
            width: `${hoveredRect.width}px`,
            height: `${hoveredRect.height}px`
          }}
        >
          {/* Pulsing Corner Markers */}
          <span className="absolute -top-1.5 -left-1.5 w-3 h-3 bg-indigo-400 rounded-xs" />
          <span className="absolute -top-1.5 -right-1.5 w-3 h-3 bg-indigo-400 rounded-xs" />
          <span className="absolute -bottom-1.5 -left-1.5 w-3 h-3 bg-indigo-400 rounded-xs" />
          <span className="absolute -bottom-1.5 -right-1.5 w-3 h-3 bg-indigo-400 rounded-xs" />

          {/* Floating Element Tooltip */}
          <div
            className="absolute left-0 bottom-full mb-2 bg-slate-900/95 backdrop-blur-xl border border-slate-700/80 rounded-xl px-3 py-2 shadow-2xl text-white text-xs max-w-sm pointer-events-none"
            style={{
              transform: hoveredRect.top < 60 ? 'translateY(calc(100% + 8px))' : 'none'
            }}
          >
            <div className="flex items-center gap-2">
              <span className="font-mono font-bold text-indigo-300">{hoveredInfo?.selector}</span>
              <span className="text-[10px] text-slate-400">
                {Math.round(hoveredRect.width)} × {Math.round(hoveredRect.height)}px
              </span>
            </div>

            {/* Error Correlation Warning in Tooltip */}
            {hoveredInfo?.correlatedError && (
              <div className="mt-1.5 pt-1.5 border-t border-rose-500/20 flex items-center gap-1.5 text-rose-400 text-[11px] font-semibold">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 animate-bounce" />
                <span>
                  {t18n('v7.inspector.correlated', { method: hoveredInfo.correlatedError.method, url: hoveredInfo.correlatedError.url, status: hoveredInfo.correlatedError.status })}
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
