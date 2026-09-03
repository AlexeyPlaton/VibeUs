import React from 'react';

export interface WidgetLauncherProps {
  isOpen: boolean;
  isInspectorActive?: boolean;
  onToggle: () => void;
  isPublicMode: boolean;
  inReviewTicketsLength: number;
  activeTicketsLength: number;
  newFeedbacksCount: number;
  subscriptionTier?: string;
}

export const WidgetLauncher: React.FC<WidgetLauncherProps> = ({
  isOpen,
  isInspectorActive = false,
  onToggle,
  isPublicMode,
  inReviewTicketsLength,
  activeTicketsLength,
  newFeedbacksCount,
  subscriptionTier = 'free'
}) => {
  const showBadge = subscriptionTier === 'free';
  const isHidden = isOpen || isInspectorActive;

  return (
    <div 
      className="fixed bottom-6 right-6 sm:bottom-10 sm:right-10 z-[9999999] flex flex-col items-end gap-1.5"
      style={{
        transform: isHidden ? 'translateY(20px) scale(0.9)' : 'translateY(0px) scale(1)',
        opacity: isHidden ? 0 : 1,
        pointerEvents: isHidden ? 'none' : 'auto',
        transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)'
      }}
    >
      <button 
        id="vibeWidgetBtn" 
        onClick={onToggle}
        className="resonance-btn px-12 py-5 group outline-none cursor-pointer"
      >
        <div className="resonance-rings z-0"></div>
        <div className="relative z-10 flex items-center gap-4 text-white">
          <span className="text-lg font-bold tracking-widest uppercase">VibeUs</span>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="resonance-icon">
            <polyline points="9 10 4 15 9 20"></polyline>
            <path d="M20 4v7a4 4 0 0 1-4 4H4"></path>
          </svg>

          {!isOpen && (inReviewTicketsLength > 0 || activeTicketsLength > 0 || newFeedbacksCount > 0) && (
            <span className="absolute -top-2.5 -right-3 min-w-[20px] h-[20px] px-1 bg-indigo-500 text-white rounded-full text-[10px] font-bold flex items-center justify-center shadow-lg shadow-indigo-500/40">
              {inReviewTicketsLength > 0 ? inReviewTicketsLength : activeTicketsLength > 0 ? activeTicketsLength : newFeedbacksCount}
            </span>
          )}
        </div>
      </button>

      {showBadge && (
        <a 
          href="https://github.com/AlexeyPlaton/Vibus" 
          target="_blank" 
          rel="noopener noreferrer"
          className="text-[10px] text-slate-400/80 hover:text-indigo-400 transition-colors font-medium tracking-tight bg-slate-950/60 backdrop-blur-md px-2 py-0.5 rounded-full border border-white/[0.06] flex items-center gap-1 shadow-sm"
        >
          <span>Powered by</span>
          <span className="font-bold text-slate-200 hover:text-indigo-300">VibeUs</span>
        </a>
      )}
    </div>
  );
};
