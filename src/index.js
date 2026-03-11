const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { queryAI } = require('./ai');
const { initDatabase, normalizePhoneNumber, saveConversationMessage, getRecentConversationHistory } = require('./db');
const { sanitizeMessage, isValidMessage } = require('./utils');
const fs = require('fs');
const path = require('path');

console.log('🔄 Iniciando bot WhatsApp...');

const authRoot = '.wwebjs_auth';
const clientId = 'whatsapp-bot';
let client = null;

function warnUnsupportedNodeVersion() {
    const major = Number(process.versions.node.split('.')[0]);
    const isRecommendedLTS = major === 20 || major === 22;

    if (!isRecommendedLTS) {
        console.warn(`⚠️  Versión actual de Node.js: v${process.versions.node}`);
        console.warn('⚠️  Este bot está validado para Node 20 o 22 LTS.');
        if (major >= 25) {
            console.warn('⚠️  Node.js v25+ puede causar errores de Puppeteer (por ejemplo: Execution context was destroyed).');
        }
        console.warn('⚠️  Recomendación: instala Node 22 LTS para mayor estabilidad.');
    }
}

function buildClient() {
    return new Client({
        authStrategy: new LocalAuth({
            dataPath: authRoot,
            clientId
        }),
        webVersionCache: {
            // Avoid pinning to stale WA builds that break script injection.
            type: 'local',
        },
        puppeteer: {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu'
            ]
        }
    });
}

function registerEventListeners(targetClient) {
    console.log('📌 Registrando event listeners...');

    targetClient.on('authenticated', () => {
        console.log('🔐 [EVENT] authenticated');
    });

    targetClient.on('auth_failure', (msg) => {
        console.log('❌ [EVENT] auth_failure:', msg);
    });

    targetClient.on('ready', () => {
        console.log('✅ [EVENT] ready - Cliente listo');
        console.log('⏳ Esperando mensajes...');
    });

    targetClient.on('loading_screen', (percent, message) => {
        console.log(`📊 [EVENT] loading_screen: ${percent}% - ${message}`);
    });

    targetClient.on('change_state', (state) => {
        console.log(`🔄 [EVENT] change_state: ${state}`);
    });

    targetClient.on('qr', (qr) => {
        console.log('📱 [EVENT] qr');
        qrcode.generate(qr, { small: true });
    });

    targetClient.on('message', async (message) => {
        const rawBody = message.body || '';
        console.log(`📨 [EVENT] message - De: ${message.from}, fromMe: ${message.fromMe}, body: ${rawBody.substring(0, 50)}`);

        if (message.fromMe || message.from.includes('@g.us')) {
            console.log('  ↳ Ignorado (fromMe o isGroup)');
            return;
        }

        const incomingText = sanitizeMessage(rawBody);
        if (!isValidMessage(incomingText)) {
            console.log('  ↳ Ignorado (mensaje vacio o invalido)');
            return;
        }

        const phoneNumber = normalizePhoneNumber(message.from);

        try {
            console.log('  ↳ Procesando...');
            await saveConversationMessage(phoneNumber, 'user', incomingText, 'whatsapp');

            const history = await getRecentConversationHistory(phoneNumber, 12);
            const result = await queryAI({
                text: incomingText,
                history,
                phoneNumber
            });

            await message.reply(result.reply);
            await saveConversationMessage(phoneNumber, 'assistant', result.reply, result.provider);
            console.log('  ↳ ✅ Respuesta enviada');
        } catch (error) {
            console.error('  ↳ ❌ Error:', error.message);
        }
    });

    targetClient.on('disconnected', (reason) => {
        console.log('⚠️  [EVENT] disconnected:', reason);
        if (reason === 'LOGOUT') {
            console.log('LOGOUT: Eliminando sesión y terminando...');
            fs.rmSync(authRoot, { recursive: true, force: true });
            process.exit(1);
        }
    });

    targetClient.on('error', (error) => {
        console.error('❌ [EVENT] error:', error.message);
    });
}

function cleanupAuthLocks() {
    const sessionDir = path.join(authRoot, `session-${clientId}`);
    if (!fs.existsSync(sessionDir)) {
        return;
    }

    const files = fs.readdirSync(sessionDir);
    for (const fileName of files) {
        if (fileName.startsWith('Singleton')) {
            const filePath = path.join(sessionDir, fileName);
            try {
                fs.rmSync(filePath, { recursive: true, force: true });
            } catch (error) {
                console.warn(`⚠️  No se pudo limpiar lock temporal: ${filePath}`, error.message);
            }
        }
    }
}

console.log('🚀 Inicializando cliente...');

async function initializeWithRetry(maxRetries = 3) {
    warnUnsupportedNodeVersion();
    await initDatabase();

    for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
        try {
            client = buildClient();
            registerEventListeners(client);
            await client.initialize();
            console.log('✅ Cliente inicializado exitosamente');
            return;
        } catch (error) {
            const message = error?.message || String(error);
            console.error(`❌ Error iniciando cliente (intento ${attempt}/${maxRetries}):`, message);

            const isTransientInitError =
                message.includes('Execution context was destroyed') ||
                message.includes('Target closed') ||
                message.includes('Navigation failed') ||
                message.includes('browser is already running');

            if (client) {
                try {
                    await client.destroy();
                } catch (_) {
                    // Ignore destroy errors and continue with cleanup.
                }
                client = null;
            }

            cleanupAuthLocks();

            if (!isTransientInitError || attempt === maxRetries) {
                console.error('🧾 Detalle del error:', error);
                process.exit(1);
            }

            const waitMs = attempt * 3000;
            console.log(`🔁 Reintentando en ${waitMs / 1000}s...`);
            await new Promise((resolve) => setTimeout(resolve, waitMs));
        }
    }
}

initializeWithRetry();