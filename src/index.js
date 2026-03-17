const { Client, LocalAuth } = require('whatsapp-web.js');
const { setBotStatus, setLastQrDataUrl } = require('./state');
const qrcode = require('qrcode-terminal');
const { queryAI } = require('./ai');
const {
    initDatabase,
    normalizePhoneNumber,
    saveConversationMessage,
    getRecentConversationHistory,
    getConversationLeadData,
    upsertConversationLeadData
} = require('./db');
const { sanitizeMessage, isValidMessage } = require('./utils');
const fs = require('fs');
const path = require('path');

console.log('🔄 Iniciando bot WhatsApp...');
setBotStatus({ available: false, message: 'Iniciando bot...' });

const authRoot = '.wwebjs_auth';
const clientId = 'whatsapp-bot';
const OWNER_PHONE = normalizePhoneNumber(process.env.OWNER_PHONE || '9848018317');
const OWNER_CHAT_ID = process.env.OWNER_CHAT_ID || '';
const pendingQuotes = new Map();
const leadStates = new Map();
// Debounce: acumula mensajes del mismo cliente antes de procesar
const messageBuffers = new Map();   // phoneNumber → [{ message, text }]
const debounceTimers = new Map();   // phoneNumber → timeoutId
const DEBOUNCE_MS = Number(process.env.DEBOUNCE_MS || 3500); // 3.5 segundos de espera
let client = null;

const PRODUCT_KEYWORDS = [
    { label: 'Revolvedora', regex: /\brevolvedora(?:s)?\b/i },
    { label: 'Vibrador', regex: /\bvibrador(?:es)?\b/i },
    { label: 'Andamio', regex: /\bandamio(?:s)?\b/i },
    { label: 'Puntal', regex: /\bpuntal(?:es)?\b/i },
    { label: 'Malacate', regex: /\bmalacate(?:s)?\b/i },
    { label: 'Polipasto', regex: /\bpolipasto(?:s)?\b/i },
    { label: 'Compresor', regex: /\bcompresor(?:es)?\b/i },
    { label: 'Generador', regex: /\bgenerador(?:es)?\b/i },
    { label: 'Cortadora', regex: /\bcortadora(?:s)?\b/i }
];

function isQuoteRequest(text) {
    const normalized = String(text || '').toLowerCase();
    // Detectar frases típicas de solicitud de precio/cotización aunque no incluya explícitamente 'precio' o 'cotización'
    return /\bcotizacion\b|\bcotiza\b|\bcotizar\b|\bprecio\b|\bprecios\b|\bcuanto\s+cuesta\b|\bcosto\b|\btendr[aá]\b|\bhay\b|\bme cotizas\b|\bme puedes cotizar\b|\bme cotiza\b|\bme cotizar\b|\bquiero saber\b|\bme interesa\b/.test(normalized);
}

function isFormalQuoteRequest(text) {
    const normalized = String(text || '').toLowerCase();
    return /\bcotizacion\s+formal\b|\bcotizacion\s+en\s+pdf\b|\bpdf\b|\bpropuesta\s+formal\b/.test(normalized);
}

function isProductIntent(text) {
    const normalized = String(text || '').toLowerCase();
    return /\brevolvedora\b|\bvibrador(?:es)?\b|\bandamio(?:s)?\b|\bpuntal(?:es)?\b|\bmalacate(?:s)?\b|\bpolipasto(?:s)?\b|\bcompresor(?:es)?\b|\bgenerador(?:es)?\b|\bcortadora(?:s)?\b/.test(normalized);
}

function detectRequestedProduct(text) {
    const source = String(text || '');
    const found = [];
    for (const product of PRODUCT_KEYWORDS) {
        if (product.regex.test(source)) {
            found.push(product.label);
        }
    }
    return found;
}

function detectRequestedProductFromHistory(history) {
    if (!Array.isArray(history) || history.length === 0) {
        return '';
    }

    for (let i = history.length - 1; i >= 0; i -= 1) {
        const row = history[i];
        if (!row || row.role !== 'user' || !row.content) {
            continue;
        }

        const detected = detectRequestedProduct(row.content);
        if (detected) {
            return detected;
        }
    }

    return '';
}

function buildQuoteId() {
    const random = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `Q-${Date.now().toString(36).slice(-4).toUpperCase()}${random}`;
}

function getOwnerChatId() {
    if (OWNER_CHAT_ID) {
        return OWNER_CHAT_ID;
    }

    if (!OWNER_PHONE) {
        return null;
    }

    if (OWNER_PHONE.length === 10) {
        return `52${OWNER_PHONE}@c.us`;
    }

    return `${OWNER_PHONE}@c.us`;
}

async function resolveOwnerChatId(targetClient) {
    if (OWNER_CHAT_ID) {
        return OWNER_CHAT_ID;
    }

    if (!OWNER_PHONE) {
        return null;
    }

    const rawCandidates = [
        OWNER_PHONE,
        OWNER_PHONE.startsWith('52') ? OWNER_PHONE : `52${OWNER_PHONE}`,
        OWNER_PHONE.startsWith('521') ? OWNER_PHONE : `521${OWNER_PHONE}`
    ];

    const candidates = Array.from(new Set(rawCandidates.map((num) => normalizePhoneNumber(num)).filter(Boolean)));

    for (const candidate of candidates) {
        try {
            const numberId = await targetClient.getNumberId(candidate);
            if (numberId && numberId._serialized) {
                return numberId._serialized;
            }
        } catch (_) {
            // Continue trying other candidates.
        }
    }

    return getOwnerChatId();
}

function isOwnerPhone(phoneNumber) {
    if (!OWNER_PHONE) {
        return false;
    }

    const normalized = normalizePhoneNumber(phoneNumber);
    if (!normalized) {
        return false;
    }

    return normalized === OWNER_PHONE ||
        normalized.endsWith(OWNER_PHONE) ||
        normalized === `52${OWNER_PHONE}` ||
        normalized === `521${OWNER_PHONE}`;
}

function parseOwnerQuoteReply(text) {
    const match = String(text || '').trim().match(/(Q-[A-Z0-9]{8})(?:[:\s-]+(.+))?/i);
    if (!match) {
        return null;
    }

    return {
        quoteId: match[1].toUpperCase(),
        quoteText: (match[2] || '').trim()
    };
}

function isOwnerQuoteInquiry(text) {
    const normalized = String(text || '').toLowerCase();
    return /que\s+equipo\s+solicito|que\s+equipo\s+pidio|cual\s+equipo\s+solicito|cual\s+equipo\s+pidio|pendiente|solicitudes|folio/i.test(normalized);
}

function getPendingQuotesOrdered() {
    return Array.from(pendingQuotes.entries())
        .map(([quoteId, payload]) => ({ quoteId, payload }))
        .sort((a, b) => b.payload.createdAt - a.payload.createdAt);
}

function buildPendingQuotesSummary(limit = 3) {
    const ordered = getPendingQuotesOrdered();
    if (ordered.length === 0) {
        return 'No hay solicitudes de cotizacion pendientes en este momento.';
    }

    const lines = ['Solicitudes pendientes:'];
    for (const item of ordered.slice(0, limit)) {
        const payload = item.payload;
        lines.push(`- ${item.quoteId} | Cliente: ${payload.clientPhone} | Equipo: ${payload.requestedProduct || 'No identificado'} | Mensaje: ${payload.clientQuestion}`);
    }

    lines.push('Responde con: Q-XXXXXXXX Precio y tiempo de entrega');
    return lines.join('\n');
}

function cleanupPendingQuotes() {
    const maxAgeMs = 24 * 60 * 60 * 1000;
    const now = Date.now();

    for (const [quoteId, payload] of pendingQuotes.entries()) {
        if (now - payload.createdAt > maxAgeMs) {
            pendingQuotes.delete(quoteId);
        }
    }
}

function getLeadState(phoneNumber) {
    if (!leadStates.has(phoneNumber)) {
        leadStates.set(phoneNumber, {
            name: '',
            contactPhone: '',
            email: '',
            awaitingName: false,
            awaitingQuoteContact: false,
            pendingQuoteMessage: '',
            profileLoaded: false,
            lastNamePromptAt: 0,
            lastQuotePromptKey: ''
        });
    }

    return leadStates.get(phoneNumber);
}

async function ensureLeadStateFromDb(phoneNumber, leadState) {
    if (leadState.profileLoaded) {
        return;
    }

    const profile = await getConversationLeadData(phoneNumber);
    if (profile) {
        leadState.name = profile.name || leadState.name;
        leadState.contactPhone = profile.contactPhone || leadState.contactPhone;
        leadState.email = profile.email || leadState.email;
    }

    leadState.profileLoaded = true;
}

function formatName(rawName) {
    return rawName
        .split(' ')
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
        .join(' ');
}

function extractNameFromText(text) {
    const normalized = String(text || '').trim();
    if (!normalized) {
        return null;
    }

    const explicitMatch = normalized.match(/(?:mi nombre es|me llamo|soy)\s+([a-zA-ZáéíóúñüÁÉÍÓÚÑÜ'\-]+(?:\s+[a-zA-ZáéíóúñüÁÉÍÓÚÑÜ'\-]+){0,2})/i);
    if (explicitMatch) {
        return formatName(explicitMatch[1]);
    }

    const lowered = normalized.toLowerCase();
    const ignored = ['hola', 'buen dia', 'buenos dias', 'buenas tardes', 'buenas noches', 'gracias', 'cotizacion', 'precio'];
    if (ignored.some((term) => lowered === term || lowered.startsWith(`${term} `))) {
        return null;
    }

    const cleaned = lowered
        .replace(/^mi nombre es\s+/i, '')
        .replace(/^soy\s+/i, '')
        .replace(/^me llamo\s+/i, '')
        .replace(/^nombre[:\s]+/i, '')
        .trim();

    if (!cleaned || /\d|@/.test(cleaned)) {
        return null;
    }

    const words = cleaned.split(/\s+/).filter(Boolean);
    if (words.length < 1 || words.length > 4) {
        return null;
    }

    if (!words.every((word) => /^[a-zA-ZáéíóúñüÁÉÍÓÚÑÜ'-]+$/.test(word))) {
        return null;
    }

    return formatName(words.join(' '));
}

function extractEmailFromText(text) {
    const match = String(text || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    return match ? match[0].toLowerCase() : null;
}

function extractContactPhoneFromText(text) {
    const matches = String(text || '').match(/\+?\d[\d\s().-]{7,}\d/g);
    if (!matches || matches.length === 0) {
        return null;
    }

    for (const candidate of matches) {
        const digits = candidate.replace(/\D/g, '');
        if (digits.length >= 10 && digits.length <= 15) {
            return digits;
        }
    }

    return null;
}

function resetQuoteCapture(leadState) {
    leadState.awaitingQuoteContact = false;
    leadState.pendingQuoteMessage = '';
    leadState.lastQuotePromptKey = '';
}

async function handleQuoteRequest(targetClient, message, phoneNumber, incomingText, options = {}) {
        // Evitar chatIds de estados (ahora solo en función auxiliar)
        // Eliminado continue fuera de bucle
    cleanupPendingQuotes();

    const isFormal = Boolean(options.isFormal);
    // Detectar producto solicitado en el mensaje de cotización
    let requestedProducts = options.requestedProduct || [];
    if (!requestedProducts || typeof requestedProducts === 'string') {
        requestedProducts = detectRequestedProduct(incomingText);
    }
    if (!Array.isArray(requestedProducts) || requestedProducts.length === 0) {
        requestedProducts = ['No identificado'];
    }

    // Registrar una cotización pendiente por cada producto detectado
        // Función auxiliar para registrar cotización
        async function registrarCotizacion(prod) {
            const quoteId = buildQuoteId();
            let chatId = message.from;
            try {
                const numberId = await targetClient.getNumberId(phoneNumber);
                if (numberId && numberId._serialized) {
                    chatId = numberId._serialized;
                }
            } catch (e) {}
            // Evitar chatIds de estados
            if (chatId.endsWith('@status')) {
                console.warn('Intento de enviar mensaje a estado, ignorado:', chatId);
                return;
            }
            pendingQuotes.set(quoteId, {
                clientChatId: chatId,
                clientPhone: phoneNumber,
                requestType: isFormal ? 'formal' : 'price',
                requestedProduct: prod,
                clientQuestion: incomingText,
                createdAt: Date.now()
            });
            const ownerChatId = await resolveOwnerChatId(targetClient);
            // Incluir cantidad y destino en la notificación al asesor
            const ownerInstruction = [
                'Nueva solicitud de cotizacion.',
                `Folio: ${quoteId}`,
                `Cliente: ${phoneNumber}`,
                `Nombre: ${leadStates.get(phoneNumber)?.name || 'No capturado'}`,
                `Tipo: ${isFormal ? 'Cotizacion formal PDF' : 'Precio y tiempo de entrega'}`,
                `Equipo solicitado: ${prod}`,
                `Cantidad: ${options.quantity || 'No especificada'}`,
                `Destino de entrega: ${options.deliveryAddress || 'No especificado'}`,
                `Mensaje del cliente: ${incomingText}`,
                '',
                isFormal
                    ? `Responde enviando PDF con el folio en el texto/caption: ${quoteId}`
                    : `Responde con: ${quoteId} Precio y tiempo de entrega`
            ].join('\n');
            let advisorNotified = false;
            if (ownerChatId) {
                try {
                    await targetClient.sendMessage(ownerChatId, ownerInstruction);
                    advisorNotified = true;
                } catch (error) {
                    console.error('❌ No se pudo enviar la solicitud al asesor:', error.message);
                }
            }
            if (!ownerChatId) {
                console.warn('⚠️  OWNER_PHONE/OWNER_CHAT_ID no configurado. No se pudo notificar al asesor.');
            }
            // Fix 3: NO confirmar disponibilidad. Solo avisar que se tomó nota.
            // El asesor confirmará existencia y tiempo de entrega cuando responda.
            const clientConfirm = isFormal
                ? 'Listo, ya registré tu solicitud. En breve te enviamos la cotización.'
                : 'Listo, ya tomé nota. En cuanto tenga el precio y tiempo de entrega te confirmo.';
            await message.reply(clientConfirm);
            await saveConversationMessage(phoneNumber, 'assistant', clientConfirm, isFormal ? 'quote:formal-pending' : 'quote:pending');
        }
        // Registrar una cotización pendiente por cada producto detectado
        for (const prod of requestedProducts) {
            await registrarCotizacion(prod);
        }
}

async function handleLeadCapture(message, phoneNumber, incomingText, leadState) {
    if (leadState.name) {
        return false;
    }

    const detectedName = extractNameFromText(incomingText);

    if (detectedName) {
        leadState.name = detectedName;
        leadState.awaitingName = false;
        await upsertConversationLeadData(phoneNumber, { name: detectedName });

        // If the message is just the name, acknowledge y responder con IA
        const nameOnly = String(incomingText || '').trim().split(/\s+/).length <= 4;
        if (nameOnly) {
            const history = await getRecentConversationHistory(phoneNumber, 30, { sameDayOnly: true });
            const aiResult = await queryAI({
                text: `Mi nombre es ${detectedName}`,
                history,
                phoneNumber
            });
            await message.reply(aiResult.reply);
            await saveConversationMessage(phoneNumber, 'assistant', aiResult.reply, 'lead:name-captured');
            return true;
        }

        return false;
    }

    const now = Date.now();
    const promptCooldownMs = 15 * 60 * 1000;
    if (!leadState.awaitingName || now - leadState.lastNamePromptAt > promptCooldownMs) {
        leadState.awaitingName = true;
        leadState.lastNamePromptAt = now;
        const history = await getRecentConversationHistory(phoneNumber, 30, { sameDayOnly: true });
        const aiResult = await queryAI({
            text: 'Por favor dime tu nombre',
            history,
            phoneNumber
        });
        await message.reply(aiResult.reply);
        await saveConversationMessage(phoneNumber, 'assistant', aiResult.reply, 'lead:ask-name');
        return false;
    }

    return false;
}

async function handleQuoteDataCapture(targetClient, message, phoneNumber, incomingText, leadState) {
    const isNewQuote = isQuoteRequest(incomingText);

    if (isNewQuote && !leadState.awaitingQuoteContact) {
        leadState.awaitingQuoteContact = true;
        leadState.pendingQuoteMessage = incomingText;
    }

    if (!leadState.awaitingQuoteContact) {
        return false;
    }

    const detectedEmail = extractEmailFromText(incomingText);
    const detectedContactPhone = extractContactPhoneFromText(incomingText);

    if (detectedEmail) {
        leadState.email = detectedEmail;
    }
    if (detectedContactPhone) {
        leadState.contactPhone = detectedContactPhone;
    }

    if (detectedEmail || detectedContactPhone) {
        await upsertConversationLeadData(phoneNumber, {
            contactPhone: detectedContactPhone || null,
            email: detectedEmail || null
        });
    }

    const missing = [];
    if (!leadState.contactPhone) {
        missing.push('numero de telefono');
    }
    if (!leadState.email) {
        missing.push('correo electronico');
    }

    if (missing.length > 0) {
        const promptKey = missing.join('|');
        if (leadState.lastQuotePromptKey === promptKey) {
            return true;
        }
        leadState.lastQuotePromptKey = promptKey;

        const history = await getRecentConversationHistory(phoneNumber, 30, { sameDayOnly: true });
        const aiResult = await queryAI({
            text: `Por favor comparte tu ${missing.join(' y ')}`,
            history,
            phoneNumber
        });
        await message.reply(aiResult.reply);
        await saveConversationMessage(phoneNumber, 'assistant', aiResult.reply, 'lead:ask-quote-contact');
        return true;
    }

    const quoteMessage = leadState.pendingQuoteMessage || incomingText;
    resetQuoteCapture(leadState);
    await handleQuoteRequest(targetClient, message, phoneNumber, quoteMessage, leadState);
    return true;
}

async function handleOwnerMessage(targetClient, message, incomingText, ownerPhoneNumber) {
    // Nuevo: comando /orden para analizar instrucciones en lenguaje natural
    if (incomingText.trim().toLowerCase().startsWith('/orden')) {
        const orderText = incomingText.trim().slice(6).trim();
        // Buscar folio en el texto
        const folioMatch = orderText.match(/q-[a-z0-9]{8}/i);
        if (folioMatch) {
            const quoteId = folioMatch[0].toUpperCase();
            const pending = pendingQuotes.get(quoteId);
            if (!pending) {
                await message.reply(`No encontré información para el folio ${quoteId}.`);
                return;
            }
            // Buscar datos recolectados del cliente
            const leadData = await getConversationLeadData(pending.clientPhone);
            let info = `Folio: ${quoteId}\n`;
            info += `Cliente: ${pending.clientPhone}\n`;
            info += `Producto: ${pending.requestedProduct || 'No identificado'}\n`;
            info += `Mensaje original: ${pending.clientQuestion}\n`;
            if (leadData) {
                if (leadData.name) info += `Nombre: ${leadData.name}\n`;
                if (leadData.email) info += `Correo: ${leadData.email}\n`;
                if (leadData.contact_phone) info += `Teléfono: ${leadData.contact_phone}\n`;
            }
            // Analizar la orden para responder solo lo solicitado
            const lowerOrder = orderText.toLowerCase();
            let respuesta = '';
            if (/nombre/.test(lowerOrder)) respuesta += leadData?.name ? `Nombre: ${leadData.name}\n` : '';
            if (/correo/.test(lowerOrder)) respuesta += leadData?.email ? `Correo: ${leadData.email}\n` : '';
            if (/tel[eé]fono|cel/.test(lowerOrder)) respuesta += leadData?.contact_phone ? `Teléfono: ${leadData.contact_phone}\n` : '';
            if (/producto|equipo/.test(lowerOrder)) respuesta += `Producto: ${pending.requestedProduct || 'No identificado'}\n`;
            if (/mensaje|original/.test(lowerOrder)) respuesta += `Mensaje original: ${pending.clientQuestion}\n`;
            if (!respuesta) respuesta = info;
            await message.reply(respuesta.trim());
            return;
        } else {
            // Órdenes generales sin folio
            const lowerOrder = orderText.toLowerCase();
            if (/pendiente|cotizaci[oó]n|folio/.test(lowerOrder)) {
                // Analizar todos los chats del día y mostrar solo los que tienen cotización pendiente
                const { getRecentConversationHistory, getPhonesWithUserMessagesToday, getConversationLeadData } = require('./db');
                const phonesToday = await getPhonesWithUserMessagesToday();
                let pendientes = [];
                const esperaRegex = /(en un momento te comparto|en breve te confirmo|ya lo reviso y te doy la informacion|gracias por tu mensaje|entendido, ya estoy revisando|perfecto, en un momento|en breve te confirmo la informacion|en un momento te comparto la informacion|te confirmo la informacion solicitada)/i;
                for (const phone of phonesToday) {
                    const history = await getRecentConversationHistory(phone, 30, { sameDayOnly: true });
                    // Si el último mensaje del bot es de espera y no hay respuesta concreta posterior, es pendiente
                    for (let i = 0; i < history.length; i++) {
                        const msg = history[i];
                        if (msg.role === 'user' && /[?¿]$/.test(msg.content.trim())) {
                            const hasBotReply = history.slice(i + 1).some(h => h.role === 'assistant');
                            if (!hasBotReply) {
                                const leadData = await getConversationLeadData(phone);
                                pendientes.push({
                                    phone,
                                    name: leadData?.name || '',
                                    producto: leadData?.desiredProduct || '',
                                    mensaje: msg.content || ''
                                });
                                break;
                            }
                        }
                    }
                    // Si el último mensaje del bot es de espera y no hay respuesta concreta posterior
                    const lastBotMsg = [...history].reverse().find(h => h.role === 'assistant');
                    if (lastBotMsg && esperaRegex.test(lastBotMsg.content)) {
                        // Buscar si después hubo una respuesta concreta (no de espera)
                        const afterBotMsgs = history.slice(history.lastIndexOf(lastBotMsg) + 1);
                        const hasConcrete = afterBotMsgs.some(h => h.role === 'assistant' && !esperaRegex.test(h.content));
                        if (!hasConcrete) {
                            const leadData = await getConversationLeadData(phone);
                            pendientes.push({
                                phone,
                                name: leadData?.name || '',
                                producto: leadData?.desiredProduct || '',
                                mensaje: lastBotMsg.content || ''
                            });
                        }
                    }
                }
                if (pendientes.length === 0) {
                    await message.reply('No hay chats con cotización pendiente hoy.');
                } else {
                    const lines = await Promise.all(pendientes.map(async p => {
                        let info = `- ${p.phone}`;
                        if (p.name) info += ` | ${p.name}`;
                        // Usar el producto guardado en el mensaje pendiente (ya asociado al folio)
                        let producto = p.producto;
                        if (producto) info += ` | Producto pendiente: ${producto}`;
                        if (p.mensaje) info += ` | Último mensaje: ${p.mensaje}`;
                        // Sugerir texto para responder cotización si aplica
                        if (/cotizaci[oó]n|precio|cu[aá]nto|costo/.test(p.mensaje) && producto) {
                            info += `\n  👉 Responde con: Q-XXXXXXXX Precio y tiempo de entrega para ${producto}`;
                        }
                        return info;
                    }));
                    await message.reply('Chats con cotización pendiente hoy:\n' + lines.join('\n'));
                }
                return;
            }
            if (/mensaje/.test(lowerOrder) && /hoy|total|cantidad|cu[aá]ntos?/.test(lowerOrder)) {
                // Contar mensajes de hoy usando la base de datos
                const { countUserMessagesToday } = require('./db');
                const total = await countUserMessagesToday();
                await message.reply(`Hoy se han recibido ${total} mensajes de clientes.`);
                return;
            }
            await message.reply('Orden recibida, pero no entendí la instrucción. Puedes pedir: pendientes, cuántos mensajes hoy, etc.');
            return;
        }
    }

    const parsed = parseOwnerQuoteReply(incomingText);

    // Permitir al asesor consultar información de una solicitud
    const infoMatch = String(incomingText || '').trim().match(/info\s+(Q-[A-Z0-9]{8})/i);
    if (infoMatch) {
        const quoteId = infoMatch[1].toUpperCase();
        const pending = pendingQuotes.get(quoteId);
        if (!pending) {
            await message.reply(`No encontré información para el folio ${quoteId}.`);
            return;
        }
        // Buscar datos recolectados del cliente
        const leadData = await getConversationLeadData(pending.clientPhone);
        let info = `Folio: ${quoteId}\n`;
        info += `Cliente: ${pending.clientPhone}\n`;
        info += `Producto: ${pending.requestedProduct || 'No identificado'}\n`;
        info += `Mensaje original: ${pending.clientQuestion}\n`;
        if (leadData) {
            if (leadData.name) info += `Nombre: ${leadData.name}\n`;
            if (leadData.email) info += `Correo: ${leadData.email}\n`;
            if (leadData.contact_phone) info += `Teléfono: ${leadData.contact_phone}\n`;
        }
        await message.reply(info.trim());
        return;
    }

    if (isOwnerQuoteInquiry(incomingText)) {
        await message.reply(buildPendingQuotesSummary());
        return;
    }

    if (message.hasMedia) {
        if (!parsed) {
            await message.reply('Para reenviar PDF al cliente incluye el folio en el texto o caption. Ejemplo: Q-XXXXXXXX');
            return;
        }

        const pendingWithMedia = pendingQuotes.get(parsed.quoteId);
        if (!pendingWithMedia) {
            await message.reply(`No encontre una solicitud activa para el folio ${parsed.quoteId}.`);
            return;
        }

        const media = await message.downloadMedia();
        if (!media) {
            await message.reply('No pude descargar el archivo enviado. Intenta reenviarlo con el folio.');
            return;
        }

        // Solo se envía al cliente el caption del asesor, sin el folio interno
        const caption = parsed.quoteText || 'Tu cotización formal adjunta.';
        // Obtener chatId válido para media
        let mediaChatId = pendingWithMedia.clientChatId;
        try {
            const numberId = await targetClient.getNumberId(pendingWithMedia.clientPhone);
            if (numberId && numberId._serialized) {
                mediaChatId = numberId._serialized;
            }
        } catch (e) {}
        await targetClient.sendMessage(mediaChatId, media, { caption });
        await saveConversationMessage(pendingWithMedia.clientPhone, 'assistant', caption, 'quote:formal-owner');
        await saveConversationMessage(OWNER_PHONE, 'user', incomingText, 'owner');

        pendingQuotes.delete(parsed.quoteId);
        await message.reply(`Cotizacion formal ${parsed.quoteId} enviada al cliente.`);
        return;
    }

    if (!parsed) {
        await message.reply('Para enviar precio al cliente usa: Q-XXXXXXXX Precio y tiempo de entrega');
        return;
    }

    const pending = pendingQuotes.get(parsed.quoteId);
    if (!pending) {
        await message.reply(`No encontre una solicitud activa para el folio ${parsed.quoteId}.`);
        return;
    }

    if (!parsed.quoteText) {
        await message.reply('Falta el detalle para enviar al cliente. Usa: Q-XXXXXXXX Precio y tiempo de entrega');
        return;
    }

    // Solo se envía al cliente el texto que escribió el asesor, sin folio ni referencias internas
    const customerText = parsed.quoteText;
    // Obtener chatId válido para respuesta
    let replyChatId = pending.clientChatId;
    try {
        const numberId = await targetClient.getNumberId(pending.clientPhone);
        if (numberId && numberId._serialized) {
            replyChatId = numberId._serialized;
        }
    } catch (e) {}
    await targetClient.sendMessage(replyChatId, customerText);
    await saveConversationMessage(pending.clientPhone, 'assistant', customerText, 'quote:owner');
    await saveConversationMessage(OWNER_PHONE, 'user', incomingText, 'owner');

    pendingQuotes.delete(parsed.quoteId);
    await message.reply(`Cotizacion ${parsed.quoteId} enviada al cliente.`);
}

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
        setBotStatus({ available: false, message: 'Autenticado, conectando...' });
    });

    targetClient.on('auth_failure', (msg) => {
        console.log('❌ [EVENT] auth_failure:', msg);
        setBotStatus({ available: false, message: 'Fallo de autenticación' });
    });

    targetClient.on('ready', () => {
        console.log('✅ [EVENT] ready - Cliente listo');
        setBotStatus({ available: true, message: 'Bot disponible' });
        console.log('⏳ Esperando mensajes...');
    });

    targetClient.on('loading_screen', (percent, message) => {
        console.log(`📊 [EVENT] loading_screen: ${percent}% - ${message}`);
    });

    targetClient.on('change_state', (state) => {
        console.log(`🔄 [EVENT] change_state: ${state}`);
    });

    const QRCode = require('qrcode');
    targetClient.on('qr', (qr) => {
        console.log('📱 [EVENT] qr');
        qrcode.generate(qr, { small: true });
        // Convertir el QR a data URL y guardarlo para la web
        QRCode.toDataURL(qr, { errorCorrectionLevel: 'H' }, (err, url) => {
            if (!err && url) {
                setLastQrDataUrl(url);
            } else {
                setLastQrDataUrl(null);
            }
        });
        setBotStatus({ available: false, message: 'Escanea el QR para conectar' });
    });
    // Limpiar QR cuando el bot esté listo
    targetClient.on('ready', () => {
        // ...existing code...
        setLastQrDataUrl(null);
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

        // ── Mensajes del asesor: sin debounce, procesar inmediato ──
        if (isOwnerPhone(phoneNumber)) {
            try {
                await handleOwnerMessage(targetClient, message, incomingText, phoneNumber);
                console.log('  ↳ ✅ Mensaje de asesor procesado');
            } catch (error) {
                console.error('  ↳ ❌ Error en mensaje de asesor:', error.message);
            }
            return;
        }

        // ── Debounce para clientes: acumular mensajes y esperar ──
        if (!messageBuffers.has(phoneNumber)) {
            messageBuffers.set(phoneNumber, []);
        }
        messageBuffers.get(phoneNumber).push({ message, text: incomingText });
        console.log(`  ↳ Mensaje en buffer (${messageBuffers.get(phoneNumber).length} acumulados). Esperando ${DEBOUNCE_MS}ms...`);

        // Cancelar timer anterior si existía
        if (debounceTimers.has(phoneNumber)) {
            clearTimeout(debounceTimers.get(phoneNumber));
        }

        // Iniciar nuevo timer
        const timer = setTimeout(async () => {
            debounceTimers.delete(phoneNumber);
            const buffered = messageBuffers.get(phoneNumber) || [];
            messageBuffers.delete(phoneNumber);

            if (buffered.length === 0) return;

            // Tomar el último mensaje como referencia para el reply
            const lastMessage = buffered[buffered.length - 1].message;
            // Unir todos los textos en uno solo para procesar con contexto completo
            const combinedText = buffered.length === 1
                ? buffered[0].text
                : buffered.map(b => b.text).join('\n');

            if (buffered.length > 1) {
                console.log(`  ↳ Procesando ${buffered.length} mensajes combinados de ${phoneNumber}`);
            }

            try {
                await processClientMessage(targetClient, lastMessage, combinedText, phoneNumber);
            } catch (error) {
                console.error('  ↳ ❌ Error procesando mensajes combinados:', error.message);
            }
        }, DEBOUNCE_MS);

        debounceTimers.set(phoneNumber, timer);
    });


// ── Helpers para extraer datos del historial completo del día ─────────────────

function extractQuantityFromHistory(history) {
    // Busca un número de piezas mencionado en cualquier mensaje del cliente ese día
    for (let i = history.length - 1; i >= 0; i--) {
        if (history[i].role !== 'user') continue;
        const m = history[i].content.match(/\b(\d+)\s*(piezas?|pzas?|unidades?|equipos?|juegos?)\b/i);
        if (m) return m[0].trim();
        // También acepta solo número si es respuesta a "¿cuántas piezas?"
        const solo = history[i].content.match(/^\s*(\d{1,4})\s*$/);
        if (solo) return solo[1].trim();
    }
    return null;
}

function extractPickupFromHistory(history) {
    // Detecta si en algún mensaje el cliente indicó que pasa a recoger en tienda
    const pickupRe = /\ben\s+tienda\b|\bpaso\s+(a|por)\b|\bvoy\s+(a|yo)\b|\brec[ou]jo\b|\bpick\s*up\b|\brecoger\b|\bpaso\s+yo\b|\bvoy\s+yo\b|\bme\s+lo\s+llevo\b|\bpaso\s+a\s+recoger\b/i;
    return history.some(h => h.role === 'user' && pickupRe.test(h.content));
}

function extractDestinationFromHistory(history) {
    // Detecta ciudad/destino de entrega mencionado por el cliente
    const deliveryRe = /\benvi[oó]\b|\bentrega\b|\bmandar\b|\bllev[ae]r\b/i;
    for (let i = history.length - 1; i >= 0; i--) {
        if (history[i].role !== 'user') continue;
        if (deliveryRe.test(history[i].content)) {
            return history[i].content.trim().slice(0, 80);
        }
    }
    return null;
}

// ── Función principal de procesamiento de mensajes de clientes ────────────────
async function processClientMessage(targetClient, message, incomingText, phoneNumber) {
    console.log('  ↳ Procesando...');

    await saveConversationMessage(phoneNumber, 'user', incomingText, 'whatsapp');
    const leadState = getLeadState(phoneNumber);
    await ensureLeadStateFromDb(phoneNumber, leadState);

    const { isFarewellMessage } = require('./ai');

    if (isFarewellMessage(incomingText)) {
        leadState.closed = true;
        const sameDayHistory = await getRecentConversationHistory(phoneNumber, 30, { sameDayOnly: true });
        const aiResult = await queryAI({ text: incomingText, history: sameDayHistory, phoneNumber });
        await saveConversationMessage(phoneNumber, 'assistant', aiResult.reply, 'farewell');
        await message.reply(aiResult.reply);
        console.log('  ↳ 🚪 Conversación marcada como cerrada por despedida');
        return;
    }

    if (leadState.closed) {
        const shouldReopen = isFormalQuoteRequest(incomingText) || isQuoteRequest(incomingText) || isProductIntent(incomingText);
        if (!shouldReopen) {
            console.log('  ↳ 🚪 Conversación cerrada, ignorando mensaje no relevante');
            return;
        }
        leadState.closed = false;
        console.log('  ↳ 🔓 Conversación reabierta por nueva solicitud');
    }

    const isQuote = isFormalQuoteRequest(incomingText) || isQuoteRequest(incomingText);
    const isProduct = isProductIntent(incomingText);
    const sameDayHistory = await getRecentConversationHistory(phoneNumber, 30, { sameDayOnly: true });
    let requestedProduct = detectRequestedProduct(incomingText) || detectRequestedProductFromHistory(sameDayHistory);

    if (isQuote && !requestedProduct) {
        const aiResult = await queryAI({ text: '¿Qué equipo necesitas cotizar?', history: sameDayHistory, phoneNumber });
        await message.reply(aiResult.reply);
        await saveConversationMessage(phoneNumber, 'assistant', aiResult.reply, 'lead:ask-product');
        return;
    }

    if ((isQuote || isProduct) && requestedProduct) {

        // ── Nombre ────────────────────────────────────────────────────────────
        if (!leadState.name) {
            const aiResult = await queryAI({ text: 'Por favor dime tu nombre para registrar tu solicitud', history: sameDayHistory, phoneNumber });
            await message.reply(aiResult.reply);
            await saveConversationMessage(phoneNumber, 'assistant', aiResult.reply, 'lead:ask-name');
            leadState.awaitingName = true;
            return;
        }
        if (leadState.awaitingName) {
            const detectedName = extractNameFromText(incomingText);
            if (detectedName) {
                leadState.name = detectedName;
                leadState.awaitingName = false;
                await upsertConversationLeadData(phoneNumber, { name: detectedName });
            }
        }

        // ── Cantidad: buscar en historial antes de preguntar ──────────────────
        if (!leadState.quantity) {
            // 1. Buscar en el historial completo del día
            const qtyFromHistory = extractQuantityFromHistory([...sameDayHistory, { role: 'user', content: incomingText }]);
            if (qtyFromHistory) {
                leadState.quantity = qtyFromHistory;
                leadState.awaitingQuantity = false;
                console.log(`  ↳ Cantidad detectada del historial: ${qtyFromHistory}`);
            } else if (leadState.awaitingQuantity) {
                // El cliente está respondiendo la pregunta de cantidad
                const qtyMatch = incomingText.match(/\b(\d+)\s*(piezas?|pzas?|unidades?|equipos?|juegos?)?/i);
                leadState.quantity = qtyMatch ? qtyMatch[0].trim() : incomingText.trim().slice(0, 40);
                leadState.awaitingQuantity = false;
            } else {
                // No hay cantidad en ningún lado: preguntar UNA sola vez
                const prodLabel = Array.isArray(requestedProduct) ? requestedProduct[0] : requestedProduct;
                const reply = `¿Cuántas piezas de ${prodLabel} necesitas?`;
                await message.reply(reply);
                await saveConversationMessage(phoneNumber, 'assistant', reply, 'lead:ask-quantity');
                leadState.awaitingQuantity = true;
                return;
            }
        }

        // ── Destino: si el cliente dijo que pasa a tienda, no preguntar ───────
        if (!leadState.deliveryAddress) {
            const allMessages = [...sameDayHistory, { role: 'user', content: incomingText }];

            // ¿Ya dijo que viene a tienda en algún mensaje?
            if (extractPickupFromHistory(allMessages)) {
                leadState.deliveryAddress = 'recoge en tienda';
                leadState.awaitingDestination = false;
                await upsertConversationLeadData(phoneNumber, { deliveryAddress: 'recoge en tienda' });
                console.log('  ↳ Destino: recoge en tienda (detectado del historial)');
            } else if (leadState.awaitingDestination) {
                leadState.deliveryAddress = incomingText.trim().slice(0, 80);
                leadState.awaitingDestination = false;
                await upsertConversationLeadData(phoneNumber, { deliveryAddress: leadState.deliveryAddress });
            } else {
                // No hay info de destino: preguntar UNA sola vez
                const reply = '¿Pasas a recoger en tienda o necesitas envío?';
                await message.reply(reply);
                await saveConversationMessage(phoneNumber, 'assistant', reply, 'lead:ask-destination');
                leadState.awaitingDestination = true;
                return;
            }
        }

        // ── Tenemos todo: notificar al asesor ─────────────────────────────────
        await handleQuoteRequest(targetClient, message, phoneNumber, incomingText, {
            isFormal: isFormalQuoteRequest(incomingText),
            requestedProduct,
            quantity: leadState.quantity,
            deliveryAddress: leadState.deliveryAddress
        });
        console.log('  ↳ ✅ Solicitud registrada para seguimiento');
        return;
    }

    const result = await queryAI({ text: incomingText, history: sameDayHistory, phoneNumber });
    console.log(`🤖 [AI OUT] provider=${result.provider} reply=${String(result.reply || '').substring(0, 220)}`);
    await message.reply(result.reply);
    await saveConversationMessage(phoneNumber, 'assistant', result.reply, result.provider);
    console.log('  ↳ ✅ Respuesta enviada');
}


    targetClient.on('disconnected', (reason) => {
        console.log('⚠️  [EVENT] disconnected:', reason);
        setBotStatus({ available: false, message: `Desconectado: ${reason}` });
        if (reason === 'LOGOUT') {
            console.log('LOGOUT: Eliminando sesión y terminando...');
            fs.rmSync(authRoot, { recursive: true, force: true });
            process.exit(1);
        }
    });

    targetClient.on('error', (error) => {
        console.error('❌ [EVENT] error:', error.message);
        setBotStatus({ available: false, message: `Error: ${error.message}` });
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