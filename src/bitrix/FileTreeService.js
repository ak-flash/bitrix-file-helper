import { HtmlParser } from './HtmlParser.js';

/**
 * FileTreeService — builds and exports the Bitrix iblock file tree
 */
export class FileTreeService {
    /**
     * @param {import('./HttpClient.js').HttpClient} httpClient
     */
    constructor(httpClient) {
        this.http = httpClient;
    }

    /**
     * Build URL to file manager list page for a given section
     * @param {string|number|null} sectionId
     * @returns {string}
     */
    getFileManagerListUrl(sectionId = null) {
        if (sectionId) {
            return `/bitrix/admin/iblock_list_admin.php?IBLOCK_ID=6&type=file_manager&lang=ru&find_section_section=${sectionId}&SECTION_ID=${sectionId}&apply_filter=Y`;
        }
        return `/bitrix/admin/iblock_list_admin.php?IBLOCK_ID=6&type=file_manager&lang=ru&find_section_section=5710&SECTION_ID=5710&apply_filter=Y`;
    }

    /**
     * Get items in a specific section
     * @param {string|number} sectionId
     * @returns {Promise<Array>}
     */
    async getSectionItems(sectionId = 0) {
        try {
            const url = `/bitrix/admin/iblock_list_admin.php?IBLOCK_ID=6&type=file_manager&lang=ru&find_section_section=${sectionId}&SECTION_ID=${sectionId}&apply_filter=Y`;
            const response = await this.http.get(url, {
                headers: { Referer: `${this.http.siteUrl}/bitrix/admin/` }
            });
            return HtmlParser.parseFileList(response.data);
        } catch (error) {
            console.error(`Error getting section ${sectionId}:`, error.message);
            return [];
        }
    }

    /**
     * Get file list from user files section
     * @param {string|number|null} sectionId
     * @returns {Promise<Array>}
     */
    async getUserFiles(sectionId = null) {
        try {
            const url = this.getFileManagerListUrl(sectionId);
            const response = await this.http.get(url, {
                headers: { Referer: `${this.http.siteUrl}/bitrix/admin/` }
            });

            const fs = await import('fs');
            fs.writeFileSync('./debug_response.html', response.data);

            return HtmlParser.parseFileList(response.data);
        } catch (error) {
            console.error('Error getting files:', error.message);
            return [];
        }
    }

    /**
     * Build complete tree structure of all sections and files
     * @param {string|number} rootSectionId
     * @param {number} maxDepth
     * @returns {Promise<Object>}
     */
    async buildFileTree(rootSectionId = 0, maxDepth = 10) {
        const tree = {
            root: rootSectionId || 0,
            sections: {},
            totalSections: 0,
            totalElements: 0,
            generatedAt: new Date().toISOString()
        };

        await this._traverseSection(rootSectionId, tree, 0, maxDepth);
        return tree;
    }

    /**
     * Traverse a section recursively (internal)
     * @param {string|number} sectionId
     * @param {Object} tree
     * @param {number} depth
     * @param {number} maxDepth
     */
    async _traverseSection(sectionId, tree, depth, maxDepth) {
        if (depth >= maxDepth) return;

        const sectionKey = String(sectionId || '0');
        const items = await this.getSectionItems(sectionId);

        tree.sections[sectionKey] = {
            id: sectionId,
            depth,
            sections: [],
            elements: [],
            itemCount: items.length
        };

        for (const item of items) {
            if (item.type === 'section') {
                tree.sections[sectionKey].sections.push({
                    id: item.id,
                    rowId: item.rowId,
                    name: item.name,
                    active: item.active,
                    sort: item.sort,
                    date: item.date,
                    link: item.link
                });
                tree.totalSections++;
                await this._traverseSection(item.id, tree, depth + 1, maxDepth);
            } else {
                tree.sections[sectionKey].elements.push({
                    id: item.id,
                    name: item.name,
                    active: item.active,
                    sort: item.sort,
                    date: item.date,
                    size: item.size,
                    link: item.link
                });
                tree.totalElements++;
            }
        }
    }

    /**
     * Export tree to formatted text
     * @param {Object} tree
     * @returns {string}
     */
    exportTreeToText(tree) {
        let output = '';

        output += '═'.repeat(60) + '\n';
        output += '  BITRIX FILE MANAGER - STRUCTURE TREE\n';
        output += '═'.repeat(60) + '\n';
        output += `Generated: ${new Date(tree.generatedAt).toLocaleString('ru-RU')}\n`;
        output += `Total Sections: ${tree.totalSections}\n`;
        output += `Total Elements: ${tree.totalElements}\n`;
        output += '═'.repeat(60) + '\n\n';

        const addSections = (parentId, prefix = '') => {
            const parentKey = String(parentId || '0');
            const section = tree.sections[parentKey];
            if (!section) return;

            for (let i = 0; i < section.sections.length; i++) {
                const sub = section.sections[i];
                const isLast = i === section.sections.length - 1 && section.elements.length === 0;
                const connector = isLast ? '└── ' : '├── ';
                const newPrefix = prefix + (isLast ? '    ' : '│   ');

                output += `${prefix}${connector}📁 ${sub.name}\n`;
                output += `${newPrefix}   ID: ${sub.id} | Sort: ${sub.sort} | Active: ${sub.active ? 'Yes' : 'No'}\n`;
                if (sub.date) output += `${newPrefix}   Date: ${sub.date}\n`;

                const subKey = String(sub.id);
                const subSection = tree.sections[subKey];
                if (subSection) {
                    for (let j = 0; j < subSection.elements.length; j++) {
                        const elem = subSection.elements[j];
                        const isLastElem = j === subSection.elements.length - 1;
                        const elemConnector = isLastElem ? '└── ' : '├── ';
                        output += `${newPrefix}${elemConnector}📄 ${elem.name}\n`;
                        output += `${newPrefix}    ID: ${elem.id}${elem.size ? ' | Size: ' + elem.size : ''}\n`;
                    }
                    addSections(sub.id, newPrefix);
                }
            }

            if (parentId === 0 || parentId === '0' || parentId === undefined) {
                for (let j = 0; j < section.elements.length; j++) {
                    const elem = section.elements[j];
                    const isLastElem = j === section.elements.length - 1;
                    const elemConnector = isLastElem ? '└── ' : '├── ';
                    output += `${prefix}${elemConnector}📄 ${elem.name}\n`;
                    output += `${prefix}    ID: ${elem.id}${elem.size ? ' | Size: ' + elem.size : ''}\n`;
                }
            }
        };

        output += '📂 Root\n';
        addSections(0, '', true);

        return output;
    }

    /**
     * Export tree to JSON string
     * @param {Object} tree
     * @returns {string}
     */
    exportTreeToJson(tree) {
        return JSON.stringify(tree, null, 2);
    }

    /**
     * Save tree to file
     * @param {Object} tree
     * @param {'txt'|'json'} format
     * @param {string|null} filename
     * @returns {Promise<string>}
     */
    async saveTreeToFile(tree, format = 'txt', filename = null) {
        const fs = await import('fs');

        if (!filename) {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            filename = `bitrix_tree_${timestamp}.${format}`;
        }

        const content = format === 'json'
            ? this.exportTreeToJson(tree)
            : this.exportTreeToText(tree);

        fs.writeFileSync(filename, content, 'utf8');
        console.log(`\n💾 Tree saved to: ${filename}`);
        return filename;
    }
}

export default FileTreeService;
