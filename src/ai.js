const OpenAI = require('openai');
require('dotenv').config();

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || 'sk-test-key-for-demo', // Key de prueba temporal
});

const OPENAI_COOLDOWN_MS = Number(process.env.OPENAI_COOLDOWN_MS || 10 * 60 * 1000);
const GEMINI_COOLDOWN_MS = Number(process.env.GEMINI_COOLDOWN_MS || 5 * 60 * 1000);
const GEMINI_MODELS = [
    process.env.GEMINI_MODEL || 'gemini-2.0-flash',
    'gemini-2.0-flash-lite',
    'gemini-1.5-flash'
];
let openAIDisabledUntil = 0;
let geminiDisabledUntil = 0;

const fallbackResponses = [
    '¡Hola! Soy el asistente de ARMAQ Maquinaria Ligera. Estamos en Calle 50 Norte esquina con 76, Playa del Carmen. Lunes a viernes 8am-6pm.',
    '¡Hola! En ARMAQ Maquinaria Ligera vendemos maquinaria para construcción. ¿Qué producto te interesa?',
    '¡Hola! Nuestra sucursal en Playa del Carmen atiende de lunes a viernes de 8am a 6pm. Solo venta de equipos.',
    '¡Hola! Somos ARMAQ Maquinaria Ligera, especialistas en venta de equipo para construcción en Playa del Carmen.',
];

function toOpenAIHistory(history) {
    if (!Array.isArray(history)) {
        return [];
    }

    return history
        .filter((entry) => entry && (entry.role === 'user' || entry.role === 'assistant') && entry.content)
        .slice(-10)
        .map((entry) => ({
            role: entry.role,
            content: entry.content
        }));
}

function toGeminiHistoryBlock(history) {
    if (!Array.isArray(history) || history.length === 0) {
        return 'Sin historial previo.';
    }

    return history
        .filter((entry) => entry && (entry.role === 'user' || entry.role === 'assistant') && entry.content)
        .slice(-10)
        .map((entry) => `${entry.role.toUpperCase()}: ${entry.content}`)
        .join('\n');
}

function getFallbackResponse() {
    return fallbackResponses[Math.floor(Math.random() * fallbackResponses.length)];
}

function canUseOpenAI() {
    if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'tu_api_key_aqui') {
        return false;
    }

    if (Date.now() < openAIDisabledUntil) {
        const remainingSec = Math.ceil((openAIDisabledUntil - Date.now()) / 1000);
        console.log(`OpenAI en cooldown por cuota. Reintento en ${remainingSec}s`);
        return false;
    }

    return true;
}

function getSystemPrompt() {
    return `Eres un asistente virtual para ARMAQ Maquinaria Ligera, una empresa de venta de maquinaria y equipo para construcción en Playa del Carmen, Quintana Roo.

INFORMACIÓN DEL NEGOCIO:
- Nombre: ARMAQ Maquinaria Ligera
- Ubicación: Calle 50 Norte esquina con 76, Colonia Luis Donaldo Colosio, Playa del Carmen, Quintana Roo
- Google Maps: https://maps.app.goo.gl/nDFcCSeze3XhSk1K7
- Horarios: Lunes a viernes de 8:00 AM a 6:00 PM. Sábados y domingos: No laboramos
- Servicios: Venta de maquinaria para construcción (NO manejamos renta)
- Productos: Vendemos maquinaria para construcción incluyendo:
  * Andamios y puntales
  * Malacates y polipastos
  * Compresores
  * Generadores
  * Vibradores de concreto
  * Cortadoras de plasma
  * Equipos de construcción en general
  * Materiales y herramientas para construcción

IMPORTANTE:
- NO mencionamos precios específicos
- Somos una empresa de VENTA, NO de renta
- Sé amable y profesional
- Responde como asesor comercial por WhatsApp: claro, humano y directo
- Cuando te pidan informacion comercial, cierra con una invitacion a continuar (ej: "si quieres te comparto opciones")
- Si el mensaje es ambiguo, haz una sola pregunta de aclaracion breve
- Si preguntan por productos específicos, confirma disponibilidad sin precios
- Si preguntan por ubicación, proporciona la dirección completa y el enlace de Google Maps
- Si preguntan por horarios, proporciona la información exacta
- Si preguntan por renta, aclara que solo vendemos equipos
- Si no sabes algo específico, ofrece contactar directamente con la sucursal

FORMATO DE RESPUESTA:
- Maximo 4 lineas
- Usa espanol neutro
- Evita texto repetitivo o generico
`;
}

async function tryOpenAI(text, history, phoneNumber) {
    if (!canUseOpenAI()) {
        return null;
    }

    console.log('Intentando con OpenAI... API key presente:', process.env.OPENAI_API_KEY.substring(0, 10) + '...');
    const messages = [
        {
            role: 'system',
            content: getSystemPrompt()
        },
        {
            role: 'system',
            content: `Telefono del cliente: ${phoneNumber || 'desconocido'}. Usa esto solo para contexto interno, no lo repitas.`
        },
        ...toOpenAIHistory(history),
        {
            role: 'user',
            content: text
        }
    ];

    const completion = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages,
        max_tokens: 150,
        temperature: 0.55,
    });

    const response = completion.choices[0].message.content.trim();
    console.log('OpenAI respondió correctamente');
    return { reply: response, provider: 'openai' };
}

async function tryGemini(text, history, phoneNumber) {
    if (!process.env.GOOGLE_API_KEY) {
        return null;
    }

    if (Date.now() < geminiDisabledUntil) {
        const remainingSec = Math.ceil((geminiDisabledUntil - Date.now()) / 1000);
        console.log(`Gemini en cooldown por cuota. Reintento en ${remainingSec}s`);
        return null;
    }

    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
    const prompt = `Eres un asistente para ARMAQ Maquinaria Ligera - venta de maquinaria.

Información del negocio:
- Nombre: ARMAQ Maquinaria Ligera
- Ubicación: Calle 50 Norte esquina con 76, Colonia Luis Donaldo Colosio, Playa del Carmen, Quintana Roo
- Google Maps: https://maps.app.goo.gl/nDFcCSeze3XhSk1K7
- Horarios: Lunes a viernes 8am a 6pm, sábados y domingos no laboramos
- Servicios: Solo venta de equipos, NO manejamos renta
- Productos: Maquinaria para construcción (andamios, puntales, malacates, compresores, generadores, etc.)

Telefono del cliente (solo contexto interno): ${phoneNumber || 'desconocido'}

Historial reciente:
${toGeminiHistoryBlock(history)}

Pregunta del usuario:
${text}

Instrucciones de respuesta:
- Espanol claro y natural para WhatsApp
- Maximo 4 lineas
- No menciones precios
- Si preguntan por renta, aclara venta unicamente
- Si falta informacion, haz una sola pregunta corta de aclaracion
- Cierra con invitacion a continuar la conversacion.`;

    for (const modelName of GEMINI_MODELS) {
        try {
            console.log(`Intentando Gemini con modelo: ${modelName}`);
            const model = genAI.getGenerativeModel({
                model: modelName,
                generationConfig: {
                    maxOutputTokens: 150,
                    temperature: 0.7,
                },
            });

            const result = await model.generateContent(prompt);
            const response = await result.response;
            return { reply: response.text().trim(), provider: `gemini:${modelName}` };
        } catch (error) {
            const statusCode = error?.status || error?.statusCode;
            const isQuotaError = statusCode === 429 || String(error?.message || '').includes('429');
            if (isQuotaError) {
                geminiDisabledUntil = Date.now() + GEMINI_COOLDOWN_MS;
                console.error(`Gemini cuota excedida (429). Activando cooldown por ${Math.ceil(GEMINI_COOLDOWN_MS / 60000)} min.`);
                return null;
            }

            console.error(`Error con modelo Gemini ${modelName}:`, error.message);
        }
    }

    return null;
}

/**
 * Consulta al modelo de IA con el texto proporcionado
 * @param {object} params - Parametros de consulta
 * @param {string} params.text - Mensaje del usuario
 * @param {Array<{role: string, content: string}>} [params.history] - Historial reciente
 * @param {string} [params.phoneNumber] - Numero de telefono normalizado
 * @returns {{reply: string, provider: string}} Respuesta y proveedor usado
 */
async function queryAI({ text, history = [], phoneNumber = '' }) {
    try {
        console.log('Procesando mensaje:', text.substring(0, 50) + '...');
        try {
            const openAIResponse = await tryOpenAI(text, history, phoneNumber);
            if (openAIResponse) {
                return openAIResponse;
            }
        } catch (error) {
            const statusCode = error?.status || error?.statusCode;
            const isQuotaError = statusCode === 429 || String(error?.message || '').includes('429');

            if (isQuotaError) {
                openAIDisabledUntil = Date.now() + OPENAI_COOLDOWN_MS;
                console.error(`OpenAI cuota excedida (429). Activando cooldown por ${Math.ceil(OPENAI_COOLDOWN_MS / 60000)} min.`);
            } else {
                console.error('Error en OpenAI:', error.message);
            }
        }

        try {
            const geminiResponse = await tryGemini(text, history, phoneNumber);
            if (geminiResponse) {
                return geminiResponse;
            }
        } catch (error) {
            console.error('Error en Gemini:', error.message);
        }

        console.log('Ninguna API disponible, usando respuestas de respaldo');
        return { reply: getFallbackResponse(), provider: 'fallback' };

    } catch (error) {
        console.error('Error consultando IA:', error.message);
        return { reply: getFallbackResponse(), provider: 'fallback:error' };
    }
}

module.exports = { queryAI };