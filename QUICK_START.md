# Quick Setup para GitHub + Hostinger

## ✅ Paso 1: Inicializa Git Localmente

```powershell
# Desde tu terminal en el proyecto
cd C:\Users\venta\Documents\bot-whatsapp-web

# Configura Git (primera vez)
git config user.name "Armaqdev"
git config user.email "tu-email@example.com"

# Inicializa repositorio
git init
git add .
git commit -m "Initial commit: WhatsApp bot with AI and PostgreSQL"
```

## ✅ Paso 2: Conéctate a GitHub

```powershell
# Agrega GitHub como remoto
git remote add origin https://github.com/Armaqdev/bot-whatsapp.git

# Cambia a rama main (si no está ya)
git branch -M main

# Haz push
git push -u origin main
```

**Si pide autenticación:**
- Usuario: `Armaqdev`
- Contraseña: **NO uses tu contraseña**, usa un **Personal Access Token**:
  1. Ve a https://github.com/settings/tokens
  2. Click "Generate new token (classic)"
  3. Marca `repo` 
  4. Copia el token y pégalo como password

## ✅ Paso 3: Authenfica WhatsApp Localmente

```powershell
npm start
# Escanea el QR desde WhatsApp
# Ctrl+C después de ver "Cliente listo"

# Sube la sesión autenticada
git add .wwebjs_auth/
git commit -m "Add WhatsApp session"
git push origin main
```

## ✅ Paso 4: Configura Hostinger App Runner

1. Ve a **hpanel.hostinger.com > App Runner**
2. Selecciona tu App Runner
3. **Settings > Git Integration:**
   - Proveedor: **GitHub**
   - Click en "Connect with GitHub"
   - Autoriza tu cuenta (Armaqdev)
   - Selecciona repositorio: `Armaqdev/bot-whatsapp`
   - Branch: `main`
   - Click **Sync**

4. **Settings > Environment Variables** (agrega estas):
   ```
   OPENAI_API_KEY=sk-proj-XXXXX
   OPENAI_COOLDOWN_MS=600000
   GEMINI_COOLDOWN_MS=300000
   GEMINI_MODEL=gemini-2.0-flash
   GOOGLE_API_KEY=AIzaSyXXXXX
   
   DATABASE_URL=postgresql://user:pass@host:5432/db
   PGSSL=true
   DB_AUTO_MIGRATE=true
   ```

5. **Settings > Build & Deploy**
   - Startup Command: `node src/index.js`
   - Click **Save**

6. **Deployments > Deploy Now** (o espera a que GitHub trigger auto-deploy)

## ✅ Paso 5: Verifica Logs

Ve a **App Runner > Logs** y busca:
- ✅ `DB conectada correctamente...`
- ✅ `Cliente inicializado exitosamente`
- ✅ `ready - Cliente listo`

## 🚀 Después: Cambios Futuros

Cada cambio que hagas:

```powershell
git add .
git commit -m "Tu cambio"
git push origin main
# ← Hostinger auto-despliega en 1-2 minutos
```

## 🐛 Troubleshooting Rápido

| Problema | Solución |
|----------|----------|
| Error de autenticación en git push | Usa Personal Access Token, no contraseña |
| "DB no configurada" en logs | Verifica DATABASE_URL en Environment Variables |
| GitHub no muestra en Hostinger | Desconecta y vuelve a conectar en Git Integration |
| Bot no responde | Verifica OpenAI API key tiene créditos |

## 💡 Tips

- Usa `.gitignore` para no subir `.env` en producción (ya está configurado)
- Revisa los logs regularmente para detectar problemas
- Si cambias credenciales, actualiza Environment Variables en Hostinger
