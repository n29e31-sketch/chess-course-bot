import TelegramBot from 'node-telegram-bot-api';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import http from 'node:http';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TOKEN = process.env.BOT_TOKEN;

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
console.log('🤖 Bot de Cursos de Ajedrez iniciado...');

// ─── Textos ───────────────────────────────────────────────────────────────────

const WELCOME_TEXT = `♟️ *Bienvenido al Chess Course Bot*

Convierte archivos PGN en cursos interactivos de ajedrez en formato HTML.

Envíame un archivo *.pgn* y elige el tipo de curso que deseas generar.

Usa /help para ver todas las funcionalidades.`;

const HELP_TEXT = `ℹ️ *¿Cómo funciona el bot?*

*1. Envía un archivo PGN*
Adjunta cualquier archivo \`.pgn\` (partidas, aperturas, análisis) y el bot lo procesará automáticamente.

*2. Elige el tipo de curso*
Tendrás 3 opciones:

⚡ *Versión Ligera*
HTML de ~250kb. Ideal para compartir y uso en móvil. Sin tema de tablero especial.

🌟 *Versión Completa*
HTML de ~5.7mb. Incluye el tema de tablero CB Teca con mayor detalle visual.

⬇️ *Con descarga PGN*
Versión ligera que incluye un botón para descargar el PGN original desde el propio HTML.

*3. Recibe tu HTML*
El bot genera el archivo y te lo entrega listo para abrir en cualquier navegador, sin internet.

*Límites*
• Sesión activa por 10 minutos tras enviar el PGN
• Archivos de hasta 20MB (límite de Telegram)`;

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
          [{ text: "⚡ Versión Ligera",       callback_data: `light|${sessionId}` }],
          [{ text: "🌟 Versión Completa",      callback_data: `heavy|${sessionId}` }],
          [{ text: "⬇️ Con descarga PGN",     callback_data: `pgn|${sessionId}`   }],
          [{ text: "❌ Cancelar",              callback_data: `cancel|${sessionId}`}]
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

// ─── Callbacks ────────────────────────────────────────────────────────────────

bot.on('callback_query', async (query) => {
  const [action, sessionId] = query.data.split('|');
  const chatId   = query.message.chat.id;
  const messageId = query.message.message_id;

  // ── Mostrar help desde /start ──
  if (action === 'show_help') {
    await bot.answerCallbackQuery(query.id);
    await bot.sendMessage(chatId, HELP_TEXT, { parse_mode: 'Markdown' });
    return;
  }

  // ── Cancelar ──
  if (action === 'cancel') {
    await bot.answerCallbackQuery(query.id);
    sessions.delete(sessionId);
    await bot.deleteMessage(chatId, messageId).catch(() => {});
    const cancelMsg = await bot.sendMessage(chatId, "❌ Cancelado");
    setTimeout(() => bot.deleteMessage(chatId, cancelMsg.message_id).catch(() => {}), 3000);
    return;
  }

  // ── Generar curso ──
  await bot.answerCallbackQuery(query.id, { text: "Generando curso..." });

  const session = sessions.get(sessionId);
  if (!session) {
    return bot.editMessageText("❌ Sesión expirada. Vuelve a enviar el archivo .pgn", {
      chat_id: chatId,
      message_id: messageId
    }).catch(() => {});
  }

  const { filePath: pgnPath, originalName } = session;
  const modeLabel = action === 'light' ? 'Ligera ⚡' : action === 'heavy' ? 'Completa 🌟' : 'Con PGN ⬇️';

  await bot.editMessageText(`🔄 Generando versión ${modeLabel}...`, {
    chat_id: chatId,
    message_id: messageId
  });

  try {
    // Seleccionar template y script según modo
    const templateFile  = action === 'heavy'
      ? 'course-template-heavy.html'
      : action === 'pgn'
        ? 'course-template-pgn.html'
        : 'course-template-light.html';

    const scriptFile    = action === 'pgn'
      ? 'generate-course-pgn.mjs'
      : 'generate-course.mjs';

    const templatePath  = path.join(__dirname, templateFile);
    const generateScript = path.join(__dirname, scriptFile);
    const courseName    = originalName.replace(/\.pgn$/i, '');
    const outputName    = originalName.replace(/\.pgn$/i, '.html');
    const outPath       = path.join(TEMP_DIR, outputName);

    const command = `node "${generateScript}" --pgn "${pgnPath}" --template "${templatePath}" --out "${outPath}" --name "${courseName}"`;
    await execAsync(command, { cwd: __dirname });

    await bot.deleteMessage(chatId, messageId).catch(() => {});

    await bot.sendDocument(chatId, outPath, {
      caption: `✅ ${outputName} · ${modeLabel}`
    });

    sessions.delete(sessionId);
    await fs.unlink(pgnPath).catch(() => {});
    await fs.unlink(outPath).catch(() => {});

  } catch (err) {
    console.error(err);
    bot.editMessageText(`❌ Error al generar el curso:\n${err.message}`, {
      chat_id: chatId,
      message_id: messageId
    }).catch(() => {});
  }
});
