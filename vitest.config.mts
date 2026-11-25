import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Hidden folders can hold checkouts of this same repo, so without this
    // every suite is found twice and the count quietly doubles - and a failure
    // in a stale copy reads as a failure here. They are somebody else's working
    // tree; this one should not be running their tests.
    exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**', '.*/**'],
  },
});
