// utils.js (фрагмент: общий fetch с tg_id)

// Берём числовой Telegram ID из Mini App
export function getTgId() {
  const tg = window.Telegram?.WebApp?.initDataUnsafe?.user?.id;
  if (tg) return Number(tg);        // всегда число
  // запасной вариант (например, в браузере вне Telegram — для локального теста)
  const fromLS = localStorage.getItem('tg_id');
  if (fromLS) return Number(fromLS);
  return null; // пусть backend отвалится 400 — так быстрее заметим
}

// Единая обёртка для запросов
export async function api(path, { method = 'GET', body, headers = {} } = {}) {
  const tgId = getTgId();
  const h = {
    'Content-Type': 'application/json',
    'x-tg-id': tgId != null ? String(tgId) : '',
    ...headers,
  };
  const res = await fetch(path, {
    method,
    headers: h,
    body: body ? JSON.stringify({ tg_id: tgId, ...body }) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

// Примеры использования:
// await api('/api/focus', { method: 'POST', body: { text } });
// await api('/api/tasks', { method: 'POST', body: { title, due_ts } });
