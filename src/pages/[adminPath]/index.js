import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/router'
import { withSessionSsr } from '../../lib/session'
import { AppShell } from '../../components/app-shell'
import { Alert, AlertDescription } from '../../components/ui/alert'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'
import { Checkbox } from '../../components/ui/checkbox'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Button } from '../../components/ui/button'
import { Badge } from '../../components/ui/badge'
import { Separator } from '../../components/ui/separator'
import { Skeleton } from '../../components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table'
import {
  Globe, Key, LogOut, MailCheck,
  Settings, ShieldCheck, User, Edit, Trash2, Plus, Save, X, Server
} from 'lucide-react'

const toBoolean = value => ['1', 1, true, 'true', 'yes', 'on'].includes(value)
const adminSectionGridClass = 'grid w-full min-w-0 grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_360px] [&>*]:min-w-0'

export const getServerSideProps = withSessionSsr(async ({ req, params }) => {
  const { getAdminPath, getSiteTitle, isSetupRequired } = await import('../../lib/db')
  if (isSetupRequired()) {
    return {
      redirect: {
        destination: '/setup',
        permanent: false,
      },
    }
  }

  const currentAdminPath = getAdminPath()
  if (!params || params.adminPath !== currentAdminPath) {
    return { notFound: true }
  }

  const admin = req.session.get('admin')
  if (!admin) {
    return {
      redirect: {
        destination: `/${currentAdminPath}/login`,
        permanent: false,
      },
    }
  }

  return {
    props: {
      admin,
      adminPath: currentAdminPath,
      siteTitle: getSiteTitle() || 'Email Node',
    },
  }
})

export default function AdminPage({ admin, adminPath, siteTitle: initialSiteTitle }) {
  const [pwd, setPwd] = useState({ current: '', new: '' })
  const [pwdMsg, setPwdMsg] = useState('')
  const [pathMsg, setPathMsg] = useState('')
  const [newPath, setNewPath] = useState(adminPath || '')
  const [usernameMsg, setUsernameMsg] = useState('')
  const [newUsername, setNewUsername] = useState(admin.username)
  const [domains, setDomains] = useState([])
  const [domainForm, setDomainForm] = useState({})
  const [domainMsg, setDomainMsg] = useState('')
  const [siteTitle, setSiteTitle] = useState(initialSiteTitle || '')
  const [siteTitleMsg, setSiteTitleMsg] = useState('')
  const [refreshSeconds, setRefreshSeconds] = useState(10)
  const [refreshMsg, setRefreshMsg] = useState('')
  const [turnstileSettings, setTurnstileSettings] = useState({
    siteKey: '',
    secretKey: '',
    secretConfigured: false,
    registrationEnabled: false,
    loginEnabled: false,
  })
  const [settingsLoading, setSettingsLoading] = useState(true)
  const [domainsLoading, setDomainsLoading] = useState(true)
  const [turnstileMsg, setTurnstileMsg] = useState('')
  const router = useRouter()

  const fetchSettings = useCallback(() => {
    setSettingsLoading(true)
    fetch(`/api/${adminPath}/settings`)
      .then(r => r.json())
      .then(data => {
        if (data?.site_title !== undefined) {
          setSiteTitle(data.site_title || '')
        }
        if (data?.inbox_refresh_seconds !== undefined) {
          setRefreshSeconds(Number(data.inbox_refresh_seconds) || 10)
        }
        setTurnstileSettings(prev => ({
          siteKey: data?.turnstile_site_key ?? prev.siteKey ?? '',
          secretKey: '',
          secretConfigured: Boolean(data?.turnstile_secret_configured),
          registrationEnabled: toBoolean(data?.turnstile_registration_enabled),
          loginEnabled: toBoolean(data?.turnstile_login_enabled),
        }))
      })
      .catch(console.error)
      .finally(() => setSettingsLoading(false))
  }, [adminPath])

  const fetchDomains = useCallback(() => {
    setDomainsLoading(true)
    fetch(`/api/${adminPath}/domains`)
      .then(r => r.json())
      .then(data => {
        setDomains(Array.isArray(data) ? data.map(domain => ({
          ...domain,
          imap_tls: toBoolean(domain.imap_tls),
          is_active: toBoolean(domain.is_active),
        })) : [])
      })
      .catch(console.error)
      .finally(() => setDomainsLoading(false))
  }, [adminPath])

  useEffect(() => {
    fetchDomains()
    fetchSettings()
  }, [adminPath, fetchDomains, fetchSettings])

  const changePwd = async e => {
    e.preventDefault()
    setPwdMsg('')
    const res = await fetch(`/api/${adminPath}/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        currentPassword: pwd.current,
        newPassword: pwd.new,
      }),
    })
    const data = await res.json()
    setPwdMsg(res.ok ? 'Password changed successfully.' : data.error || 'Error changing password.')
  }

  const changeUsername = async e => {
    e.preventDefault()
    setUsernameMsg('')
    if (!newUsername || newUsername.length < 3) {
      setUsernameMsg('Username must be at least 3 characters.')
      return
    }
    const res = await fetch(`/api/${adminPath}/change-username`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newUsername }),
    })
    const data = await res.json()
    if (res.ok) {
      setUsernameMsg('Username updated! You must log in again.')
      setTimeout(() => {
        router.push(`/${adminPath}/login`)
      }, 2000)
    } else {
      setUsernameMsg(data.error || 'Failed to update username.')
    }
  }

  const changeAdminPath = async e => {
    e.preventDefault()
    setPathMsg('')
    if (!newPath || newPath.length < 3) {
      setPathMsg('Admin path must be at least 3 characters.')
      return
    }
    const res = await fetch(`/api/${adminPath}/config-path`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminPath: newPath }),
    })
    if (res.ok) {
      setPathMsg(`Path updated! You must log in again at /${newPath}.`)
      setTimeout(() => {
        router.push(`/${newPath}/login`)
      }, 2000)
    } else {
      setPathMsg('Failed to update admin path.')
    }
  }

  const logout = async () => {
    await fetch(`/api/${adminPath}/logout`, { method: 'POST' })
    router.push(`/${adminPath}/login`)
  }

  const saveDomain = async (e) => {
    e.preventDefault()
    setDomainMsg('')
    const method = domainForm.id ? 'PUT' : 'POST'
    const url = `/api/${adminPath}/domains`
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(domainForm),
    })
    if (res.ok) {
      setDomainMsg('Domain saved successfully.')
      setDomainForm({})
      fetchDomains()
    } else {
      setDomainMsg('Error saving domain.')
    }
  }

  const saveSiteTitle = async (e) => {
    e.preventDefault()
    setSiteTitleMsg('')
    const res = await fetch(`/api/${adminPath}/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ site_title: siteTitle }),
    })
    if (res.ok) {
      setSiteTitleMsg('Site title updated successfully.')
      fetchSettings()
    } else {
      setSiteTitleMsg('Error updating site title.')
    }
  }

  const saveTurnstileSettings = async (e) => {
    e.preventDefault()
    setTurnstileMsg('')
    const res = await fetch(`/api/${adminPath}/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        turnstile_site_key: turnstileSettings.siteKey,
        turnstile_secret_key: turnstileSettings.secretKey,
        turnstile_registration_enabled: turnstileSettings.registrationEnabled,
        turnstile_login_enabled: turnstileSettings.loginEnabled,
      }),
    })
    if (res.ok) {
      setTurnstileMsg('Turnstile settings updated successfully.')
      fetchSettings()
    } else {
      setTurnstileMsg('Error updating Turnstile settings.')
    }
  }

  const editDomain = (domain) => {
    setDomainForm({
      ...domain,
      imap_tls: toBoolean(domain.imap_tls),
      is_active: toBoolean(domain.is_active),
    })
    // Scroll to form
    document.getElementById('domain-form')?.scrollIntoView({ behavior: 'smooth' })
  }

  const saveRefreshSeconds = async (e) => {
    e.preventDefault()
    setRefreshMsg('')
    const res = await fetch(`/api/${adminPath}/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inbox_refresh_seconds: refreshSeconds }),
    })
    const data = await res.json()
    if (res.ok) {
      setRefreshMsg('Inbox refresh time updated successfully.')
      fetchSettings()
    } else {
      setRefreshMsg(data.error || 'Error updating inbox refresh time.')
    }
  }

  const deleteDomain = async (id) => {
    if (confirm('Are you sure you want to delete this domain?')) {
      const res = await fetch(`/api/${adminPath}/domains`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      })
      if (res.ok) {
        setDomainMsg('Domain deleted.')
        fetchDomains()
      } else {
        setDomainMsg('Error deleting domain.')
      }
    }
  }

  const activeDomains = domains.filter(domain => domain.is_active).length
  const adminUrl = `/${adminPath}`

  const StatusMessage = ({ message }) => {
    if (!message) return null
    const isError = /error|failed|invalid/i.test(message)

    return (
      <Alert variant={isError ? 'destructive' : 'default'} className={isError ? '' : 'border-emerald-200 text-emerald-700 dark:border-emerald-900 dark:text-emerald-300'}>
        <AlertDescription>{message}</AlertDescription>
      </Alert>
    )
  }

  return (
    <AppShell siteTitle={siteTitle} adminPath={adminPath} adminUser={admin} fullWidth mainClassName="p-0 sm:p-0 lg:p-0">
      <section className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-4 border-b pb-5 md:flex-row md:items-end md:justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">Admin settings</h1>
            <p className="text-sm text-muted-foreground">
              Manage mailbox domains, public settings, and administrator credentials.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="h-8 px-3 font-normal">
              <User className="mr-2 h-3.5 w-3.5" />
              {admin.username}
            </Badge>
            <Button variant="destructive" size="sm" onClick={logout}>
              <LogOut className="h-4 w-4" />
              Sign out
            </Button>
          </div>
        </div>

        <div className="w-full space-y-5">
          <section className="w-full">
            <div className={adminSectionGridClass}>
              <Card>
                <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <CardTitle>Domains</CardTitle>
                    <CardDescription>Catch-all mailboxes available for public address creation.</CardDescription>
                  </div>
                  <Badge variant="secondary">
                    {activeDomains} active / {domains.length || 0} total
                  </Badge>
                </CardHeader>
                <CardContent>
                  {domainsLoading ? (
                    <div className="space-y-3">
                      {[0, 1, 2, 3].map(index => (
                        <div key={index} className="grid gap-3 rounded-md border p-4 sm:grid-cols-[1fr_1fr_120px_96px]">
                          <Skeleton className="h-5 w-36" />
                          <Skeleton className="h-5 w-44" />
                          <Skeleton className="h-5 w-20" />
                          <Skeleton className="h-8 w-full" />
                        </div>
                      ))}
                    </div>
                  ) : domains.length > 0 ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Domain</TableHead>
                          <TableHead>IMAP host</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {domains.map((domain) => (
                          <TableRow key={domain.id}>
                            <TableCell>
                              <div className="font-medium">{domain.name}</div>
                              <div className="text-xs text-muted-foreground">Port {domain.imap_port || 'not set'}</div>
                            </TableCell>
                            <TableCell className="text-muted-foreground">{domain.imap_host || 'Not configured'}</TableCell>
                            <TableCell>
                              <div className="flex flex-wrap gap-2">
                                <Badge variant={domain.is_active ? 'default' : 'destructive'}>
                                  {domain.is_active ? 'Active' : 'Inactive'}
                                </Badge>
                                {domain.imap_tls ? <Badge variant="secondary">TLS</Badge> : null}
                              </div>
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-2">
                                <Button variant="ghost" size="icon" onClick={() => editDomain(domain)} title="Edit">
                                  <Edit className="h-4 w-4 text-muted-foreground hover:text-primary" />
                                </Button>
                                <Button variant="ghost" size="icon" onClick={() => deleteDomain(domain.id)} title="Delete">
                                  <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <div className="flex min-h-[220px] flex-col items-center justify-center rounded-md border border-dashed p-8 text-center">
                      <MailCheck className="mb-3 h-10 w-10 text-muted-foreground" />
                      <h3 className="font-semibold">No domains configured</h3>
                      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                        Add a domain to make email registration available on the public site.
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card id="domain-form" className="h-fit">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Server className="h-5 w-5 text-primary" />
                    {domainForm.id ? 'Edit domain' : 'Add domain'}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <form onSubmit={saveDomain} className="space-y-4">
                    <div className="space-y-2">
                      <Label>Domain name</Label>
                      <Input
                        name="name"
                        value={domainForm.name || ''}
                        onChange={e => setDomainForm({ ...domainForm, name: e.target.value })}
                        placeholder="example.com"
                      />
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
                      <div className="space-y-2">
                        <Label>IMAP host</Label>
                        <Input
                          name="imap_host"
                          value={domainForm.imap_host || ''}
                          onChange={e => setDomainForm({ ...domainForm, imap_host: e.target.value })}
                          placeholder="imap.example.com"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Port</Label>
                        <Input
                          type="number"
                          name="imap_port"
                          value={domainForm.imap_port || ''}
                          onChange={e => setDomainForm({ ...domainForm, imap_port: e.target.value })}
                          placeholder="993"
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>IMAP user</Label>
                      <Input
                        name="imap_user"
                        value={domainForm.imap_user || ''}
                        onChange={e => setDomainForm({ ...domainForm, imap_user: e.target.value })}
                        placeholder="user@example.com"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>IMAP password</Label>
                      <Input
                        type="password"
                        name="imap_password"
                        value={domainForm.imap_password || ''}
                        onChange={e => setDomainForm({ ...domainForm, imap_password: e.target.value })}
                        placeholder="Password"
                      />
                    </div>
                    <div className="grid gap-3 rounded-md border bg-muted/30 p-3">
                      <Label className="flex cursor-pointer items-center space-x-2">
                        <Checkbox
                          name="imap_tls"
                          checked={toBoolean(domainForm.imap_tls)}
                          onCheckedChange={checked => setDomainForm({ ...domainForm, imap_tls: Boolean(checked) })}
                        />
                        <span className="text-sm font-medium">Use TLS</span>
                      </Label>
                      <Label className="flex cursor-pointer items-center space-x-2">
                        <Checkbox
                          name="is_active"
                          checked={domainForm.is_active === undefined ? true : toBoolean(domainForm.is_active)}
                          onCheckedChange={checked => setDomainForm({ ...domainForm, is_active: Boolean(checked) })}
                        />
                        <span className="text-sm font-medium">Active</span>
                      </Label>
                    </div>
                    <div className="flex gap-2">
                      <Button type="submit" className="flex-1">
                        {domainForm.id ? <Save className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                        {domainForm.id ? 'Update' : 'Add'}
                      </Button>
                      {domainForm.id && (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => {
                            setDomainForm({})
                            setDomainMsg('')
                          }}
                        >
                          <X className="h-4 w-4" />
                          Cancel
                        </Button>
                      )}
                    </div>
                    <StatusMessage message={domainMsg} />
                  </form>
                </CardContent>
              </Card>
            </div>
          </section>

          <section className="w-full">
            <div className={adminSectionGridClass}>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Globe className="h-5 w-5 text-primary" />
                    Public site
                  </CardTitle>
                  <CardDescription>Basic public identity and admin URL.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <form onSubmit={saveSiteTitle} className="space-y-4">
                    <div className="space-y-2">
                      <Label>Site title</Label>
                      <Input
                        type="text"
                        value={siteTitle}
                        onChange={e => setSiteTitle(e.target.value)}
                        placeholder="My Email Service"
                        disabled={settingsLoading}
                      />
                    </div>
                    <Button type="submit" disabled={settingsLoading}>
                      <Save className="h-4 w-4" />
                      Save title
                    </Button>
                    <StatusMessage message={siteTitleMsg} />
                  </form>

                  <Separator />

                  <form onSubmit={saveRefreshSeconds} className="space-y-4">
                    <div className="space-y-2">
                      <Label>Inbox refresh time</Label>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          min={5}
                          step={1}
                          value={refreshSeconds}
                          onChange={e => setRefreshSeconds(e.target.value)}
                          disabled={settingsLoading}
                        />
                        <span className="text-sm text-muted-foreground">seconds</span>
                      </div>
                      <p className="text-xs text-muted-foreground">Minimum 5 seconds. Default is 10 seconds.</p>
                    </div>
                    <Button type="submit" variant="outline" disabled={settingsLoading}>
                      <Save className="h-4 w-4" />
                      Save refresh time
                    </Button>
                    <StatusMessage message={refreshMsg} />
                  </form>

                  <Separator />

                  <form onSubmit={changeAdminPath} className="space-y-4">
                    <div className="space-y-2">
                      <Label>Admin path</Label>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">/</span>
                        <Input
                          type="text"
                          value={newPath}
                          onChange={e => setNewPath(e.target.value)}
                          minLength={3}
                          required
                          disabled={settingsLoading}
                        />
                      </div>
                      <p className="font-mono text-xs text-muted-foreground">{adminUrl}</p>
                    </div>
                    <Button type="submit" variant="outline" disabled={settingsLoading}>
                      <Settings className="h-4 w-4" />
                      Update path
                    </Button>
                    <StatusMessage message={pathMsg} />
                  </form>
                </CardContent>
              </Card>

              <Card className="h-fit">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ShieldCheck className="h-5 w-5 text-primary" />
                    Cloudflare Turnstile
                  </CardTitle>
                  <CardDescription>Enable challenge checks on public account flows.</CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={saveTurnstileSettings} className="space-y-4">
                    <div className="grid grid-cols-1 gap-4">
                      <div className="space-y-2">
                        <Label>Site key</Label>
                        <Input
                          type="text"
                          value={turnstileSettings.siteKey}
                          onChange={e => setTurnstileSettings(prev => ({ ...prev, siteKey: e.target.value }))}
                          placeholder="0x4AAAA..."
                          disabled={settingsLoading}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Secret key</Label>
                        <Input
                          type="password"
                          value={turnstileSettings.secretKey}
                          onChange={e => setTurnstileSettings(prev => ({ ...prev, secretKey: e.target.value }))}
                          placeholder={turnstileSettings.secretConfigured ? 'Configured - leave blank to keep current secret' : '0x4AAAA...'}
                          disabled={settingsLoading}
                        />
                        {turnstileSettings.secretConfigured && (
                          <p className="text-xs text-muted-foreground">A secret key is already stored.</p>
                        )}
                      </div>
                    </div>

                    <div className="grid gap-3 rounded-md border bg-muted/30 p-3">
                      <Label className="flex items-center space-x-2 cursor-pointer">
                        <Checkbox
                          checked={turnstileSettings.registrationEnabled}
                          onCheckedChange={checked => setTurnstileSettings(prev => ({ ...prev, registrationEnabled: Boolean(checked) }))}
                          disabled={settingsLoading}
                        />
                        <span className="text-sm">Require Turnstile for registration</span>
                      </Label>
                      <Label className="flex items-center space-x-2 cursor-pointer">
                        <Checkbox
                          checked={turnstileSettings.loginEnabled}
                          onCheckedChange={checked => setTurnstileSettings(prev => ({ ...prev, loginEnabled: Boolean(checked) }))}
                          disabled={settingsLoading}
                        />
                        <span className="text-sm">Require Turnstile for login</span>
                      </Label>
                    </div>

                    <Button type="submit" disabled={settingsLoading}>
                      <ShieldCheck className="h-4 w-4" />
                      Save Turnstile settings
                    </Button>
                    <StatusMessage message={turnstileMsg} />
                  </form>
                </CardContent>
              </Card>
            </div>
          </section>

          <section className="w-full">
            <div className={adminSectionGridClass}>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <User className="h-5 w-5 text-primary" />
                    Username
                  </CardTitle>
                  <CardDescription>Change the administrator login name.</CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={changeUsername} className="space-y-4">
                    <div className="space-y-2">
                      <Label>Username</Label>
                      <Input
                        type="text"
                        value={newUsername}
                        onChange={e => setNewUsername(e.target.value)}
                        minLength={3}
                        required
                      />
                    </div>
                    <Button type="submit">
                      <User className="h-4 w-4" />
                      Update username
                    </Button>
                    <StatusMessage message={usernameMsg} />
                  </form>
                </CardContent>
              </Card>

              <Card className="h-fit">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Key className="h-5 w-5 text-primary" />
                    Password
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <form onSubmit={changePwd} className="space-y-4">
                    <div className="space-y-2">
                      <Label>Current password</Label>
                      <Input
                        type="password"
                        value={pwd.current}
                        onChange={e => setPwd({ ...pwd, current: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>New password</Label>
                      <Input
                        type="password"
                        value={pwd.new}
                        onChange={e => setPwd({ ...pwd, new: e.target.value })}
                      />
                    </div>
                    <Button type="submit">
                      <Key className="h-4 w-4" />
                      Update password
                    </Button>
                    <StatusMessage message={pwdMsg} />
                  </form>
                </CardContent>
              </Card>
            </div>
          </section>
        </div>
      </section>
    </AppShell>
  )
}
