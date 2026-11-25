import { Link } from '@/i18n/navigation';

/**
 * The header logo: always the home page.
 */
export function HomeLink({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link href="/" className={className}>
      {children}
    </Link>
  );
}
