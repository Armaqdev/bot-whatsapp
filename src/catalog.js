const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');
const { PDFParse } = require('pdf-parse');
const { createWorker } = require('tesseract.js');

const DEFAULT_PRICE_LIST_DIR = 'C:/Users/venta/Desktop/documentos laptop/lista de precios junio 2025';
const PRICE_LIST_DIR = process.env.PRICE_LIST_DIR || DEFAULT_PRICE_LIST_DIR;
const DEFAULT_PROMO_DIR = 'C:/Users/venta/Desktop/promo marzo';
const PROMO_DIR = process.env.PROMO_DIR || DEFAULT_PROMO_DIR;
const ALLOW_PROMO_PRICES = false;
const REFRESH_MS = 10 * 60 * 1000;

const PRODUCT_ALIASES = {
    vibradores: ['vibrador', 'vibradores', 'vibrador de concreto', 'vibradores de concreto'],
    andamios: ['andamio', 'andamios'],
    puntales: ['puntal', 'puntales'],
    malacates: ['malacate', 'malacates'],
    polipastos: ['polipasto', 'polipastos'],
    compresores: ['compresor', 'compresores'],
    generadores: ['generador', 'generadores', 'planta de luz'],
    cortadoras: ['cortadora', 'cortadoras', 'cortadora de plasma'],
    revolvedoras: ['revolvedora', 'revolvedoras', 'mezcladora de concreto']
};

const BRAND_ALIASES = {
    hypermaq: ['hypermaq', 'hyper'],
    honda: ['honda'],
    cipsa: ['cipsa'],
    fidecsa: ['fidecsa'],
    mpower: ['mpower'],
    mopycsa: ['mopycsa', 'mopysca']
};

let catalogCache = {
    loadedAt: 0,
    newestMtimeMs: 0,
    byProduct: {},
    loadedFiles: 0
};

let promoCache = {
    loadedAt: 0,
    newestMtimeMs: 0,
    byProduct: {},
    loadedFiles: 0
};

let ocrWorker = null;

function normalizeText(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
}

function hasAnyAlias(text, aliases) {
    return aliases.some((alias) => text.includes(alias));
}

function isPromotionQuery(text) {
    const normalized = normalizeText(text);
    return [
        'promo', 'promocion', 'oferta', 'descuento', 'precio', 'precios', 'cuanto', 'costo', 'costos'
    ].some((word) => normalized.includes(word));
}

function detectProductInText(text) {
    const normalized = normalizeText(text);
    for (const [product, aliases] of Object.entries(PRODUCT_ALIASES)) {
        if (hasAnyAlias(normalized, aliases)) {
            return product;
        }
    }
    return null;
}

function detectBrandsInText(text) {
    const normalized = normalizeText(text);
    const brands = [];

    for (const [brand, aliases] of Object.entries(BRAND_ALIASES)) {
        if (hasAnyAlias(normalized, aliases)) {
            brands.push(brand);
        }
    }

    return brands;
}

function addProductEvidence(productMap, product, line, filePath) {
    if (!productMap[product]) {
        productMap[product] = {
            brands: new Set(),
            evidence: []
        };
    }

    const brands = detectBrandsInText(line);
    for (const brand of brands) {
        productMap[product].brands.add(brand);
    }

    if (productMap[product].evidence.length < 3) {
        productMap[product].evidence.push({
            file: path.basename(filePath),
            line: line.slice(0, 140)
        });
    }
}

function processTextIntoMap(text, filePath, productMap) {
    const normalized = normalizeText(text);
    const lines = normalized
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];

        for (const [product, aliases] of Object.entries(PRODUCT_ALIASES)) {
            if (!hasAnyAlias(line, aliases)) {
                continue;
            }

            addProductEvidence(productMap, product, line, filePath);

            const nextLine = lines[index + 1] || '';
            const previousLine = lines[index - 1] || '';
            addProductEvidence(productMap, product, nextLine, filePath);
            addProductEvidence(productMap, product, previousLine, filePath);
        }
    }
}

async function extractTextFromPdf(filePath) {
    const fileBuffer = fs.readFileSync(filePath);
    const parser = new PDFParse({ data: fileBuffer });

    try {
        const result = await parser.getText();
        return result.text || '';
    } finally {
        await parser.destroy();
    }
}

async function extractTextFromImage(filePath) {
    if (!ocrWorker) {
        ocrWorker = await createWorker('spa+eng');
    }

    const result = await ocrWorker.recognize(filePath);
    return result?.data?.text || '';
}

function extractTextFromXlsx(filePath) {
    const workbook = xlsx.readFile(filePath);
    const chunks = [];

    for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const rows = xlsx.utils.sheet_to_json(sheet, {
            header: 1,
            raw: false,
            defval: ''
        });

        for (const row of rows) {
            if (!Array.isArray(row) || row.length === 0) {
                continue;
            }

            const line = row
                .map((cell) => String(cell || '').trim())
                .filter(Boolean)
                .join(' | ');

            if (line) {
                chunks.push(line);
            }
        }
    }

    return chunks.join('\n');
}

function getCatalogFiles(dirPath) {
    if (!fs.existsSync(dirPath)) {
        return [];
    }

    return fs
        .readdirSync(dirPath)
        .map((name) => path.join(dirPath, name))
        .filter((absolutePath) => fs.statSync(absolutePath).isFile())
        .filter((absolutePath) => /\.(pdf|xlsx|xls|txt|csv|png|jpe?g)$/i.test(absolutePath));
}

function shouldReloadCatalog(files) {
    if (Date.now() - catalogCache.loadedAt > REFRESH_MS) {
        return true;
    }

    const newestMtimeMs = files.reduce((max, filePath) => {
        const stat = fs.statSync(filePath);
        return Math.max(max, stat.mtimeMs);
    }, 0);

    return newestMtimeMs !== catalogCache.newestMtimeMs;
}

async function loadCatalog() {
    const files = getCatalogFiles(PRICE_LIST_DIR);
    if (files.length === 0) {
        return {
            byProduct: {},
            loadedFiles: 0
        };
    }

    if (!shouldReloadCatalog(files)) {
        return {
            byProduct: catalogCache.byProduct,
            loadedFiles: catalogCache.loadedFiles
        };
    }

    const productMap = {};

    for (const filePath of files) {
        try {
            const extension = path.extname(filePath).toLowerCase();
            let text = '';

            if (extension === '.pdf') {
                text = await extractTextFromPdf(filePath);
            } else if (extension === '.xlsx' || extension === '.xls') {
                text = extractTextFromXlsx(filePath);
            }

            if (text) {
                processTextIntoMap(text, filePath, productMap);
            }
        } catch (error) {
            console.warn(`No se pudo procesar archivo de catalogo: ${path.basename(filePath)} - ${error.message}`);
        }
    }

    const newestMtimeMs = files.reduce((max, filePath) => {
        const stat = fs.statSync(filePath);
        return Math.max(max, stat.mtimeMs);
    }, 0);

    catalogCache = {
        loadedAt: Date.now(),
        newestMtimeMs,
        byProduct: productMap,
        loadedFiles: files.length
    };

    return {
        byProduct: productMap,
        loadedFiles: files.length
    };
}

function extractPriceFromText(text) {
    if (!text) {
        return null;
    }

    const priceRegex = /(\$\s?\d[\d,]*(?:\.\d{2})?|\d[\d,]*(?:\.\d{2})?\s?(?:mxn|pesos))/i;
    const match = String(text).match(priceRegex);
    return match ? match[0].replace(/\s+/g, ' ').trim() : null;
}

function pushPromoOffer(promoMap, product, sourceLine, filePath, neighborLines = []) {
    if (!promoMap[product]) {
        promoMap[product] = [];
    }

    const sampleLines = [sourceLine, ...neighborLines].filter(Boolean);
    const normalizedJoined = normalizeText(sampleLines.join(' '));
    const brands = detectBrandsInText(normalizedJoined);
    const price = sampleLines.map(extractPriceFromText).find(Boolean);

    if (!price) {
        return;
    }

    const exists = promoMap[product].some((item) => item.price === price && item.file === path.basename(filePath));
    if (exists) {
        return;
    }

    promoMap[product].push({
        price,
        brands,
        file: path.basename(filePath),
        line: String(sourceLine || '').slice(0, 140)
    });
}

function processPromotionText(text, filePath, promoMap) {
    const rawLines = String(text)
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

    const normalizedLines = rawLines.map((line) => normalizeText(line));

    for (let index = 0; index < rawLines.length; index += 1) {
        const currentRaw = rawLines[index] || '';
        const currentPrice = extractPriceFromText(currentRaw);
        if (!currentPrice) {
            continue;
        }

        const windowRaw = [
            rawLines[index - 2] || '',
            rawLines[index - 1] || '',
            currentRaw,
            rawLines[index + 1] || '',
            rawLines[index + 2] || ''
        ].filter(Boolean);

        const normalizedWindow = normalizeText(windowRaw.join(' '));
        const detectedProduct = detectProductInText(normalizedWindow);

        if (detectedProduct) {
            pushPromoOffer(promoMap, detectedProduct, currentRaw, filePath, windowRaw);
            continue;
        }

        if (!promoMap.__general) {
            promoMap.__general = [];
        }

        const brands = detectBrandsInText(normalizedWindow);
        promoMap.__general.push({
            price: currentPrice,
            brands,
            file: path.basename(filePath),
            line: currentRaw.slice(0, 140)
        });
    }
}

async function loadPromotions() {
    const files = getCatalogFiles(PROMO_DIR);
    if (files.length === 0) {
        return { byProduct: {}, loadedFiles: 0 };
    }

    const newestMtimeMs = files.reduce((max, filePath) => Math.max(max, fs.statSync(filePath).mtimeMs), 0);
    const shouldReload = Date.now() - promoCache.loadedAt > REFRESH_MS || newestMtimeMs !== promoCache.newestMtimeMs;

    if (!shouldReload) {
        return {
            byProduct: promoCache.byProduct,
            loadedFiles: promoCache.loadedFiles
        };
    }

    const promoMap = {};
    for (const filePath of files) {
        try {
            const extension = path.extname(filePath).toLowerCase();
            let text = '';

            if (extension === '.pdf') {
                text = await extractTextFromPdf(filePath);
            } else if (extension === '.xlsx' || extension === '.xls') {
                text = extractTextFromXlsx(filePath);
            } else if (extension === '.txt' || extension === '.csv') {
                text = fs.readFileSync(filePath, 'utf8');
            } else if (extension === '.jpg' || extension === '.jpeg' || extension === '.png') {
                text = await extractTextFromImage(filePath);
            }

            if (text) {
                processPromotionText(text, filePath, promoMap);
            }
        } catch (error) {
            console.warn(`No se pudo procesar archivo de promocion: ${path.basename(filePath)} - ${error.message}`);
        }
    }

    promoCache = {
        loadedAt: Date.now(),
        newestMtimeMs,
        byProduct: promoMap,
        loadedFiles: files.length
    };

    return {
        byProduct: promoMap,
        loadedFiles: files.length
    };
}

function formatBrandName(brand) {
    if (brand === 'hypermaq') {
        return 'Hypermaq';
    }
    if (brand === 'honda') {
        return 'Honda';
    }
    if (brand === 'cipsa') {
        return 'Cipsa';
    }
    if (brand === 'fidecsa') {
        return 'Fidecsa';
    }
    if (brand === 'mpower') {
        return 'Mpower';
    }
    if (brand === 'mopycsa') {
        return 'Mopycsa';
    }
    return brand.charAt(0).toUpperCase() + brand.slice(1);
}

function formatBrandList(brands) {
    if (brands.length === 0) {
        return '';
    }

    const formatted = brands.map(formatBrandName);
    if (formatted.length === 1) {
        return formatted[0];
    }

    if (formatted.length === 2) {
        return `${formatted[0]} y ${formatted[1]}`;
    }

    return `${formatted.slice(0, -1).join(', ')} y ${formatted[formatted.length - 1]}`;
}

async function getCatalogContext(userText) {
    const requestedProduct = detectProductInText(userText);
    if (!requestedProduct) {
        return null;
    }

    const catalog = await loadCatalog();
    const productInfo = catalog.byProduct[requestedProduct];

    if (!productInfo) {
        return `Producto detectado: ${requestedProduct}. En los archivos de lista no se detecto evidencia clara para este producto.`;
    }

    return `Producto detectado: ${requestedProduct}. Confirma venta segun lista, no compartas precios ni menciones marcas.`;
}

async function getCatalogReply(userText) {
    const requestedProduct = detectProductInText(userText);
    if (!requestedProduct) {
        return null;
    }

    const catalog = await loadCatalog();
    const productInfo = catalog.byProduct[requestedProduct];
    const productLabel = requestedProduct;

    if (!productInfo) {
        return `Revisando la lista actual, no me aparece ${productLabel} como equipo en venta. Si quieres, te confirmo opciones similares que si manejamos.`;
    }

    return `Si, manejamos ${productLabel} en venta. Si gustas, te confirmo existencias para tu solicitud.`;
}

async function getPromotionContext(userText) {
    const requestedProduct = detectProductInText(userText);
    if (!requestedProduct || !isPromotionQuery(userText)) {
        return null;
    }

    return `Promocion detectada para ${requestedProduct}. Confirma disponibilidad y evita mencionar precios.`;
}

async function getPromotionReply(userText) {
    const requestedProduct = detectProductInText(userText);
    const wantsPromo = isPromotionQuery(userText);
    if (!wantsPromo) {
        return null;
    }

    if (!requestedProduct) {
        return 'Si tenemos promociones vigentes este mes. Dime que equipo te interesa y te confirmo si lo manejamos en venta.';
    }

    const catalog = await loadCatalog();
    const productInfo = catalog.byProduct[requestedProduct];
    if (!productInfo) {
        return `En este momento no veo ${requestedProduct} en la lista de venta actual. Si quieres, te confirmo alternativas disponibles.`;
    }

    return `Si, manejamos ${requestedProduct} en venta y contamos con promociones vigentes. Si quieres, te confirmo existencias y opciones disponibles.`;
}

module.exports = {
    getPromotionContext,
    getPromotionReply,
    getCatalogContext,
    getCatalogReply,
    loadCatalog,
    loadPromotions
};
