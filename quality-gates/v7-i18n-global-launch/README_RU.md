# VibeUs Quality Gate V7 — Internationalization & Global Launch Closure

V7 фиксирует shipping-контракт локализации перед международным запуском.

## Инварианты

- English (`en`) — canonical/default/fallback locale.
- Russian (`ru`) — полностью поддерживаемая locale с точным key parity относительно EN.
- `zh.json` и `hi.json` не удаляются, но не публикуются в runtime/switcher, пока не достигнут 100% parity и human LQA.
- Язык интерфейса не определяет billing market. RUB/YooKassa и global pricing остаются отдельным deployment/business выбором.
- Пользовательский текст не должен хардкодиться в TS/TSX. Кириллица в production source разрешена только в узком compatibility allowlist: legacy titles/regex, parser markers и поддержка Unicode slug.
- Статические `t()/t18n()/tr()/i18n.t()` ключи обязаны существовать одновременно в EN и RU и не должны быть кириллическими идентификаторами.
- Landing, create-project, dashboard, legal navigation, Runtime Errors, onboarding, Settings и DoD Manager обязаны быть подключены к V7 i18n.
- Английская навигация legal center не превращает российские юридические документы в международные Terms. Юридически значимые global Terms/Privacy/DPA должны выпускаться отдельно после определения реального merchant/data-region/payment контура.

## Запуск

```bash
python quality-gates/v7-i18n-global-launch/verify_i18n_global_launch.py .
node --test quality-gates/v7-i18n-global-launch/tests-js/i18n_contract.test.mjs
```
