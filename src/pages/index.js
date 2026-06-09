'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/router';
import { Copy, Inbox, KeyRound, LogOut, Mail, RefreshCw, Shuffle } from 'lucide-react';
import { AppShell } from '../components/app-shell';
import { Alert, AlertDescription } from '../components/ui/alert';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Skeleton } from '../components/ui/skeleton';
import { withUser } from '../lib/user-auth';

let turnstileScriptPromise;

function loadTurnstileScript() {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.turnstile) return Promise.resolve();

  if (!turnstileScriptPromise) {
    turnstileScriptPromise = new Promise((resolve, reject) => {
      let script = document.querySelector('script[data-turnstile-script]');

      const handleLoad = () => {
        script?.setAttribute('data-loaded', 'true');
        resolve();
      };
      const handleError = () => reject(new Error('Failed to load Turnstile.'));

      if (!script) {
        script = document.createElement('script');
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        script.async = true;
        script.defer = true;
        script.setAttribute('data-turnstile-script', 'true');
        script.addEventListener('load', handleLoad, { once: true });
        script.addEventListener('error', handleError, { once: true });
        document.head.appendChild(script);
        return;
      }

      if (script.getAttribute('data-loaded') === 'true' || window.turnstile) {
        resolve();
        return;
      }

      script.addEventListener('load', handleLoad, { once: true });
      script.addEventListener('error', handleError, { once: true });
    });
  }

  return turnstileScriptPromise;
}

function TurnstileWidget({ siteKey, resetKey, onVerify, onExpire }) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!siteKey) return undefined;

    let cancelled = false;
    let widgetId = null;

    loadTurnstileScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) return;

        widgetId = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          callback: onVerify,
          'expired-callback': onExpire,
          'error-callback': onExpire,
        });
      })
      .catch(error => {
        console.error(error);
        onExpire();
      });

    return () => {
      cancelled = true;
      if (widgetId && window.turnstile) {
        window.turnstile.remove(widgetId);
      }
    };
  }, [onExpire, onVerify, resetKey, siteKey]);

  return <div ref={containerRef} className="cf-turnstile" />;
}

export const getServerSideProps = withUser(async ({ user }) => {
  try {
    const { getAdminPath, getSiteTitle, getTurnstileConfig, isSetupRequired } = await import('../lib/db');
    if (isSetupRequired()) {
      return {
        redirect: {
          destination: '/setup',
          permanent: false,
        },
      };
    }

    const siteTitle = getSiteTitle() || 'Email Node';
    const turnstile = getTurnstileConfig();
    return {
      props: {
        siteTitle,
        adminPath: getAdminPath(),
        user: user || null,
        turnstileSiteKey: turnstile.siteKey || '',
        turnstileRegistrationEnabled: Boolean(turnstile.registrationEnabled),
        turnstileLoginEnabled: Boolean(turnstile.loginEnabled),
      },
    };
  } catch {
    return {
      props: {
        siteTitle: 'Email Node',
        adminPath: 'admin',
        user: user || null,
        turnstileSiteKey: '',
        turnstileRegistrationEnabled: false,
        turnstileLoginEnabled: false,
      },
    };
  }
});

export default function Home({
  siteTitle,
  adminPath,
  user,
  turnstileSiteKey: initialTurnstileSiteKey,
  turnstileRegistrationEnabled: initialTurnstileRegistrationEnabled,
  turnstileLoginEnabled: initialTurnstileLoginEnabled,
}) {
  const router = useRouter();
  const [started, setStarted] = useState(false);
  const [domains, setDomains] = useState([]);
  const [domainsLoading, setDomainsLoading] = useState(!user);
  const [selectedDomain, setSelectedDomain] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [isLoginView, setIsLoginView] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPasskey, setLoginPasskey] = useState('');
  const [createdMailbox, setCreatedMailbox] = useState(null);
  const [copyFeedback, setCopyFeedback] = useState({});

  const [turnstileSiteKey, setTurnstileSiteKey] = useState(initialTurnstileSiteKey || '');
  const [turnstileRegistrationEnabled, setTurnstileRegistrationEnabled] = useState(
    Boolean(initialTurnstileRegistrationEnabled)
  );
  const [turnstileLoginEnabled, setTurnstileLoginEnabled] = useState(
    Boolean(initialTurnstileLoginEnabled)
  );
  const [registerToken, setRegisterToken] = useState('');
  const [loginToken, setLoginToken] = useState('');
  const handleRegisterVerify = useCallback(token => setRegisterToken(token), []);
  const handleRegisterExpire = useCallback(() => setRegisterToken(''), []);
  const handleLoginVerify = useCallback(token => setLoginToken(token), []);
  const handleLoginExpire = useCallback(() => setLoginToken(''), []);

  const readJsonResponse = async response => {
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      throw new Error(`Expected JSON but received ${contentType || 'an unknown response type'}.`);
    }
    return response.json();
  };

  const getRandomDomainName = domainList => {
    if (!domainList.length) return '';
    const randomIndex = Math.floor(Math.random() * domainList.length);
    return domainList[randomIndex].name;
  };

  const clearErrorOnEdit = () => {
    if (error) setError('');
  };

  const updateEmailInput = value => {
    clearErrorOnEdit();
    setEmailInput(value);
  };

  const updateSelectedDomain = value => {
    clearErrorOnEdit();
    setSelectedDomain(value);
  };

  const updateLoginEmail = value => {
    clearErrorOnEdit();
    setLoginEmail(value);
  };

  const updateLoginPasskey = value => {
    clearErrorOnEdit();
    setLoginPasskey(value);
  };

  useEffect(() => {
    setTurnstileSiteKey(initialTurnstileSiteKey || '');
    setTurnstileRegistrationEnabled(Boolean(initialTurnstileRegistrationEnabled));
    setTurnstileLoginEnabled(Boolean(initialTurnstileLoginEnabled));
  }, [initialTurnstileSiteKey, initialTurnstileRegistrationEnabled, initialTurnstileLoginEnabled]);

  useEffect(() => {
    setRegisterToken('');
    setLoginToken('');
  }, [isLoginView]);

  useEffect(() => {
    if (user) {
      setDomainsLoading(false);
      return;
    }
    setDomainsLoading(true);
    fetch('/api/domains')
      .then(readJsonResponse)
      .then(data => {
        if (Array.isArray(data)) {
          setDomains(data);
          if (data.length > 0) {
            setSelectedDomain(getRandomDomainName(data));
          }
        }
      })
      .catch(error => {
        console.error('Error fetching domains:', error);
        setDomains([]);
      })
      .finally(() => setDomainsLoading(false));
  }, [user]);


  const generateRandomPrefix = () => {
    const adjectives = [
      'happy', 'sunny', 'bright', 'swift', 'quick', 'clever', 'smart', 'wise',
      'brave', 'bold', 'calm', 'cool', 'warm', 'kind', 'gentle', 'sweet',
      'smooth', 'sharp', 'clear', 'pure', 'fresh', 'crisp', 'light', 'dark',
      'silver', 'golden', 'crystal', 'cosmic', 'magic', 'mystic', 'royal', 'noble',
      'lucky', 'grand', 'epic', 'mighty', 'super', 'mega', 'ultra', 'hyper',
      'wild', 'free', 'true', 'real', 'rad', 'ace', 'top', 'prime',
      'zen', 'chill', 'sleek', 'slick', 'snappy', 'zippy', 'bouncy', 'fuzzy',
      'cozy', 'jolly', 'merry', 'perky', 'spry', 'vivid', 'zesty', 'peppy'
    ];

    const nouns = [
      'fox', 'wolf', 'bear', 'lion', 'tiger', 'eagle', 'hawk', 'raven',
      'dragon', 'phoenix', 'falcon', 'panda', 'koala', 'otter', 'lynx', 'cobra',
      'star', 'moon', 'sun', 'sky', 'cloud', 'rain', 'storm', 'wind',
      'ocean', 'wave', 'river', 'lake', 'forest', 'mountain', 'valley', 'peak',
      'flame', 'spark', 'ember', 'blaze', 'frost', 'snow', 'ice', 'mist',
      'thunder', 'bolt', 'flash', 'beam', 'ray', 'glow', 'shine', 'gleam',
      'ninja', 'ranger', 'knight', 'wizard', 'sage', 'scout', 'pilot', 'rider',
      'quest', 'dream', 'hope', 'wish', 'vibe', 'pulse', 'flow', 'rhythm'
    ];

    const randomAdj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const randomNoun = nouns[Math.floor(Math.random() * nouns.length)];
    const randomNumber = Math.floor(Math.random() * 9000) + 1000; // 4-digit number (1000-9999)

    return `${randomAdj}${randomNoun}${randomNumber}`;
  };

  const handleRandomClick = () => {
    updateEmailInput(generateRandomPrefix());
  };


  const handleSubmit = async () => {
    if (!emailInput || !selectedDomain) {
      setError('Please enter an email address');
      return;
    }

    if (turnstileRegistrationEnabled && turnstileSiteKey && !registerToken) {
      setError('Please complete the Turnstile challenge.');
      return;
    }

    
    setIsLoading(true);
    setError('');

    try {
      const payload = {
        userEmail: emailInput,
        emailType: 'username',
        domainName: selectedDomain,
      };

      if (turnstileRegistrationEnabled && turnstileSiteKey) {
        payload.turnstileToken = registerToken;
      }

      const res = await fetch('/api/users/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await readJsonResponse(res);

      if (data.success) {
        setCreatedMailbox({
          email: data.email.email,
          passkey: data.passkey,
        });
        setStarted(true);
        setEmailInput('');
      } else {
        setError(data.error || 'Failed to create account');
      }
    } catch (err) {
      console.error('Account creation error:', err);
      setError('Failed to create account. Please try again.');
    } finally {
      setRegisterToken('');
      setIsLoading(false);
    }
  };

  const copyCreatedValue = async (type, value) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopyFeedback(prev => ({ ...prev, [type]: true }));
      setTimeout(() => {
        setCopyFeedback(prev => {
          const next = { ...prev };
          delete next[type];
          return next;
        });
      }, 2000);
    } catch (error) {
      console.error(`Failed to copy ${type}:`, error);
      setError('Copy failed. Please copy it manually.');
    }
  };

  const handleLogin = async () => {
    if (!loginEmail || !loginPasskey) {
      setError('Please enter both email and passkey.');
      return;
    }
    if (turnstileLoginEnabled && turnstileSiteKey && !loginToken) {
      setError('Please complete the Turnstile challenge.');
      return;
    }
    setIsLoading(true);
    setError('');
    try {
      const payload = { email: loginEmail, passkey: loginPasskey };
      if (turnstileLoginEnabled && turnstileSiteKey) {
        payload.turnstileToken = loginToken;
      }
      const res = await fetch('/api/users/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await readJsonResponse(res);
      if (data.success) {
        router.push('/inbox');
      } else {
        setError(data.error || 'Login failed.');
      }
    } catch (err) {
      console.error('Login error:', err);
      setError('An error occurred during login.');
    } finally {
      setLoginToken('');
      setIsLoading(false);
    }
  };

  const handleLogout = async () => {
    setIsLoading(true);
    setError('');
    try {
      await fetch('/api/users/logout', {
        method: 'POST',
        credentials: 'include',
      });
      router.reload();
    } catch (err) {
      console.error('Logout error:', err);
      setError('Failed to sign out. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const fullEmailPreview = emailInput && selectedDomain
    ? `${emailInput}@${selectedDomain}`
    : 'your-email@example.com';
  const primaryDomain = selectedDomain || domains[0]?.name || 'your-domain.com';
  if (user) {
    return (
      <AppShell siteTitle={siteTitle} user={user} adminPath={adminPath}>
        <section className="mx-auto flex min-h-[calc(100vh-14rem)] w-full max-w-xl items-center py-8">
          <Card className="w-full shadow-sm">
            <CardHeader className="space-y-2">
              <CardTitle className="flex items-center gap-2 text-xl">
                <Inbox className="h-5 w-5 text-primary" />
                Mailbox
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                You are signed in. Open your inbox to read incoming mail.
              </p>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 sm:flex-row">
              <Button onClick={() => router.push('/inbox')} disabled={isLoading}>
                <Inbox className="h-4 w-4" />
                Open inbox
              </Button>
              <Button variant="destructive" onClick={handleLogout} disabled={isLoading}>
                <LogOut className="h-4 w-4" />
                Sign out
              </Button>
            </CardContent>
          </Card>
        </section>
      </AppShell>
    );
  }

  return (
    <AppShell siteTitle={siteTitle} user={user} adminPath={adminPath}>
      <section className="mx-auto flex min-h-[calc(100vh-14rem)] w-full max-w-2xl items-center py-8">
        <Card className="w-full shadow-sm">
          <CardHeader className="space-y-4 pb-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-xl">
                  {isLoginView ? (
                    <KeyRound className="h-5 w-5 text-primary" />
                  ) : (
                    <Mail className="h-5 w-5 text-primary" />
                  )}
                  {isLoginView ? 'Open mailbox' : 'Create mailbox'}
                </CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  {isLoginView ? 'Sign in with an existing address and passkey.' : `Use any available local part on @${primaryDomain}.`}
                </p>
              </div>
              <Button
                variant="outline"
                onClick={() => {
                  setError('');
                  setCreatedMailbox(null);
                  setStarted(false);
                  setIsLoginView(value => !value);
                }}
              >
                {isLoginView ? (
                  <>
                    <Mail className="h-4 w-4" />
                    Create instead
                  </>
                ) : (
                  <>
                    <KeyRound className="h-4 w-4" />
                    Login instead
                  </>
                )}
              </Button>
            </div>
          </CardHeader>

          <CardContent className="space-y-5">
            <div className="space-y-3 rounded-md border bg-muted/30 p-4">
              <div>
                <h2 className="text-sm font-semibold">Persistent email for signups and testing</h2>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  Create an address on this service, keep the generated passkey, and return here later to read incoming mail.
                </p>
              </div>
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Active domains</p>
                {domainsLoading ? (
                  <div className="flex flex-wrap gap-2">
                    <Skeleton className="h-6 w-24" />
                    <Skeleton className="h-6 w-28" />
                  </div>
                ) : domains.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {domains.map(domain => (
                      <Badge key={domain.id} variant={domain.name === selectedDomain ? 'default' : 'secondary'} className="font-mono">
                        @{domain.name}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No domains are currently available.</p>
                )}
              </div>
            </div>

            {isLoginView ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-muted-foreground" htmlFor="login-email">
                    Email Address
                  </Label>
                  <Input
                    id="login-email"
                    type="email"
                    value={loginEmail}
                    onChange={event => updateLoginEmail(event.target.value)}
                    placeholder="you@example.com"
                    disabled={isLoading}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-muted-foreground" htmlFor="login-passkey">
                    Passkey
                  </Label>
                  <Input
                    id="login-passkey"
                    type="password"
                    value={loginPasskey}
                    onChange={event => updateLoginPasskey(event.target.value)}
                    placeholder="Your passkey"
                    disabled={isLoading}
                  />
                </div>
                {turnstileLoginEnabled && turnstileSiteKey && (
                  <div className="flex min-h-[90px] justify-center rounded-md border bg-muted/30 p-3">
                    <TurnstileWidget
                      key="login-turnstile"
                      siteKey={turnstileSiteKey}
                      resetKey="login"
                      onVerify={handleLoginVerify}
                      onExpire={handleLoginExpire}
                    />
                  </div>
                )}
                {error && (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
                <Button
                  onClick={handleLogin}
                  disabled={
                    !loginEmail ||
                    !loginPasskey ||
                    isLoading ||
                    (turnstileLoginEnabled && turnstileSiteKey && !loginToken)
                  }
                  className="w-full"
                  size="lg"
                >
                  {isLoading ? (
                    <div className="flex items-center justify-center">
                      <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                      Logging in...
                    </div>
                  ) : (
                    'Login'
                  )}
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                {createdMailbox && (
                  <Alert>
                    <AlertDescription className="space-y-3">
                      <div>
                        <p className="font-medium">Mailbox created: {createdMailbox.email}</p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Copy this passkey now. It will not be shown again after you leave this page.
                        </p>
                      </div>
                      <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-3">
                        <span className="min-w-0 flex-1 break-all font-mono text-sm">
                          {createdMailbox.email}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => copyCreatedValue('email', createdMailbox.email)}
                        >
                          {copyFeedback.email ? <span className="text-xs font-semibold">Copied</span> : <Copy className="h-4 w-4" />}
                        </Button>
                      </div>
                      <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-3">
                        <span className="min-w-0 flex-1 break-all font-mono text-sm">
                          {createdMailbox.passkey}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => copyCreatedValue('passkey', createdMailbox.passkey)}
                        >
                          {copyFeedback.passkey ? <span className="text-xs font-semibold">Copied</span> : <Copy className="h-4 w-4" />}
                        </Button>
                      </div>
                      <Button type="button" onClick={() => router.push('/inbox')} className="w-full">
                        <Inbox className="h-4 w-4" />
                        Open inbox
                      </Button>
                    </AlertDescription>
                  </Alert>
                )}
                {domainsLoading ? (
                  <div className="space-y-3">
                    <Skeleton className="h-4 w-28" />
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Skeleton className="h-10 flex-1" />
                      <Skeleton className="h-10 w-full sm:w-[180px]" />
                      <Skeleton className="h-10 w-full sm:w-[104px]" />
                    </div>
                    <Skeleton className="h-6 w-72 max-w-full" />
                  </div>
                ) : domains.length === 0 ? (
                  <Alert variant="destructive">
                    <AlertDescription>
                      No active domains available. Please contact the administrator.
                    </AlertDescription>
                  </Alert>
                ) : (
                  <div className="space-y-2">
                    <Label className="text-muted-foreground" htmlFor="email-prefix">
                      Email Address
                    </Label>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <div className="flex min-w-0 flex-1 flex-col sm:flex-row">
                        <Input
                          id="email-prefix"
                          type="text"
                          value={emailInput}
                          onChange={event => updateEmailInput(event.target.value)}
                          placeholder="your-email"
                          disabled={isLoading || started}
                          className="rounded-b-none sm:rounded-b-md sm:rounded-r-none"
                        />
                        <Select
                          value={selectedDomain}
                          onValueChange={updateSelectedDomain}
                          disabled={isLoading || started}
                        >
                          <SelectTrigger
                            className="rounded-t-none border-t-0 sm:w-[180px] sm:rounded-l-none sm:rounded-t-md sm:border-l-0 sm:border-t"
                            aria-label="Email domain"
                          >
                            <SelectValue placeholder="@domain" />
                          </SelectTrigger>
                          <SelectContent>
                            {domains.map(domain => (
                              <SelectItem key={domain.id} value={domain.name}>
                                @{domain.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <Button
                        type="button"
                        onClick={handleRandomClick}
                        disabled={isLoading || started}
                        variant="outline"
                        className="w-full sm:w-auto"
                      >
                        <Shuffle className="h-4 w-4" />
                        Random
                      </Button>
                    </div>
                    <p className="break-all text-sm text-muted-foreground">
                      Full email:{' '}
                      <span className="rounded-md bg-muted px-2 py-1 font-mono text-foreground">
                        {fullEmailPreview}
                      </span>
                    </p>
                  </div>
                )}
                {turnstileRegistrationEnabled && turnstileSiteKey && (
                  <div className="flex min-h-[90px] justify-center rounded-md border bg-muted/30 p-3">
                    <TurnstileWidget
                      key="register-turnstile"
                      siteKey={turnstileSiteKey}
                      resetKey="register"
                      onVerify={handleRegisterVerify}
                      onExpire={handleRegisterExpire}
                    />
                  </div>
                )}
                {error && (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
                <Button
                  onClick={handleSubmit}
                  disabled={
                    started ||
                    (!emailInput || !selectedDomain || domains.length === 0) ||
                    domainsLoading ||
                    isLoading ||
                    (turnstileRegistrationEnabled && turnstileSiteKey && !registerToken)
                  }
                  className="w-full"
                  size="lg"
                >
                  {isLoading ? (
                    <div className="flex items-center justify-center">
                      <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                      Creating...
                    </div>
                  ) : (
                    'Create address'
                  )}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </AppShell>
  );
}
