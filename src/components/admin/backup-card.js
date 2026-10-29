import { useState } from 'react'
import { DatabaseBackup, Download } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { Input } from '../ui/input'
import { Label } from '../ui/label'

export function BackupCard({ adminPath }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  const download = async event => {
    event.preventDefault()
    setBusy(true)
    try {
      const res = await fetch(`/api/${adminPath}/backup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error || 'The backup could not be created.')
        return
      }

      const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1] || 'email-node-backup.db'
      const url = URL.createObjectURL(await res.blob())
      const link = document.createElement('a')
      link.href = url
      link.download = name
      document.body.appendChild(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)

      setPassword('')
      toast.success('Backup downloaded. Keep it somewhere private.')
    } catch {
      toast.error('The backup could not be created. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="h-fit">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <DatabaseBackup className="h-5 w-5 text-primary" />
          Backup
        </CardTitle>
        <CardDescription>
          Download a copy of the database: addresses, domains, settings and admin account.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={download} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="backup-password">Confirm your password</Label>
            <Input
              id="backup-password"
              type="password"
              value={password}
              onChange={event => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
          <Button type="submit" disabled={busy}>
            <Download className="h-4 w-4" />
            {busy ? 'Preparing...' : 'Download backup'}
          </Button>
        </form>
        <p className="text-xs text-muted-foreground">
          The file contains password hashes and secrets that are encrypted with your <code>DATA_ENCRYPTION_KEY</code>.
          Store it privately, and keep that key with it: without the same key, the saved IMAP passwords and
          two-factor secrets cannot be read after a restore. See the README for how to restore.
        </p>
      </CardContent>
    </Card>
  )
}
