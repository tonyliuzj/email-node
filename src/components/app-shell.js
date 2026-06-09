import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Home, Inbox, Mail, Menu, Moon, Settings, Sun, User, X } from 'lucide-react';
import { Button } from './ui/button';
import { cn } from '../lib/utils';

export function AppShell({
  children,
  siteTitle = 'Email Node',
  user,
  adminUser,
  adminPath = 'admin',
  fullWidth = false,
  hideFooter = false,
  mainClassName,
}) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setDarkMode(document.documentElement.classList.contains('dark'));
  }, []);

  const toggleDarkMode = () => {
    const nextMode = !darkMode;
    setDarkMode(nextMode);
    document.documentElement.classList.toggle('dark', nextMode);
  };

  const navItems = [
    { href: '/', label: 'Home', icon: Home },
    ...(user ? [
      { href: '/inbox', label: 'Inbox', icon: Inbox },
      { href: '/account', label: 'Account', icon: User },
    ] : []),
    { href: adminUser ? `/${adminPath}` : `/${adminPath}/login`, label: 'Admin', icon: Settings },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground shadow-sm">
              <Mail className="h-4 w-4" />
            </span>
            <span className="truncate text-lg font-semibold tracking-tight">{siteTitle}</span>
          </Link>

          <nav className="hidden items-center gap-1 md:flex">
            {navItems.map(item => {
              const Icon = item.icon;
              return (
                <Button key={item.href} variant="ghost" size="sm" asChild>
                  <Link href={item.href}>
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                </Button>
              );
            })}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={toggleDarkMode}
              aria-label="Toggle theme"
              aria-pressed={darkMode}
            >
              {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
          </nav>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setIsMenuOpen(open => !open)}
            aria-label="Toggle navigation menu"
            aria-expanded={isMenuOpen}
          >
            {isMenuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </Button>
        </div>

        {isMenuOpen && (
          <div className="border-t md:hidden">
            <nav className="mx-auto grid max-w-7xl gap-1 px-4 py-3 sm:px-6">
              {navItems.map(item => {
                const Icon = item.icon;
                return (
                  <Button key={item.href} variant="ghost" className="justify-start" asChild>
                    <Link href={item.href} onClick={() => setIsMenuOpen(false)}>
                      <Icon className="h-4 w-4" />
                      {item.label}
                    </Link>
                  </Button>
                );
              })}
              <Button
                type="button"
                variant="ghost"
                className="justify-start"
                onClick={() => {
                  toggleDarkMode();
                  setIsMenuOpen(false);
                }}
                aria-label="Toggle theme"
                aria-pressed={darkMode}
              >
                {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                {darkMode ? 'Light Mode' : 'Dark Mode'}
              </Button>
            </nav>
          </div>
        )}
      </header>

      <main
        className={cn(
          'mx-auto flex w-full flex-1 flex-col px-4 py-8 sm:px-6 lg:px-8',
          fullWidth ? 'max-w-none' : 'max-w-7xl',
          mainClassName
        )}
      >
        {children}
      </main>

      {!hideFooter && (
        <footer className="border-t bg-background">
          <div className="mx-auto flex max-w-7xl justify-center px-4 py-6 text-xs text-muted-foreground sm:px-6 lg:px-8">
            <Button variant="link" size="sm" className="h-auto p-0 text-muted-foreground" asChild>
              <Link href="https://github.com/tonyliuzj/email-node" target="_blank" rel="noopener noreferrer">
                Powered by Email Node
              </Link>
            </Button>
          </div>
        </footer>
      )}
    </div>
  );
}
