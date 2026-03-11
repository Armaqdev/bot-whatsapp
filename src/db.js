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
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
            `);

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

async function getRecentConversationHistory(phoneNumber, limit = 12) {
    const db = getPool();
    if (!dbReady || !db) {
        return [];
    }

    const conversationId = await getOrCreateConversation(phoneNumber);
    if (!conversationId) {
        return [];
    }

    const safeLimit = Math.max(1, Math.min(Number(limit) || 12, 50));
    const result = await db.query(
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

module.exports = {
    initDatabase,
    normalizePhoneNumber,
    saveConversationMessage,
    getRecentConversationHistory
};
