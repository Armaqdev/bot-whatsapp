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
       PRICE_LIST_DIR=C:/Users/venta/Desktop/documentos laptop/lista de precios junio 2025
       PROMO_DIR=C:/Users/venta/Desktop/promo marzo
       ALLOW_PROMO_PRICES=false
       OWNER_PHONE=9848018317
       OWNER_CHAT_ID=

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
5. **Catalogo local**: Para consultas de productos, usa la carpeta en `PRICE_LIST_DIR` (PDF/XLSX) para confirmar disponibilidad sin precios
6. **Promociones del mes**: Usa `PROMO_DIR` (incluye imagenes) para detectar promociones y confirmar disponibilidad del producto sin compartir precios
7. **Cotización manual**: Si el cliente pide cotización/precio, el bot te envia un folio a `OWNER_PHONE`; cuando respondes con ese folio, el bot reenvia tu mensaje al cliente
8. **Respuesta**: Devuelve la respuesta generada al remitente y la almacena en DB

### Flujo de Cotización

- El bot solicita nombre del cliente antes de continuar la conversación.
- Si el cliente pide cotización, el bot solicita primero teléfono y correo electrónico.
- Cuando ya tiene nombre, teléfono y correo, envía la solicitud con folio al asesor (`OWNER_PHONE`).
- El asesor responde con el formato: `Q-XXXXXXXX detalle de cotizacion` y el bot lo reenvía al cliente.
- Nombre, teléfono y correo quedan guardados en PostgreSQL para no volver a solicitarlos en futuras conversaciones.

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
- Si recibes error 429 (cuota), el bot activa un cooldown automático (`OPENAI_COOLDOWN_MS`) y usa respuestas de respaldo

### DB no configurada
- Si ves `DB no configurada. El bot seguira sin historial persistente.`, revisa tu `.env`
- Configura `DATABASE_URL` o los parámetros `PG*`
- Si tu proveedor PostgreSQL exige SSL, usa `PGSSL=true`

## 📄 Licencia

MIT - Ver archivo LICENSE para más detalles.

## 🤝 Contribución

Las contribuciones son bienvenidas. Por favor, lee las guías de contribución antes de enviar un PR.

---

**Recuerda**: Este es un proyecto educativo. El uso de bots en WhatsApp puede violar los términos de servicio. Úsalo responsablemente.