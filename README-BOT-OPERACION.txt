═══════════════════════════════════════════════════════════════
   CHESS COURSE BOT — GUÍA DE OPERACIÓN
═══════════════════════════════════════════════════════════════

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 ESTRUCTURA DE ARCHIVOS DEL BOT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  bot telegram/
  ├── bot.js                        ← Lógica principal del bot
  ├── generate-course.mjs           ← Convierte PGN a HTML
  ├── course-template-light.html    ← Plantilla ligera (248kb)
  ├── course-template-heavy.html    ← Plantilla pesada (5.7mb, tema CB Teca)
  ├── package.json                  ← Dependencias Node.js
  └── temp/                         ← Archivos temporales (auto-generada)


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 OPCIÓN A — CORRER EL BOT DESDE TU PC (LOCAL)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

REQUISITOS:
  - Node.js instalado (v18 o superior)
  - Token de Telegram del bot

PASO 1 — Configura el token
  En bot.js, asegúrate de que la línea del token sea:
    const TOKEN = process.env.BOT_TOKEN;

  Luego crea un archivo llamado  .env  en la carpeta del bot
  con este contenido (sin comillas alrededor del token):
    BOT_TOKEN=8880048929:AAGUzqe_NoEM_4OnGomxKNFpQbW5X0YjLRI

PASO 2 — Instala dependencias (solo la primera vez)
  Abre la terminal en la carpeta del bot y ejecuta:
    npm install
    npm install dotenv

PASO 3 — Agrega dotenv al bot (solo si aún no está)
  Al inicio de bot.js, agrega esta línea como primera línea:
    import 'dotenv/config';

PASO 4 — Inicia el bot
  En la terminal dentro de la carpeta del bot:
    node bot.js

  Deberías ver:
    🌐 Servidor HTTP en puerto 3000
    🤖 Bot de Cursos de Ajedrez iniciado...

PASO 5 — Detener el bot
  Presiona  Ctrl + C  en la terminal.

NOTA IMPORTANTE:
  Si el bot está corriendo en Render al mismo tiempo que en tu PC,
  verás el error "409 Conflict". Para evitarlo:
  - Pausa el servicio en Render antes de correr local, o
  - Detén el proceso local antes de que Render lo retome.
  Para pausar en Render: Dashboard → tu servicio → Settings →
  desplázate hasta "Suspend Service" y actívalo.


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 OPCIÓN B — CORRER EL BOT EN RENDER (NUBE 24/7)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

REQUISITOS:
  - Cuenta en render.com (login con GitHub)
  - Repositorio en GitHub con el código del bot
  - Token del bot configurado como variable de entorno

VERIFICAR QUE EL BOT ESTÁ CORRIENDO:
  1. Ve a https://render.com y entra a tu cuenta
  2. Selecciona el servicio  chess-course-bot
  3. Haz clic en  "Logs"
  4. Deberías ver:
       🌐 Servidor HTTP en puerto 3000
       🤖 Bot de Cursos de Ajedrez iniciado...

VERIFICAR EL TOKEN EN RENDER:
  1. En tu servicio → pestaña "Environment"
  2. Debe existir la variable:
       BOT_TOKEN = tu_token_aqui

PAUSAR / REANUDAR EL BOT EN RENDER:
  - Para pausar: Settings → "Suspend Service" → activar
  - Para reanudar: Settings → "Suspend Service" → desactivar

LÍMITES DEL PLAN GRATUITO DE RENDER:
  - 512 MB RAM · 0.1 vCPU
  - 750 horas/mes (suficiente para 1 servicio continuo)
  - 100 GB de ancho de banda saliente/mes
  - El servicio se "duerme" tras 15 min de inactividad
    (tarda ~50 seg en despertar la primera vez)


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 CÓMO USA EL BOT UN USUARIO EN TELEGRAM
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  1. El usuario envía un archivo .pgn al bot en Telegram
  2. El bot responde con dos botones:
       ⚡ Versión Ligera   →  HTML de ~250kb (más rápido)
       🌟 Versión Completa →  HTML de ~5.7mb (tema CB Teca)
  3. El usuario elige una opción
  4. El bot genera el HTML y lo envía como archivo descargable
  5. El usuario abre el HTML en su navegador — funciona sin internet

NOTA: Las sesiones expiran a los 10 minutos. Si los botones
no responden, vuelve a enviar el archivo .pgn.


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 SOLUCIÓN DE ERRORES COMUNES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ERROR: 409 Conflict
  Causa: Hay dos instancias del bot corriendo al mismo tiempo.
  Solución: Ejecuta en la terminal:
    taskkill /F /IM node.exe
  Luego vuelve a iniciar con: node bot.js

ERROR: ENOENT no such file or directory
  Causa: No encuentra un archivo de plantilla.
  Solución: Verifica que course-template-light.html y
  course-template-heavy.html estén en la misma carpeta que bot.js

ERROR: Cannot find module
  Causa: Faltan dependencias.
  Solución: Ejecuta: npm install

ERROR: Sesión expirada en Telegram
  Causa: Pasaron más de 10 minutos desde que se envió el PGN.
  Solución: Vuelve a enviar el archivo .pgn al bot.

═══════════════════════════════════════════════════════════════
