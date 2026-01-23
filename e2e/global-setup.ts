import { FullConfig } from '@playwright/test';
import { execSync } from 'child_process';

const globalSetup = async (config: FullConfig): Promise<void> => {
  // Set test environment variables
  process.env.TZ = 'Europe/Berlin';
  process.env.NODE_ENV = 'test';
  console.log(`Running tests with ${config.workers} workers`);

  // Build plugins before starting tests
  console.log('Building bundled plugins...');
  try {
    execSync('npm run plugins:build', {
      stdio: 'inherit',
      cwd: process.cwd(),
    });
    console.log('Bundled plugins built successfully');
  } catch (error) {
    console.error('Failed to build plugins:', error);
    throw error; // Fail fast if plugin build fails
  }
};

export default globalSetup;
