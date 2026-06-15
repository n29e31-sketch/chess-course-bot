═══════════════════════════════════════════════════════════════
   CHESS COURSE BOT — GUÍA DE ACTUALIZACIONES
   (GitHub + Render)
═══════════════════════════════════════════════════════════════

Cada vez que modifiques un archivo del bot (bot.js, templates,
generate-course.mjs, etc.) debes subir los cambios a GitHub.
Render detecta el push y redespliega automáticamente.


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 FLUJO COMPLETO DE ACTUALIZACIÓN
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PASO 1 — Abre la terminal en la carpeta del bot
  Navega hasta tu carpeta:
    cd "C:\Users\N29E3\Desktop\bot telegram"

PASO 2 — Verifica qué archivos cambiaron (opcional)
    git status

  Verás una lista de archivos modificados en rojo.

PASO 3 — Agrega los archivos modificados
  Para agregar TODO lo que cambió:
    git add .

  O para agregar archivos específicos:
    git add bot.js
    git add course-template-light.html course-template-heavy.html
    git add generate-course.mjs

PASO 4 — Crea el commit con una descripción
    git commit -m "descripción del cambio"

  Ejemplos de buenas descripciones:
    git commit -m "fix error al generar html pesado"
    git commit -m "agregar panel info jugadores"
    git commit -m "actualizar plantillas light y heavy"

PASO 5 — Sube los cambios a GitHub
    git push

  Si te pide credenciales, usa tu usuario y contraseña de GitHub.

PASO 6 — Render redespliega automáticamente
  - Render detecta el push en segundos
  - Ve a https://render.com → tu servicio → pestaña "Logs"
  - Espera ver:
      ==> Deploying...
      ==> Running 'node bot.js'
      🌐 Servidor HTTP en puerto 3000
      🤖 Bot de Cursos de Ajedrez iniciado...
  - El proceso tarda entre 1 y 3 minutos


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 COMANDOS DE REFERENCIA RÁPIDA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Actualización estándar (archivos específicos):
    git add bot.js
    git commit -m "descripción"
    git push

  Actualización rápida (todos los cambios de una vez):
    git add .
    git commit -m "descripción"
    git push

  Ver historial de cambios:
    git log --oneline

  Ver qué archivos cambiaron sin hacer nada:
    git status

  Ver diferencias en un archivo antes de hacer commit:
    git diff bot.js


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 ACTUALIZAR VARIABLES DE ENTORNO EN RENDER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Si necesitas cambiar el token u otra variable:
  1. Ve a https://render.com → tu servicio
  2. Pestaña "Environment"
  3. Edita el valor de BOT_TOKEN
  4. Render redespliega automáticamente al guardar


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 SI GIT PUSH FALLA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ERROR: src refspec main does not match any
  Causa: No has hecho ningún commit todavía.
  Solución:
    git add .
    git commit -m "primer commit"
    git push -u origin main

ERROR: remote origin already exists
  Causa: El repositorio ya tiene un remote configurado.
  Solución: No hagas nada, solo continúa con git push.

ERROR: rejected / non-fast-forward
  Causa: Render o alguien más hizo cambios que no tienes local.
  Solución:
    git pull --rebase
    git push

ERROR: Authentication failed
  Causa: Credenciales de GitHub incorrectas o expiradas.
  Solución: Genera un Personal Access Token en:
    https://github.com/settings/tokens
  Y úsalo como contraseña al hacer push.


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 FORZAR REDESPLIEGUE EN RENDER SIN CAMBIAR CÓDIGO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Si el bot falla y quieres que Render lo reinicie sin subir
ningún cambio:
  1. Ve a https://render.com → tu servicio
  2. Pestaña "Deployments"
  3. Clic en "Manual Deploy" → "Deploy latest commit"

O desde la terminal, haz un commit vacío:
    git commit --allow-empty -m "forzar redespliegue"
    git push


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 ARCHIVOS QUE NUNCA DEBES SUBIR A GITHUB
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  - .env                 (contiene el token — es privado)
  - node_modules/        (se regenera con npm install)
  - temp/                (archivos temporales del bot)

Verifica que tu archivo .gitignore contenga al menos:
    node_modules/
    .env
    temp/

Si no existe el .gitignore, créalo con ese contenido.

═══════════════════════════════════════════════════════════════
