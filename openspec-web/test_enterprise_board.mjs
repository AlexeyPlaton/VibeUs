import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('enterprise board defines shared light and dark design tokens', () => {
  const css = read('src/enterprise-board.css');
  assert.match(css, /\.vibe-enterprise-shell\.vibe-theme-dark/);
  assert.match(css, /\.vibe-enterprise-shell\.vibe-theme-light/);
  for (const token of ['--vb-canvas', '--vb-surface', '--vb-border', '--vb-text', '--vb-muted', '--vb-accent']) {
    assert.match(css, new RegExp(token));
  }
  assert.match(css, /backdrop-filter:\s*none\s*!important/);
  assert.match(css, /\.spatial-card:hover[\s\S]*transform:\s*none\s*!important/);
  assert.match(css, /focus-visible/);
  assert.match(css, /prefers-reduced-motion/);
});

test('account and board share one persisted UI theme contract', () => {
  const theme = read('src/utils/uiTheme.ts');
  const frame = read('src/components/EnterpriseDashboardFrame.tsx');
  const modal = read('src/components/ProjectBoardModal.tsx');
  assert.match(theme, /vibus_ui_theme/);
  assert.match(theme, /vibus_board_theme/);
  assert.match(theme, /prefers-color-scheme:\s*dark/);
  assert.match(theme, /vibeus:ui-theme-change/);
  assert.match(theme, /window\.dispatchEvent/);
  assert.match(frame, /enterprise-dashboard-shell/);
  assert.match(frame, /persistUiTheme/);
  assert.match(frame, /subscribeUiTheme/);
  assert.match(frame, /data-dashboard-theme-toggle/);
  assert.match(modal, /persistUiTheme\(appearance\)/);
  assert.match(modal, /resolveInitialUiTheme/);
});

test('authenticated project board persists information density independently', () => {
  const modal = read('src/components/ProjectBoardModal.tsx');
  assert.match(modal, /vibus_board_density/);
  assert.match(modal, /vibe-enterprise-shell/);
  assert.match(modal, /vibe-theme-\$\{appearance\}/);
  assert.match(modal, /vibe-density-\$\{density\}/);
  assert.match(modal, /theme=\{appearance\}/);
  assert.match(modal, /switch_to_light/);
  assert.match(modal, /switch_to_dark/);
  assert.match(modal, /switch_to_compact/);
  assert.match(modal, /switch_to_comfortable/);
});

test('board UX layer uses semantic column selectors and compact density', () => {
  const css = read('src/enterprise-board-ux.css');
  const column = read('src/components/widget/ui/KanbanColumn.tsx');
  assert.match(column, /data-board-column=\{col\.id\}/);
  assert.match(css, /\[data-board-column\]/);
  assert.match(css, /\.vibe-density-compact/);
  assert.match(css, /scroll-snap-type:\s*x/);
  assert.match(css, /scrollbar-gutter:\s*stable/);
  assert.doesNotMatch(css, /div\[class\*="w-80 flex flex-col h-full"\]/);
});

test('board search supports keyboard focus and filter-aware empty states', () => {
  const board = read('src/components/widget/ui/BoardView.tsx');
  const column = read('src/components/widget/ui/KanbanColumn.tsx');
  assert.match(board, /searchInputRef/);
  assert.match(board, /event\.key === '\/'/);
  assert.match(board, /event\.ctrlKey \|\| event\.metaKey/);
  assert.match(board, /v7\.board\.clear_filters/);
  assert.match(board, /v7\.board\.results/);
  assert.match(column, /isFiltering/);
  assert.match(column, /v7\.kanban\.no_matches/);
});

test('standalone widget supports auto light-dark theming without hard-coded dark root', () => {
  const widget = read('src/widget.tsx');
  assert.match(widget, /resolveTheme/);
  assert.match(widget, /vibe-theme-\$\{theme\}/);
  assert.match(widget, /prefers-color-scheme:\s*dark/);
  assert.match(widget, /data-vibus-root/);
  assert.match(widget, /data-vibus-style/);
  assert.match(widget, /enterprise-board-ux\.css/);
  assert.match(widget, /VibeusWidgetAlias/);
  assert.match(widget, /autoMountWidget/);
  assert.doesNotMatch(widget, /vibus-widget-root dark['"]/);
});

test('enterprise cards use local assignee initials and no remote avatar service', () => {
  const card = read('src/components/widget/ui/KanbanCard.tsx');
  assert.match(card, /getInitials/);
  assert.match(card, /assigneeInitials/);
  assert.doesNotMatch(card, /dicebear\.com/i);
  assert.doesNotMatch(card, /<img\b/);
});

test('quick task creation is available in every active work column', () => {
  const column = read('src/components/widget/ui/KanbanColumn.tsx');
  assert.match(column, /canCreateInColumn\s*=\s*canWrite\s*&&\s*!isDoneCol/);
  assert.match(column, /handleAddTicket\?\.\(e, inlineTicketTitle\.trim\(\), inlinePriority, col\.id\)/);
  assert.match(column, /bug\.priority_low/);
  assert.match(column, /bug\.priority_medium/);
  assert.match(column, /bug\.priority_high/);
  assert.doesNotMatch(column, />🟢 Low</);
});

test('light theme also covers board dialogs and form controls', () => {
  const dialogs = read('src/enterprise-dialogs.css');
  assert.match(dialogs, /vibe-theme-light[\s\S]*fixed inset-0/);
  assert.match(dialogs, /background:\s*var\(--vb-surface\)/);
  assert.match(dialogs, /input::placeholder/);
  assert.match(dialogs, /background-color:\s*var\(--vb-canvas-subtle\)/);
});

test('dashboard maps legacy dark surfaces to semantic enterprise tokens', () => {
  const app = read('src/App.tsx');
  const main = read('src/main.tsx');
  const css = read('src/enterprise-dashboard.css');
  assert.match(app, /EnterpriseDashboardFrame/);
  assert.match(main, /enterprise-dashboard\.css/);
  assert.match(css, /enterprise-dashboard-shell/);
  assert.match(css, /var\(--vb-canvas\)/);
  assert.match(css, /var\(--vb-surface\)/);
  assert.match(css, /var\(--vb-border\)/);
  assert.match(css, /bg-white\/\[/);
  assert.match(css, /bg-black\//);
  assert.match(css, /enterprise-dashboard-theme-toggle/);
  assert.match(css, /focus-visible/);
  assert.match(css, /prefers-reduced-motion/);
});

test('enterprise stylesheets are loaded without breaking standalone widget lifecycle', () => {
  const main = read('src/main.tsx');
  const widget = read('src/widget.tsx');
  for (const source of [main, widget]) {
    assert.match(source, /enterprise-board\.css/);
    assert.match(source, /enterprise-board-ux\.css/);
    assert.match(source, /enterprise-dialogs\.css/);
  }
  assert.match(main, /enterprise-dashboard\.css/);
  assert.doesNotMatch(widget, /enterprise-dashboard\.css/);
});
