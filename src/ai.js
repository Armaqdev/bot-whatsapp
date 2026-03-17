const OpenAI = require('openai');
const { getCatalogContext, getCatalogReply, getPromotionContext, getPromotionReply } = require('./catalog');
require('dotenv').config();

const AI_PROVIDER = String(process.env.AI_PROVIDER || 'openai').toLowerCase();
const USE_OLLAMA = AI_PROVIDER === 'ollama';
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434/v1';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2';

const openai = new OpenAI({
    apiKey: USE_OLLAMA ? (process.env.OLLAMA_API_KEY || 'ollama') : (process.env.OPENAI_API_KEY || 'sk-test-key-for-demo'),
    baseURL: USE_OLLAMA ? OLLAMA_BASE_URL : undefined,
});

const OPENAI_COOLDOWN_MS = Number(process.env.OPENAI_COOLDOWN_MS || 10 * 60 * 1000);
let openAIDisabledUntil = 0;

const fallbackResponses = [
    'Claro, ya lo reviso y te doy la información en un momento.',
    'Perfecto, en un momento te comparto la información.',
    'Gracias por tu mensaje. En breve te confirmo lo que necesitas.',
    'Entendido, ya estoy revisando tu solicitud para darte respuesta enseguida.',
];

// ─── Utilidades de texto ──────────────────────────────────────────────────────

function normalizeText(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
}

// ─── Detección de intenciones ─────────────────────────────────────────────────

function isGreetingMessage(text) {
    const n = normalizeText(text);
    if (!n || n.split(' ').length > 4) return false;
    const greetings = ['hola', 'buen dia', 'buenos dias', 'buenas tardes', 'buenas noches', 'que tal', 'buenas', 'hey'];
    return greetings.some((w) => n === w || n.startsWith(`${w} `));
}

function isFarewellMessage(text) {
    const n = normalizeText(text);
    if (!n) return false;
    const farewells = [
        'gracias', 'muchas gracias', 'ok', 'al rato paso', 'nos vemos', 'hasta luego', 'bye',
        'adios', 'me avisas', 'estamos en contacto', 'luego te aviso', 'luego paso', 'luego regreso',
        'luego te marco', 'luego te llamo', 'luego te escribo', 'hasta mañana', 'hasta manana',
        'hasta pronto', 'hasta la proxima', 'buenas noches', 'saludos', 'listo', 'perfecto',
        'excelente', 'de acuerdo', 'vale', 'va', 'sale',
    ];
    return farewells.some((w) => n === w || n.startsWith(`${w} `) || n.endsWith(` ${w}`));
}

function isRentalRequest(text) {
    const n = normalizeText(text);
    return /\brenta\b|\brentar\b|\balquiler\b|\balquilar\b/.test(n);
}

function isFreightRequest(text) {
    const n = normalizeText(text);
    return /\bflete\b|\benvio\b|\benvío\b|\bentrega\b|\btransporte\b|\bcuanto.*flete\b|\bcuanto.*envio\b|\bcuanto.*entrega\b/.test(n);
}

/**
 * Detecta si el cliente está preguntando por disponibilidad de un producto.
 * Ej: "¿tienen andamios?", "¿manejan compresores?", "¿hay vibradores?"
 */
function isAvailabilityRequest(text) {
    const n = normalizeText(text);
    return /\btienen\b|\btiene\b|\bmanejan\b|\bmaneja\b|\bhay\b|\bdisponib|\bcuentan\b|\bvenden\b|\bvende\b/.test(n);
}

/**
 * Detecta solicitudes de cotización o precio.
 * Ej: "¿cuánto cuesta?", "me puedes cotizar", "precio de..."
 */
function isQuoteRequest(text) {
    const n = normalizeText(text);
    return /\bcoti(z|s)|\bprecio\b|\bcuanto cuesta\b|\bcuanto vale\b|\bme das un precio\b|\bme puedes dar el costo\b|\bcosto de\b|\bimporte\b|\bcuanto sale\b/.test(n);
}

/**
 * Detecta preguntas sobre horarios o ubicación.
 */
function isLocationOrHoursRequest(text) {
    const n = normalizeText(text);
    return /\bhorario\b|\bque hora\b|\ba que hora\b|\bcuando abren\b|\bcuando cierran\b|\bdonde estan\b|\bdireccion\b|\bubicacion\b|\bcomo llegar\b|\bdonde queda\b|\bmapa\b/.test(n);
}

// ─── Respuestas de política ───────────────────────────────────────────────────

function getWelcomeMessage() {
    return 'Hola, asesor de ventas ARMAQ. ¿En qué le puedo ayudar?';
}

function getFreightReply() {
    return 'El envío dentro de Playa del Carmen es sin costo. Para entregas fuera de la ciudad, el flete se incluye en la cotización formal. ¿A qué zona o ciudad necesitas el envío?';
}

function getRentalReply() {
    return 'Por el momento solo manejamos venta de equipos, no renta. Si gustas, te confirmo disponibilidad del equipo que necesitas y te compartimos opciones.';
}

function getLocationReply() {
    return 'Estamos en Calle 50 Norte esquina con 76, Col. Luis Donaldo Colosio, Playa del Carmen. Aquí el mapa: https://maps.app.goo.gl/nDFcCSeze3XhSk1K7\nAtendemos lunes a viernes de 8:00 AM a 6:00 PM.';
}

function isPaymentRequest(text) {
    const n = normalizeText(text);
    return /\bpago\b|\bpagar\b|\bformas?\s+de\s+pago\b|\bmetodos?\s+de\s+pago\b|\btarjeta\b|\befectivo\b|\btransferencia\b|\bdepósito\b|\bdeposito\b|\bcomo\s+pago\b|\bcomo\s+se\s+paga\b/.test(n);
}

function isDeliveryOutsidePlaya(text) {
    const n = normalizeText(text);
    // Detectar si el cliente mencionó entrega/envío fuera de Playa del Carmen
    const isOutside = /\bcancun\b|\btulum\b|\bcobá\b|\bcoba\b|\bfелipe\b|\bfelipe\s+carrillo\b|\bchetumal\b|\bholbox\b|\bisla\s+mujeres\b|\bpuerto\s+morelos\b|\bvalladolid\b|\bmerida\b|\bmexico\b|\bcdmx\b|\bmonterrey\b|\bguadalajara\b|\botro\s+estado\b|\botra\s+ciudad\b|\bfuera\s+de\s+playa\b|\bfuera\s+de\s+la\s+ciudad\b|\bquintana\s+roo\b|\bq\.?\s*roo\b|\botro\s+municipio\b|\benvio\b|\benvío\b|\bentrega\s+a\b/.test(n);
    const isPlaya = /\bplaya\b|\bplaya\s+del\s+carmen\b|\ben\s+tienda\b|\bpaso\s+a\s+tienda\b|\bvoy\s+a\s+tienda\b|\brec[ou]jo\b|\bpaso\s+por\b/.test(n);
    return isOutside && !isPlaya;
}

function isPickupInStore(text) {
    const n = normalizeText(text);
    return /\ben\s+tienda\b|\bpaso\s+a\s+tienda\b|\bvoy\s+a\s+tienda\b|\brec[ou]jo\b|\bpaso\s+por\b|\bpaso\s+yo\b|\bvoy\s+yo\b|\bpick\s*up\b|\brecoger\b/.test(n);
}

function getPaymentReply(text) {
    if (isPickupInStore(text)) {
        return 'En tienda aceptamos efectivo, tarjeta de débito/crédito y transferencia bancaria.';
    }
    if (isDeliveryOutsidePlaya(text)) {
        return 'Para envíos fuera de Playa del Carmen el pago es únicamente por transferencia bancaria.';
    }
    // Pregunta genérica sin contexto de entrega
    return 'En tienda aceptamos efectivo, tarjeta y transferencia. Para envíos fuera de Playa del Carmen el pago es por transferencia únicamente.';
}

// ─── Prompt del sistema ───────────────────────────────────────────────────────

function getSystemPrompt() {
    return `Eres un asesor de ventas de ARMAQ Maquinaria Ligera, empresa especializada en venta de maquinaria y equipo para construcción en Playa del Carmen, Quintana Roo. Tu canal es WhatsApp.

## DATOS DE LA EMPRESA
- Dirección: Calle 50 Norte esquina con 76, Col. Luis Donaldo Colosio, Playa del Carmen, Q. Roo
- Mapa: https://maps.app.goo.gl/nDFcCSeze3XhSk1K7
- Horario: Lunes a viernes 8:00 AM – 6:00 PM. No laboramos sábados ni domingos.
- Giro: VENTA de maquinaria para construcción (no manejamos renta)

## PRODUCTOS QUE VENDEMOS
Andamios, puntales, malacates, polipastos, compresores, generadores, vibradores de concreto, cortadoras de plasma, herramienta y materiales para construcción.

## FORMAS DE PAGO
- Compra en tienda: efectivo, tarjeta de débito/crédito o transferencia bancaria.
- Envío fuera de Playa del Carmen (cualquier municipio o ciudad): transferencia bancaria únicamente.
- Si el cliente pregunta por formas de pago y ya mencionó que viene a tienda, indica las tres opciones.
- Si ya mencionó envío fuera de Playa, indica solo transferencia.
- Si no hay contexto claro, menciona ambas políticas en una sola respuesta.

## REGLAS DE RESPUESTA
1. NUNCA menciones precios exactos; si preguntan, indícales que la cotización se hace según el equipo y cantidad, e invítalos a solicitarla.
2. NUNCA confirmes disponibilidad de ningún producto. Cuando pregunten si tienes algo, responde que revisarás y confirmarás. Ejemplos correctos: "Déjame revisar y te confirmo si tenemos existencia." "En cuanto verifique te aviso." NUNCA digas "sí tenemos", "sí manejamos", "sí contamos con".
3. NUNCA menciones tiempos de entrega. Eso lo confirma el equipo después de revisar.
4. Si el cliente solicita una cotización, pide: (a) qué equipo necesita, (b) cantidad, (c) si es para entrega o recoge en tienda. Con esa info el equipo le prepara la cotización.
5. Si preguntan por ubicación u horarios, da la información completa de una sola vez.
6. Si el mensaje es ambiguo, haz UNA sola pregunta de aclaración breve y directa.
7. No des recomendaciones técnicas detalladas (eso lo maneja el equipo en piso).
8. No repitas el saludo en cada mensaje; ve directo a la información.
9. Nunca te identifiques como bot, IA o asistente virtual.
10. No menciones marcas específicas de equipos en respuestas generales.
11. Cierra siempre con una invitación a continuar la conversación o a acercarse a la tienda.

## TONO Y FORMATO
- Lenguaje: español neutro, amable y directo, como un vendedor real de WhatsApp
- Longitud: máximo 4 líneas por respuesta
- Evita palabras de relleno: "por supuesto", "claro que sí", "con gusto"
- Usa puntuación natural; no listas de bullets a menos que sea necesario
`;
}

// ─── Helpers de IA ───────────────────────────────────────────────────────────

function toOpenAIHistory(history) {
    if (!Array.isArray(history)) return [];
    return history
        .filter((e) => e && (e.role === 'user' || e.role === 'assistant') && e.content)
        .slice(-10)
        .map((e) => ({ role: e.role, content: e.content }));
}

function getFallbackResponse() {
    return fallbackResponses[Math.floor(Math.random() * fallbackResponses.length)];
}

function canUseOpenAI() {
    if (USE_OLLAMA) return true;
    if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'tu_api_key_aqui') return false;
    if (Date.now() < openAIDisabledUntil) {
        const remaining = Math.ceil((openAIDisabledUntil - Date.now()) / 1000);
        console.log(`OpenAI en cooldown. Reintento en ${remaining}s`);
        return false;
    }
    return true;
}

async function tryOpenAI(text, history, phoneNumber) {
    if (!canUseOpenAI()) return null;

    const label = USE_OLLAMA ? `Ollama (${OLLAMA_MODEL})` : 'OpenAI';
    console.log(`Intentando con ${label}...`);

    const [catalogContext, promotionContext] = await Promise.all([
        getCatalogContext(text),
        getPromotionContext(text),
    ]);

    const messages = [
        { role: 'system', content: getSystemPrompt() },
        { role: 'system', content: `Teléfono del cliente: ${phoneNumber || 'desconocido'}. Solo para contexto interno.` },
        { role: 'system', content: catalogContext || 'Sin contexto adicional de catálogo para este mensaje.' },
        { role: 'system', content: promotionContext || 'Sin promociones activas para este mensaje.' },
        ...toOpenAIHistory(history),
        { role: 'user', content: text },
    ];

    const completion = await openai.chat.completions.create({
        model: USE_OLLAMA ? OLLAMA_MODEL : 'gpt-3.5-turbo',
        messages,
        max_tokens: 180,   // Ligeramente más margen para respuestas completas
        temperature: 0.45, // Más consistente y menos genérico
    });

    const reply = completion.choices[0].message.content.trim();
    const provider = USE_OLLAMA ? `ollama:${OLLAMA_MODEL}` : 'openai';
    console.log(`${label} respondió correctamente`);
    return { reply, provider };
}

// ─── Función principal ────────────────────────────────────────────────────────

/**
 * Consulta al modelo de IA con el texto proporcionado.
 * @param {object} params
 * @param {string} params.text - Mensaje del usuario
 * @param {Array<{role: string, content: string}>} [params.history] - Historial reciente
 * @param {string} [params.phoneNumber] - Número de teléfono normalizado
 * @returns {Promise<{reply: string, provider: string}>}
 */
async function queryAI({ text, history = [], phoneNumber = '' }) {
    try {
        console.log('Procesando mensaje:', text.substring(0, 60) + (text.length > 60 ? '...' : ''));

        // 1. Saludo simple → respuesta fija
        if (isGreetingMessage(text)) {
            return { reply: getWelcomeMessage(), provider: 'welcome' };
        }

        // 2. Flete / envío → política clara + pregunta de destino
        if (isFreightRequest(text)) {
            return { reply: getFreightReply(), provider: 'policy:freight' };
        }

        // 3. Renta → aclaración + oferta de venta
        if (isRentalRequest(text)) {
            return { reply: getRentalReply(), provider: 'policy:rental' };
        }

        // 4. Ubicación / horarios → respuesta completa de una vez
        if (isLocationOrHoursRequest(text)) {
            return { reply: getLocationReply(), provider: 'policy:location' };
        }

        // 5. Forma de pago → respuesta según contexto de entrega
        if (isPaymentRequest(text)) {
            return { reply: getPaymentReply(text), provider: 'policy:payment' };
        }

        // 5. Promociones del catálogo local
        try {
            const promotionReply = await getPromotionReply(text);
            if (promotionReply) return { reply: promotionReply, provider: 'promotion' };
        } catch (err) {
            console.error('Error en promociones:', err.message);
        }

        // 6. Respuesta de catálogo local (disponibilidad / producto específico)
        try {
            const catalogReply = await getCatalogReply(text);
            if (catalogReply) return { reply: catalogReply, provider: 'catalog' };
        } catch (err) {
            console.error('Error en catálogo:', err.message);
        }

        // 7. IA (OpenAI / Ollama) con contexto enriquecido
        try {
            const aiResponse = await tryOpenAI(text, history, phoneNumber);
            if (aiResponse) return aiResponse;
        } catch (err) {
            if (USE_OLLAMA) {
                console.error('Error en Ollama:', err.message);
                return { reply: getFallbackResponse(), provider: 'fallback:ollama-error' };
            }

            const status = err?.status || err?.statusCode;
            const isQuota = status === 429 || String(err?.message || '').includes('429');

            if (isQuota) {
                openAIDisabledUntil = Date.now() + OPENAI_COOLDOWN_MS;
                console.error(`OpenAI cuota excedida. Cooldown por ${Math.ceil(OPENAI_COOLDOWN_MS / 60000)} min.`);
            } else {
                console.error('Error en OpenAI:', err.message);
            }
        }

        // 8. Fallback genérico
        console.log('IA no disponible, usando fallback.');
        return { reply: getFallbackResponse(), provider: 'fallback' };

    } catch (err) {
        console.error('Error general en queryAI:', err.message);
        return { reply: getFallbackResponse(), provider: 'fallback:error' };
    }
}

module.exports = { queryAI, isFarewellMessage, isPaymentRequest, isPickupInStore, isDeliveryOutsidePlaya };