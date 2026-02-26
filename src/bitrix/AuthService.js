import * as cheerio from 'cheerio';
import FormData from 'form-data';

/**
 * AuthService — handles login, logout and session checks
 */
export class AuthService {
    /**
     * @param {import('./HttpClient.js').HttpClient} httpClient
     * @param {string} adminPath
     */
    constructor(httpClient, adminPath = '/bitrix/admin') {
        this.http = httpClient;
        this.adminPath = adminPath;
    }

    /**
     * Authenticate with Bitrix admin panel
     * @param {string} username
     * @param {string} password
     * @returns {Promise<boolean>}
     */
    async login(username, password) {
        try {
            // Get login page to obtain session and form tokens
            const loginPage = await this.http.get('/bitrix/admin/index.php?login=yes');

            const $ = cheerio.load(loginPage.data);
            const formAction = $('form[name="form_auth"]').attr('action') || '/bitrix/admin/index.php';
            const securityToken = $('input[name="security_token"]').val() || '';
            const sessid = $('input[name="sessid"]').val() || '';

            const loginData = new FormData();
            loginData.append('AUTH_FORM', 'Y');
            loginData.append('TYPE', 'AUTH');
            loginData.append('USER_LOGIN', username);
            loginData.append('USER_PASSWORD', password);
            loginData.append('Remember', 'Y');
            loginData.append('sessid', sessid);
            loginData.append('security_token', securityToken);
            loginData.append('Login', 'Login');

            const loginResponse = await this.http.post(formAction, loginData, {
                headers: {
                    ...loginData.getHeaders(),
                    'Referer': `${this.http.siteUrl}/bitrix/admin/index.php?login=yes`
                }
            });

            const responseCookies = loginResponse.headers['set-cookie'];
            if (responseCookies) {
                this.http.storeCookies(responseCookies);
                this.http.authenticated = true;
                return true;
            }

            // Alternative check
            const loginHtml = loginResponse.data;
            if (loginHtml.includes('user_info') || loginHtml.includes('USER_LOGIN')) {
                if (loginHtml.includes('error') || loginHtml.includes('Incorrect')) {
                    throw new Error('Invalid username or password');
                }
            }

            this.http.authenticated = true;
            return true;
        } catch (error) {
            console.error('Login error:', error.message);
            this.http.authenticated = false;
            throw error;
        }
    }

    /**
     * Check if current session is still active
     * @returns {Promise<boolean>}
     */
    async checkAuth() {
        try {
            const response = await this.http.get('/bitrix/admin/index.php?lang=ru');
            const html = response.data;
            return !html.includes('form_auth') || !html.includes('USER_LOGIN');
        } catch {
            return false;
        }
    }

    /**
     * Logout from admin panel
     * @returns {Promise<void>}
     */
    async logout() {
        try {
            await this.http.get('/bitrix/admin/?logout=yes');
        } catch {
            // Ignore logout errors
        } finally {
            this.http.cookies = null;
            this.http.authenticated = false;
        }
    }
}

export default AuthService;
