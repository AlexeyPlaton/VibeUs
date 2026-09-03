import os
import logging
import httpx
from typing import Optional, Dict, Any, List
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

import models

logger = logging.getLogger("vibus.github")

GITHUB_API_BASE = "https://api.github.com"

async def test_github_connection(repo: str, token: str) -> Dict[str, Any]:
    """
    Validate that the repository exists and the token has permission to access it.
    """
    repo = repo.strip().strip("/")
    if "/" not in repo:
        return {"ok": False, "message": "Формат репозитория должен быть 'owner/repo' (например, 'octocat/Hello-World')"}
    
    headers = {
        "Authorization": f"Bearer {token.strip()}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "Vibus-Sync-Agent/1.0"
    }
    
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(f"{GITHUB_API_BASE}/repos/{repo}", headers=headers)
            if resp.status_code == 200:
                data = resp.json()
                return {
                    "ok": True,
                    "repo_name": data.get("full_name"),
                    "private": data.get("private", False),
                    "open_issues_count": data.get("open_issues_count", 0),
                    "message": f"Подключение успешно! Репозиторий: {data.get('full_name')}"
                }
            elif resp.status_code == 401:
                return {"ok": False, "message": "Неверный GitHub Personal Access Token (401 Unauthorized)"}
            elif resp.status_code == 404:
                return {"ok": False, "message": f"Репозиторий '{repo}' не найден или нет прав доступа (404 Not Found)"}
            else:
                return {"ok": False, "message": f"Ошибка GitHub API ({resp.status_code}): {resp.text}"}
    except Exception as e:
        logger.error(f"GitHub test connection error: {e}")
        return {"ok": False, "message": f"Сетевая ошибка при обращении к GitHub: {str(e)}"}

async def create_github_issue_for_ticket(
    repo: str,
    token: str,
    ticket: models.SpecTicket,
    project_slug: str,
    node_title: str = "",
    base_url: str = "https://vibeus.pro"
) -> Dict[str, Any]:
    """
    Create a GitHub Issue from a Vibus SpecTicket.
    """
    repo = repo.strip().strip("/")
    headers = {
        "Authorization": f"Bearer {token.strip()}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "Vibus-Sync-Agent/1.0"
    }
    
    # Priority badge emoji
    priority_emoji = {
        "critical": "🚨 CRITICAL",
        "high": "🔥 HIGH",
        "medium": "⚡ MEDIUM",
        "low": "🟢 LOW"
    }.get(ticket.priority.lower(), ticket.priority.upper())
    
    # Format Body in rich GitHub Flavored Markdown
    body_parts = []
    body_parts.append(f"### 📍 Vibus Ticket: `{ticket.key or ticket.id[:8]}`")
    body_parts.append(f"**Section / Feature:** {node_title or 'General'}")
    body_parts.append(f"**Priority:** {priority_emoji} | **Status:** `{ticket.status}`")
    if ticket.assignee:
        body_parts.append(f"**Assignee:** {ticket.assignee}")
    body_parts.append("")
    
    if ticket.summary:
        body_parts.append("#### 📝 Description")
        body_parts.append(ticket.summary)
        body_parts.append("")
        
    if ticket.source_quote:
        body_parts.append("#### 💬 Source Quote / Context")
        body_parts.append(f"> {ticket.source_quote}")
        body_parts.append("")

    # Bug context snapshot if available
    bug_ctx = ticket.bug_context or {}
    if bug_ctx:
        body_parts.append("#### 🔍 Inspector Snapshot")
        if bug_ctx.get("selector"):
            body_parts.append(f"- **DOM Selector:** `{bug_ctx.get('selector')}`")
        if bug_ctx.get("url"):
            body_parts.append(f"- **Page URL:** {bug_ctx.get('url')}")
        if bug_ctx.get("tagName"):
            body_parts.append(f"- **Element:** `<{bug_ctx.get('tagName').lower()}>`")
        if bug_ctx.get("screenSize"):
            body_parts.append(f"- **Viewport:** `{bug_ctx.get('screenSize')}`")
        if bug_ctx.get("userAgent"):
            body_parts.append(f"- **User Agent:** `{bug_ctx.get('userAgent')}`")
        body_parts.append("")

    # Checklists
    checklists = ticket.checklists or {}
    if checklists:
        items = checklists.get("items", [])
        if items:
            body_parts.append("#### ✅ Definition of Done")
            for it in items:
                checked = "x" if it.get("completed") else " "
                body_parts.append(f"- [{checked}] {it.get('text', '')}")
            body_parts.append("")

    # Direct links back to Vibus
    vibus_link = f"{base_url}/#project={project_slug}&ticket={ticket.id}"
    body_parts.append("---")
    body_parts.append(f"🔗 *Reported via [Vibus Visual Feedback]({vibus_link})*")
    
    payload = {
        "title": f"[{ticket.key or 'VB'}] {ticket.title}",
        "body": "\n".join(body_parts),
        "labels": ["vibus", f"priority:{ticket.priority.lower()}"]
    }
    
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(f"{GITHUB_API_BASE}/repos/{repo}/issues", json=payload, headers=headers)
            if resp.status_code in (200, 201):
                issue_data = resp.json()
                return {
                    "ok": True,
                    "issue_url": issue_data.get("html_url"),
                    "issue_number": issue_data.get("number"),
                    "issue_id": issue_data.get("id")
                }
            else:
                logger.error(f"GitHub issue creation failed [{resp.status_code}]: {resp.text}")
                return {"ok": False, "message": f"GitHub API error ({resp.status_code}): {resp.text}"}
    except Exception as e:
        logger.error(f"Error creating GitHub issue: {e}")
        return {"ok": False, "message": str(e)}

async def sync_project_tickets_to_github(
    db: AsyncSession,
    project: models.Project,
    base_url: str = "https://vibeus.pro"
) -> Dict[str, Any]:
    """
    Find all tickets without github_issue_url and create issues for them on GitHub.
    """
    if not project.github_repo or not project.github_token:
        return {"ok": False, "message": "GitHub repository and token must be configured"}
    
    # Query all active tickets in this project
    query = (
        select(models.SpecTicket, models.SpecNode)
        .join(models.SpecNode, models.SpecTicket.node_id == models.SpecNode.id)
        .where(
            models.SpecNode.project_id == project.id,
            models.SpecTicket.is_deleted == False,
            models.SpecTicket.github_issue_url == None
        )
    )
    result = await db.execute(query)
    rows = result.all()
    
    synced_issues = []
    errors = []
    
    for ticket, node in rows:
        res = await create_github_issue_for_ticket(
            repo=project.github_repo,
            token=project.github_token,
            ticket=ticket,
            project_slug=project.slug,
            node_title=node.title if node else "General",
            base_url=base_url
        )
        if res.get("ok"):
            ticket.github_issue_url = res.get("issue_url")
            ticket.github_issue_number = res.get("issue_number")
            synced_issues.append({
                "ticket_id": ticket.id,
                "ticket_key": ticket.key,
                "title": ticket.title,
                "github_url": res.get("issue_url"),
                "github_number": res.get("issue_number")
            })
        else:
            errors.append({
                "ticket_id": ticket.id,
                "error": res.get("message")
            })
            
    if synced_issues:
        await db.commit()
        
    return {
        "ok": True,
        "synced_count": len(synced_issues),
        "issues": synced_issues,
        "errors": errors
    }
