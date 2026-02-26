import { HttpClient } from './bitrix/HttpClient.js';
import { AuthService } from './bitrix/AuthService.js';
import { HtmlParser } from './bitrix/HtmlParser.js';
import { FileTreeService } from './bitrix/FileTreeService.js';
import { FileUploadService } from './bitrix/FileUploadService.js';
import {
  transliterate,
  sanitizeFileName,
  encodeValue,
  encodeFilename,
  formatBitrixDate,
  buildMultipartBody
} from './bitrix/encoding.js';

/**
 * BitrixClient — facade for working with Bitrix24/1C-Bitrix file management.
 *
 * Delegates actual work to focused service classes:
 *  - HttpClient        HTTP transport + cookie management
 *  - AuthService       login / logout / checkAuth
 *  - HtmlParser        HTML parsing (static)
 *  - FileTreeService   directory tree traversal and export
 *  - FileUploadService file uploads
 */
export class BitrixClient {
  /**
   * @param {string} siteUrl
   * @param {object} options
   * @param {string}  [options.adminPath='/bitrix/admin']
   * @param {number}  [options.maxRetries=3]
   * @param {number}  [options.timeout=30000]
   * @param {boolean} [options.rejectUnauthorized=true]
   * @param {number}  [options.iblockId=6]
   */
  constructor(siteUrl, options = {}) {
    this.siteUrl = siteUrl.replace(/\/$/, '');
    this.adminPath = options.adminPath || '/bitrix/admin';
    this.maxRetries = options.maxRetries || 3;
    this.timeout = options.timeout || 30000;
    this.rejectUnauthorized = options.rejectUnauthorized !== false;

    // HTTP transport layer (also owns cookies & authenticated flag)
    this.client = new HttpClient(siteUrl, {
      timeout: this.timeout,
      rejectUnauthorized: this.rejectUnauthorized
    });

    // Services
    this._auth = new AuthService(this.client, this.adminPath);
    this._tree = new FileTreeService(this.client);
    this._upload = new FileUploadService(this.client, options.iblockId ?? 6);
  }

  // ── Proxy properties for backwards-compatibility ──────────────────────────

  get cookies() { return this.client.cookies; }
  set cookies(v) { this.client.cookies = v; }

  get authenticated() { return this.client.authenticated; }
  set authenticated(v) { this.client.authenticated = v; }

  // ── Auth ──────────────────────────────────────────────────────────────────

  async login(username, password) {
    return this._auth.login(username, password);
  }

  async checkAuth() {
    return this._auth.checkAuth();
  }

  async logout() {
    return this._auth.logout();
  }

  // ── File Manager ──────────────────────────────────────────────────────────

  getFileManagerListUrl(sectionId = null) {
    return this._tree.getFileManagerListUrl(sectionId);
  }

  async getUserFiles(sectionId = null) {
    if (!this.authenticated) throw new Error('Not authenticated. Please call login() first.');
    return this._tree.getUserFiles(sectionId);
  }

  async getSectionItems(sectionId = 0) {
    return this._tree.getSectionItems(sectionId);
  }

  async buildFileTree(rootSectionId = 0, maxDepth = 10) {
    if (!this.authenticated) throw new Error('Not authenticated. Please call login() first.');
    return this._tree.buildFileTree(rootSectionId, maxDepth);
  }

  exportTreeToText(tree) {
    return this._tree.exportTreeToText(tree);
  }

  exportTreeToJson(tree) {
    return this._tree.exportTreeToJson(tree);
  }

  async saveTreeToFile(tree, format = 'txt', filename = null) {
    return this._tree.saveTreeToFile(tree, format, filename);
  }

  // ── Parsing (static delegates) ────────────────────────────────────────────

  parseFileList(html) {
    return HtmlParser.parseFileList(html);
  }

  parseMainGridTable($) {
    return HtmlParser.parseMainGridTable($);
  }

  parseUserList(html) {
    return HtmlParser.parseUserList(html);
  }

  // ── Users ─────────────────────────────────────────────────────────────────

  async getUsers() {
    if (!this.authenticated) throw new Error('Not authenticated. Please call login() first.');
    try {
      const response = await this.client.get('/bitrix/admin/user_admin.php?lang=ru', {
        headers: { Referer: `${this.siteUrl}/bitrix/admin/` }
      });
      return HtmlParser.parseUserList(response.data);
    } catch (error) {
      console.error('Error getting users:', error.message);
      return [];
    }
  }

  // ── Uploads ───────────────────────────────────────────────────────────────

  async uploadFileToTemp(filename, buffer, mimetype = 'application/octet-stream', opts = {}) {
    return this._upload.uploadFileToTemp(filename, buffer, mimetype, opts);
  }

  async uploadFile(sectionId, filename, buffer, extra = {}) {
    if (!this.authenticated) throw new Error('Not authenticated. Please call login() first.');
    return this._upload.uploadFile(sectionId, filename, buffer, extra);
  }

  // ── Encoding utilities (kept for external callers) ────────────────────────

  transliterate(value) { return transliterate(value); }
  sanitizeFileName(value) { return sanitizeFileName(value); }
  encodeValue(value, encoding) { return encodeValue(value, encoding); }
  encodeFilename(filename, encoding) { return encodeFilename(filename, encoding); }
  formatBitrixDate(value) { return formatBitrixDate(value); }
  buildMultipartBody(fields, files, boundary, encoding) {
    return buildMultipartBody(fields, files, boundary, encoding);
  }
}

export default BitrixClient;
