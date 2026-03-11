# Guía de Despliegue en Hostinger App Runner

## ✅ Prerequisitos

- Instancia de Node App Runner creada en Hostinger
- Base de datos PostgreSQL (gestionada o propia en Hostinger)
- Git configurado en tu máquina local
- Credenciales de acceso a Hostinger (Git o SFTP)

## 🚀 Pasos de Despliegue

### 1. Preparar el Proyecto Localmente

```bash
cd C:\Users\venta\Documents\bot-whatsapp-web

# Verifica que todo esté OK
npm install
node --check src/ai.js
node --check src/db.js
node --check src/index.js
```

### 2. Inicializar Git (si aún no lo has hecho)

```bash
git init
git add .
git commit -m "Initial commit: WhatsApp bot with AI and PostgreSQL persistence"
```

### 3. Agregar Repositorio en GitHub

Si aún no has hecho push a GitHub:

```bash
git remote add origin https://github.com/Armaqdev/bot-whatsapp.git
git branch -M main
git push -u origin main
# Te pedirá usuario (Armaqdev) y token/password de GitHub
```

**Generar GitHub Personal Access Token (si no lo tienes):**
1. Ve a https://github.com/settings/tokens
2. Click en "Generate new token (classic)"
3. Marca: `repo` (full control of private repositories)
4. Copia el token y úsalo como password en el git push

### 4. Configurar Variables de Entorno en Hostinger

En el panel de App Runner > Settings > Environment Variables, agrega:

```
OPENAI_API_KEY=tu_clave_openai_real
OPENAI_COOLDOWN_MS=600000
GEMINI_COOLDOWN_MS=300000
GEMINI_MODEL=gemini-2.0-flash
GOOGLE_API_KEY=tu_clave_gemini_real

DATABASE_URL=postgresql://usuario:password@host.hostinger.com:5432/whatsapp_bot
PGSSL=true
DB_AUTO_MIGRATE=true
```

**Nota sobre DATABASE_URL:**
- Si creaste PostgreSQL en Hostinger: copia la cadena exacta del panel
- Formato típico: `postgresql://username:password@host:5432/database`
- El PGSSL=true es crítico para Hostinger

### 5. Configurar Comando de Inicio

En App Runner > Settings > Startup Command:

```
node src/index.js
```

### 6. Crear Tablas (Opcional - Si DB_AUTO_MIGRATE=false)

Si prefieres crear tablas manualmente, conéctate a PostgreSQL:

```bash
psql "postgresql://usuario:password@host:5432/whatsapp_bot" -f sql/init.sql
```

### 7. Conectar Hostinger con GitHub (Auto-Deploy)

En tu panel de Hostinger **App Runner > Settings > Git Integration:**
- Selecciona **GitHub** como proveedor
- Autoriza tu cuenta de GitHub (Armaqdev)
- Selecciona repositorio: `Armaqdev/bot-whatsapp`
- Branch: `main`
- Click en **Connect**

Ahora cada vez que hagas `git push origin main`, Hostinger desplegará automáticamente.

**Si prefieres deploy manual:**
- App Runner > Deployments > Deploy Now

### 8. Monitorear Logs

En Panel Hostinger > App Runner > Logs, verifica:
- ✅ `DB conectada correctamente. Historial persistente habilitado.`
- ✅ `Cliente inicializado exitosamente`
- ✅ `authenticated`
- ✅ `ready - Cliente listo`

### ❌ Si ves "DB no configurada..."

1. Verifica que DATABASE_URL esté en Environment Variables
2. Valida credenciales PostgreSQL
3. Confirm PGSSL=true si es necesario
4. Reinicia la app: App Runner > Restart

## 🔄 Actualizar Código en Producción

Después de hacer cambios locales:

```bash
git add .
git commit -m "descripcion del cambio"
git push origin main
```

Si conectaste GitHub a Hostinger:
- Hostinger verá el push y desplegará automáticamente en 1-2 minutos
- Verifica en Panel > App Runner > Deployments > Activity

Si no conectaste GitHub:
- Haz manual Deploy en Panel > App Runner > Deployments > Deploy Now

## 🐛 Troubleshooting Común

### Error: "Connection refused"
- ✅ Verifica que la IP de App Runner esté en firewall de PostgreSQL
- ✅ En Hostinger: Database > Access > Whitelist tu App Runner IP

### Error: "password authentication failed"
- ✅ Revisa credenciales en DATABASE_URL
- ✅ Si cambiaste password en PostgreSQL, actualiza DATABASE_URL en Environment Variables

### Error: "PGSSL required but disabled"
- ✅ Asegúrate PGSSL=true en Environment Variables
- ✅ Los servidores Hostinger exigen SSL por defecto

### Bot no responde (pero está en "ready")
- ✅ Verifica que OpenAI API key sea válida y tenga créditos
- ✅ Revisa logs para errores de cuota (429)
- ✅ Confirma que WhatsApp aceptó el escaneo de QR

### QR Code no aparece
- ✅ En App Runner no hay terminal para escanear QR
- ✅ **Solución**: Ejecuta localmente en tu PC, escanea el QR para autenticar
- ✅ Luego despliega en App Runner (la sesión se guarda en `.wwebjs_auth/`)
- ✅ **Alternativa**: Si tu VPS tiene SSH, usa SSH forwarding para acceder a la terminal

## 📋 Autenticación WhatsApp en App Runner

Como App Runner no tiene terminal interactiva:

**Opción 1 (Recomendado): Autenticar localmente**
```bash
npm start
# Escanea el QR en tu PC
# Presiona Ctrl+C después de autenticar
# Commit y push con .wwebjs_auth/ generado
git add .wwebjs_auth/
git commit -m "Add WhatsApp session"
git push origin main
```

**Opción 2: SSH a tu App Runner**
- Contacta a Hostinger para habilitar SSH
- Ejecuta: `npm start` en SSH
- Escanea QR desde otra terminal
- Ctrl+C y cierra SSH

**Opción 3: Usar SFTP para cargar sesión**
- Genera sesión en local
- Carga `.wwebjs_auth/` vía SFTP a `public/` o root del App Runner

## 🎯 Checklist Final

- [ ] Código pusheado a GitHub (Armaqdev/bot-whatsapp)
- [ ] GitHub conectado a Hostinger App Runner (auto-deploy)
- [ ] Environment Variables configuradas en Hostinger (OPENAI_API_KEY, DATABASE_URL, PGSSL=true)
- [ ] PostgreSQL creado y accesible desde App Runner
- [ ] Tabla `sql/init.sql` creada (manual o automático)
- [ ] `.wwebjs_auth/` generado (sesión WhatsApp autenticada localmente) y pusheado
- [ ] Startup Command en Hostinger: `node src/index.js`
- [ ] Deploy ejecutado y logs sin errores
- [ ] Bot responde en WhatsApp

## 📞 Soporte Hostinger

- Panel: https://hpanel.hostinger.com/
- Docs: https://support.hostinger.com/
- Chat: En tu panel, esquina inferior derecha
