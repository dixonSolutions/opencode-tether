import { defineConfig } from '@playwright/test';

// Logic tests that need no browser and no dev server: `npm run test:unit`.
export default defineConfig({
  testDir: './src/lib',
  testMatch: '**/*.unit.ts',
  reporter: 'list'
});
