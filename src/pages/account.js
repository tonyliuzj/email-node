'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { Copy, EyeOff, Inbox, LogOut, RefreshCw, ShieldCheck, User } from 'lucide-react';
import { AppShell } from '../components/app-shell';
import { Alert, AlertDescription } from '../components/ui/alert';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Label } from '../components/ui/label';
import { Skeleton } from '../components/ui/skeleton';
import { withUser } from '../lib/user-auth';

export const getServerSideProps = withUser(async ({ user }) => {
  try {
    const { getAdminPath, getSiteTitle } = await import('../lib/db');
    return {
      props: {
        siteTitle: getSiteTitle() || 'Email Node',
        adminPath: getAdminPath(),
        user: user || null,
      },
    };
  } catch {
    return {
      props: {
        siteTitle: 'Email Node',
        adminPath: 'admin',
        user: user || null,
      },
    };
  }
});

function AccountSkeleton({ siteTitle, adminPath, user }) {
  return (
    <AppShell siteTitle={siteTitle} user={user} adminPath={adminPath}>
      <section className="space-y-6 py-6">
        <div className="flex flex-col gap-3 border-b pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-4 w-72 max-w-full" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-9 w-24" />
            <Skeleton className="h-9 w-24" />
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <Card>
            <CardHeader>
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-28" />
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-12 w-full" />
              </div>
              <div className="space-y-2">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-12 w-full" />
              </div>
              <Skeleton className="h-9 w-44" />
            </CardContent>
          </Card>

          <Card className="h-fit">
            <CardHeader>
              <Skeleton className="h-6 w-28" />
            </CardHeader>
            <CardContent className="space-y-3">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-9 w-full" />
            </CardContent>
          </Card>
        </div>
      </section>
    </AppShell>
  );
}

export default function Account({ siteTitle, adminPath, user }) {
  const router = useRouter();
  const [userEmails, setUserEmails] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [regeneratingId, setRegeneratingId] = useState(null);
  const [newlyGeneratedPasskeys, setNewlyGeneratedPasskeys] = useState(new Set());
  const [copyFeedback, setCopyFeedback] = useState({});

  useEffect(() => {
    const fetchAccount = async () => {
      try {
        const response = await fetch('/api/account/info');
        if (!response.ok) {
          router.push('/');
          return;
        }

        const data = await response.json();
        setUserEmails(data.emails || []);
      } catch (err) {
        console.error('Error fetching account:', err);
        router.push('/');
      } finally {
        setLoading(false);
      }
    };

    fetchAccount();
  }, [router]);

  const formatDate = dateString => new Date(dateString).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  const copyToClipboard = async (text, emailId, type = 'text') => {
    try {
      await navigator.clipboard.writeText(text);
      const key = `${emailId}-${type}`;
      setCopyFeedback(prev => ({ ...prev, [key]: true }));
      setTimeout(() => {
        setCopyFeedback(prev => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
      }, 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const handleMaskPasskey = emailId => {
    setUserEmails(prevEmails =>
      prevEmails.map(email =>
        email.id === emailId ? { ...email, passkey: null } : email
      )
    );
    setNewlyGeneratedPasskeys(prev => {
      const next = new Set(prev);
      next.delete(emailId);
      return next;
    });
    setSuccess('Passkey has been masked.');
  };

  const handleRegeneratePasskey = async emailId => {
    setRegeneratingId(emailId);
    setError('');
    setSuccess('');

    try {
      const response = await fetch('/api/account/regenerate-passkey', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailId }),
        credentials: 'include',
      });
      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Failed to regenerate passkey.');
        return;
      }

      setUserEmails(prevEmails =>
        prevEmails.map(email =>
          email.id === emailId ? { ...email, passkey: data.newPasskey } : email
        )
      );
      setNewlyGeneratedPasskeys(prev => new Set([...prev, emailId]));
      setSuccess('Passkey regenerated. Copy it before masking.');
    } catch (err) {
      console.error('Passkey regeneration error:', err);
      setError('Failed to regenerate passkey. Please try again.');
    } finally {
      setRegeneratingId(null);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/users/logout', { method: 'POST', credentials: 'include' });
      router.push('/');
    } catch (err) {
      console.error('Logout error:', err);
    }
  };

  if (loading) {
    return <AccountSkeleton siteTitle={siteTitle} user={user} adminPath={adminPath} />;
  }

  return (
    <AppShell siteTitle={siteTitle} user={user} adminPath={adminPath}>
      <section className="space-y-6 py-6">
        <div className="flex flex-col gap-3 border-b pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">Account</h1>
            <p className="text-sm text-muted-foreground">
              Manage mailbox credentials and the current session.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => router.push('/inbox')}>
              <Inbox className="h-4 w-4" />
              Inbox
            </Button>
            <Button variant="destructive" onClick={handleLogout}>
              <LogOut className="h-4 w-4" />
              Sign out
            </Button>
          </div>
        </div>

        {(success || error) && (
          <Alert variant={error ? 'destructive' : 'default'}>
            <AlertDescription>{error || success}</AlertDescription>
          </Alert>
        )}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-4">
            {userEmails.map(email => (
              <Card key={email.id}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <User className="h-5 w-5 text-primary" />
                    Mailbox credentials
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">Created {formatDate(email.created_at)}</p>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="space-y-2">
                    <Label className="text-muted-foreground">Email address</Label>
                    <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-3">
                      <span className="min-w-0 flex-1 truncate font-mono text-sm">{email.email_address}</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => copyToClipboard(email.email_address, email.id, 'email')}
                      >
                        {copyFeedback[`${email.id}-email`] ? <span className="text-xs font-semibold">Copied</span> : <Copy className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-muted-foreground">Passkey</Label>
                    <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-3">
                      <span className="min-w-0 flex-1 break-all font-mono text-sm">
                        {email.passkey ? (
                          <span className={newlyGeneratedPasskeys.has(email.id) ? 'font-semibold text-emerald-600 dark:text-emerald-400' : ''}>
                            {email.passkey}
                          </span>
                        ) : (
                          <span className="tracking-widest text-muted-foreground">••••••••••••</span>
                        )}
                      </span>
                      {email.passkey && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => copyToClipboard(email.passkey, email.id, 'passkey')}
                        >
                          {copyFeedback[`${email.id}-passkey`] ? <span className="text-xs font-semibold">Copied</span> : <Copy className="h-4 w-4" />}
                        </Button>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row">
                    {email.passkey ? (
                      <Button variant="outline" onClick={() => handleMaskPasskey(email.id)}>
                        <EyeOff className="h-4 w-4" />
                        Mask passkey
                      </Button>
                    ) : (
                      <Button
                        variant="secondary"
                        onClick={() => handleRegeneratePasskey(email.id)}
                        disabled={regeneratingId === email.id}
                      >
                        <RefreshCw className={`h-4 w-4 ${regeneratingId === email.id ? 'animate-spin' : ''}`} />
                        {regeneratingId === email.id ? 'Regenerating...' : 'Regenerate passkey'}
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card className="h-fit">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <ShieldCheck className="h-5 w-5 text-primary" />
                Session
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="rounded-md border p-3">
                <p className="text-muted-foreground">Mailboxes</p>
                <p className="font-medium">{userEmails.length}</p>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-muted-foreground">Authentication</p>
                <p className="font-medium">Passkey</p>
              </div>
              <Button variant="destructive" className="w-full" onClick={handleLogout}>
                <LogOut className="h-4 w-4" />
                Sign out
              </Button>
            </CardContent>
          </Card>
        </div>
      </section>
    </AppShell>
  );
}
