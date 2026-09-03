# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-08-27

### Added
- **Widget**: Embeddable Web Component for reporting bugs directly from websites.
- **DOM Inspector**: Precise point-and-click bug reporting with automatic DOM context capture.
- **Text Selection**: Ability to highlight text to report typos and content issues.
- **Backend**: FastAPI-based server with PostgreSQL for state management.
- **CLI Bridge**: Node.js CLI daemon to sync issues via WebSocket to local IDEs (`TASKS_FOR_AI.md`).
- **Telegram Integration**: Real-time notifications for new issues and QA status changes.
- **i18n**: Multi-language support (English, Russian, Chinese, Hindi).
- **Kanban Board**: Built-in dashboard for managing the issue lifecycle (Open -> QA Review -> Done).
- **Spec Tree**: Hierarchical project specification management.
- **Docker Support**: Ready-to-use Docker Compose configuration for easy self-hosting.
