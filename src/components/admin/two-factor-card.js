import { useCallback, useEffect, useState } from 'react'
import { Copy, ShieldCheck, ShieldOff } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { Input } from '../ui/input'
import { Label } from '../ui/label'

async function copyText(text, message) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(message)
  } catch {
    toast.error('Copy failed. Select the text and copy it by hand.')
  }
}

// stages: 'idle' -> 'password' -> 'verify' -> 'codes' while turning it on; 'disable' while turning it off.
export function TwoFactorCard({ adminPath }) {
  const [status, setStatus] = useState(null)
  const [stage, setStage] = useState('idle')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [setup, setSetup] = useState(null)
  const [recoveryCodes, setRecoveryCodes] = useState([])
  const [busy, setBusy] = useState(false)

  const endpoint = `/api/${adminPath}/two-factor`

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch(endpoint)
      if (res.ok) setStatus(await res.json())
    } catch (error) {
      console.error('Could not load two-factor status:', error)
    }
  }, [endpoint])

  useEffect(() => {
    loadStatus()
  }, [loadStatus])

  const reset = () => {
    setStage('idle')
    setPassword('')
    setCode('')
    setSetup(null)
  }

  const send = async body => {
    setBusy(true)
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Something went wrong.')
        return null
      }
      return data
    } catch {
      toast.error('Something went wrong. Please try again.')
      return null
    } finally {
      setBusy(false)
    }
  }

  const begin = async event => {
    event.preventDefault()
    const data = await send({ action: 'begin', password })
    if (!data) return
    setSetup(data)
    setPassword('')
    setStage('verify')
  }

  const enable = async event => {
    event.preventDefault()
    const data = await send({ action: 'enable', code })
    if (!data) return
    setRecoveryCodes(data.recoveryCodes)
    setCode('')
    setSetup(null)
    setStage('codes')
    toast.success('Two-factor authentication is on. Other devices were signed out.')
    loadStatus()
  }

  const disable = async event => {
    event.preventDefault()
    const data = await send({ action: 'disable', password, code })
    if (!data) return
    toast.success('Two-factor authentication is off. Other devices were signed out.')
    reset()
    loadStatus()
  }

  const enabled = Boolean(status?.enabled)

  return (
    <Card className="h-fit">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          Two-factor authentication
          {status ? (
            <Badge variant={enabled ? 'default' : 'secondary'}>{enabled ? 'On' : 'Off'}</Badge>
          ) : null}
        </CardTitle>
        <CardDescription>
          Ask for a code from an authenticator app (Google Authenticator, Authy, 1Password, Bitwarden) when signing in.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {stage === 'codes' ? (
          <div className="space-y-3">
            <p className="text-sm font-medium">Save these recovery codes now.</p>
            <p className="text-xs text-muted-foreground">
              Each works once if you lose your phone. They are not shown again.
            </p>
            <ul className="grid grid-cols-2 gap-2 rounded-md border bg-muted/30 p-3 font-mono text-sm" data-testid="recovery-codes">
              {recoveryCodes.map(recoveryCode => <li key={recoveryCode}>{recoveryCode}</li>)}
            </ul>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => copyText(recoveryCodes.join('\n'), 'Recovery codes copied.')}>
                <Copy className="h-4 w-4" />
                Copy codes
              </Button>
              <Button type="button" onClick={() => { setRecoveryCodes([]); reset() }}>
                I have saved them
              </Button>
            </div>
          </div>
        ) : stage === 'verify' && setup ? (
          <form onSubmit={enable} className="space-y-4">
            <div className="space-y-2">
              <Label>1. Add this key to your authenticator app</Label>
              <p className="break-all rounded-md border bg-muted/30 p-3 font-mono text-sm" data-testid="totp-secret">{setup.secret}</p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => copyText(setup.secret.replace(/\s/g, ''), 'Key copied.')}>
                  <Copy className="h-4 w-4" />
                  Copy key
                </Button>
                <Button type="button" variant="outline" size="sm" asChild>
                  <a href={setup.otpauthUrl}>Open in app</a>
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Choose &quot;enter a setup key&quot; in the app. Time-based, 6 digits.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="totp-confirm">2. Enter the 6-digit code it shows</Label>
              <Input
                id="totp-confirm"
                value={code}
                onChange={event => setCode(event.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
                required
              />
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={busy}>Turn on</Button>
              <Button type="button" variant="ghost" onClick={reset}>Cancel</Button>
            </div>
          </form>
        ) : stage === 'password' ? (
          <form onSubmit={begin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="totp-password">Confirm your password to continue</Label>
              <Input
                id="totp-password"
                type="password"
                value={password}
                onChange={event => setPassword(event.target.value)}
                autoComplete="current-password"
                required
              />
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={busy}>Continue</Button>
              <Button type="button" variant="ghost" onClick={reset}>Cancel</Button>
            </div>
          </form>
        ) : stage === 'disable' ? (
          <form onSubmit={disable} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="totp-off-password">Password</Label>
              <Input
                id="totp-off-password"
                type="password"
                value={password}
                onChange={event => setPassword(event.target.value)}
                autoComplete="current-password"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="totp-off-code">Authentication code or recovery code</Label>
              <Input
                id="totp-off-code"
                value={code}
                onChange={event => setCode(event.target.value)}
                autoComplete="one-time-code"
                required
              />
            </div>
            <div className="flex gap-2">
              <Button type="submit" variant="destructive" disabled={busy}>Turn off</Button>
              <Button type="button" variant="ghost" onClick={reset}>Cancel</Button>
            </div>
          </form>
        ) : enabled ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {status.recoveryCodesRemaining} recovery {status.recoveryCodesRemaining === 1 ? 'code' : 'codes'} left.
            </p>
            <Button type="button" variant="outline" onClick={() => setStage('disable')}>
              <ShieldOff className="h-4 w-4" />
              Turn off
            </Button>
          </div>
        ) : (
          <Button type="button" onClick={() => setStage('password')} disabled={!status}>
            <ShieldCheck className="h-4 w-4" />
            Turn on
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
