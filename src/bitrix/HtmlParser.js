import * as cheerio from 'cheerio';

/**
 * HtmlParser — stateless HTML parsing for Bitrix admin pages
 */
export class HtmlParser {
    /**
     * Parse HTML response to extract file/section list
     * @param {string} html
     * @returns {Array}
     */
    static parseFileList(html) {
        const files = [];
        const $ = cheerio.load(html);

        // Try new Bitrix main-grid table format first
        const gridFiles = HtmlParser.parseMainGridTable($);
        if (gridFiles.length > 0) {
            return gridFiles;
        }

        // Try various table selectors used in Bitrix
        const tableSelectors = [
            'table.adm-list-table',
            'table.adm-workgrounds',
            'table.list-table',
            'table[data-table]',
            'table.iblock_list_table'
        ];

        for (const selector of tableSelectors) {
            $(selector).each((_, table) => {
                const $table = $(table);

                $table.find('tr').each((_, row) => {
                    const cells = $(row).find('td');
                    if (cells.length >= 1) {
                        const nameCell = $(cells[0]);
                        const name = nameCell.text().trim();
                        const linkElem = nameCell.find('a').first();
                        const link = linkElem.attr('href');

                        let size = '';
                        let date = '';
                        if (cells.length >= 2) size = $(cells[1]).text().trim();
                        if (cells.length >= 3) date = $(cells[2]).text().trim();

                        if (name && name.length > 2 &&
                            !name.toLowerCase().includes('название') &&
                            !name.toLowerCase().includes('name') &&
                            !name.includes('---') &&
                            !name.includes('Элемент') &&
                            !name.toLowerCase().startsWith('добавить') &&
                            !name.toLowerCase().includes('добавить элемент') &&
                            !name.toLowerCase().includes('добавить папку') &&
                            !name.toLowerCase().includes('добавить раздел') &&
                            !name.toLowerCase().includes('добавить файл')) {
                            files.push({
                                name: name.substring(0, 100),
                                size,
                                date,
                                link: link || null
                            });
                        }
                    }
                });
            });

            if (files.length > 0) break;
        }

        // Alternative: look for any links that might be files
        if (files.length === 0) {
            $('a[href*="element"]').each((_, elem) => {
                const $elem = $(elem);
                const text = $elem.text().trim();
                const href = $elem.attr('href');

                if (text && text.length > 2 && text.length < 200) {
                    files.push({ name: text, link: href });
                }
            });
        }

        return files;
    }

    /**
     * Parse Bitrix main-grid table (new format)
     * @param {import('cheerio').CheerioAPI} $ - Cheerio instance
     * @returns {Array}
     */
    static parseMainGridTable($) {
        const items = [];

        const $table = $('table.main-grid-table');
        if ($table.length === 0) return items;

        const headers = [];
        $table.find('thead th').each((_, th) => {
            const $th = $(th);
            const name = $th.attr('data-name') || $th.find('.main-grid-head-title').text().trim().toUpperCase();
            headers.push(name);
        });

        const nameIdx = headers.findIndex(h => h === 'NAME');
        const activeIdx = headers.findIndex(h => h === 'ACTIVE');
        const sortIdx = headers.findIndex(h => h === 'SORT');
        const dateIdx = headers.findIndex(h => h.includes('TIMESTAMP') || h.includes('DATE'));
        const idIdx = headers.findIndex(h => h === 'ID');
        const sizeIdx = headers.findIndex(h => h.includes('SIZE'));

        $table.find('tbody tr.main-grid-row').each((_, row) => {
            const $row = $(row);
            const rowId = $row.attr('data-id');

            if (rowId === 'template_0' || rowId?.startsWith('template_')) return;

            const cells = $row.find('td.main-grid-cell');
            if (cells.length === 0) return;

            let name = '';
            if (nameIdx >= 0 && cells[nameIdx]) {
                const nameCell = $(cells[nameIdx]);
                name = nameCell.find('.main-grid-cell-content').text().trim() ||
                    nameCell.find('a.adm-list-table-link').text().trim() ||
                    nameCell.text().trim();
            }

            if (!name || name.length < 2) return;
            const nameLower = name.toLowerCase();
            if (nameLower.includes('название') ||
                nameLower.includes('name') ||
                nameLower.startsWith('добавить') ||
                nameLower.includes('добавить элемент') ||
                nameLower.includes('добавить папку') ||
                nameLower.includes('добавить файл') ||
                nameLower.includes('добавить раздел') ||
                name.includes('Элемент')) return;

            const active = activeIdx >= 0 && cells[activeIdx]
                ? $(cells[activeIdx]).find('.main-grid-cell-content').text().trim()
                : '';

            const sort = sortIdx >= 0 && cells[sortIdx]
                ? $(cells[sortIdx]).find('.main-grid-cell-content').text().trim()
                : '';

            const date = dateIdx >= 0 && cells[dateIdx]
                ? $(cells[dateIdx]).find('.main-grid-cell-content').text().trim()
                : '';

            const id = idIdx >= 0 && cells[idIdx]
                ? $(cells[idIdx]).find('.main-grid-cell-content').text().trim()
                : rowId?.replace('S', '') || '';

            let size = '';
            if (sizeIdx >= 0 && cells[sizeIdx]) {
                size = $(cells[sizeIdx]).find('.main-grid-cell-content').text().trim();
            }

            const isSection = rowId?.startsWith('S');

            let link = '';
            const actionCell = $row.find('td.main-grid-cell-action');
            if (actionCell.length > 0) {
                const actionLink = actionCell.find('a').attr('href');
                if (actionLink) link = actionLink;
            }

            if (!link && nameIdx >= 0 && cells[nameIdx]) {
                const nameLink = $(cells[nameIdx]).find('a').attr('href');
                if (nameLink) link = nameLink;
            }

            items.push({
                id,
                rowId,
                name: name.substring(0, 200),
                active: active === 'Да' || active === 'Y' || active === 'true',
                sort: parseInt(sort, 10) || 0,
                date,
                size,
                link: link || null,
                type: isSection ? 'section' : 'element'
            });
        });

        return items;
    }

    /**
     * Parse HTML response to extract user list
     * @param {string} html
     * @returns {Array}
     */
    static parseUserList(html) {
        const users = [];
        const $ = cheerio.load(html);

        $('table.adm-users-list, table.users-list, table[data-role="users-grid"]').each((_, table) => {
            $(table).find('tr').each((_, row) => {
                const cells = $(row).find('td');
                if (cells.length >= 2) {
                    const login = $(cells[0]).text().trim();
                    const name = $(cells[1]).text().trim();
                    const email = $(cells[2]).text().trim();
                    const active = $(cells[3]).text().trim();

                    if (login && !login.includes('Login') && !login.includes('---')) {
                        users.push({ login, name, email, active: active === 'Y' });
                    }
                }
            });
        });

        return users;
    }
}

export default HtmlParser;
