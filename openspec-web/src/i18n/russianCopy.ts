type CopyValue = string | number | boolean | null | CopyValue[] | { [key: string]: CopyValue };

const REPLACEMENTS: Array<[RegExp, string]> = [
  [/Runtime Error Tracking/gi, 'отслеживание сбоев сервера'],
  [/Runtime Error Bridge/gi, 'перехват сбоев сервера'],
  [/Runtime Ingest Key/gi, 'ключ приёма ошибок'],
  [/Public Widget Key/gi, 'открытый ключ виджета'],
  [/Founding Access/gi, 'доступ для первых пользователей'],
  [/International billing/gi, 'международная оплата'],
  [/Definition of Done/gi, 'критерии готовности'],
  [/Live Preview/gi, 'живой предпросмотр'],
  [/Self[- ]Hosted/gi, 'самостоятельное размещение'],
  [/Open[- ]Source/gi, 'открытый исходный код'],
  [/Call Stack/gi, 'стек вызовов'],
  [/Edge cases/gi, 'граничные случаи'],
  [/IDE-мост/gi, 'связь со средой разработки'],
  [/AI[- ]агент/gi, 'ИИ-агент'],
  [/AI[- ]разработчик/gi, 'ИИ-разработчик'],
  [/AI-задач/gi, 'задач для ИИ'],
  [/AI-задачи/gi, 'задачи для ИИ'],
  [/Runtime Bridge/gi, 'перехват сбоев сервера'],
  [/Ingest Key/gi, 'ключ приёма ошибок'],
  [/Public Key/gi, 'открытый ключ'],
  [/API Token/gi, 'токен API'],
  [/Zero[- ]Friction/gi, 'без лишних шагов'],
  [/Tab Auto-completion/gi, 'автодополнение по Tab'],
  [/BYOK/gi, 'с собственным ключом API'],
  [/\bworkspace\b/gi, 'рабочее пространство'],
  [/\bdigest\b/gi, 'хэш'],
  [/\bdeployment\b/gi, 'развёртывание'],
  [/\bworkflow\b/gi, 'процесс работы'],
  [/\bfeedback\b/gi, 'обратная связь'],
  [/\bBackend\b/g, 'Серверная часть'],
  [/\bbackend\b/g, 'серверная часть'],
  [/\bFrontend\b/g, 'Интерфейс'],
  [/\bfrontend\b/g, 'интерфейс'],
  [/\bReview\b/g, 'Приёмка'],
  [/\breview\b/g, 'приёмка'],
  [/\bRuntime\b/g, 'Сбои сервера'],
  [/\bruntime\b/g, 'сбои сервера'],
  [/\bAI\b/g, 'ИИ'],
  [/\bIDE\b/g, 'среда разработки'],
  [/\bCLI\b/g, 'командная утилита'],
  [/\bQA\b/g, 'тестирование'],
  [/\bLow\b/g, 'низкий'],
  [/\bMedium\b/g, 'средний'],
  [/\bHigh\b/g, 'высокий'],
  [/\bTraceback\b/g, 'стек ошибки'],
  [/\bPayload\b/g, 'данные'],
  [/\bTTL\b/g, 'срок действия'],
];

const PHRASE_REPLACEMENTS: Array<[string, string]> = [
  ['UI / UX', 'интерфейс и удобство'],
  ['UI / Дизайн', 'интерфейс и дизайн'],
  ['UI / Вёрстка', 'интерфейс и вёрстка'],
  ['UI (Интерфейс)', 'интерфейс'],
  ['UI баг', 'ошибка интерфейса'],
  ['Баг UI', 'Ошибка интерфейса'],
  ['баг-репорт', 'сообщение об ошибке'],
  ['Баг-репорт', 'Сообщение об ошибке'],
  ['баг-репорты', 'сообщения об ошибках'],
  ['Баг-репорты', 'Сообщения об ошибках'],
  ['готово к тестирование', 'готово к проверке'],
  ['Готово к тестирование', 'Готово к проверке'],
  ['для тестирование', 'для проверки'],
  ['Тестировщик / тестирование', 'Тестировщик'],
  ['Приемка / тестирование', 'Приёмка и тестирование'],
  ['Приёмка / тестирование', 'Приёмка и тестирование'],
  ['серверная часть / API / 500', 'сервер / API / ошибка 500'],
  ['Серверная часть / API / 500', 'Сервер / API / ошибка 500'],
  ['серверная часть API', 'серверный API'],
  ['Серверная часть API', 'Серверный API'],
  ['JSON данные', 'данные JSON'],
  ['request ID', 'номер запроса'],
  ['Request ID', 'номер запроса'],
  ['viewport', 'размер экрана'],
  ['Viewport', 'Размер экрана'],
  ['checkout_url', 'ссылка на оплату'],
  ['confirmation_url', 'ссылка для оплаты'],
];

export function polishRussianString(value: string): string {
  let result = value;
  for (const [pattern, replacement] of REPLACEMENTS) {
    result = result.replace(pattern, replacement);
  }
  for (const [source, replacement] of PHRASE_REPLACEMENTS) {
    result = result.split(source).join(replacement);
  }
  return result;
}

export function polishRussianCopy<T extends CopyValue>(value: T): T {
  if (typeof value === 'string') return polishRussianString(value) as T;
  if (Array.isArray(value)) return value.map((item) => polishRussianCopy(item)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, polishRussianCopy(nested)]),
    ) as T;
  }
  return value;
}
