import * as cheerio from 'cheerio';
import { sanitizeFileName, transliterate, formatBitrixDate, buildMultipartBody } from './encoding.js';

/**
 * FileUploadService — handles file uploads to Bitrix iblock
 */
export class FileUploadService {
    /**
     * @param {import('./HttpClient.js').HttpClient} httpClient
     * @param {number|string} iblockId
     */
    constructor(httpClient, iblockId) {
        this.http = httpClient;
        this.iblockId = String(iblockId ?? 6);
    }

    /**
     * Upload file to Bitrix temporary storage (AJAX endpoint)
     * @param {string} filename
     * @param {Buffer} buffer
     * @param {string} mimetype
     * @param {object} opts
     * @returns {Promise<{tmp_name: string, size: number}>}
     */
    async uploadFileToTemp(filename, buffer, mimetype = 'application/octet-stream', opts = {}) {
        const bufferData = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || '');
        const escapedFilename = filename.replace(/"/g, '\\"');

        const buildBody = (boundary, fieldName = 'file', extraFields = []) => {
            const chunks = [];
            for (const { name, value } of extraFields) {
                chunks.push(Buffer.from(`--${boundary}\r\n`, 'ascii'));
                chunks.push(Buffer.from(`Content-Disposition: form-data; name="${name}"\r\n\r\n`, 'ascii'));
                chunks.push(Buffer.from(String(value), 'utf-8'));
                chunks.push(Buffer.from('\r\n', 'ascii'));
            }
            chunks.push(Buffer.from(`--${boundary}\r\n`, 'ascii'));
            chunks.push(Buffer.from(`Content-Disposition: form-data; name="${fieldName}"; filename="${escapedFilename}"\r\n`, 'utf-8'));
            chunks.push(Buffer.from(`Content-Type: ${mimetype}\r\n\r\n`, 'ascii'));
            chunks.push(bufferData);
            chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`, 'ascii'));
            return Buffer.concat(chunks);
        };

        const parseResponse = (data) => {
            if (typeof data !== 'string') return data;
            try {
                return JSON.parse(data);
            } catch {
                const m = data.match(/"tmp_name"\s*:\s*"([^"]+)"/);
                if (m) return { tmp_name: m[1] };
                return null;
            }
        };

        const { bxuInfo, bxuUrl, sessid } = opts;
        const endpoints = [];

        if (bxuInfo) {
            const extraFields = [{ name: 'bxu_info', value: bxuInfo }];
            if (sessid) extraFields.push({ name: 'sessid', value: sessid });
            endpoints.push({
                url: bxuUrl || '/bitrix/tools/upload.php',
                fieldName: 'file',
                extraFields,
                extra: { 'X-Requested-With': 'XMLHttpRequest' }
            });
        }

        endpoints.push({
            url: '/bitrix/tools/upload.php',
            fieldName: 'file',
            extraFields: sessid ? [{ name: 'sessid', value: sessid }] : [],
            extra: {}
        });

        for (const endpoint of endpoints) {
            const boundary = `----WebKitFormBoundary${Date.now().toString(16)}`;
            const body = buildBody(boundary, endpoint.fieldName, endpoint.extraFields || []);
            try {
                const response = await this.http.post(endpoint.url, body, {
                    headers: {
                        'Content-Type': `multipart/form-data; boundary=${boundary}`,
                        'Content-Length': body.length,
                        ...endpoint.extra
                    },
                    maxBodyLength: Infinity,
                    validateStatus: null
                });

                const result = parseResponse(response.data);
                if (result && result.tmp_name) {
                    return { tmp_name: result.tmp_name, size: bufferData.length };
                }
                if (result && result.error) {
                    throw new Error('Bitrix temp upload error: ' + result.error);
                }
            } catch (err) {
                if (err.message.startsWith('Bitrix temp upload error')) throw err;
            }
        }

        throw new Error('All temp upload endpoints failed. See console for details.');
    }

    /**
     * Upload a file to a Bitrix iblock section
     * @param {string|null} sectionId
     * @param {string} filename
     * @param {Buffer} buffer
     * @param {object} extra
     * @returns {Promise<{success: boolean}>}
     */
    async uploadFile(sectionId, filename, buffer, extra = {}) {
        const normalizedSectionId =
            sectionId === undefined || sectionId === null
                ? null
                : String(sectionId).trim() || null;

        const effectiveSectionId = normalizedSectionId || '5710';
        const uploadDateRaw = extra && extra.uploadDate ? extra.uploadDate : null;
        const prop68Value = formatBitrixDate(uploadDateRaw);
        const rawNameBase = filename.split(/[/\\]/).pop() || filename;
        const nameBase = sanitizeFileName(rawNameBase);
        const nameWithoutExt = nameBase.replace(/\.[^.]+$/, '');

        const qs = new URLSearchParams({
            IBLOCK_ID: this.iblockId,
            type: 'file_manager',
            lang: 'ru',
            find_section_section: effectiveSectionId,
            IBLOCK_SECTION_ID: effectiveSectionId,
            from: 'iblock_list_admin'
        }).toString();

        const editUrl = `/bitrix/admin/iblock_element_edit.php?${qs}`;
        const listUrl = this._getFileManagerListUrl(normalizedSectionId);

        const editPageResponse = await this.http.get(editUrl, {
            headers: { Referer: listUrl }
        });

        const $ = cheerio.load(editPageResponse.data);

        let $form = $('form[name="form_element"]');
        if ($form.length === 0) $form = $('form[id^="form_"]');
        if ($form.length === 0) $form = $('form').first();
        if ($form.length === 0) throw new Error('Bitrix element edit form not found');

        const actionAttr = $form.attr('action') || editUrl;
        const actionUrl = actionAttr.startsWith('http') || actionAttr.startsWith('/')
            ? actionAttr
            : `/bitrix/admin/${actionAttr}`;

        const bufferData = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || '');
        const mimetype = extra?.mimetype || 'application/octet-stream';

        const fields = [];
        let hasSectionField = false;
        let hasCodeField = false;
        let hasDateField = false;
        const sectionFieldNames = ['IBLOCK_SECTION_ID', 'IBLOCK_SECTION_ID[]', 'SECTION_ID', 'IBLOCK_SECTION[]'];

        $form.find('input[type="hidden"]').each((_, el) => {
            const name = $(el).attr('name');
            if (!name) return;

            let value = $(el).attr('value') ?? '';

            if (sectionFieldNames.includes(name)) {
                value = effectiveSectionId;
                hasSectionField = true;
            }

            if (name.includes('PROP[68]') && name.includes('[VALUE]')) {
                value = prop68Value;
                hasDateField = true;
            }

            if (name === 'CODE' && value && String(value).trim() !== '') {
                hasCodeField = true;
            }

            fields.push({ name, value });
        });

        if (!hasSectionField && effectiveSectionId) {
            sectionFieldNames.forEach((name) => fields.push({ name, value: effectiveSectionId }));
        }

        if (!hasDateField && prop68Value) {
            const prop68Inputs = $form.find('input[name^="PROP[68]"]');
            if (prop68Inputs.length > 0) {
                prop68Inputs.each((_, el) => {
                    const name = $(el).attr('name') || '';
                    if (name.includes('[VALUE]')) fields.push({ name, value: prop68Value });
                });
            } else {
                fields.push({ name: 'PROP[68][n0][VALUE]', value: prop68Value });
            }
        }

        if (!hasCodeField) {
            const transliterated = transliterate(nameWithoutExt);
            const slug = (transliterated || 'file')
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-+|-+$/g, '');
            fields.push({ name: 'CODE', value: slug.slice(0, 50) });
        }

        fields.push({ name: 'ACTIVE', value: 'Y' });
        fields.push({ name: 'NAME', value: nameWithoutExt });

        // Find PROP[74] field names from the form
        let prop74NameField = 'PROP[74][n0][name]';
        let prop74TypeField = 'PROP[74][n0][type]';
        let prop74SizeField = 'PROP[74][n0][size]';
        let prop74ErrorField = 'PROP[74][n0][error]';

        const prop74Inputs = $form.find('input[name^="PROP[74]"]');
        if (prop74Inputs.length > 0) {
            prop74Inputs.each((_, el) => {
                const name = $(el).attr('name') || '';
                if (name.includes('[name]')) prop74NameField = name;
                else if (name.includes('[type]')) prop74TypeField = name;
                else if (name.includes('[size]')) prop74SizeField = name;
                else if (name.includes('[error]')) prop74ErrorField = name;
            });
        }

        fields.push({ name: prop74NameField, value: nameBase });
        fields.push({ name: prop74TypeField, value: mimetype });
        fields.push({ name: prop74SizeField, value: String(bufferData.length) });
        fields.push({ name: prop74ErrorField, value: '0' });
        fields.push({ name: 'save', value: 'Сохранить' });
        fields.push({ name: 'WF', value: 'N' });
        fields.push({ name: 'linked_state', value: 'Y' });
        fields.push({ name: 'Update', value: 'Y' });
        fields.push({ name: 'TMP_ID', value: '0' });
        fields.push({ name: 'from', value: 'iblock_list_admin' });
        fields.push({ name: 'find_section_section', value: effectiveSectionId });
        fields.push({ name: 'DETAIL_TEXT_TYPE', value: 'html' });
        fields.push({ name: 'PREVIEW_TEXT_TYPE', value: 'text' });

        const files = [
            { name: 'PROP[74][n0]', filename: nameBase, contentType: mimetype, data: bufferData },
            { name: 'bxu_files[]', filename: '', contentType: 'application/octet-stream', data: Buffer.alloc(0) },
            { name: 'bxu_files[]', filename: '', contentType: 'application/octet-stream', data: Buffer.alloc(0) }
        ];

        console.log(`[${new Date().toLocaleString('ru-RU')}] Sending file: NAME="${nameWithoutExt}", file="${nameBase}", sectionId=${effectiveSectionId}, date=${prop68Value || '(не указана)'}`);

        const boundary = `----WebKitFormBoundary${Date.now().toString(16)}`;
        const body = buildMultipartBody(fields, files, boundary, 'utf-8');

        const response = await this.http.post(actionUrl, body, {
            headers: {
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': body.length,
                Referer: editUrl
            },
            maxRedirects: 5,
            maxBodyLength: Infinity
        });

        if (response.status >= 400) {
            throw new Error(`Bitrix upload failed with status ${response.status}`);
        }

        const html = response.data;
        if (typeof html === 'string') {
            const $result = cheerio.load(html);
            const errorTexts = [];

            $result('.bx-core-adm-dialog-tab-message-error').each((_, el) => {
                const text = $result(el).text().trim();
                if (text) errorTexts.push(text);
            });

            $result('.adm-info-message-wrap .adm-info-message, .adm-info-message-red').each((_, el) => {
                const text = $result(el).text().trim();
                if (text) errorTexts.push(text);
            });

            const combinedError = errorTexts.join(' ').replace(/\s+/g, ' ').trim();
            if (combinedError) throw new Error('Bitrix error: ' + combinedError);
        }

        return { success: true };
    }

    /**
     * Internal helper: build file manager list URL
     * @param {string|null} sectionId
     * @returns {string}
     */
    _getFileManagerListUrl(sectionId = null) {
        if (sectionId) {
            return `/bitrix/admin/iblock_list_admin.php?IBLOCK_ID=${this.iblockId}&type=file_manager&lang=ru&find_section_section=${sectionId}&SECTION_ID=${sectionId}&apply_filter=Y`;
        }
        return `/bitrix/admin/iblock_list_admin.php?IBLOCK_ID=${this.iblockId}&type=file_manager&lang=ru&find_section_section=5710&SECTION_ID=5710&apply_filter=Y`;
    }
}

export default FileUploadService;
