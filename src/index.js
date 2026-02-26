import { CLI } from './cli.js';

/**
 * Main entry point for Bitrix Helper
 */
async function main() {
  const cli = new CLI();

  try {
    await cli.run();
  } catch (error) {
    console.error('Fatal error:', error.message);
    process.exit(1);
  }
}

// Run the application
main();
