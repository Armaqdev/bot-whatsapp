const { Pool } = require('pg');
require('dotenv').config();

let pool = null;
let dbReady = false;

function isDbConfigured() {
    return Boolean(process.env.DATABASE_URL || process.env.PGHOST);
}

function getPool() {
    if (pool) {
        return pool;
    }

    if (!isDbConfigured()) {
        return null;
    }

    const useSsl = String(process.env.PGSSL || '').toLowerCase() === 'true';
    const ssl = useSsl ? { rejectUnauthorized: false } : undefined;

    if (process.env.DATABASE_URL) {
        pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl
        });
        return pool;
    }

    pool = new Pool({
        host: process.env.PGHOST,
        port: Number(process.env.PGPORT || 5432),
        database: process.env.PGDATABASE,
        user: process.env.PGUSER,
        password: process.env.PGPASSWORD,
        ssl
    });

    return pool;
}

async function initDatabase() {
    const db = getPool();
    if (!db) {
        console.warn('DB no configurada. El bot seguira sin historial persistente.');
        return false;
    }

    const autoMigrate = String(process.env.DB_AUTO_MIGRATE || 'true').toLowerCase() === 'true';
    try {
        if (autoMigrate) {
            await db.query(`
                CREATE TABLE IF NOT EXISTS conversations (
                    id BIGSERIAL PRIMARY KEY,
                    phone_number VARCHAR(32) NOT NULL UNIQUE,
                    customer_name VARCHAR(120),
                    contact_phone VARCHAR(32),
                    email VARCHAR(160),
                    desired_product VARCHAR(180),
                    delivery_address TEXT,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
            `);

            await db.query('ALTER TABLE conversations ADD COLUMN IF NOT EXISTS customer_name VARCHAR(120);');
            await db.query('ALTER TABLE conversations ADD COLUMN IF NOT EXISTS contact_phone VARCHAR(32);');
            await db.query('ALTER TABLE conversations ADD COLUMN IF NOT EXISTS email VARCHAR(160);');
            await db.query('ALTER TABLE conversations ADD COLUMN IF NOT EXISTS desired_product VARCHAR(180);');
            await db.query('ALTER TABLE conversations ADD COLUMN IF NOT EXISTS delivery_address TEXT;');

            await db.query(`
                CREATE TABLE IF NOT EXISTS messages (
                    id BIGSERIAL PRIMARY KEY,
                    conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
                    role VARCHAR(16) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
                    content TEXT NOT NULL,
                    provider VARCHAR(32),
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
            `);

            await db.query('CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON messages(conversation_id, created_at DESC);');
            await db.query('CREATE INDEX IF NOT EXISTS idx_messages_role ON messages(role);');
        }

        dbReady = true;
        console.log('DB conectada correctamente. Historial persistente habilitado.');
        return true;
    } catch (error) {
        console.error('Error inicializando PostgreSQL:', error.message);
        dbReady = false;
        return false;
    }
}

function normalizePhoneNumber(rawPhoneNumber) {
    return String(rawPhoneNumber || '')
        .split('@')[0]
        .replace(/[^0-9]/g, '');
}

async function getOrCreateConversation(phoneNumber) {
    const db = getPool();
    if (!dbReady || !db) {
        return null;
    }

    const normalized = normalizePhoneNumber(phoneNumber);
    if (!normalized) {
        return null;
    }

    const result = await db.query(
        `
        INSERT INTO conversations (phone_number, updated_at)
        VALUES ($1, NOW())
        ON CONFLICT (phone_number)
        DO UPDATE SET updated_at = NOW()
        RETURNING id;
        `,
        [normalized]
    );

    return result.rows[0]?.id || null;
}

async function saveConversationMessage(phoneNumber, role, content, provider = null) {
    const db = getPool();
    if (!dbReady || !db) {
        return false;
    }

    const conversationId = await getOrCreateConversation(phoneNumber);
    if (!conversationId) {
        return false;
    }

    await db.query(
        `
        INSERT INTO messages (conversation_id, role, content, provider)
        VALUES ($1, $2, $3, $4);
        `,
        [conversationId, role, content, provider]
    );

    return true;
}

function getStartOfToday() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
}

async function getRecentConversationHistory(phoneNumber, limit = 12, options = {}) {
    const db = getPool();
    if (!dbReady || !db) {
        return [];
    }

    const conversationId = await getOrCreateConversation(phoneNumber);
    if (!conversationId) {
        return [];
    }

    const safeLimit = Math.max(1, Math.min(Number(limit) || 12, 50));
    const sameDayOnly = Boolean(options.sameDayOnly);

    const result = sameDayOnly
        ? await db.query(
            `
            SELECT role, content, created_at
            FROM messages
            WHERE conversation_id = $1
              AND created_at >= $2
            ORDER BY created_at DESC
            LIMIT $3;
            `,
            [conversationId, getStartOfToday(), safeLimit]
        )
        : await db.query(
            `
            SELECT role, content, created_at
            FROM messages
            WHERE conversation_id = $1
            ORDER BY created_at DESC
            LIMIT $2;
            `,
            [conversationId, safeLimit]
        );

    return result.rows.reverse().map((row) => ({
        role: row.role,
        content: row.content,
        createdAt: row.created_at
    }));
}

async function getConversationLeadData(phoneNumber) {
    const db = getPool();
    if (!dbReady || !db) {
        return null;
    }

    const normalized = normalizePhoneNumber(phoneNumber);
    if (!normalized) {
        return null;
    }

    const result = await db.query(
        `
        SELECT customer_name, contact_phone, email, desired_product, delivery_address
        FROM conversations
        WHERE phone_number = $1
        LIMIT 1;
        `,
        [normalized]
    );

    if (result.rows.length === 0) {
        return null;
    }

    return {
        name: result.rows[0].customer_name || '',
        contactPhone: result.rows[0].contact_phone || '',
        email: result.rows[0].email || '',
        desiredProduct: result.rows[0].desired_product || '',
        deliveryAddress: result.rows[0].delivery_address || ''
    };
}

async function upsertConversationLeadData(phoneNumber, {
    name = null,
    contactPhone = null,
    email = null,
    desiredProduct = null,
    deliveryAddress = null
} = {}) {
    const db = getPool();
    if (!dbReady || !db) {
        return false;
    }

    const normalized = normalizePhoneNumber(phoneNumber);
    if (!normalized) {
        return false;
    }

    await db.query(
        `
        INSERT INTO conversations (phone_number, customer_name, contact_phone, email, desired_product, delivery_address, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, NOW())
        ON CONFLICT (phone_number)
        DO UPDATE SET
            customer_name = COALESCE($2, conversations.customer_name),
            contact_phone = COALESCE($3, conversations.contact_phone),
            email = COALESCE($4, conversations.email),
            desired_product = COALESCE($5, conversations.desired_product),
            delivery_address = COALESCE($6, conversations.delivery_address),
            updated_at = NOW();
        `,
        [normalized, name, contactPhone, email, desiredProduct, deliveryAddress]
    );

    return true;
}

// ─── FIX: estas funciones van DESPUÉS de getPool, dbReady y getStartOfToday ──

/**
 * Cuenta el total de mensajes de clientes recibidos hoy (rol 'user')
 * @returns {Promise<number>}
 */
async function countUserMessagesToday() {
    const db = getPool();
    if (!dbReady || !db) return 0;
    const result = await db.query(
        `SELECT COUNT(*) FROM messages WHERE role = 'user' AND created_at >= $1`,
        [getStartOfToday()]
    );
    return Number(result.rows[0]?.count || 0);
}

/**
 * Obtiene todos los números de teléfono que enviaron mensajes de usuario hoy
 * @returns {Promise<string[]>}
 */
async function getPhonesWithUserMessagesToday() {
    const db = getPool();
    if (!dbReady || !db) return [];
    const result = await db.query(
        `SELECT DISTINCT c.phone_number
         FROM messages m
         JOIN conversations c ON m.conversation_id = c.id
         WHERE m.role = 'user' AND m.created_at >= $1`,
        [getStartOfToday()]
    );
    return result.rows.map(r => r.phone_number);
}

module.exports = {
    initDatabase,
    normalizePhoneNumber,
    saveConversationMessage,
    getRecentConversationHistory,
    getConversationLeadData,
    upsertConversationLeadData,
    countUserMessagesToday,
    getPhonesWithUserMessagesToday
};