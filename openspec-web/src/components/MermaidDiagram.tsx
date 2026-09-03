import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import mermaid from 'mermaid';

interface MermaidDiagramProps {
  chart: string;
}

let mermaidInitialized = false;

function initMermaid() {
  if (!mermaidInitialized) {
    mermaid.initialize({
      startOnLoad: false,
      theme: 'neutral',
      themeVariables: {
        darkMode: false,
        primaryColor: '#4f46e5',
        primaryTextColor: '#ffffff',
        primaryBorderColor: '#4338ca',
        lineColor: '#6366f1',
        secondaryColor: '#f3f4f6',
        tertiaryColor: '#ffffff',
        fontSize: '12px',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif'
      },
      securityLevel: 'strict'
    });
    mermaidInitialized = true;
  }
}

function sanitize(svg: string): string {
  return svg.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
}

export const MermaidDiagram: React.FC<MermaidDiagramProps> = ({ chart }) => {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const [svgContent, setSvgContent] = useState<string>('');
  const [hasError, setHasError] = useState<boolean>(false);

  useEffect(() => {
    let isMounted = true;
    initMermaid();

    const renderChart = async () => {
      if (!chart.trim()) return;
      const id = `mermaid-svg-${Math.random().toString(36).substring(2, 9)}`;
      try {
        setHasError(false);
        const { svg } = await mermaid.render(id, chart.trim());
        if (isMounted) {
          setSvgContent(svg);
        }
      } catch (err) {
        console.warn('Mermaid render error:', err);
        if (isMounted) {
          setHasError(true);
        }
      }
    };

    renderChart();

    return () => {
      isMounted = false;
    };
  }, [chart]);

  if (hasError) {
    return (
      <div className="my-3 p-3 bg-slate-900 text-slate-200 rounded-xl font-mono text-xs overflow-x-auto border border-rose-500/40">
        <div className="text-rose-400 text-[11px] font-bold mb-1 flex items-center gap-1">
          <span>{t('common.mermaid_error')}</span>
        </div>
        <pre>{chart}</pre>
      </div>
    );
  }

  return (
    <div className="my-3 p-4 bg-slate-50/90 hover:bg-slate-50 rounded-2xl border border-indigo-100 shadow-2xs overflow-x-auto flex items-center justify-center transition-all">
      {svgContent ? (
        <div 
          ref={containerRef}
          className="w-full flex justify-center [&>svg]:max-w-full [&>svg]:h-auto"
          dangerouslySetInnerHTML={{ __html: sanitize(svgContent) }} 
        />
      ) : (
        <div className="py-6 text-xs text-slate-400 animate-pulse flex items-center gap-2">
          <span>{t('common.mermaid_rendering')}</span>
        </div>
      )}
    </div>
  );
};
