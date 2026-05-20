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

// ✅ Mini servidor HTTP para que Render no mate el servicio
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

  try {
    await bot.sendMessage(chatId, "📥 Recibí tu PGN. Generando curso...");

    const filePath = path.join(TEMP_DIR, `${Date.now()}-${file.file_name}`);
    const fileStream = await bot.getFileStream(file.file_id);
    const writeStream = (await import('node:fs')).createWriteStream(filePath);

    fileStream.pipe(writeStream);
    await new Promise(r => writeStream.on('finish', r));

    const sessionId = Date.now().toString(36);
    sessions.set(sessionId, filePath);
    setTimeout(() => sessions.delete(sessionId), 10 * 60 * 1000);

    const opts = {
      reply_markup: {
        inline_keyboard: [
          [{ text: "⚡ Versión Ligera", callback_data: `light|${sessionId}` }],
          [{ text: "🌟 Versión Completa (Pesada)", callback_data: `heavy|${sessionId}` }]
        ]
      }
    };

    await bot.sendMessage(chatId, "Elige el tipo de curso:", opts);
  } catch (err) {
    console.error(err);
    bot.sendMessage(chatId, "❌ Error al descargar el archivo.");
  }
});

bot.on('callback_query', async (query) => {
  const [mode, sessionId] = query.data.split('|');
  const chatId = query.message.chat.id;

  await bot.answerCallbackQuery(query.id, { text: "Generando curso..." });

  const pgnPath = sessions.get(sessionId);
  if (!pgnPath) {
    return bot.sendMessage(chatId, "❌ Sesión expirada. Vuelve a enviar el archivo .pgn");
  }

  await bot.sendMessage(chatId, `🔄 Generando versión ${mode === 'light' ? 'Ligera' : 'Completa'}...`);

  try {
    const templateFile = mode === 'light' ? 'course-template-light.html' : 'course-template-heavy.html';
    const templatePath = path.join(__dirname, templateFile);
    const generateScript = path.join(__dirname, 'generate-course.mjs');

    const outputName = path.basename(pgnPath, '.pgn') + '.html';
    const outPath = path.join(TEMP_DIR, outputName);

    const command = `node "${generateScript}" --pgn "${pgnPath}" --template "${templatePath}" --out "${outPath}"`;
    await execAsync(command, { cwd: __dirname });

    await bot.sendDocument(chatId, outPath, {
      caption: `✅ ¡Curso generado!\nModo: ${mode === 'light' ? 'Ligera ⚡' : 'Completa 🌟'}`
    });

    sessions.delete(sessionId);
    await fs.unlink(pgnPath).catch(() => {});
    await fs.unlink(outPath).catch(() => {});

  } catch (err) {
    console.error(err);
    bot.sendMessage(chatId, `❌ Error al generar el curso:\n${err.message}`);
  }
});
