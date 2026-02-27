import express from 'express';
import multer from 'multer';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { BitrixClient } from './BitrixClient.js';
import config from '../config.json' with { type: 'json' };
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

const app = express();
const port = process.env.PORT || 3000;

app.use(helmet({
    contentSecurityPolicy: false // Allowed because we use CDNs and Alpine inline scripts
}));
app.use(express.json());

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20, // Limit each IP to 20 login requests per window
    message: { error: 'Слишком много попыток входа, пожалуйста, попробуйте позже' }
});

// Middleware для правильной обработки UTF-8 в заголовках
app.use((req, res, next) => {
    // Обрабатываем Content-Type с правильной кодировкой
    if (req.headers['content-type'] && req.headers['content-type'].includes('multipart/form-data')) {
        req.headers['content-type'] = req.headers['content-type'].replace(/charset=[^;]*/, 'charset=utf-8');
    }
    next();
});

// Функция для декодирования имени файла
function decodeFileName(fileName) {
    if (!fileName) return fileName;

    // Пробуем разные способы декодирования
    try {
        // Способ 1: Буфер из binary в UTF-8
        return Buffer.from(fileName, 'binary').toString('utf8');
    } catch (e) {
        try {
            // Способ 2: decodeURIComponent для URL-encoded строк
            return decodeURIComponent(fileName);
        } catch (e2) {
            try {
                // Способ 3: Пытаемся определить кодировку по символам
                if (fileName.includes('Ð') || fileName.includes('Ñ')) {
                    // Похоже на искаженную UTF-8 строку
                    return fileName.replace(/[Ð-ÿ]/g, (match) => {
                        const charCode = match.charCodeAt(0);
                        return String.fromCharCode(charCode - 0x350);
                    });
                }
            } catch (e3) {
                // Ничего не получилось, возвращаем как есть
                console.warn('Failed to decode filename:', fileName, e3.message);
            }
        }
    }
    return fileName;
}

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 50 * 1024 * 1024 // 50 MB
    },
    fileFilter: (req, file, cb) => {
        // Декодируем имя файла
        file.originalname = decodeFileName(file.originalname);
        cb(null, true);
    }
});
const sessions = new Map();

// Периодическая очистка старых сессий (неактивных более 24 часов)
const SESSION_TTL = 24 * 60 * 60 * 1000; // 24 hours
setInterval(() => {
    const now = Date.now();
    for (const [token, session] of sessions.entries()) {
        if (now - session.createdAt > SESSION_TTL) {
            sessions.delete(token);
        }
    }
}, 60 * 60 * 1000); // Check every hour

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, '..', 'public');

app.use(express.static(publicDir));

function createClient(ignoreSSL) {
    // If frontend explicitly passed a boolean, use it. Otherwise, fallback to config.ignoreSSL. Secure by default.
    const effectiveIgnore = typeof ignoreSSL === 'boolean' ? ignoreSSL : (config.ignoreSSL === true);
    return new BitrixClient(config.siteUrl, {
        adminPath: config.adminPath,
        maxRetries: config.maxRetries,
        timeout: config.timeout,
        rejectUnauthorized: !effectiveIgnore,
        iblockId: config.iblockId
    });
}

function getAuthToken(req) {
    const header = req.headers.authorization;
    if (!header) return null;
    if (!header.toLowerCase().startsWith('bearer ')) return null;
    return header.slice(7);
}

function authMiddleware(req, res, next) {
    const token = getAuthToken(req);
    if (!token) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }
    const session = sessions.get(token);
    if (!session) {
        res.status(401).json({ error: 'Invalid token' });
        return;
    }
    req.bitrix = session.client;
    next();
}

app.get('/config/public', (req, res) => {
    res.json({
        siteUrl: config.siteUrl || '',
        iblockId: config.iblockId || 6
    });
});

app.post('/auth/login', loginLimiter, async (req, res) => {
    const { username, password, ignoreSSL } = req.body || {};
    if (!username || !password) {
        res.status(400).json({ error: 'username and password are required' });
        return;
    }
    const client = createClient(ignoreSSL);
    try {
        await client.login(username, password);
        const isAuth = await client.checkAuth();
        if (!isAuth) {
            res.status(401).json({ error: 'Authentication failed' });
            return;
        }
        const token = crypto.randomBytes(24).toString('hex');
        sessions.set(token, {
            client,
            username,
            createdAt: Date.now()
        });
        res.json({ token });
    } catch (error) {
        res.status(401).json({ error: error.message || 'Authentication error' });
    }
});

app.get('/files/tree', authMiddleware, async (req, res) => {
    const rootSectionId = req.query.rootSectionId || req.query.sectionId || config.sectionId || 0;
    const maxDepthParam = req.query.maxDepth;
    const maxDepth = maxDepthParam ? parseInt(maxDepthParam, 10) : (config.maxDepth || 5);

    if (!Number.isFinite(maxDepth) || maxDepth <= 0) {
        res.status(400).json({ error: 'Invalid maxDepth' });
        return;
    }

    try {
        const tree = await req.bitrix.buildFileTree(rootSectionId, maxDepth);
        res.json({ tree });
    } catch (error) {
        res.status(500).json({ error: error.message || 'Failed to build tree' });
    }
});

app.get('/files', authMiddleware, async (req, res) => {
    const sectionId = req.query.sectionId || config.sectionId || null;
    try {
        const result = await req.bitrix.getUserFiles(sectionId);
        res.json({ items: result.items, sectionName: result.sectionName || null });
    } catch (error) {
        res.status(500).json({ error: error.message || 'Failed to get files' });
    }
});

app.post('/files/upload', authMiddleware, upload.single('file'), async (req, res) => {
    if (!req.file) {
        res.status(400).json({ error: 'file is required' });
        return;
    }


    const body = req.body || {};
    const sectionId = body.sectionId || config.sectionId || null;
    const extra = {
        uploadDate: body.uploadDate || null,
        mimetype: req.file.mimetype
    };
    try {
        const result = await req.bitrix.uploadFile(sectionId, req.file.originalname, req.file.buffer, extra);
        res.json(result);
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: error.message || 'Upload error' });
    }
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

const server = app.listen(port, () => {
    console.log(`Bitrix helper API listening on port ${port}`);
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`\n❌ Port ${port} is already in use.`);
        console.error(`   Stop the existing process or set a different PORT env variable.\n`);
        process.exit(1);
    } else {
        throw err;
    }
});

// Graceful shutdown logic
const shutdown = (signal) => {
    console.log(`\nReceived ${signal}. Shutting down gracefully...`);

    // Force shutdown after 10 seconds if connections are still alive
    const forceExitTimer = setTimeout(() => {
        console.error('Forcefully shutting down because graceful close took too long');
        process.exit(1);
    }, 10000);

    // Stops the server from accepting new connections
    server.close(() => {
        console.log('HTTP server closed');
        clearTimeout(forceExitTimer);
        process.exit(0);
    });

    // Close all keep-alive / active connections immediately to unblock the exit.
    // Required to prevent the event loop from hanging on existing connections.
    if (server.closeAllConnections) {
        server.closeAllConnections();
    }
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGQUIT', () => shutdown('SIGQUIT'));


