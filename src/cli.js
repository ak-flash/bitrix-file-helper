import inquirer from 'inquirer';
import { BitrixClient } from './BitrixClient.js';
import config from '../config.json' with { type: 'json' };

/**
 * CLI interface for Bitrix file management
 */
export class CLI {
  constructor() {
    this.client = null;
    this.credentials = null;
  }

  /**
   * Run the CLI application
   */
  async run() {
    console.log('\n=== Bitrix File Manager ===\n');

    // Use config value directly if set, otherwise ask
    let ignoreSSL = config.ignoreSSL;
    if (ignoreSSL === undefined) {
      const result = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'ignoreSSL',
          message: 'Ignore SSL certificate errors?',
          default: true
        }
      ]);
      ignoreSSL = result.ignoreSSL;
    }

    // Get credentials
    await this.getCredentials();

    // Initialize client
    this.client = new BitrixClient(config.siteUrl, {
      adminPath: config.adminPath,
      maxRetries: config.maxRetries,
      timeout: config.timeout,
      rejectUnauthorized: !ignoreSSL
    });

    // Login
    console.log(`\nLogging in as ${this.credentials.username}...`);
    try {
      await this.client.login(this.credentials.username, this.credentials.password);

      // Verify authentication by checking auth status
      const isAuth = await this.client.checkAuth();
      if (isAuth) {
        console.log('✓ Successfully authenticated!\n');
        console.log('  Status: Active session established');
        console.log('  You can now view your files\n');
      } else {
        console.log('⚠ Warning: Login appeared to succeed but session may not be active\n');
      }
    } catch (error) {
      console.error('✗ Authentication failed:', error.message);
      console.error('\nPossible causes:');
      console.error('  - Invalid username or password');
      console.error('  - Account is locked or inactive');
      console.error('  - Network connectivity issues');
      return;
    }

    // Main menu loop
    await this.mainMenu();

    // Logout
    await this.client.logout();
    console.log('\n✓ Logged out successfully');
  }

  /**
   * Get credentials from user
   */
  async getCredentials() {
    // Use saved username from config if available
    const questions = [
      {
        type: 'input',
        name: 'username',
        message: 'Username:',
        default: config.username || '',
        validate: (input) => input.trim() !== '' ? true : 'Username is required'
      },
      {
        type: 'password',
        name: 'password',
        message: 'Password:',
        mask: '*',
        validate: (input) => input.trim() !== '' ? true : 'Password is required'
      }
    ];

    this.credentials = await inquirer.prompt(questions);

    // Ask if user wants to save username for next time
    if (!config.username || config.username !== this.credentials.username) {
      const { saveUsername } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'saveUsername',
          message: 'Save username for future use?',
          default: true
        }
      ]);

      if (saveUsername) {
        const fs = await import('fs');
        const configPath = './config.json';
        const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        configData.username = this.credentials.username;
        fs.writeFileSync(configPath, JSON.stringify(configData, null, 2));
        console.log('✓ Username saved\n');
      }
    }
  }

  /**
   * Main menu
   */
  async mainMenu() {
    const choices = [
      { name: 'List my files/sections', value: 'list_files' },
      { name: 'Build and save file tree', value: 'build_tree' },
      { name: 'Test parsing (from debug file)', value: 'test_parse' },
      { name: 'Exit', value: 'exit' }
    ];

    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'Select action:',
        choices
      }
    ]);

    switch (action) {
      case 'list_files':
        await this.listFiles();
        break;
      case 'build_tree':
        await this.buildTree();
        break;
      case 'test_parse':
        await this.testParsing();
        break;
      case 'exit':
        return;
    }

    if (action !== 'exit') {
      await this.mainMenu();
    }
  }

  /**
   * Build and save file tree
   */
  async buildTree() {
    console.log('\n--- Build File Tree ---\n');

    // Get values from config
    const sectionId = config.sectionId || 5710;
    const maxDepth = config.maxDepth || 5;

    // Ask for output format only
    const { format } = await inquirer.prompt([
      {
        type: 'list',
        name: 'format',
        message: 'Output format:',
        choices: [
          { name: 'Text (.txt)', value: 'txt' },
          { name: 'JSON (.json)', value: 'json' }
        ]
      }
    ]);

    console.log(`\n🔄 Building tree from section ${sectionId}...`);
    console.log(`   Max depth: ${maxDepth}\n`);

    try {
      const tree = await this.client.buildFileTree(sectionId, maxDepth);

      // Save to file
      const filename = await this.client.saveTreeToFile(tree, format);

      console.log('\n✅ Tree building completed!');
      console.log(`   Root section ID: ${sectionId}`);
      console.log(`   Total sections: ${tree.totalSections}`);
      console.log(`   Total elements: ${tree.totalElements}`);
      console.log(`   Saved to: ${filename}\n`);
    } catch (error) {
      console.error('Error building tree:', error.message);
    }
  }

  /**
   * List all files/sections
   */
  async listFiles() {
    console.log('\n--- File/Section List ---\n');

    try {
      const files = await this.client.getUserFiles();

      if (files.length === 0) {
        console.log('No files found.');
        console.log('\nDebug info:');
        console.log('- Authentication status:', this.client.authenticated ? 'authenticated' : 'not authenticated');
        console.log('- Trying to access file manager page...');

        // Try to get raw response for debugging
        try {
          const debugResponse = await this.client.client.get(
            '/bitrix/admin/iblock_list_admin.php?IBLOCK_ID=6&type=file_manager&lang=ru&find_section_section=5710&SECTION_ID=5710&apply_filter=Y',
            {
              headers: {
                'Cookie': this.client.cookies?.join('; ') || ''
              }
            }
          );
          console.log('- Response status:', debugResponse.status);
          console.log('- Response length:', debugResponse.data.length, 'chars');

          // Check if it's a login page
          if (debugResponse.data.includes('form_auth') || debugResponse.data.includes('USER_LOGIN')) {
            console.log('\n⚠ You may not be logged in. Please check your credentials.');
          } else if (debugResponse.data.includes('Access denied') || debugResponse.data.includes('Доступ запрещен')) {
            console.log('\n⚠ Access denied. You may not have permission to view this section.');
          }
        } catch (e) {
          console.log('- Debug request failed:', e.message);
        }
      } else {
        // Group by type
        const sections = files.filter(f => f.type === 'section');
        const elements = files.filter(f => f.type !== 'section');

        if (sections.length > 0) {
          console.log(`📁 Sections (${sections.length}):\n`);
          sections.forEach((item, index) => {
            console.log(`  ${index + 1}. ${item.name}`);
            console.log(`     ID: ${item.id} | Active: ${item.active ? 'Yes' : 'No'} | Sort: ${item.sort}`);
            if (item.date) console.log(`     Date: ${item.date}`);
            console.log('');
          });
        }

        if (elements.length > 0) {
          console.log(`\n📄 Files/Elements (${elements.length}):\n`);
          elements.forEach((item, index) => {
            console.log(`  ${index + 1}. ${item.name}`);
            console.log(`     Size: ${item.size || 'N/A'}`);
            console.log('');
          });
        }

        console.log(`Total: ${files.length} item(s)`);
      }
    } catch (error) {
      console.error('Error:', error.message);
    }
  }

  /**
   * Test parsing from debug_response.html file
   */
  async testParsing() {
    console.log('\n--- Test Parsing ---\n');

    try {
      const fs = await import('fs');
      const path = await import('path');
      const cheerio = await import('cheerio');

      const debugFile = path.join(process.cwd(), 'debug_response.html');

      if (!fs.existsSync(debugFile)) {
        console.log('⚠ debug_response.html not found');
        console.log('Run "list_files" first to download and save the HTML response.');
        return;
      }

      const html = fs.readFileSync(debugFile, 'utf8');
      console.log(`Loaded debug_response.html (${html.length} chars)\n`);

      // Test the parsing
      const items = this.client.parseFileList(html);

      if (items.length === 0) {
        console.log('No items parsed from the file.');
      } else {
        const sections = items.filter(f => f.type === 'section');
        const elements = items.filter(f => f.type !== 'section');

        console.log(`✓ Successfully parsed ${items.length} item(s)\n`);

        if (sections.length > 0) {
          console.log(`📁 Sections (${sections.length}):`);
          sections.forEach((item, index) => {
            console.log(`  ${index + 1}. ${item.name}`);
            console.log(`     ID: ${item.id} | RowID: ${item.rowId} | Active: ${item.active} | Sort: ${item.sort}`);
            if (item.date) console.log(`     Date: ${item.date}`);
          });
          console.log('');
        }

        if (elements.length > 0) {
          console.log(`📄 Elements/Files (${elements.length}):`);
          elements.forEach((item, index) => {
            console.log(`  ${index + 1}. ${item.name}`);
            console.log(`     ID: ${item.id} | Active: ${item.active}`);
          });
        }
      }
    } catch (error) {
      console.error('Error testing parsing:', error.message);
    }
  }
}

export default CLI;
