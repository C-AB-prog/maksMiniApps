// api/bot/webhook.js
import OpenAI from 'openai';
import { ensureSchema } from '../_db.js';
import { getOrCreateUserId } from '../_utils.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN || '';
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function sendMessage(chatId, text) {
  if (!BOT_TOKEN) return;
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  }).catch(() => null);
}

function sysPromptForBot() {
  const now = new Date();
  const todayISO = now.toISOString().slice(0, 10);
  return [
    `Ты — Growth Assistant в Telegram-боте.`,
    `Сегодня ${todayISO}. Отвечай кратко и по делу.`,
    `Ты помогаешь: планировать, разбивать задачи, ставить дедлайны, напоминать.`,
    `Если пользователь просит: “добавь задачу …” — скажи ему сделать это в мини-аппе или напиши формат, который он должен отправить (MVP).`,
    `Не выдумывай, если данных нет.`,
  ].join('\n');
}

export default async function handler(req, res) {
  await ensureSchema();

  if (req.method !== 'POST') return res.status(405).end();
  if (!BOT_TOKEN) return res.status(200).json({ ok: true, skipped: 'BOT_TOKEN missing' });

  try {
    const update = req.body && typeof req.body === 'object' ? req.body : {};
    const msg = update.message || update.edited_message;
    if (!msg?.chat?.id) return res.status(200).json({ ok: true });

    const chatId = msg.chat.id;
    const text = (msg.text || '').toString().trim();
    const tgId = msg.from?.id ? Number(msg.from.id) : null;

    if (!text) {
      await sendMessage(chatId, 'Напиши текстом 🙂');
      return res.status(200).json({ ok: true });
    }

    if (tgId) {
      // создадим пользователя в БД, чтобы дальше можно было связывать
      await getOrCreateUserId(tgId);
    }

    // команды бота
    if (text === '/start') {
      await sendMessage(
        chatId,
        `Привет! Я Growth Assistant.\n\n` +
        `Могу помочь составить план, разобрать задачу на шаги, подсказать приоритеты.\n` +
        `Чтобы управлять задачами (создать/закрыть/команды) — используй мини-аппу.`
      );
      return res.status(200).json({ ok: true });
    }

    const resp = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.35,
      messages: [
        { role: 'system', content: sysPromptForBot() },
        { role: 'user', content: text },
      ],
    });

    const answer = (resp.choices?.[0]?.message?.content || '').trim() || 'Ок. Давай уточним: что именно нужно получить?';
    await sendMessage(chatId, answer);

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[bot/webhook] error', e);
    return res.status(200).json({ ok: true });
  }
}
