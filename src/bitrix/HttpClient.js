import axios from 'axios';
import https from 'https';
import http from 'http';

/**
 * HttpClient — manages the axios instance, cookies, and authenticated state
 */
export class HttpClient {
    /**
     * @param {string} siteUrl
     * @param {object} options
     * @param {number} [options.timeout=30000]
     * @param {boolean} [options.rejectUnauthorized=true]
     */
    constructor(siteUrl, options = {}) {
        this.siteUrl = siteUrl.replace(/\/$/, '');
        this.timeout = options.timeout || 30000;
        this.rejectUnauthorized = options.rejectUnauthorized !== false;

        this.cookies = null;
        this.authenticated = false;

        const httpsAgent = new https.Agent({
            rejectUnauthorized: this.rejectUnauthorized,
            keepAlive: true,
            maxSockets: 50,
            keepAliveMsecs: 10000
        });

        const httpAgent = new http.Agent({
            keepAlive: true,
            maxSockets: 50,
            keepAliveMsecs: 10000
        });

        this._axios = axios.create({
            baseURL: this.siteUrl,
            timeout: this.timeout,
            withCredentials: true,
            httpAgent,
            httpsAgent,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            }
        });
    }

    /**
     * Build cookie header string from stored cookies
     * @returns {string}
     */
    getCookieHeader() {
        return this.cookies?.join('; ') || '';
    }

    /**
     * Store cookies from a response's set-cookie header
     * @param {string[]|undefined} setCookieHeader
     */
    storeCookies(setCookieHeader) {
        if (setCookieHeader) {
            this.cookies = setCookieHeader;
        }
    }

    /**
     * Perform a GET request with automatic cookie injection
     * @param {string} url
     * @param {object} [config]
     * @returns {Promise<import('axios').AxiosResponse>}
     */
    async get(url, config = {}) {
        const mergedConfig = this._mergeConfig(config);
        return this._axios.get(url, mergedConfig);
    }

    /**
     * Perform a POST request with automatic cookie injection
     * @param {string} url
     * @param {*} data
     * @param {object} [config]
     * @returns {Promise<import('axios').AxiosResponse>}
     */
    async post(url, data, config = {}) {
        const mergedConfig = this._mergeConfig(config);
        return this._axios.post(url, data, mergedConfig);
    }

    /**
     * Merge caller config with automatic cookie header
     * @param {object} config
     * @returns {object}
     */
    _mergeConfig(config) {
        const cookieHeader = this.getCookieHeader();
        if (!cookieHeader) return config;
        return {
            ...config,
            headers: {
                Cookie: cookieHeader,
                ...(config.headers || {})
            }
        };
    }
}

export default HttpClient;
