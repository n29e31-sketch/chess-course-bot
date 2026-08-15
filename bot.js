import TelegramBot from 'node-telegram-bot-api';
import fs from 'node:fs/promises';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

// ========== CONFIGURACIÓN ==========
const TOKEN = process.env.TOKEN; // ← Se toma de Render (Environment Variable)

if (!TOKEN) {
  console.error('❌ ERROR: Falta la variable de entorno TOKEN');
  process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });
const TEMP_DIR = './temp';

await fs.mkdir(TEMP_DIR, { recursive: true }).catch(() => {});

console.log('🤖 Bot de Cursos de Ajedrez iniciado correctamente');

// ========== COMANDO /start ==========
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id,
`♟️ *Bot Generador de Cursos de Ajedrez*

Envíame un archivo \`.pgn\` y elige la versión:

⚡ *Versión Ligera* — Rápida y ligera
🌟 *Versión Completa* — Con más funciones
🚀 *Version 13* — Grafo + Constelación temática

Envía el archivo PGN para comenzar.`,
  { parse_mode: 'Markdown' });
});

// ========== RECIBIR ARCHIVO PGN ==========
bot.on('document', async (msg) => {
  const chatId = msg.chat.id;
  const file = msg.document;

  if (!file.file_name?.toLowerCase().endsWith('.pgn')) {
    return bot.sendMessage(chatId, '❌ Solo acepto archivos .pgn');
  }

  try {
    await bot.sendMessage(chatId, '📥 Recibí tu PGN. Procesando...');

    // Nombre limpio (sin espacios raros)
    const safeName = file.file_name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    const filePath = path.join(TEMP_DIR, `${Date.now()}-${safeName}`);

    const fileStream = await bot.getFileStream(file.file_id);
    const writeStream = (await import('node:fs')).createWriteStream(filePath);

    fileStream.pipe(writeStream);
    await new Promise((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });

    const opts = {
      reply_markup: {
        inline_keyboard: [
          [{ text: '⚡ Versión Ligera', callback_data: `light|${filePath}` }],
          [{ text: '🌟 Versión Completa', callback_data: `heavy|${filePath}` }],
          [{ text: '🚀 Version 13', callback_data: `v13|${filePath}` }]
        ]
      }
    };

    await bot.sendMessage(chatId, 'Elige el tipo de curso HTML:', opts);

  } catch (err) {
    console.error('Error al descargar PGN:', err);
    bot.sendMessage(chatId, '❌ Error al descargar el archivo.');
  }
});

// ========== GENERAR CURSO ==========
bot.on('callback_query', async (query) => {
  const [mode, pgnPath] = query.data.split('|');
  const chatId = query.message.chat.id;

  await bot.answerCallbackQuery(query.id, { text: 'Generando curso...' });

  let outPath = null;

  try {
    const baseName = path.basename(pgnPath, '.pgn');
    outPath = path.join(TEMP_DIR, `${baseName}-${mode}.html`);

    let command = '';
    let modeName = '';

    if (mode === 'light') {
      modeName = 'Ligera ⚡';
      command = `node generate-course.mjs --pgn "${pgnPath}" --template "course-template-light.html" --out "${outPath}" --name "${baseName}"`;
    } 
    else if (mode === 'heavy') {
      modeName = 'Completa 🌟';
      command = `node generate-course.mjs --pgn "${pgnPath}" --template "course-template-heavy.html" --out "${outPath}" --name "${baseName}"`;
    } 
    else if (mode === 'v13') {
      modeName = 'Version 13 🚀';
      command = `node generate-sphere-course.mjs --pgn "${pgnPath}" --template "101-chess-tips-v13.html" --out "${outPath}" --name "${baseName}" --ejes "ejes_tematicos_ajedrez_4idiomas.json"`;
    } 
    else {
      return bot.sendMessage(chatId, '❌ Opción no válida.');
    }

    // Avisar al usuario que puede tardar
    await bot.sendMessage(chatId, `🔄 Generando *${modeName}*...\nEsto puede tardar unos segundos.`, {
      parse_mode: 'Markdown'
    });

    console.log('Ejecutando:', command);

    // Timeout más alto para Version 13 (puede tardar más)
    const { stdout, stderr } = await execAsync(command, { 
      timeout: 120000, // 2 minutos
      maxBuffer: 10 * 1024 * 1024 
    });

    if (stderr) console.error('stderr:', stderr);
    if (stdout) console.log(stdout);

    // Verificar que el HTML se generó
    await fs.access(outPath);

    await bot.sendDocument(chatId, outPath, {
      caption: `✅ ¡Curso generado correctamente!\nModo: ${modeName}`
    });

  } catch (err) {
    console.error('Error al generar:', err);
    bot.sendMessage(chatId, `❌ Error al generar el curso:\n\`${err.message}\``, {
      parse_mode: 'Markdown'
    });
  } finally {
    // Limpiar siempre los temporales
    if (pgnPath) await fs.unlink(pgnPath).catch(() => {});
    if (outPath) await fs.unlink(outPath).catch(() => {});
  }
});