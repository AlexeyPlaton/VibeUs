import os
import httpx
import logging
from typing import List, Dict, Optional

logger = logging.getLogger('vibus.telegram')

BOT_TOKEN = os.getenv('TELEGRAM_BOT_TOKEN', '')
TELEGRAM_API_URL = f"https://api.telegram.org/bot{BOT_TOKEN}" if BOT_TOKEN else ""

async def send_telegram_message(chat_id: str | int, text: str, reply_markup: Optional[dict] = None) -> bool:
    if not BOT_TOKEN or not chat_id:
        logger.info(f"[TG MOCK] To {chat_id}: {text}")
        return True
        
    try:
        payload = {
            "chat_id": chat_id,
            "text": text,
            "parse_mode": "HTML",
            "disable_web_page_preview": True
        }
        if reply_markup:
            payload["reply_markup"] = reply_markup

        async with httpx.AsyncClient(timeout=5.0) as client:
            res = await client.post(f"{TELEGRAM_API_URL}/sendMessage", json=payload)
            return res.status_code == 200
    except Exception as e:
        logger.error(f"Failed to send Telegram message to {chat_id}: {e}")
        return False

async def notify_subscribers_on_new_ticket(
    subscribers: List[Dict],
    project_slug: str,
    title: str,
    node_title: str,
    priority: str,
    summary: str,
    group_chat: Optional[Dict] = None
):
    msg = (
        f"📝 <b>[Vibus • Новая задача]</b>\n\n"
        f"Проект: <code>{project_slug}</code>\n"
        f"Раздел: <b>{node_title}</b>\n"
        f"Задача: <b>{title}</b> (Приоритет: {priority})\n"
    )
    if summary:
        msg += f"Описание: <blockquote>{summary}</blockquote>\n"

    for sub in (subscribers or []):
        chat_id = sub.get('tg_chat_id')
        if chat_id:
            await send_telegram_message(chat_id, msg)

    if group_chat and group_chat.get('chat_id'):
        await send_telegram_message(group_chat.get('chat_id'), msg)

async def notify_subscribers_on_ticket_status(
    subscribers: List[Dict],
    project_slug: str,
    ticket: Dict,
    old_status: str,
    new_status: str,
    group_chat: Optional[Dict] = None
):
    if old_status == new_status:
        return

    ticket_id = ticket.get('id', '')
    title = ticket.get('title', '')
    assignee = ticket.get('assignee', '')
    rework = ticket.get('rework_notes', '')

    # 1. Personal subscriber notifications
    for sub in (subscribers or []):
        chat_id = sub.get('tg_chat_id')
        role = sub.get('role', 'client')
        if not chat_id:
            continue

        if new_status == 'review':
            msg = (
                f"🎯 <b>[Vibus • Приемка задачи]</b>\n\n"
                f"Проект: <code>{project_slug}</code>\n"
                f"Задача: <b>{ticket_id}: {title}</b>\n"
                f"Статус: <b>🔍 Готово к проверке (QA)</b>\n\n"
                f"<i>ИИ выполнил критерии Definition of Done. Пожалуйста, проверьте результат!</i>"
            )
            keyboard = {
                "inline_keyboard": [
                  [
                    {"text": "✅ Принять (Готово)", "callback_data": f"accept:{project_slug}:{ticket_id}"},
                    {"text": "⚠️ На доработку", "callback_data": f"rework:{project_slug}:{ticket_id}"}
                  ]
                ]
            }
            await send_telegram_message(chat_id, msg, keyboard)

        elif new_status == 'in_progress' and rework:
            msg = (
                f"⚠️ <b>[Vibus • Возврат на доработку]</b>\n\n"
                f"Проект: <code>{project_slug}</code>\n"
                f"Задача: <b>{ticket_id}: {title}</b>\n"
                f"Замечания:\n"
                f"<blockquote>{rework}</blockquote>\n\n"
                f"<i>ИИ в IDE уже получил эти замечания в TASKS_FOR_AI.md.</i>"
            )
            await send_telegram_message(chat_id, msg)

        elif new_status == 'done':
            msg = (
                f"✅ <b>[Vibus • Задача принята!]</b>\n\n"
                f"Проект: <code>{project_slug}</code>\n"
                f"Задача: <b>{ticket_id}: {title}</b> переведена в <b>Готово 🎉</b>"
            )
            await send_telegram_message(chat_id, msg)

    # 2. Corporate Group Chat / Channel Categorized Broadcast
    if group_chat and group_chat.get('chat_id'):
        group_id = group_chat.get('chat_id')
        if new_status == 'review' and group_chat.get('notify_review', True):
            group_msg = (
                f"🚀 <b>[QA & ДЕПЛОЙ • {project_slug.upper()}]</b>\n"
                f"Задача <b>{ticket_id}: {title}</b> готова к тестированию! 🔍\n"
                f"<i>Исполнитель: {assignee or 'ИИ'}</i>"
            )
            await send_telegram_message(group_id, group_msg)

        elif new_status == 'in_progress' and rework and group_chat.get('notify_rework', True):
            group_msg = (
                f"⚠️ <b>[БАГ-РЕПОРТ • {project_slug.upper()}]</b>\n"
                f"Задача <b>{ticket_id}: {title}</b> возвращена на доработку:\n"
                f"<blockquote>{rework}</blockquote>"
            )
            await send_telegram_message(group_id, group_msg)

        elif new_status == 'done':
            group_msg = (
                f"🎉 <b>[УСПЕХ • {project_slug.upper()}]</b>\n"
                f"Задача <b>{ticket_id}: {title}</b> успешно принята и закрыта!"
            )
            await send_telegram_message(group_id, group_msg)

async def notify_new_public_feedback(
    subscribers: List[Dict], 
    project_slug: str, 
    feedback: Dict, 
    group_chat: Optional[Dict] = None
):
    text = feedback.get('text', '')
    quote = feedback.get('quote', '')
    author = feedback.get('author', 'Посетитель')
    contact = feedback.get('contact', '')

    msg = (
        f"📥 <b>[Vibus • Новый отзыв от тестера / Product Hunt]</b>\n\n"
        f"Проект: <code>{project_slug}</code>\n"
        f"Автор: <b>{author}</b> {f'({contact})' if contact else ''}\n"
    )
    if quote:
        msg += f"Фрагмент на сайте: <i>\"{quote}\"</i>\n"
    msg += f"Отзыв: <blockquote>{text}</blockquote>\n\n<i>Отзыв доступен во вкладке «Отзывы» виджета.</i>"

    # Send to subscribers
    for sub in (subscribers or []):
        chat_id = sub.get('tg_chat_id')
        if chat_id:
            await send_telegram_message(chat_id, msg)

    # Send to Corporate Group Chat
    if group_chat and group_chat.get('chat_id') and group_chat.get('notify_feedback', True):
        await send_telegram_message(group_chat.get('chat_id'), msg)
