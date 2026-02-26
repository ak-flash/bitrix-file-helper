import axios from 'axios';
import * as cheerio from 'cheerio';
import FormData from 'form-data';
import https from 'https';
import iconv from 'iconv-lite';
import { Buffer } from 'buffer';

/**
 * BitrixClient - Client for working with Bitrix24/1C-Bitrix file management
 */
export class BitrixClient {
  constructor(siteUrl, options = {}) {
    this.siteUrl = siteUrl.replace(/\/$/, '');
    this.adminPath = options.adminPath || '/bitrix/admin';
    this.maxRetries = options.maxRetries || 3;
    this.timeout = options.timeout || 30000;
    this.rejectUnauthorized = options.rejectUnauthorized !== false;

    this.cookies = null;
    this.authenticated = false;

    // Create HTTPS agent to handle SSL certificate issues
    const httpsAgent = new https.Agent({
      rejectUnauthorized: this.rejectUnauthorized
    });

    // Create axios instance with default config
    this.client = axios.create({
      baseURL: this.siteUrl,
      timeout: this.timeout,
      withCredentials: true,
      httpsAgent,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      }
    });
  }

  /**
   * Authenticate with Bitrix admin panel
   * @param {string} username - Admin username
   * @param {string} password - Admin password
   * @returns {Promise<boolean>} - Authentication success
   */
  async login(username, password) {
    try {
      // First, get the login page to obtain session and form tokens
      const loginPage = await this.client.get('/bitrix/admin/index.php?login=yes');

      // Extract session and security tokens from the login form
      const $ = cheerio.load(loginPage.data);

      // Get the form action URL
      const formAction = $('form[name="form_auth"]').attr('action') || '/bitrix/admin/index.php';

      // Extract hidden fields
      const securityToken = $('input[name="security_token"]').val() || '';
      const sessid = $('input[name="sessid"]').val() || '';

      // Prepare login data
      const loginData = new FormData();
      loginData.append('AUTH_FORM', 'Y');
      loginData.append('TYPE', 'AUTH');
      loginData.append('USER_LOGIN', username);
      loginData.append('USER_PASSWORD', password);
      loginData.append('Remember', 'Y');
      loginData.append('sessid', sessid);
      loginData.append('security_token', securityToken);
      loginData.append('Login', 'Login');

      // Perform login
      const loginResponse = await this.client.post(formAction, loginData, {
        headers: {
          ...loginData.getHeaders(),
          'Referer': `${this.siteUrl}/bitrix/admin/index.php?login=yes`
        }
      });

      // Check if login was successful by looking for user info or session
      const responseCookies = loginResponse.headers['set-cookie'];
      if (responseCookies) {
        this.cookies = responseCookies;
        this.authenticated = true;
        return true;
      }

      // Alternative check: look for user info in the response
      const loginHtml = loginResponse.data;
      if (loginHtml.includes('user_info') || loginHtml.includes('USER_LOGIN')) {
        // Still on login page, check for error
        if (loginHtml.includes('error') || loginHtml.includes('Incorrect')) {
          throw new Error('Invalid username or password');
        }
      }

      this.authenticated = true;
      return true;
    } catch (error) {
      console.error('Login error:', error.message);
      this.authenticated = false;
      throw error;
    }
  }

  getFileManagerListUrl(sectionId = null) {
    if (sectionId) {
      return `/bitrix/admin/iblock_list_admin.php?IBLOCK_ID=6&type=file_manager&lang=ru&find_section_section=${sectionId}&SECTION_ID=${sectionId}&apply_filter=Y`;
    }
    return `/bitrix/admin/iblock_list_admin.php?IBLOCK_ID=6&type=file_manager&lang=ru&find_section_section=5710&SECTION_ID=5710&apply_filter=Y`;
  }

  /**
   * Get file list from user files section
   * @param {string} sectionId - Section ID (optional)
   * @returns {Promise<Array>} - List of files
   */
  async getUserFiles(sectionId = null) {
    if (!this.authenticated) {
      throw new Error('Not authenticated. Please call login() first.');
    }

    try {
      const fileManagerUrl = this.getFileManagerListUrl(sectionId);

      const response = await this.client.get(fileManagerUrl, {
        headers: {
          'Cookie': this.cookies?.join('; ') || '',
          'Referer': `${this.siteUrl}/bitrix/admin/`
        }
      });

      const fs = await import('fs');
      fs.writeFileSync('./debug_response.html', response.data);

      return this.parseFileList(response.data);
    } catch (error) {
      console.error('Error getting files:', error.message);
      return [];
    }
  }

  /**
   * Parse HTML response to extract file list
   * @param {string} html - HTML response
   * @returns {Array} - Parsed file list
   */
  parseFileList(html) {
    const files = [];
    const $ = cheerio.load(html);

    // Try new Bitrix main-grid table format first
    const gridFiles = this.parseMainGridTable($);
    if (gridFiles.length > 0) {
      return gridFiles;
    }

    // Find all tables and look for ones with data
    const tables = $('table');

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

            // Get additional info from other cells
            let size = '';
            let date = '';
            if (cells.length >= 2) size = $(cells[1]).text().trim();
            if (cells.length >= 3) date = $(cells[2]).text().trim();

            // Skip header rows and empty rows
            if (name && name.length > 2 &&
              !name.toLowerCase().includes('название') &&
              !name.toLowerCase().includes('name') &&
              !name.includes('---') &&
              !name.includes('Элемент')) {
              files.push({
                name: name.substring(0, 100), // Limit name length
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
          files.push({
            name: text,
            link: href
          });
        }
      });
    }

    return files;
  }

  /**
   * Parse Bitrix main-grid table (new format)
   * @param {cheerio.Root} $ - Cheerio instance
   * @returns {Array} - Parsed items (sections/files)
   */
  parseMainGridTable($) {
    const items = [];

    // Find main-grid-table
    const $table = $('table.main-grid-table');
    if ($table.length === 0) {
      return items;
    }

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

    // Parse data rows
    $table.find('tbody tr.main-grid-row').each((_, row) => {
      const $row = $(row);
      const rowId = $row.attr('data-id');

      // Skip template rows
      if (rowId === 'template_0' || rowId?.startsWith('template_')) {
        return;
      }

      const cells = $row.find('td.main-grid-cell');
      if (cells.length === 0) return;

      // Extract name
      let name = '';
      if (nameIdx >= 0 && cells[nameIdx]) {
        const nameCell = $(cells[nameIdx]);
        name = nameCell.find('.main-grid-cell-content').text().trim() ||
          nameCell.find('a.adm-list-table-link').text().trim() ||
          nameCell.text().trim();
      }

      // Skip if no name or it's a header-like row
      if (!name || name.length < 2) return;
      if (name.toLowerCase().includes('название') || name.toLowerCase().includes('name')) return;

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

      // Determine if this is a section or element
      const isSection = rowId?.startsWith('S');

      // Get edit link from action column
      let link = '';
      const actionCell = $row.find('td.main-grid-cell-action');
      if (actionCell.length > 0) {
        const actionLink = actionCell.find('a').attr('href');
        if (actionLink) {
          link = actionLink;
        }
      }

      // Get name link
      if (!link && nameIdx >= 0 && cells[nameIdx]) {
        const nameLink = $(cells[nameIdx]).find('a').attr('href');
        if (nameLink) {
          link = nameLink;
        }
      }

      items.push({
        id: id,
        rowId: rowId,
        name: name.substring(0, 200),
        active: active === 'Да' || active === 'Y' || active === 'true',
        sort: parseInt(sort, 10) || 0,
        date: date,
        size: size,
        link: link || null,
        type: isSection ? 'section' : 'element'
      });
    });

    return items;
  }

  /**
   * Get user list from admin panel
   * @returns {Promise<Array>} - List of users
   */
  async getUsers() {
    if (!this.authenticated) {
      throw new Error('Not authenticated. Please call login() first.');
    }

    try {
      const response = await this.client.get('/bitrix/admin/user_admin.php?lang=ru', {
        headers: {
          'Cookie': this.cookies?.join('; ') || '',
          'Referer': `${this.siteUrl}/bitrix/admin/`
        }
      });

      return this.parseUserList(response.data);
    } catch (error) {
      console.error('Error getting users:', error.message);
      return [];
    }
  }

  /**
   * Parse HTML response to extract user list
   * @param {string} html - HTML response
   * @returns {Array} - Parsed user list
   */
  parseUserList(html) {
    const users = [];
    const $ = cheerio.load(html);

    // Find user table
    $('table.adm-users-list, table.users-list, table[data-role="users-grid"]').each((_, table) => {
      $(table).find('tr').each((_, row) => {
        const cells = $(row).find('td');
        if (cells.length >= 2) {
          const login = $(cells[0]).text().trim();
          const name = $(cells[1]).text().trim();
          const email = $(cells[2]).text().trim();
          const active = $(cells[3]).text().trim();

          if (login && !login.includes('Login') && !login.includes('---')) {
            users.push({
              login,
              name,
              email,
              active: active === 'Y'
            });
          }
        }
      });
    });

    return users;
  }

  /**
   * Check authentication status
   * @returns {Promise<boolean>} - Authentication status
   */
  async checkAuth() {
    try {
      const response = await this.client.get('/bitrix/admin/index.php?lang=ru', {
        headers: {
          'Cookie': this.cookies?.join('; ') || ''
        }
      });

      // Check if we're still logged in
      const html = response.data;
      return !html.includes('form_auth') || !html.includes('USER_LOGIN');
    } catch (error) {
      return false;
    }
  }

  /**
   * Logout from admin panel
   */
  async logout() {
    try {
      await this.client.get('/bitrix/admin/?logout=yes', {
        headers: {
          'Cookie': this.cookies?.join('; ') || ''
        }
      });
    } catch (error) {
      // Ignore logout errors
    } finally {
      this.cookies = null;
      this.authenticated = false;
    }
  }

  /**
   * Build complete tree structure of all sections and files
   * @param {string} rootSectionId - Root section ID (default: 0)
   * @param {number} maxDepth - Maximum depth to traverse
   * @returns {Promise<Object>} - Tree structure
   */
  async buildFileTree(rootSectionId = 0, maxDepth = 10) {
    if (!this.authenticated) {
      throw new Error('Not authenticated. Please call login() first.');
    }

    const tree = {
      root: rootSectionId || 0,
      sections: {},
      totalSections: 0,
      totalElements: 0,
      generatedAt: new Date().toISOString()
    };

    // Recursively traverse
    await this._traverseSection(rootSectionId, tree, 0, maxDepth);

    return tree;
  }

  /**
   * Traverse a section recursively (internal)
   * @param {string|number} sectionId - Section ID
   * @param {Object} tree - Tree object to populate
   * @param {number} depth - Current depth
   * @param {number} maxDepth - Maximum depth
   */
  async _traverseSection(sectionId, tree, depth, maxDepth) {
    if (depth >= maxDepth) {
      return;
    }

    const sectionKey = String(sectionId || '0');

    // Get items in this section
    const items = await this.getSectionItems(sectionId);

    tree.sections[sectionKey] = {
      id: sectionId,
      depth: depth,
      sections: [],
      elements: [],
      itemCount: items.length
    };

    // Separate sections and elements
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

        // Recursively traverse subsections
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
   * Get items in a specific section
   * @param {string|number} sectionId - Section ID
   * @returns {Promise<Array>} - List of items
   */
  async getSectionItems(sectionId = 0) {
    try {
      const url = `/bitrix/admin/iblock_list_admin.php?IBLOCK_ID=6&type=file_manager&lang=ru&find_section_section=${sectionId}&SECTION_ID=${sectionId}&apply_filter=Y`;

      const response = await this.client.get(url, {
        headers: {
          'Cookie': this.cookies?.join('; ') || '',
          'Referer': `${this.siteUrl}/bitrix/admin/`
        }
      });

      return this.parseFileList(response.data);
    } catch (error) {
      console.error(`Error getting section ${sectionId}:`, error.message);
      return [];
    }
  }

  /**
   * Export tree to formatted text
   * @param {Object} tree - Tree structure
   * @returns {string} - Formatted text tree
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

    // Build text tree recursively
    const addSections = (parentId, prefix = '', isLastParent = true) => {
      const parentKey = String(parentId || '0');
      const section = tree.sections[parentKey];
      if (!section) return;

      // Get subsections
      for (let i = 0; i < section.sections.length; i++) {
        const sub = section.sections[i];
        const isLast = i === section.sections.length - 1 && section.elements.length === 0;
        const connector = isLast ? '└── ' : '├── ';
        const newPrefix = prefix + (isLast ? '    ' : '│   ');

        output += `${prefix}${connector}📁 ${sub.name}\n`;
        output += `${newPrefix}   ID: ${sub.id} | Sort: ${sub.sort} | Active: ${sub.active ? 'Yes' : 'No'}\n`;
        if (sub.date) {
          output += `${newPrefix}   Date: ${sub.date}\n`;
        }

        // Add elements in this subsection
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

          // Add nested subsections
          addSections(sub.id, newPrefix, isLast);
        }
      }

      // Add elements at current level (if this is root)
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

    // Start from root
    output += '📂 Root\n';
    addSections(0, '', true);

    return output;
  }

  /**
   * Export tree to JSON
   * @param {Object} tree - Tree structure
   * @returns {string} - JSON string
   */
  exportTreeToJson(tree) {
    return JSON.stringify(tree, null, 2);
  }

  /**
   * Save tree to file
   * @param {Object} tree - Tree structure
   * @param {string} format - Output format ('txt' or 'json')
   * @param {string} filename - Output filename
   * @returns {Promise<string>} - Saved filename
   */
  async saveTreeToFile(tree, format = 'txt', filename = null) {
    const fs = await import('fs');

    if (!filename) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      filename = `bitrix_tree_${timestamp}.${format}`;
    }

    let content;
    if (format === 'json') {
      content = this.exportTreeToJson(tree);
    } else {
      content = this.exportTreeToText(tree);
    }

    fs.writeFileSync(filename, content, 'utf8');
    console.log(`\n💾 Tree saved to: ${filename}`);
    return filename;
  }

  transliterate(value) {
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
        if (map[lower]) {
          const tr = map[lower];
          return ch === lower ? tr : tr.toUpperCase();
        }
        return ch;
      })
      .join('');
  }

  sanitizeFileName(value) {
    // Preserve Unicode characters including Cyrillic
    const cleaned = String(value ?? '')
      .replace(/[\\/]/g, '_')
      .replace(/[\u0000-\u001F\u007F]/g, '')
      .replace(/[<>:"|?*%]/g, '_')
      .replace(/\s+/g, ' ')
      .trim();
    return cleaned || 'file';
  }

  encodeValue(value, encoding = 'utf-8') {
    if (Buffer.isBuffer(value)) {
      return value;
    }
    const text = String(value ?? '');
    // Use iconv-lite for windows-1251 encoding
    if (encoding === 'windows-1251') {
      return iconv.encode(text, 'windows-1251');
    }
    return Buffer.from(text, 'utf-8');
  }

  /**
   * Encode filename for Content-Disposition header
   * @param {string} filename - Original filename
   * @param {string} encoding - Target encoding
   * @returns {Buffer} - Encoded filename header part
   */
  encodeFilename(filename, encoding = 'utf-8') {
    const text = String(filename ?? '');
    const escaped = text.replace(/"/g, '\\"');
    if (encoding === 'windows-1251') {
      return iconv.encode(`filename="${escaped}"`, 'windows-1251');
    }
    return Buffer.from(`filename="${escaped}"`, 'utf-8');
  }

  buildMultipartBody(fields, files, boundary, encoding = 'utf-8') {
    const chunks = [];
    const lineBreak = Buffer.from('\r\n', 'ascii');
    const boundaryLine = Buffer.from(`--${boundary}\r\n`, 'ascii');

    fields.forEach(({ name, value }) => {
      chunks.push(boundaryLine);
      chunks.push(Buffer.from(`Content-Disposition: form-data; name="${name}"\r\n\r\n`, 'ascii'));
      chunks.push(this.encodeValue(value, encoding));
      chunks.push(lineBreak);
    });

    files.forEach(({ name, filename, contentType, data }) => {
      chunks.push(boundaryLine);
      const filenameHeaderBuffer = this.encodeFilename(filename, encoding);
      chunks.push(Buffer.from(`Content-Disposition: form-data; name="${name}"; `, 'ascii'));
      chunks.push(filenameHeaderBuffer);
      chunks.push(Buffer.from(`\r\nContent-Type: ${contentType || 'application/octet-stream'}\r\n\r\n`, 'ascii'));
      chunks.push(data);
      chunks.push(lineBreak);
    });

    chunks.push(Buffer.from(`--${boundary}--\r\n`, 'ascii'));
    return Buffer.concat(chunks);
  }


  formatBitrixDate(value) {
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
   * Upload file to Bitrix temporary storage (AJAX endpoint)
   * @param {string} filename - File name
   * @param {Buffer} buffer - File content
   * @param {string} mimetype - MIME type
   * @returns {Promise<{tmp_name: string, size: number}>} - Temporary file path
   */
  async uploadFileToTemp(filename, buffer, mimetype = 'application/octet-stream', opts = {}) {
    const bufferData = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || '');
    const escapedFilename = filename.replace(/"/g, '\\"');

    const buildBody = (boundary, fieldName = 'file', extraFields = []) => {
      const chunks = [];
      // Add extra text fields first (e.g. bxu_info, sessid)
      for (const { name, value } of extraFields) {
        chunks.push(Buffer.from(`--${boundary}\r\n`, 'ascii'));
        chunks.push(Buffer.from(`Content-Disposition: form-data; name="${name}"\r\n\r\n`, 'ascii'));
        chunks.push(Buffer.from(String(value), 'utf-8'));
        chunks.push(Buffer.from('\r\n', 'ascii'));
      }
      // Add file
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

    // Build the list of endpoints to try
    // Primary: /bitrix/tools/upload.php with bxu_info if available
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

    // Fallback without bxu_info
    endpoints.push({ url: '/bitrix/tools/upload.php', fieldName: 'file', extraFields: sessid ? [{ name: 'sessid', value: sessid }] : [], extra: {} });

    for (const endpoint of endpoints) {
      const boundary = `----WebKitFormBoundary${Date.now().toString(16)}`;
      const body = buildBody(boundary, endpoint.fieldName, endpoint.extraFields || []);
      try {
        const response = await this.client.post(endpoint.url, body, {
          headers: {
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Content-Length': body.length,
            'Cookie': this.cookies?.join('; ') || '',
            ...endpoint.extra
          },
          maxBodyLength: Infinity,
          validateStatus: null // don't throw on non-2xx
        });

        console.log(`uploadFileToTemp [${endpoint.url}] status: ${response.status}`);
        if (response.status === 404) {
          console.log(`  -> 404, trying next endpoint`);
          continue;
        }

        const dataPreview = typeof response.data === 'string'
          ? response.data.slice(0, 300)
          : JSON.stringify(response.data).slice(0, 300);
        console.log(`  -> response data: ${dataPreview}`);

        const result = parseResponse(response.data);
        if (result && result.tmp_name) {
          console.log(`  -> SUCCESS tmp_name: ${result.tmp_name}`);
          return { tmp_name: result.tmp_name, size: bufferData.length };
        }
        if (result && result.error) {
          throw new Error('Bitrix temp upload error: ' + result.error);
        }
        // Got a non-404 but no tmp_name — log and continue
        console.log(`  -> no tmp_name in result: ${JSON.stringify(result)}`);
      } catch (err) {
        if (err.message.startsWith('Bitrix temp upload error')) throw err;
        console.log(`  -> error: ${err.message}`);
      }
    }

    throw new Error('All temp upload endpoints failed. See console for details.');
  }

  async uploadFile(sectionId, filename, buffer, extra = {}) {
    if (!this.authenticated) {
      throw new Error('Not authenticated. Please call login() first.');
    }

    console.log('BitrixClient.uploadFile called with:');
    console.log('  filename:', filename);
    console.log('  buffer size:', buffer?.length);

    const normalizedSectionId =
      sectionId === undefined || sectionId === null
        ? null
        : String(sectionId).trim() || null;

    const effectiveSectionId = normalizedSectionId || '5710';
    const uploadDateRaw = extra && extra.uploadDate ? extra.uploadDate : null;
    const prop68Value = this.formatBitrixDate(uploadDateRaw);
    const rawNameBase = filename.split(/[\\/]/).pop() || filename;
    const nameBase = this.sanitizeFileName(rawNameBase);
    const nameWithoutExt = nameBase.replace(/\.[^.]+$/, '');

    console.log('  processed filename:', nameBase);
    console.log('  effectiveSectionId:', effectiveSectionId);

    const qs = new URLSearchParams({
      IBLOCK_ID: '6',
      type: 'file_manager',
      lang: 'ru',
      find_section_section: effectiveSectionId,
      IBLOCK_SECTION_ID: effectiveSectionId,
      from: 'iblock_list_admin'
    }).toString();

    const editUrl = `/bitrix/admin/iblock_element_edit.php?${qs}`;
    const listUrl = this.getFileManagerListUrl(normalizedSectionId);

    const editPageResponse = await this.client.get(editUrl, {
      headers: {
        Cookie: this.cookies?.join('; ') || '',
        Referer: listUrl
      }
    });

    const $ = cheerio.load(editPageResponse.data);

    let $form = $('form[name="form_element"]');
    if ($form.length === 0) {
      $form = $('form[id^="form_"]');
    }
    if ($form.length === 0) {
      $form = $('form').first();
    }
    if ($form.length === 0) {
      throw new Error('Bitrix element edit form not found');
    }

    const actionAttr = $form.attr('action') || editUrl;
    const actionUrl = actionAttr.startsWith('http')
      ? actionAttr
      : actionAttr.startsWith('/')
        ? actionAttr
        : `/bitrix/admin/${actionAttr}`;

    // Prepare file buffer and mimetype
    const bufferData = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || '');
    const mimetype = extra?.mimetype || 'application/octet-stream';

    // Build multipart body - only fields, no direct file upload
    const fields = [];

    // Add hidden fields from the form
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
      sectionFieldNames.forEach((name) => {
        fields.push({ name, value: effectiveSectionId });
      });
    }

    if (!hasDateField && prop68Value) {
      const prop68Inputs = $form.find('input[name^="PROP[68]"]');
      if (prop68Inputs.length > 0) {
        prop68Inputs.each((_, el) => {
          const name = $(el).attr('name') || '';
          if (name.includes('[VALUE]')) {
            fields.push({ name, value: prop68Value });
          }
        });
      } else {
        fields.push({ name: 'PROP[68][n0][VALUE]', value: prop68Value });
      }
    }

    if (!hasCodeField) {
      const transliterated = this.transliterate(nameWithoutExt);
      const slug = (transliterated || 'file')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
      fields.push({ name: 'CODE', value: slug.slice(0, 50) });
    }

    fields.push({ name: 'ACTIVE', value: 'Y' });
    // NAME field: full name without extension, plain UTF-8
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

    // PROP[74] metadata as plain text fields (UTF-8)
    // PROP[74][n0][name] = full filename with extension — this is what Bitrix stores as the file name
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

    // Send actual file with original filename (UTF-8) in Content-Disposition
    const files = [
      {
        name: 'PROP[74][n0]',
        filename: nameBase,
        contentType: mimetype,
        data: bufferData
      },
      { name: 'bxu_files[]', filename: '', contentType: 'application/octet-stream', data: Buffer.alloc(0) },
      { name: 'bxu_files[]', filename: '', contentType: 'application/octet-stream', data: Buffer.alloc(0) }
    ];

    console.log(`Sending file: NAME="${nameWithoutExt}", PROP[74][n0][name]="${nameBase}"`);

    // Build multipart body with UTF-8 encoding
    const boundary = `----WebKitFormBoundary${Date.now().toString(16)}`;
    const body = this.buildMultipartBody(fields, files, boundary, 'utf-8');

    const response = await this.client.post(actionUrl, body, {
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
        Cookie: this.cookies?.join('; ') || '',
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

      if (combinedError) {
        throw new Error('Bitrix error: ' + combinedError);
      }
    }

    return { success: true };
  }
}

export default BitrixClient;
