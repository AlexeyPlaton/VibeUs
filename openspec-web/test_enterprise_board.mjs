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

test('authenticated project board is a full workspace with persistent theme switch', () => {
  const modal = read('src/components/ProjectBoardModal.tsx');
  assert.match(modal, /vibus_board_theme/);
  assert.match(modal, /prefers-color-scheme:\s*dark/);
  assert.match(modal, /vibe-enterprise-shell/);
  assert.match(modal, /vibe-theme-\$\{appearance\}/);
  assert.match(modal, /theme=\{appearance\}/);
  assert.match(modal, /switch_to_light/);
  assert.match(modal, /switch_to_dark/);
});

test('standalone widget supports auto light-dark theming without hard-coded dark root', () => {
  const widget = read('src/widget.tsx');
  assert.match(widget, /resolveTheme/);
  assert.match(widget, /vibe-theme-\$\{theme\}/);
  assert.match(widget, /prefers-color-scheme:\s*dark/);
  assert.match(widget, /data-vibus-root/);
  assert.match(widget, /data-vibus-style/);
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

test('enterprise board and dialog stylesheets are loaded in app and widget builds', () => {
  const main = read('src/main.tsx');
  const widget = read('src/widget.tsx');
  for (const source of [main, widget]) {
    assert.match(source, /enterprise-board\.css/);
    assert.match(source, /enterprise-dialogs\.css/);
  }
});
