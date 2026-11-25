import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The shared packages ship TypeScript source rather than a build step, so Next
  // compiles them itself. Same trick keeps Metro happy on the Expo side.
  transpilePackages: ['@tannin/core', '@tannin/supabase'],
  typedRoutes: true,
};

export default withNextIntl(nextConfig);
