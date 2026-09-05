import type { ReactNode } from 'react';
import { Activity, ClipboardCheck, Route, Settings2 } from 'lucide-react';
import { useLocation } from 'react-router-dom';

function NavLink({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <a
      href={href}
      className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold transition ${
        active ? 'bg-white text-slate-950' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
      }`}
    >
      {children}
    </a>
  );
}

export function FounderControlShell({ children }: { children: ReactNode }) {
  const location = useLocation();
  return (
    <div className="min-h-screen bg-slate-950">
      <nav className="sticky top-0 z-[90] border-b border-slate-800 bg-slate-950/95 px-3 py-2 text-white backdrop-blur md:px-6">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2">
          <div className="text-xs font-black uppercase tracking-[0.2em] text-indigo-300">VibeUs · Founder cockpit</div>
          <div className="flex flex-wrap gap-1">
            <NavLink href="/control" active={location.pathname === '/control'}><Activity className="h-3.5 w-3.5" /> Radar</NavLink>
            <NavLink href="/control/strategy" active={location.pathname.startsWith('/control/strategy')}><Route className="h-3.5 w-3.5" /> Strategy</NavLink>
            <NavLink href="/control/workbench" active={location.pathname.startsWith('/control/workbench')}><ClipboardCheck className="h-3.5 w-3.5" /> Launch & Growth</NavLink>
            <NavLink href="/control/ops" active={location.pathname.startsWith('/control/ops')}><Settings2 className="h-3.5 w-3.5" /> Operations</NavLink>
          </div>
        </div>
      </nav>
      {children}
    </div>
  );
}