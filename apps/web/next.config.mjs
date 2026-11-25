import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The shared packages ship TypeScript source rather than a build step, so Next
  // compiles them itself. Same trick keeps Metro happy on the Expo side.
  transpilePackages: ['@tannin/core', '@tannin/supabase'],
  typedRoutes: true,
  // Old WordPress URLs (ta-nnin.be before 2026-11-25) that Google still lists.
  async redirects() {
    return [
      { source: '/about-us', destination: '/about', permanent: true },
      { source: '/contact', destination: '/visit', permanent: true },
      { source: '/food-menu', destination: '/menu', permanent: true },
      { source: '/wine-menu', destination: '/wine', permanent: true },
      { source: '/jobs', destination: '/', permanent: true },
      { source: '/sample-page', destination: '/', permanent: true },
    ];
  },
};

export default withNextIntl(nextConfig);
