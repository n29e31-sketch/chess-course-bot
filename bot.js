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
const bot = new TelegramBot(TOKEN, { polling: true });

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

bot.on('document', async (msg) => {
  const chatId = msg.chat.id;
  const file = msg.document;

  if (!file.file_name?.toLowerCase().endsWith('.pgn')) {
    return bot.sendMessage(chatId, "❌ Solo acepto archivos .pgn");
  }

  // Guardar nombre original del PGN (sin timestamp)
  const originalName = file.file_name;

  let statusMsg = await bot.sendMessage(chatId, "📥 Recibí tu PGN. Generando curso...");

  try {
    // Archivo temporal con timestamp para evitar colisiones
    const filePath = path.join(TEMP_DIR, `${Date.now()}-${originalName}`);
    const fileStream = await bot.getFileStream(file.file_id);
    const writeStream = (await import('node:fs')).createWriteStream(filePath);

    fileStream.pipe(writeStream);
    await new Promise(r => writeStream.on('finish', r));

    const sessionId = Date.now().toString(36);
    // Guardamos ruta Y nombre original
    sessions.set(sessionId, { filePath, originalName });
    setTimeout(() => sessions.delete(sessionId), 10 * 60 * 1000);

    // Editar el mensaje anterior en vez de mandar uno nuevo
    await bot.editMessageText("Elige el tipo de curso:", {
      chat_id: chatId,
      message_id: statusMsg.message_id,
      reply_markup: {
        inline_keyboard: [
          [{ text: "⚡ Versión Ligera", callback_data: `light|${sessionId}` }],
          [{ text: "🌟 Versión Completa (Pesada)", callback_data: `heavy|${sessionId}` }]
        ]
      }
    });

  } catch (err) {
    console.error(err);
    bot.editMessageText("❌ Error al descargar el archivo.", {
      chat_id: chatId,
      message_id: statusMsg.message_id
    });
  }
});

bot.on('callback_query', async (query) => {
  const [mode, sessionId] = query.data.split('|');
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;

  await bot.answerCallbackQuery(query.id, { text: "Generando curso..." });

  const session = sessions.get(sessionId);
  if (!session) {
    return bot.editMessageText("❌ Sesión expirada. Vuelve a enviar el archivo .pgn", {
      chat_id: chatId,
      message_id: messageId
    });
  }

  const { filePath: pgnPath, originalName } = session;

  // Editar el mensaje de botones con el estado actual
  await bot.editMessageText(`🔄 Generando versión ${mode === 'light' ? 'Ligera ⚡' : 'Completa 🌟'}...`, {
    chat_id: chatId,
    message_id: messageId
  });

  try {
    const templateFile = mode === 'light' ? 'course-template-light.html' : 'course-template-heavy.html';
    const templatePath = path.join(__dirname, templateFile);
    const generateScript = path.join(__dirname, 'generate-course.mjs');

    // ✅ Nombre del HTML = mismo nombre del PGN, sin timestamp
    const outputName = originalName.replace(/\.pgn$/i, '.html');
    const outPath = path.join(TEMP_DIR, outputName);

    const command = `node "${generateScript}" --pgn "${pgnPath}" --template "${templatePath}" --out "${outPath}"`;
    await execAsync(command, { cwd: __dirname });

    // Borrar el mensaje de estado antes de enviar el archivo
    await bot.deleteMessage(chatId, messageId).catch(() => {});

    await bot.sendDocument(chatId, outPath, {
      caption: `✅ ${outputName}`
    });

    sessions.delete(sessionId);
    await fs.unlink(pgnPath).catch(() => {});
    await fs.unlink(outPath).catch(() => {});

  } catch (err) {
    console.error(err);
    bot.editMessageText(`❌ Error al generar el curso:\n${err.message}`, {
      chat_id: chatId,
      message_id: messageId
    });
  }
});
