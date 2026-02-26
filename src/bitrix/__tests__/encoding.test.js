/**
 * Unit tests for encoding utilities
 * Run: node --experimental-vm-modules node_modules/.bin/jest src/bitrix/__tests__/encoding.test.js
 * Or with vitest: npx vitest run src/bitrix/__tests__/encoding.test.js
 *
 * Since this project has no test framework installed, tests are written as
 * self-contained assertions using Node's built-in assert module.
 * Run: node src/bitrix/__tests__/encoding.test.js
 */

import assert from 'assert';
import {
    transliterate,
    sanitizeFileName,
    encodeValue,
    encodeFilename,
    formatBitrixDate,
    buildMultipartBody
} from '../encoding.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        console.log(`  ✓  ${name}`);
        passed++;
    } catch (err) {
        console.error(`  ✗  ${name}`);
        console.error(`     ${err.message}`);
        failed++;
    }
}

// ── transliterate ────────────────────────────────────────────────────────────
console.log('\ntransliterate');

test('transliterates lowercase Cyrillic', () => {
    assert.strictEqual(transliterate('привет'), 'privet');
});

test('transliterates uppercase Cyrillic', () => {
    assert.strictEqual(transliterate('Привет'), 'Privet');
});

test('preserves Latin characters', () => {
    assert.strictEqual(transliterate('Hello World'), 'Hello World');
});

test('handles mixed Cyrillic+Latin', () => {
    assert.strictEqual(transliterate('file_тест.pdf'), 'file_test.pdf');
});

test('handles ё', () => {
    assert.strictEqual(transliterate('ёж'), 'ezh');
});

test('handles special chars ъ ь', () => {
    assert.strictEqual(transliterate('объект'), 'obekt');
});

test('returns empty string for falsy input', () => {
    assert.strictEqual(transliterate(''), '');
    assert.strictEqual(transliterate(null), '');
});

// ── sanitizeFileName ─────────────────────────────────────────────────────────
console.log('\nsanitizeFileName');

test('preserves Cyrillic characters', () => {
    assert.strictEqual(sanitizeFileName('Документ.pdf'), 'Документ.pdf');
});

test('replaces backslash and forward slash', () => {
    const result = sanitizeFileName('path\\to/file.txt');
    assert.ok(!result.includes('/') && !result.includes('\\'));
});

test('replaces unsafe chars <>":|?*', () => {
    const result = sanitizeFileName('file<name>:"test"|?*.txt');
    assert.ok(!result.includes('<') && !result.includes('>') && !result.includes(':'));
});

test('collapses multiple spaces', () => {
    assert.strictEqual(sanitizeFileName('my   file.txt'), 'my file.txt');
});

test('returns "file" for empty input', () => {
    assert.strictEqual(sanitizeFileName(''), 'file');
    assert.strictEqual(sanitizeFileName(null), 'file');
});

test('removes control characters', () => {
    assert.ok(!sanitizeFileName('file\x00name').includes('\x00'));
});

// ── encodeValue ──────────────────────────────────────────────────────────────
console.log('\nencodeValue');

test('returns UTF-8 buffer for plain string', () => {
    const buf = encodeValue('hello', 'utf-8');
    assert.ok(Buffer.isBuffer(buf));
    assert.strictEqual(buf.toString('utf-8'), 'hello');
});

test('returns windows-1251 buffer', () => {
    const buf = encodeValue('привет', 'windows-1251');
    assert.ok(Buffer.isBuffer(buf));
    assert.ok(buf.length > 0);
});

test('returns buffer as-is when Buffer passed', () => {
    const original = Buffer.from('test');
    const result = encodeValue(original);
    assert.strictEqual(result, original);
});

// ── encodeFilename ───────────────────────────────────────────────────────────
console.log('\nencodeFilename');

test('wraps filename in quotes', () => {
    const buf = encodeFilename('test.pdf', 'utf-8');
    assert.ok(buf.toString('utf-8').startsWith('filename="'));
    assert.ok(buf.toString('utf-8').endsWith('"'));
});

test('escapes double quotes inside filename', () => {
    const buf = encodeFilename('say "hello".pdf', 'utf-8');
    assert.ok(buf.toString('utf-8').includes('\\"'));
});

// ── formatBitrixDate ─────────────────────────────────────────────────────────
console.log('\nformatBitrixDate');

test('converts ISO date to Bitrix format', () => {
    assert.strictEqual(formatBitrixDate('2024-01-15'), '15.01.2024');
});

test('passes through already-formatted date', () => {
    assert.strictEqual(formatBitrixDate('15.01.2024'), '15.01.2024');
});

test('returns today for null/empty', () => {
    const result = formatBitrixDate(null);
    assert.ok(/^\d{2}\.\d{2}\.\d{4}$/.test(result), `Expected DD.MM.YYYY, got: ${result}`);
});

test('returns today for invalid input', () => {
    const result = formatBitrixDate('not-a-date');
    assert.ok(/^\d{2}\.\d{2}\.\d{4}$/.test(result));
});

// ── buildMultipartBody ───────────────────────────────────────────────────────
console.log('\nbuildMultipartBody');

test('contains boundary markers', () => {
    const boundary = 'testboundary123';
    const body = buildMultipartBody(
        [{ name: 'field1', value: 'value1' }],
        [],
        boundary
    );
    const str = body.toString('binary');
    assert.ok(str.includes(`--${boundary}\r\n`));
    assert.ok(str.includes(`--${boundary}--`));
});

test('includes field name and value', () => {
    const body = buildMultipartBody(
        [{ name: 'myfield', value: 'myvalue' }],
        [],
        'boundary123'
    );
    const str = body.toString('utf-8');
    assert.ok(str.includes('name="myfield"'));
    assert.ok(str.includes('myvalue'));
});

test('includes file info in Content-Disposition', () => {
    const body = buildMultipartBody(
        [],
        [{ name: 'file', filename: 'test.pdf', contentType: 'application/pdf', data: Buffer.from('data') }],
        'boundary456'
    );
    const str = body.toString('utf-8');
    assert.ok(str.includes('filename="test.pdf"'));
    assert.ok(str.includes('Content-Type: application/pdf'));
});

test('contains file data', () => {
    const fileData = Buffer.from('file content');
    const body = buildMultipartBody(
        [],
        [{ name: 'file', filename: 'f.txt', contentType: 'text/plain', data: fileData }],
        'bnd'
    );
    assert.ok(body.includes(fileData));
});

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('─'.repeat(40));

if (failed > 0) {
    process.exit(1);
}
