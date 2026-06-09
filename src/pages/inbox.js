'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/router';
import { RefreshCw, Inbox as InboxIcon, ArrowLeft, User, Calendar, Clock, MailOpen } from 'lucide-react';
import { AppShell } from '../components/app-shell';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Separator } from '../components/ui/separator';
import { Skeleton } from '../components/ui/skeleton';
import { withUser } from '../lib/user-auth';
import { cn } from '../lib/utils';

export const getServerSideProps = withUser(async ({ user }) => {
  try {
    const { getAdminPath, getInboxRefreshSeconds, getSiteTitle } = await import('../lib/db');
    return {
      props: {
        siteTitle: getSiteTitle() || 'Email Node',
        adminPath: getAdminPath(),
        inboxRefreshSeconds: getInboxRefreshSeconds(),
        user: user || null,
      }
    };
  } catch {
    return {
      props: {
        siteTitle: 'Email Node',
        adminPath: 'admin',
        inboxRefreshSeconds: 10,
        user: user || null,
      }
    };
  }
});

function InboxSkeleton({ siteTitle, adminPath, user }) {
  return (
    <AppShell siteTitle={siteTitle} user={user} adminPath={adminPath} fullWidth mainClassName="p-0 sm:p-0 lg:p-0">
      <section className="flex h-[calc(100vh-8rem)] min-h-[560px] flex-col overflow-hidden bg-muted/20">
        <Card className="m-3 min-h-0 flex-1 overflow-hidden rounded-lg border shadow-sm sm:m-4">
          <div className="grid h-full min-h-0 lg:grid-cols-[minmax(320px,420px)_minmax(0,1fr)]">
            <div className="min-h-0 flex-col border-r bg-background lg:flex">
              <div className="border-b px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-2">
                    <Skeleton className="h-6 w-28" />
                    <Skeleton className="h-4 w-48" />
                  </div>
                  <Skeleton className="h-9 w-24" />
                </div>
              </div>
              <div className="divide-y">
                {[0, 1, 2, 3, 4, 5].map(index => (
                  <div key={index} className="flex gap-3 px-4 py-3">
                    <Skeleton className="h-9 w-9 shrink-0" />
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex justify-between gap-3">
                        <Skeleton className="h-4 w-32" />
                        <Skeleton className="h-3 w-12" />
                      </div>
                      <Skeleton className="h-4 w-56 max-w-full" />
                      <Skeleton className="h-3 w-full" />
                      <Skeleton className="h-3 w-3/4" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="hidden min-h-0 flex-col bg-background p-6 lg:flex">
              <div className="space-y-4 border-b pb-6">
                <Skeleton className="h-6 w-20" />
                <Skeleton className="h-8 w-2/3" />
                <div className="flex gap-4">
                  <Skeleton className="h-4 w-36" />
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-20" />
                </div>
              </div>
              <div className="space-y-3 pt-6">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-11/12" />
                <Skeleton className="h-4 w-4/5" />
                <Skeleton className="h-4 w-5/6" />
              </div>
            </div>
          </div>
        </Card>
      </section>
    </AppShell>
  );
}

export default function Inbox({ siteTitle, adminPath, user, inboxRefreshSeconds = 10 }) {
  const router = useRouter();
  const refreshSeconds = Math.max(5, Number.parseInt(inboxRefreshSeconds, 10) || 10);
  const [inbox, setInbox] = useState([]);
  const [selectedEmail, setSelectedEmail] = useState(null);
  const [countdown, setCountdown] = useState(refreshSeconds);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const seenUids = useRef(new Set());
  const isFetchingRef = useRef(false);
  const [userEmails, setUserEmails] = useState([])
  const [loading, setLoading] = useState(true)
  const [syncError, setSyncError] = useState('')

  useEffect(() => {
    
    const fetchUserEmails = async () => {
      try {
        const response = await fetch('/api/account/info')
        if (response.ok) {
          const data = await response.json()
          setUserEmails(data.emails || [])
        } else {
          
          router.push('/')
        }
      } catch (error) {
        console.error('Error fetching user emails:', error)
        router.push('/')
      } finally {
        setLoading(false)
      }
    }

    fetchUserEmails()
  }, [router])

  const fetchEmails = useCallback(async () => {
    if (userEmails.length === 0) return;
    if (isFetchingRef.current) return;
    
    const primaryEmail = userEmails[0];
    if (!primaryEmail) return;

    isFetchingRef.current = true;

    try {
      setIsRefreshing(true);
      setSyncError('');
      const res = await fetch('/api/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: primaryEmail.email_address }),
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Mailbox sync failed.');
      }
      if (data.warning) {
        setSyncError(data.warning);
      }
      const { emails } = data;
      const newOnes = emails?.filter(m => {
        if (seenUids.current.has(m.uid)) return false;
        seenUids.current.add(m.uid);
        return true;
      }) || [];
      if (newOnes.length) setInbox(prev => [...newOnes, ...prev]);
    } catch (err) {
      console.error(err);
      setSyncError(err.message || 'Mailbox sync failed.');
    } finally {
      isFetchingRef.current = false;
      setIsRefreshing(false);
      setCountdown(refreshSeconds);
    }
  }, [refreshSeconds, userEmails]);

  useEffect(() => {
    let timer;
    if (userEmails.length > 0) {
      fetchEmails();
      setCountdown(refreshSeconds);
      timer = setInterval(() => {
        setCountdown(c => {
          if (c <= 1) {
            fetchEmails();
            return refreshSeconds;
          }
          return c - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [refreshSeconds, userEmails, fetchEmails]);

  const getSnippet = text => {
    const first = (text || '').split('\n')[0];
    return first.length > 90 ? `${first.slice(0, 90)}...` : first;
  };

  const getSenderInitial = sender => {
    const normalizedSender = sender || '?';
    return normalizedSender.replace(/^["']/, '').charAt(0).toUpperCase() || '?';
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  if (loading) {
    return <InboxSkeleton siteTitle={siteTitle} user={user} adminPath={adminPath} />;
  }

  return (
    <AppShell siteTitle={siteTitle} user={user} adminPath={adminPath} fullWidth mainClassName="p-0 sm:p-0 lg:p-0">
      <section className="flex h-[calc(100vh-8rem)] min-h-[560px] flex-col overflow-hidden bg-muted/20">
        <Card className="m-3 min-h-0 flex-1 overflow-hidden rounded-lg border shadow-sm sm:m-4">
          <div className="grid h-full min-h-0 lg:grid-cols-[minmax(320px,420px)_minmax(0,1fr)]">
            <div className={cn(
              'min-h-0 flex-col border-r bg-background',
              selectedEmail ? 'hidden lg:flex' : 'flex'
            )}>
              <div className="border-b px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h1 className="font-semibold">Inbox</h1>
                      <Badge variant="outline" className="gap-1.5 font-normal">
                        <span className={cn('h-2 w-2 rounded-full', isRefreshing ? 'animate-pulse bg-primary' : 'bg-emerald-500')} />
                        {isRefreshing ? 'Syncing' : 'Live'}
                      </Badge>
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {userEmails[0]?.email_address || 'Live mailbox'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {inbox.length} message{inbox.length !== 1 ? 's' : ''} - refresh in {countdown}s
                    </p>
                    {syncError && (
                      <p className="mt-1 text-xs text-destructive">
                        {syncError}
                      </p>
                    )}
                  </div>
                  <Button variant="outline" size="sm" onClick={fetchEmails} disabled={isRefreshing}>
                    <RefreshCw className={cn('h-4 w-4', isRefreshing && 'animate-spin')} />
                    Refresh
                  </Button>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto">
                {inbox.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center px-8 py-12 text-center">
                    <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-md border bg-muted">
                      <InboxIcon className="h-7 w-7 text-muted-foreground" />
                    </div>
                    <h3 className="font-semibold">No messages yet</h3>
                    <p className="mt-1 max-w-xs text-sm text-muted-foreground">
                      New mail will arrive here automatically while this page stays open.
                    </p>
                  </div>
                ) : (
                  <div className="divide-y">
                    {inbox.map(email => (
                      <button
                        key={email.uid}
                        type="button"
                        onClick={() => setSelectedEmail(email)}
                        className={cn(
                          'flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                          selectedEmail?.uid === email.uid && 'bg-accent'
                        )}
                      >
                        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md border bg-muted text-sm font-semibold text-muted-foreground">
                          {getSenderInitial(email.from)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center justify-between gap-3">
                            <span className="truncate text-sm font-medium">{email.from}</span>
                            <span className="shrink-0 text-xs text-muted-foreground">{formatDate(email.date)}</span>
                          </span>
                          <span className="mt-1 block truncate text-sm font-medium text-foreground/85">
                            {email.subject || '(No Subject)'}
                          </span>
                          <span className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                            {getSnippet(email.text)}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className={cn(
              'min-h-0 flex-col bg-background',
              selectedEmail ? 'flex' : 'hidden lg:flex'
            )}>
              {selectedEmail ? (
                <>
                  <div className="border-b bg-muted/30 px-4 py-4 sm:px-6">
                    <div className="mb-4 flex items-center justify-between gap-3">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedEmail(null)}
                      className="lg:hidden"
                    >
                      <ArrowLeft className="h-4 w-4" />
                      Messages
                    </Button>
                      <Badge variant="secondary" className="ml-auto">
                        Received
                      </Badge>
                  </div>
                    <h2 className="break-words text-xl font-semibold tracking-tight sm:text-2xl">
                    {selectedEmail.subject || '(No Subject)'}
                  </h2>
                    <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
                      <div className="flex min-w-0 items-center gap-2">
                        <User className="h-4 w-4 shrink-0" />
                        <span className="truncate font-medium text-foreground">{selectedEmail.from}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 shrink-0" />
                      <span>{new Date(selectedEmail.date).toLocaleDateString()}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4 shrink-0" />
                      <span>{new Date(selectedEmail.date).toLocaleTimeString()}</span>
                    </div>
                  </div>
                </div>
                  <div className="min-h-0 flex-1 overflow-y-auto bg-background px-4 py-6 sm:px-8">
                    <div className="mx-auto max-w-4xl">
                    {selectedEmail.html ? (
                      <iframe
                        title={selectedEmail.subject || 'Email message'}
                        sandbox="allow-popups allow-popups-to-escape-sandbox"
                        srcDoc={selectedEmail.html}
                        className="h-[70vh] min-h-[420px] w-full border-0 bg-background"
                      />
                    ) : (
                      <div className="whitespace-pre-wrap text-sm leading-6">
                        {selectedEmail.text}
                      </div>
                    )}
                  </div>
                </div>
                </>
            ) : (
                <div className="flex h-full flex-col items-center justify-center px-8 text-center">
                  <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-md border bg-muted">
                    <MailOpen className="h-8 w-8 text-muted-foreground" />
                    </div>
                  <h3 className="text-lg font-semibold">Select a message</h3>
                  <p className="mt-2 max-w-sm text-sm text-muted-foreground">
                    Choose a message from the inbox to read it here.
                  </p>
                  <Separator className="my-6 max-w-sm" />
                  <p className="text-xs text-muted-foreground">
                    {userEmails[0]?.email_address || 'Live mailbox'}
                  </p>
                </div>
            )}
            </div>
          </div>
        </Card>
      </section>
    </AppShell>
  );
}
