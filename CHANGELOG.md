# Changelog

All notable user-facing changes to VibeUs are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Added
- Human Review and final-acceptance boundary for AI-assisted delivery.
- Runtime Error Bridge for bringing backend failures into the same task workflow.
- GitHub App-first repository connection and guarded non-production preview delivery.
- English and Russian shipping UI.
- Browser E2E release journeys and migration/runtime regression coverage.

### Changed
- Public project documentation now focuses on the product workflow, architecture and reproducible testing rather than internal launch/operator notes.
- Founder/business operating surfaces are separated from the public customer runtime.

### Security
- Public widget credentials are separated from secret API/runtime-ingest credentials.
- Browser-session mutations enforce trusted-origin checks.
- High-risk task criteria can require verification evidence before Review.
- Live Preview is separated from the account origin in production.

## [0.1.0] - 2026-08-27

### Added
- Embeddable visual-feedback widget.
- Point-and-click element context capture.
- Text-selection feedback.
- FastAPI backend with persistent project/task state.
- Node.js CLI with WebSocket synchronization and `.vibus/TASKS_FOR_AI.md`.
- Kanban-style task board.
- Project specification tree.
- Docker Compose self-hosting baseline.
