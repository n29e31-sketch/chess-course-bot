import TelegramBot from 'node-telegram-bot-api';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import http from 'node:http';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TOKEN = process.env.TOKEN;
const TRADUCTOR_URL = process.env.TRADUCTOR_URL || '';  // URL del servicio traductor en Render

const bot = new TelegramBot(TOKEN, {
  polling: {
    autoStart: true,
    params: { timeout: 10 },
    interval: 2000
  }
});

bot.on('polling_error', (err) => {
  if (err.code === 'ETELEGRAM' && err.message.includes('409')) {
    console.warn('⚠️ Otra instancia detectada, reintentando...');
  } else {
    console.error('polling_error:', err.message);
  }
});

const TEMP_DIR = path.join(__dirname, 'temp');
await fs.mkdir(TEMP_DIR, { recursive: true }).catch(() => {});

const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Bot corriendo');
}).listen(PORT, () => {
  console.log(`🌐 Servidor HTTP en puerto ${PORT}`);
});

const sessions = new Map();
console.log('🤖 Bot de Cursos de Ajedrez iniciado correctamente');

// ─── Idiomas soportados ───────────────────────────────────────────────────────

const LANGS = {
  en: 'Inglés 🇬🇧',
  es: 'Español 🇪🇸',
  ru: 'Русский 🇷🇺'
};

// ─── Textos ───────────────────────────────────────────────────────────────────

const WELCOME_TEXT = `♟️ *Bienvenido al Chess Course Bot*

Convierte archivos PGN en cursos interactivos de ajedrez en formato HTML.

Envíame un archivo *.pgn* y elige el tipo de curso que deseas generar.

Usa /help para ver todas las funcionalidades.`;

const HELP_TEXT = `ℹ️ *¿Cómo funciona el bot?*

*1. Envía un archivo PGN*
Adjunta cualquier archivo \`.pgn\` y el bot lo procesará.

*2. Elige el tipo de curso*
Tendrás 5 opciones:

⚡ *Versión Ligera* — HTML ~250kb, ideal para móvil.
🌟 *Versión Completa* — HTML ~5.7mb, tema CB Teca.
⬇️ *Con descarga PGN* — incluye botón para descargar el PGN.
🔮 *Constelación* — Visor 3D interactivo con 101 Chess Tips.
🌐 *Traducir PGN* — Traduce los comentarios del PGN a otro idioma.

*Atajos en el HTML de Constelación:*
  K → Constelación estratégica
  ? → 101 Chess Tips

*Idiomas disponibles para traducción:*
  🇬🇧 Inglés · 🇪🇸 Español · 🇷🇺 Русский

*Límites:*
• Sesión activa por 10 minutos tras enviar el PGN
• Archivos de hasta 20MB`;

// ─── Comandos ─────────────────────────────────────────────────────────────────

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  await bot.sendMessage(chatId, WELCOME_TEXT, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: 'ℹ️ ¿Cómo funciona?', callback_data: 'show_help' }]
      ]
    }
  });
});

bot.onText(/\/help/, async (msg) => {
  const chatId = msg.chat.id;
  await bot.sendMessage(chatId, HELP_TEXT, { parse_mode: 'Markdown' });
});

// ─── Documento PGN ────────────────────────────────────────────────────────────

bot.on('document', async (msg) => {
  const chatId = msg.chat.id;
  const file = msg.document;

  if (!file.file_name?.toLowerCase().endsWith('.pgn')) {
    return bot.sendMessage(chatId, "❌ Solo acepto archivos .pgn");
  }

  const originalName = file.file_name;
  const statusMsg = await bot.sendMessage(chatId, "📥 Recibí tu PGN...");

  try {
    const filePath = path.join(TEMP_DIR, `${Date.now()}-${originalName}`);
    const fileStream = await bot.getFileStream(file.file_id);
    const writeStream = (await import('node:fs')).createWriteStream(filePath);
    fileStream.pipe(writeStream);
    await new Promise(r => writeStream.on('finish', r));

    const sessionId = Date.now().toString(36);
    sessions.set(sessionId, { filePath, originalName });
    setTimeout(() => sessions.delete(sessionId), 10 * 60 * 1000);

    await bot.editMessageText("Elige el tipo de curso:", {
      chat_id: chatId,
      message_id: statusMsg.message_id,
      reply_markup: {
        inline_keyboard: [
          [{ text: "⚡ Versión Ligera",    callback_data: `light|${sessionId}` }],
          [{ text: "🌟 Versión Completa",  callback_data: `heavy|${sessionId}` }],
          [{ text: "⬇️ Con descarga PGN", callback_data: `pgn|${sessionId}`   }],
          [{ text: "🔮 Constelación",      callback_data: `sphere|${sessionId}`}],
          [{ text: "🌐 Traducir PGN",      callback_data: `tr_start|${sessionId}`}],
          [{ text: "❌ Cancelar",          callback_data: `cancel|${sessionId}`}]
        ]
      }
    });

  } catch (err) {
    console.error(err);
    bot.editMessageText("❌ Error al descargar el archivo.", {
      chat_id: chatId,
      message_id: statusMsg.message_id
    }).catch(() => {});
  }
});

// ─── Helpers de traducción ────────────────────────────────────────────────────

async function fetchJSON(url, opts = {}) {
  const { default: fetch } = await import('node-fetch');
  return fetch(url, opts);
}

async function callTraductor(endpoint, body) {
  const res = await fetchJSON(`${TRADUCTOR_URL}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return res.json();
}

async function pollJob(jobId, chatId, messageId) {
  const { default: fetch } = await import('node-fetch');
  while (true) {
    await new Promise(r => setTimeout(r, 4000));
    const res = await fetch(`${TRADUCTOR_URL}/translate/status/${jobId}`);
    const data = await res.json();

    if (data.status === 'running' || data.status === 'queued') {
      const pct   = data.pct || 0;
      const done  = data.progress || 0;
      const total = data.total || '?';
      const eta   = data.eta_seconds > 0
        ? ` · ETA ${Math.ceil(data.eta_seconds / 60)} min`
        : '';
      await bot.editMessageText(
        `🌐 Traduciendo... ${pct}% (${done}/${total})${eta}`,
        { chat_id: chatId, message_id: messageId }
      ).catch(() => {});
    } else if (data.status === 'done') {
      return { ok: true, pgn: data.pgn };
    } else {
      return { ok: false, error: data.error || 'Error desconocido' };
    }
  }
}

// ─── Callbacks ────────────────────────────────────────────────────────────────

bot.on('callback_query', async (query) => {
  const parts     = query.data.split('|');
  const action    = parts[0];
  const sessionId = parts[1];
  const extra     = parts[2];           // usado para from_lang / to_lang
  const chatId    = query.message.chat.id;
  const messageId = query.message.message_id;

  // ── Help ──────────────────────────────────────────────────────────────────
  if (action === 'show_help') {
    await bot.answerCallbackQuery(query.id);
    await bot.sendMessage(chatId, HELP_TEXT, { parse_mode: 'Markdown' });
    return;
  }

  // ── Cancelar ──────────────────────────────────────────────────────────────
  if (action === 'cancel') {
    await bot.answerCallbackQuery(query.id);
    sessions.delete(sessionId);
    await bot.deleteMessage(chatId, messageId).catch(() => {});
    const m = await bot.sendMessage(chatId, "❌ Cancelado");
    setTimeout(() => bot.deleteMessage(chatId, m.message_id).catch(() => {}), 3000);
    return;
  }

  // ── Traducción: paso 1 — elegir idioma ORIGEN ─────────────────────────────
  if (action === 'tr_start') {
    await bot.answerCallbackQuery(query.id);
    await bot.editMessageText("🌐 *Traducir PGN*\n\n¿En qué idioma están los comentarios?", {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          ...Object.entries(LANGS).map(([code, label]) => ([
            { text: label, callback_data: `tr_from|${sessionId}|${code}` }
          ])),
          [{ text: "❌ Cancelar", callback_data: `cancel|${sessionId}` }]
        ]
      }
    });
    return;
  }

  // ── Traducción: paso 2 — elegir idioma DESTINO ────────────────────────────
  if (action === 'tr_from') {
    const fromLang = extra;
    await bot.answerCallbackQuery(query.id);
    await bot.editMessageText(
      `🌐 *Traducir PGN*\n\nOrigen: *${LANGS[fromLang]}*\n\n¿A qué idioma deseas traducir?`,
      {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            ...Object.entries(LANGS)
              .filter(([code]) => code !== fromLang)
              .map(([code, label]) => ([
                { text: label, callback_data: `tr_do|${sessionId}|${fromLang}_${code}` }
              ])),
            [{ text: "❌ Cancelar", callback_data: `cancel|${sessionId}` }]
          ]
        }
      }
    );
    return;
  }

  // ── Traducción: paso 3 — ejecutar ─────────────────────────────────────────
  if (action === 'tr_do') {
    const [fromLang, toLang] = extra.split('_');
    await bot.answerCallbackQuery(query.id, { text: "Iniciando traducción..." });

    const session = sessions.get(sessionId);
    if (!session) {
      return bot.editMessageText("❌ Sesión expirada. Vuelve a enviar el archivo .pgn", {
        chat_id: chatId, message_id: messageId
      }).catch(() => {});
    }

    if (!TRADUCTOR_URL) {
      return bot.editMessageText("❌ Servicio de traducción no configurado.", {
        chat_id: chatId, message_id: messageId
      }).catch(() => {});
    }

    const { filePath: pgnPath, originalName } = session;

    await bot.editMessageText("🌐 Analizando PGN...", {
      chat_id: chatId, message_id: messageId
    });

    try {
      const pgnText = await fs.readFile(pgnPath, 'utf8');

      // Estimar tamaño
      const est = await callTraductor('/estimate', { pgn: pgnText });
      const games = est.games || 0;
      const chars = est.comment_chars || 0;

      await bot.editMessageText(
        `🌐 *Traduciendo PGN*\n\n` +
        `📊 ${games} partidas · ${chars.toLocaleString()} caracteres\n` +
        `🔤 ${LANGS[fromLang]} → ${LANGS[toLang]}\n\n` +
        `⏳ Iniciando...`,
        { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' }
      );

      let pgn, result;

      if (games <= 50) {
        // Sincrónico para PGN pequeños
        result = await callTraductor('/translate', {
          pgn: pgnText, from_lang: fromLang, to_lang: toLang
        });
        pgn = result.pgn;
      } else {
        // Asíncrono para PGN grandes
        const jobRes = await callTraductor('/translate/async', {
          pgn: pgnText, from_lang: fromLang, to_lang: toLang
        });
        if (jobRes.error) throw new Error(jobRes.error);
        const poll = await pollJob(jobRes.job_id, chatId, messageId);
        if (!poll.ok) throw new Error(poll.error);
        pgn = poll.pgn;
      }

      if (!pgn) throw new Error('La traducción devolvió un resultado vacío.');

      // Guardar y enviar
      const outName = originalName.replace(/\.pgn$/i, '').replace(/_/g, ' ')
        + ` (${fromLang}→${toLang}).pgn`;
      const outPath = path.join(TEMP_DIR, `${Date.now()}-out.pgn`);
      await fs.writeFile(outPath, pgn, 'utf8');

      await bot.deleteMessage(chatId, messageId).catch(() => {});
      await bot.sendDocument(chatId, outPath, {
        caption: `🌐 ${LANGS[fromLang]} → ${LANGS[toLang]}`
      });

      sessions.delete(sessionId);
      await fs.unlink(pgnPath).catch(() => {});
      await fs.unlink(outPath).catch(() => {});

    } catch (err) {
      console.error(err);
      bot.editMessageText(`❌ Error en la traducción:\n${err.message?.slice(0, 300)}`, {
        chat_id: chatId, message_id: messageId
      }).catch(() => {});
    }
    return;
  }

  // ── Generar curso (opciones originales) ───────────────────────────────────
  await bot.answerCallbackQuery(query.id, { text: "Generando curso..." });

  const session = sessions.get(sessionId);
  if (!session) {
    return bot.editMessageText("❌ Sesión expirada. Vuelve a enviar el archivo .pgn", {
      chat_id: chatId, message_id: messageId
    }).catch(() => {});
  }

  const { filePath: pgnPath, originalName } = session;

  const modeLabel = {
    light:  'Ligera ⚡',
    heavy:  'Completa 🌟',
    pgn:    'Con PGN ⬇️',
    sphere: 'Constelación 🔮'
  }[action] || action;

  const waitMsg = action === 'sphere'
    ? `🔮 Generando Constelación...\n_Esto puede tardar 1-2 minutos, por favor espera._`
    : `🔄 Generando versión ${modeLabel}...`;

  await bot.editMessageText(waitMsg, {
    chat_id: chatId, message_id: messageId, parse_mode: 'Markdown'
  });

  try {
    let templateFile, scriptFile;
    if (action === 'sphere') {
      templateFile = '101-chess-tips-v13.html';
      scriptFile   = 'generate-sphere-course.mjs';
    } else if (action === 'heavy') {
      templateFile = 'course-template-heavy.html';
      scriptFile   = 'generate-course.mjs';
    } else if (action === 'pgn') {
      templateFile = 'course-template-pgn.html';
      scriptFile   = 'generate-course-pgn.mjs';
    } else {
      templateFile = 'course-template-light.html';
      scriptFile   = 'generate-course.mjs';
    }

    const templatePath   = path.join(__dirname, templateFile);
    const generateScript = path.join(__dirname, scriptFile);
    const courseName     = originalName.replace(/\.pgn$/i, '');
    const outputName     = originalName.replace(/\.pgn$/i, '').replace(/_/g, ' ') + '.html';
    const outPath        = path.join(TEMP_DIR, outputName);

    let command;
    if (action === 'sphere') {
      const ejesPath = path.join(__dirname, 'ejes_tematicos_ajedrez_4idiomas.json');
      command = `node "${generateScript}" --pgn "${pgnPath}" --template "${templatePath}" --ejes "${ejesPath}" --out "${outPath}" --name "${courseName}"`;
    } else {
      command = `node "${generateScript}" --pgn "${pgnPath}" --template "${templatePath}" --out "${outPath}" --name "${courseName}"`;
    }

    const timeout = action === 'sphere' ? 180000 : 90000;
    await execAsync(command, { cwd: __dirname, timeout });

    await bot.deleteMessage(chatId, messageId).catch(() => {});
    await bot.sendDocument(chatId, outPath, {
      caption: `✅ ${modeLabel}`
    });

    sessions.delete(sessionId);
    await fs.unlink(pgnPath).catch(() => {});
    await fs.unlink(outPath).catch(() => {});

  } catch (err) {
    console.error(err);
    const errText = err.killed
      ? '❌ Tiempo de espera agotado. El PGN puede ser demasiado grande.'
      : `❌ Error al generar el curso:\n${err.message?.slice(0, 300)}`;
    bot.editMessageText(errText, {
      chat_id: chatId, message_id: messageId
    }).catch(() => bot.sendMessage(chatId, errText));
  }
});
