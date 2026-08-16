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
Adjunta cualquier archivo \`.pgn\` y el bot lo procesará automáticamente.

*2. Elige el tipo de curso*
Tendrás 4 opciones:

⚡ *Versión Ligera*
HTML de ~250kb. Ideal para compartir y uso en móvil.

🌟 *Versión Completa*
HTML de ~5.7mb. Incluye el tema de tablero CB Teca.

⬇️ *Con descarga PGN*
Versión ligera que incluye un botón para descargar el PGN original.

🔮 *Constelación*
Visor interactivo 3D con grafo de partidas, constelación estratégica temática y acceso a 101 Chess Tips. Requiere más tiempo de procesamiento.

*3. Recibe tu HTML*
El bot genera el archivo y te lo entrega listo para abrir en cualquier navegador, sin internet.

*Atajos en el HTML de Constelación:*
  K → Constelación estratégica
  ? → 101 Chess Tips

*Límites:*
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
          [{ text: "🔮 Constelación",          callback_data: `sphere|${sessionId}`}],
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
  const chatId    = query.message.chat.id;
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

  const modeLabel = {
    light:  'Ligera ⚡',
    heavy:  'Completa 🌟',
    pgn:    'Con PGN ⬇️',
    sphere: 'Constelación 🔮'
  }[action] || action;

  // La constelación tarda más — aviso especial
  const waitMsg = action === 'sphere'
    ? `🔮 Generando Constelación...\n_Esto puede tardar 1-2 minutos, por favor espera._`
    : `🔄 Generando versión ${modeLabel}...`;

  await bot.editMessageText(waitMsg, {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: 'Markdown'
  });

  try {
    // Seleccionar template y script según modo
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
    const outputName     = originalName.replace(/\.pgn$/i, '.html');
    const outPath        = path.join(TEMP_DIR, outputName);

    // Para sphere: también pasar ejes y template explícitamente
    let command;
    if (action === 'sphere') {
      const ejesPath = path.join(__dirname, 'ejes_tematicos_ajedrez_4idiomas.json');
      command = `node "${generateScript}" --pgn "${pgnPath}" --template "${templatePath}" --ejes "${ejesPath}" --out "${outPath}" --name "${courseName}"`;
    } else {
      command = `node "${generateScript}" --pgn "${pgnPath}" --template "${templatePath}" --out "${outPath}" --name "${courseName}"`;
    }

    // Timeout extendido para constelación (3 min) vs normal (90 seg)
    const timeout = action === 'sphere' ? 180000 : 90000;
    await execAsync(command, { cwd: __dirname, timeout });

    await bot.deleteMessage(chatId, messageId).catch(() => {});

    await bot.sendDocument(chatId, outPath, {
      caption: `✅ ${outputName} · ${modeLabel}`
    });

    sessions.delete(sessionId);
    await fs.unlink(pgnPath).catch(() => {});
    await fs.unlink(outPath).catch(() => {});

  } catch (err) {
    console.error(err);
    const errText = err.killed
      ? '❌ Tiempo de espera agotado al generar el curso. El PGN puede ser demasiado grande.'
      : `❌ Error al generar el curso:\n${err.message?.slice(0, 300)}`;
    bot.editMessageText(errText, {
      chat_id: chatId,
      message_id: messageId
    }).catch(() => bot.sendMessage(chatId, errText));
  }
});