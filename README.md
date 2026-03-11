# Bot WhatsApp Web con Agente de IA

Este proyecto implementa un bot de WhatsApp que utiliza la interfaz web de WhatsApp para conectarse y responder mensajes automáticamente usando un modelo de inteligencia artificial.

## ⚠️ Advertencia Importante

**Este proyecto utiliza WhatsApp Web de manera no oficial y corre el riesgo de bloqueo por parte de WhatsApp.** No se recomienda su uso en producción. WhatsApp puede detectar y bloquear cuentas que usen automatización no autorizada. Úsalo únicamente para fines educativos y de prueba.

## 🚀 Instalación

1. **Clona o descarga el proyecto**
   ```bash
   git clone <url-del-repositorio>
   cd whatsapp-web-bot-ai
   ```

2. **Instala las dependencias**
   ```bash
   npm install
   ```

3. **Configura las variables de entorno**
   - Copia el archivo `.env.example` a `.env`
   - Edita `.env` y configura al menos:
     ```
     OPENAI_API_KEY=tu_api_key_real_aqui
     OPENAI_COOLDOWN_MS=600000
     GEMINI_COOLDOWN_MS=300000
     GEMINI_MODEL=gemini-2.0-flash

     DATABASE_URL=postgresql://usuario:password@host:5432/whatsapp_bot
     PGSSL=true
     DB_AUTO_MIGRATE=true
     ```
   - Si no usas `DATABASE_URL`, puedes usar `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`.

## 🔧 Configuración

### API Key de IA
Necesitas una API key válida de OpenAI. Puedes obtenerla en [OpenAI Platform](https://platform.openai.com/).

### Modelo de IA
Por defecto usa GPT-3.5-turbo. Puedes cambiarlo en `src/ai.js` si tienes acceso a GPT-4.

### Versión de Node.js
Se recomienda usar **Node 22 LTS** (o Node 20 LTS). Versiones no LTS, especialmente Node 25+, pueden causar inestabilidad con Puppeteer/WhatsApp Web.

## ▶️ Ejecución

1. **Inicia el bot**
   ```bash
   npm start
   ```

2. **Escanea el QR Code**
   - El bot mostrará un QR code en la terminal
   - Abre WhatsApp en tu teléfono
   - Ve a "Dispositivos vinculados" > "Vincular dispositivo"
   - Escanea el QR code mostrado

3. **¡Listo!**
   - El bot se conectará y estará listo para responder mensajes
   - La sesion de WhatsApp se guarda en `.wwebjs_auth/`
   - El historial conversacional por numero se guarda en PostgreSQL (si DB esta configurada)

## 📁 Estructura del Proyecto

```
whatsapp-web-bot-ai/
├── src/
│   ├── index.js            # Punto de entrada principal
│   ├── ai.js               # Integración con modelo de IA
│   ├── db.js               # Persistencia de conversaciones en PostgreSQL
│   ├── session.json        # Credenciales de WhatsApp (generado automáticamente)
│   └── utils.js            # Funciones auxiliares
├── sql/
│   └── init.sql            # Script SQL opcional para tablas
├── .env.example            # Plantilla de variables de entorno
├── package.json            # Dependencias y scripts
└── README.md               # Este archivo
```

## 🔄 Funcionamiento

1. **Conexión**: El bot se conecta a WhatsApp Web usando `whatsapp-web.js`
2. **Escucha**: Monitorea mensajes entrantes (excluyendo grupos y mensajes propios)
3. **Historial por número**: Guarda cada mensaje entrante/saliente en PostgreSQL por teléfono
4. **Procesamiento contextual**: Recupera historial reciente y lo envía al modelo de IA
5. **Respuesta**: Devuelve la respuesta generada al remitente y la almacena en DB

## 🛠️ Desarrollo

Para desarrollo con recarga automática:
```bash
npm run dev
```

## 📋 Dependencias

- `whatsapp-web.js`: Cliente de WhatsApp Web
- `openai`: SDK de OpenAI
- `qrcode-terminal`: Generador de QR codes en terminal
- `dotenv`: Gestión de variables de entorno

## 🐛 Solución de Problemas

### El QR code no aparece
- Asegúrate de que no hay otra sesión activa
- Borra `src/session.json` y reinicia

### Error de autenticación
- WhatsApp puede haber detectado actividad sospechosa
- Espera unos minutos y vuelve a intentar
- Considera usar una cuenta secundaria para pruebas

### Error de API de IA
- Verifica que tu API key sea válida
- Revisa los límites de uso en tu cuenta de OpenAI
- Si recibes error 429 (cuota), el bot activa un cooldown automático (`OPENAI_COOLDOWN_MS`) y usa proveedor alterno o respuestas de respaldo

### DB no configurada
- Si ves `DB no configurada. El bot seguira sin historial persistente.`, revisa tu `.env`
- Configura `DATABASE_URL` o los parámetros `PG*`
- Si tu proveedor exige SSL (ej. Hostinger), usa `PGSSL=true`

## ☁️ Despliegue en VPS (Hostinger)

1. Instala Node 22 LTS y PostgreSQL (o usa PostgreSQL gestionado).
2. Crea base de datos y usuario para el bot.
3. Sube el proyecto y ejecuta:
   ```bash
   npm ci
   ```
4. Crea `.env` en el VPS con tus variables reales.
5. Opcional: crea tablas manualmente:
   ```bash
   psql "$DATABASE_URL" -f sql/init.sql
   ```
6. Inicia el bot con PM2:
   ```bash
   npm i -g pm2
   pm2 start src/index.js --name whatsapp-bot
   pm2 save
   pm2 startup
   ```

## 📄 Licencia

MIT - Ver archivo LICENSE para más detalles.

## 🤝 Contribución

Las contribuciones son bienvenidas. Por favor, lee las guías de contribución antes de enviar un PR.

---

**Recuerda**: Este es un proyecto educativo. El uso de bots en WhatsApp puede violar los términos de servicio. Úsalo responsablemente.