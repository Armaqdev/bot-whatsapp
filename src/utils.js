/**
 * Registra un mensaje en la consola con timestamp
 * @param {string} message - El mensaje a registrar
 */
function logMessage(message) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${message}`);
}

/**
 * Valida si un mensaje contiene texto válido
 * @param {string} text - El texto a validar
 * @returns {boolean} - True si es válido
 */
function isValidMessage(text) {
    return text && text.trim().length > 0 && text.length < 4096; // Límite de WhatsApp
}

/**
 * Limpia y sanitiza el texto del mensaje
 * @param {string} text - El texto a limpiar
 * @returns {string} - Texto limpio
 */
function sanitizeMessage(text) {
    return text.trim().replace(/\n{3,}/g, '\n\n'); // Limitar saltos de línea
}

module.exports = {
    logMessage,
    isValidMessage,
    sanitizeMessage
};