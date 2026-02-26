import iconv from 'iconv-lite';
import { Buffer } from 'buffer';

/**
 * Transliterate Cyrillic characters to Latin
 * @param {string} value
 * @returns {string}
 */
export function transliterate(value) {
    if (!value) return '';
    const map = {
        а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
        и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
        с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh',
        щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya'
    };
    return String(value)
        .split('')
        .map((ch) => {
            const lower = ch.toLowerCase();
            if (map[lower] !== undefined) {
                const tr = map[lower];
                return ch === lower ? tr : tr.toUpperCase();
            }
            return ch;
        })
        .join('');
}

/**
 * Sanitize a filename: preserve Unicode (including Cyrillic), remove unsafe chars
 * @param {string} value
 * @returns {string}
 */
export function sanitizeFileName(value) {
    const cleaned = String(value ?? '')
        .replace(/[\\/]/g, '_')
        .replace(/[\u0000-\u001F\u007F]/g, '')
        .replace(/[<>:"|?*%]/g, '_')
        .replace(/\s+/g, ' ')
        .trim();
    return cleaned || 'file';
}

/**
 * Encode a string/buffer to the target encoding
 * @param {string|Buffer} value
 * @param {'utf-8'|'windows-1251'} encoding
 * @returns {Buffer}
 */
export function encodeValue(value, encoding = 'utf-8') {
    if (Buffer.isBuffer(value)) return value;
    const text = String(value ?? '');
    if (encoding === 'windows-1251') {
        return iconv.encode(text, 'windows-1251');
    }
    return Buffer.from(text, 'utf-8');
}

/**
 * Encode filename for Content-Disposition header
 * @param {string} filename
 * @param {'utf-8'|'windows-1251'} encoding
 * @returns {Buffer}
 */
export function encodeFilename(filename, encoding = 'utf-8') {
    const text = String(filename ?? '');
    const escaped = text.replace(/"/g, '\\"');
    if (encoding === 'windows-1251') {
        return iconv.encode(`filename="${escaped}"`, 'windows-1251');
    }
    return Buffer.from(`filename="${escaped}"`, 'utf-8');
}

/**
 * Format a date value as Bitrix-compatible DD.MM.YYYY string
 * @param {string|null} value
 * @returns {string}
 */
export function formatBitrixDate(value) {
    if (!value) {
        const now = new Date();
        const dd = String(now.getDate()).padStart(2, '0');
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const yyyy = String(now.getFullYear());
        return `${dd}.${mm}.${yyyy}`;
    }
    const str = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
        const [y, m, d] = str.split('-');
        return `${d}.${m}.${y}`;
    }
    if (/^\d{2}\.\d{2}\.\d{4}$/.test(str)) {
        return str;
    }
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = String(now.getFullYear());
    return `${dd}.${mm}.${yyyy}`;
}

/**
 * Build a raw multipart/form-data body buffer
 * @param {Array<{name: string, value: string}>} fields
 * @param {Array<{name: string, filename: string, contentType: string, data: Buffer}>} files
 * @param {string} boundary
 * @param {'utf-8'|'windows-1251'} encoding
 * @returns {Buffer}
 */
export function buildMultipartBody(fields, files, boundary, encoding = 'utf-8') {
    const chunks = [];
    const lineBreak = Buffer.from('\r\n', 'ascii');
    const boundaryLine = Buffer.from(`--${boundary}\r\n`, 'ascii');

    fields.forEach(({ name, value }) => {
        chunks.push(boundaryLine);
        chunks.push(Buffer.from(`Content-Disposition: form-data; name="${name}"\r\n\r\n`, 'ascii'));
        chunks.push(encodeValue(value, encoding));
        chunks.push(lineBreak);
    });

    files.forEach(({ name, filename, contentType, data }) => {
        chunks.push(boundaryLine);
        const filenameHeaderBuffer = encodeFilename(filename, encoding);
        chunks.push(Buffer.from(`Content-Disposition: form-data; name="${name}"; `, 'ascii'));
        chunks.push(filenameHeaderBuffer);
        chunks.push(Buffer.from(`\r\nContent-Type: ${contentType || 'application/octet-stream'}\r\n\r\n`, 'ascii'));
        chunks.push(data);
        chunks.push(lineBreak);
    });

    chunks.push(Buffer.from(`--${boundary}--\r\n`, 'ascii'));
    return Buffer.concat(chunks);
}
