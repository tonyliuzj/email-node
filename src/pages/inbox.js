'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/router';
import { RefreshCw, Inbox as InboxIcon, ArrowLeft, User, Calendar, Clock, MailOpen, Copy, Download, Paperclip, Trash2, Search, CheckCheck } from 'lucide-react';
import { toast } from 'sonner';
import { AppShell } from '../components/app-shell';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Separator } from '../components/ui/separator';
import { Skeleton } from '../components/ui/skeleton';
import { withUser } from '../lib/user-auth';
import { buildMessageDocument, restoreRemoteImages } from '../lib/remote-images';
import {
  INLINE_IMAGE_TYPES,
  MAX_INLINE_IMAGE_BYTES,
  applyInlineImages,
  formatBytes,
  inlineImagesToFetch,
} from '../lib/inline-images';
import { cn } from '../lib/utils';

const MAX_CATCH_UP_ROUNDS = 20;

export const getServerSideProps = withUser(async ({ user, adminLink }) => {
  try {
    const { getInboxRefreshSeconds, getSiteTitle } = await import('../lib/db');
    return {
      props: {
        siteTitle: getSiteTitle() || 'Email Node',
        adminPath: adminLink,
        inboxRefreshSeconds: getInboxRefreshSeconds(),
        user: user || null,
      }
    };
  } catch {
    return {
      props: {
        siteTitle: 'Email Node',
        adminPath: null,
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
  const [selectedUid, setSelectedUid] = useState(null);
  const selectedEmail = inbox.find(message => message.uid === selectedUid) || null;
  // Pictures that are part of a message (Content-ID), fetched when it is opened: uid -> { cid: data address }.
  const [inlineImages, setInlineImages] = useState({});
  const inlineRequested = useRef(new Set());
  // Paging back through older mail.
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [filter, setFilter] = useState('');
  const lowestUidRef = useRef(0);
  // UIDs of the messages whose remote images the reader chose to load.
  const [imagesLoadedFor, setImagesLoadedFor] = useState(() => new Set());
  const [countdown, setCountdown] = useState(refreshSeconds);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const seenUids = useRef(new Set());
  // What the server has already looked at, so each refresh only asks for newer mail.
  const highestUidRef = useRef(0);
  const uidValidityRef = useRef('');
  const isFetchingRef = useRef(false);
  const [userEmails, setUserEmails] = useState([])
  const [loading, setLoading] = useState(true)
  const primaryEmailAddress = userEmails[0]?.email_address || ''

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
    // Every refresh opens an IMAP connection on the server, so don't poll from a hidden tab.
    if (typeof document !== 'undefined' && document.hidden) return;
    
    const primaryEmail = userEmails[0];
    if (!primaryEmail) return;

    isFetchingRef.current = true;

    try {
      setIsRefreshing(true);
      // The server hands over at most 50 messages at a time, oldest first, and says when there is more. Keep
      // asking so a burst of mail is never skipped; the limit only guards against a server that never stops.
      for (let round = 0; round < MAX_CATCH_UP_ROUNDS; round += 1) {
        const res = await fetch('/api/emails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: primaryEmail.email_address,
            sinceUid: highestUidRef.current || undefined,
            uidValidity: uidValidityRef.current || undefined,
          }),
          credentials: 'include',
        });
        if (res.status === 401 || res.status === 403) {
          router.push('/');
          return;
        }
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Mailbox sync failed.');
        }
        if (data.warning) {
          toast.warning(data.warning);
        }
        // The mailbox was rebuilt on the server, so the UIDs we remember no longer mean anything.
        if (data.reset) {
          seenUids.current.clear();
          highestUidRef.current = 0;
          lowestUidRef.current = 0;
          inlineRequested.current.clear();
          setInlineImages({});
        }
        if (data.uidValidity) uidValidityRef.current = data.uidValidity;
        if (Number.isInteger(data.highestUid)) {
          highestUidRef.current = Math.max(highestUidRef.current, data.highestUid);
        }
        // Only a first load (or a reset) says where the page stopped; later refreshes leave it alone.
        if (typeof data.hasMore === 'boolean' && Number.isInteger(data.lowestUid)) {
          lowestUidRef.current = data.lowestUid;
          setHasMore(data.hasMore);
        }

        const newOnes = (data.emails || []).filter(m => {
          if (seenUids.current.has(m.uid)) return false;
          seenUids.current.add(m.uid);
          return true;
        });
        if (data.reset) {
          setInbox(newOnes);
          setSelectedUid(null);
        } else if (newOnes.length) {
          setInbox(prev => [...newOnes, ...prev]);
        }
        if (!data.more) break;
      }
    } catch (err) {
      console.error(err);
      toast.error(err.message || 'Mailbox sync failed.', { id: 'mailbox-sync-error' });
    } finally {
      isFetchingRef.current = false;
      setIsRefreshing(false);
      setCountdown(refreshSeconds);
    }
  }, [refreshSeconds, userEmails, router]);

  useEffect(() => {
    let timer;
    const onVisible = () => {
      if (!document.hidden) fetchEmails();
    };

    if (userEmails.length > 0) {
      fetchEmails();
      setCountdown(refreshSeconds);
      let remaining = refreshSeconds;
      timer = setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) {
          remaining = refreshSeconds;
          fetchEmails();
        }
        setCountdown(remaining);
      }, 1000);
      document.addEventListener('visibilitychange', onVisible);
    }
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refreshSeconds, userEmails, fetchEmails]);

  const loadOlder = async () => {
    const primaryEmail = userEmails[0];
    if (!primaryEmail || loadingOlder || !hasMore || !lowestUidRef.current) return;

    setLoadingOlder(true);
    try {
      const res = await fetch('/api/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: primaryEmail.email_address,
          beforeUid: lowestUidRef.current,
          uidValidity: uidValidityRef.current || undefined,
        }),
        credentials: 'include',
      });
      if (res.status === 401 || res.status === 403) {
        router.push('/');
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load older messages.');

      // The mailbox was rebuilt while this page was open: drop what it holds and let the next refresh reload.
      if (data.reset) {
        seenUids.current.clear();
        highestUidRef.current = 0;
        lowestUidRef.current = 0;
        uidValidityRef.current = data.uidValidity || '';
        inlineRequested.current.clear();
        setInlineImages({});
        setInbox([]);
        setSelectedUid(null);
        setHasMore(false);
        return;
      }

      lowestUidRef.current = data.lowestUid > 0 ? data.lowestUid : lowestUidRef.current;
      setHasMore(Boolean(data.hasMore));

      const older = (data.emails || []).filter(m => {
        if (seenUids.current.has(m.uid)) return false;
        seenUids.current.add(m.uid);
        return true;
      });
      if (older.length) setInbox(prev => [...prev, ...older]);
    } catch (err) {
      console.error(err);
      toast.error(err.message || 'Could not load older messages.', { id: 'older-error' });
    } finally {
      setLoadingOlder(false);
    }
  };

  // Read, unread and removal are kept per address on this site, not on the mail server (see /api/emails/state).
  const sendState = async (action, uids) => {
    try {
      const res = await fetch('/api/emails/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action, uids, uidValidity: uidValidityRef.current }),
      });
      if (res.status === 401 || res.status === 403) {
        router.push('/');
        return false;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Could not save that change.');
      }
      return true;
    } catch (err) {
      toast.error(err.message || 'Could not save that change.', { id: 'message-state-error' });
      return false;
    }
  };

  const setReadState = (uids, read) => {
    setInbox(prev => prev.map(m => (uids.includes(m.uid) ? { ...m, read } : m)));
    sendState(read ? 'read' : 'unread', uids);
  };

  const markAllRead = () => {
    const unread = inbox.filter(message => !message.read).map(message => message.uid);
    for (let index = 0; index < unread.length; index += 100) {
      setReadState(unread.slice(index, index + 100), true);
    }
  };

  const selectEmail = email => {
    setSelectedUid(email.uid);
    if (!email.read) setReadState([email.uid], true);
  };

  const removeMessage = async email => {
    if (!window.confirm('Delete this message? It disappears from your inbox here. It is not deleted from the mail server.')) return;
    if (!(await sendState('delete', [email.uid]))) return;

    setInbox(prev => prev.filter(m => m.uid !== email.uid));
    setSelectedUid(null);
    toast.success('Message deleted.');
  };

  const downloadAttachment = async (email, attachment) => {
    try {
      const params = new URLSearchParams({ uid: String(email.uid), part: attachment.part, v: uidValidityRef.current });
      const res = await fetch(`/api/emails/attachment?${params}`, { credentials: 'include' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Could not download the attachment.');
      }
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = attachment.filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      toast.error(err.message || 'Could not download the attachment.', { id: 'attachment-error' });
    }
  };

  // Pictures that belong to the message are fetched when it is opened, then placed into it by the page.
  useEffect(() => {
    if (!selectedEmail || inlineRequested.current.has(selectedEmail.uid)) return;
    const wanted = inlineImagesToFetch(selectedEmail.html, selectedEmail.attachments);
    if (wanted.length === 0) return;

    const uid = selectedEmail.uid;
    inlineRequested.current.add(uid);

    (async () => {
      const found = {};
      for (const attachment of wanted) {
        if (attachment.size > MAX_INLINE_IMAGE_BYTES) continue;
        try {
          const params = new URLSearchParams({ uid: String(uid), part: attachment.part, inline: '1', v: uidValidityRef.current });
          const res = await fetch(`/api/emails/attachment?${params}`, { credentials: 'include' });
          if (!res.ok) continue;
          const blob = await res.blob();
          if (!INLINE_IMAGE_TYPES.has(blob.type) || blob.size > MAX_INLINE_IMAGE_BYTES) continue;
          found[attachment.cid] = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        } catch {
          // A picture that can't be fetched just stays missing.
        }
      }
      setInlineImages(prev => ({ ...prev, [uid]: found }));
    })();
  }, [selectedEmail]);

  const getSnippet = text => {
    const first = (text || '').split('\n')[0];
    return first.length > 90 ? `${first.slice(0, 90)}...` : first;
  };

  const formatSender = sender => {
    const normalizedSender = String(sender || 'Unknown sender').trim();
    const quotedDisplayNameMatch = normalizedSender.match(/^["'](.+)["']\s*(<[^>]+>)$/);
    const displayNameMatch = quotedDisplayNameMatch || normalizedSender.match(/^([^<]+?)\s*(<[^>]+>)$/);

    if (displayNameMatch) {
      const senderName = displayNameMatch[1].trim().replace(/^["']+|["']+$/g, '');
      return `${senderName} ${displayNameMatch[2]}`;
    }

    return normalizedSender.replace(/^["']+|["']+$/g, '');
  };

  const getSenderInitial = sender => {
    return formatSender(sender).charAt(0).toUpperCase() || '?';
  };

  const copyToClipboard = async (key, value) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${key === 'email' ? 'Inbox address' : 'Value'} copied.`);
    } catch (error) {
      console.error('Copy failed:', error);
      toast.error('Copy failed. Please try again.');
    }
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

  const unreadCount = inbox.filter(message => !message.read).length;
  // Narrows the messages already loaded in this page; it does not search the mailbox.
  const needle = filter.trim().toLowerCase();
  const visibleInbox = needle
    ? inbox.filter(message => [message.subject, message.from, String(message.text || '').slice(0, 5000)]
        .some(value => String(value || '').toLowerCase().includes(needle)))
    : inbox;
  // Pictures the message body shows itself are not listed again as files to download.
  const listedAttachments = selectedEmail
    ? (selectedEmail.attachments || []).filter(item => inlineImagesToFetch(selectedEmail.html, [item]).length === 0)
    : [];
  const messageHtml = selectedEmail?.html
    ? applyInlineImages(
        imagesLoadedFor.has(selectedEmail.uid) ? restoreRemoteImages(selectedEmail.html) : selectedEmail.html,
        inlineImages[selectedEmail.uid]
      )
    : null;

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
                      {inbox.length} message{inbox.length !== 1 ? 's' : ''}{inbox.length ? ` - ${unreadCount} unread` : ''} - refresh in {countdown}s
                    </p>
                  </div>
                  <Button variant="outline" size="sm" onClick={fetchEmails} disabled={isRefreshing}>
                    <RefreshCw className={cn('h-4 w-4', isRefreshing && 'animate-spin')} />
                    Refresh
                  </Button>
                </div>
              </div>

              <div className="border-b px-4 py-3">
                <p className="mb-2 text-xs font-medium text-muted-foreground">Inbox address</p>
                <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-2">
                  <span className="min-w-0 flex-1 break-all font-mono text-xs">
                    {primaryEmailAddress || 'No inbox address'}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => copyToClipboard('email', primaryEmailAddress)}
                    disabled={!primaryEmailAddress}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {inbox.length > 0 ? (
                <div className="flex items-center gap-2 border-b px-4 py-3">
                  <div className="relative min-w-0 flex-1">
                    <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      type="search"
                      value={filter}
                      onChange={event => setFilter(event.target.value)}
                      placeholder="Filter loaded messages"
                      aria-label="Filter loaded messages"
                      className="pl-8"
                    />
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={markAllRead} disabled={unreadCount === 0}>
                    <CheckCheck className="h-4 w-4" />
                    Mark all read
                  </Button>
                </div>
              ) : null}

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
                ) : visibleInbox.length === 0 ? (
                  <p className="px-6 py-10 text-center text-sm text-muted-foreground">No loaded message matches that.</p>
                ) : (
                  <div className="divide-y">
                    {visibleInbox.map(email => (
                      <button
                        key={email.uid}
                        type="button"
                        onClick={() => selectEmail(email)}
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
                            <span className={cn('flex min-w-0 items-center gap-2 text-sm', email.read ? 'font-medium' : 'font-semibold')}>
                              {email.read ? null : (
                                <span className="h-2 w-2 shrink-0 rounded-full bg-primary" data-testid="unread-dot" aria-label="Unread" />
                              )}
                              <span className="truncate">{formatSender(email.from)}</span>
                            </span>
                            <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                              {email.attachments?.length ? <Paperclip className="h-3.5 w-3.5" aria-label="Has attachments" /> : null}
                              {formatDate(email.date)}
                            </span>
                          </span>
                          <span className={cn('mt-1 block truncate text-sm text-foreground/85', email.read ? 'font-medium' : 'font-semibold')}>
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
                {hasMore ? (
                  <div className="p-3">
                    <Button type="button" variant="outline" className="w-full" onClick={loadOlder} disabled={loadingOlder}>
                      {loadingOlder ? 'Loading...' : 'Load older messages'}
                    </Button>
                  </div>
                ) : null}
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
                      onClick={() => setSelectedUid(null)}
                      className="lg:hidden"
                    >
                      <ArrowLeft className="h-4 w-4" />
                      Messages
                    </Button>
                      <div className="ml-auto flex items-center gap-2">
                        <Button type="button" variant="outline" size="sm" onClick={() => setReadState([selectedEmail.uid], false)}>
                          <MailOpen className="h-4 w-4" />
                          Mark unread
                        </Button>
                        <Button type="button" variant="outline" size="sm" onClick={() => removeMessage(selectedEmail)}>
                          <Trash2 className="h-4 w-4" />
                          Delete
                        </Button>
                      </div>
                  </div>
                    <h2 className="break-words text-xl font-semibold tracking-tight sm:text-2xl">
                    {selectedEmail.subject || '(No Subject)'}
                  </h2>
                    <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
                      <div className="flex min-w-0 items-center gap-2">
                        <User className="h-4 w-4 shrink-0" />
                        <span className="truncate font-medium text-foreground">{formatSender(selectedEmail.from)}</span>
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
                {listedAttachments.length > 0 ? (
                  <div className="border-b px-4 py-3 sm:px-6" data-testid="attachments">
                    <p className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                      <Paperclip className="h-3.5 w-3.5" />
                      {listedAttachments.length} attachment{listedAttachments.length !== 1 ? 's' : ''}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {listedAttachments.map(attachment => (
                        <Button
                          key={attachment.part}
                          type="button"
                          variant="outline"
                          size="sm"
                          title={`${attachment.filename} (${attachment.type})`}
                          onClick={() => downloadAttachment(selectedEmail, attachment)}
                        >
                          <Download className="h-4 w-4" />
                          <span className="max-w-[16rem] truncate">{attachment.filename}</span>
                          <span className="text-xs text-muted-foreground">{formatBytes(attachment.size)}</span>
                        </Button>
                      ))}
                    </div>
                  </div>
                ) : null}
                  <div className="min-h-0 flex-1 overflow-y-auto bg-background px-4 py-6 sm:px-8">
                    <div className="mx-auto max-w-4xl">
                    {selectedEmail.html ? (
                      <>
                        {selectedEmail.hasRemoteImages && !imagesLoadedFor.has(selectedEmail.uid) ? (
                          <div
                            className="mb-4 flex flex-col gap-2 rounded-md border bg-muted/40 p-3 text-sm sm:flex-row sm:items-center sm:justify-between"
                            data-testid="remote-images-banner"
                          >
                            <span className="text-muted-foreground">
                              Images from the internet are blocked, so the sender can&apos;t tell you opened this.
                            </span>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => setImagesLoadedFor(current => new Set(current).add(selectedEmail.uid))}
                            >
                              Load images
                            </Button>
                          </div>
                        ) : null}
                        {selectedEmail.truncated ? (
                          <p className="mb-4 text-xs text-muted-foreground">
                            This message is very large, so only part of it is shown.
                          </p>
                        ) : null}
                        <iframe
                          title={selectedEmail.subject || 'Email message'}
                          sandbox="allow-popups allow-popups-to-escape-sandbox"
                          srcDoc={buildMessageDocument(messageHtml, { allowRemoteImages: imagesLoadedFor.has(selectedEmail.uid) })}
                          className="h-[70vh] min-h-[420px] w-full border-0 bg-background"
                        />
                      </>
                    ) : (
                      <div className="whitespace-pre-wrap text-sm leading-6">
                        {selectedEmail.truncated ? (
                          <p className="mb-4 text-xs text-muted-foreground">
                            This message is very large, so only part of it is shown.
                          </p>
                        ) : null}
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
