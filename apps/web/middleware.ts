import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

export default createMiddleware(routing);

export const config = {
  // Everything except the API, Next's own assets and anything with a file
  // extension - /brand/logo.png must not be rewritten to /en/brand/logo.png.
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
