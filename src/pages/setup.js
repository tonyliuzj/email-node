import { useState } from 'react'
import { useRouter } from 'next/router'
import { AlertCircle, ShieldCheck } from 'lucide-react'
import { AppShell } from '../components/app-shell'
import { Alert, AlertDescription } from '../components/ui/alert'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { withSessionSsr } from '../lib/session'

export const getServerSideProps = withSessionSsr(async () => {
  const { getAdminPath, isSetupRequired } = await import('../lib/db')

  if (!isSetupRequired()) {
    return {
      redirect: {
        destination: `/${getAdminPath()}/login`,
        permanent: false,
      },
    }
  }

  return {
    props: {
      adminPath: getAdminPath(),
      siteTitle: 'Setup Email Node',
    },
  }
})

export default function Setup({ adminPath }) {
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const router = useRouter()

  const submit = async event => {
    event.preventDefault()
    setError('')
    setIsLoading(true)

    try {
      const res = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, confirmPassword }),
      })
      const data = await res.json()

      if (res.ok) {
        router.push(`/${data.adminPath}`)
      } else {
        setError(data.error || 'Setup failed.')
        setIsLoading(false)
      }
    } catch {
      setError('An error occurred. Please try again.')
      setIsLoading(false)
    }
  }

  return (
    <AppShell siteTitle="Setup Email Node" adminPath={adminPath}>
      <section className="mx-auto flex min-h-[calc(100vh-14rem)] w-full max-w-sm items-center py-8">
        <Card className="w-full shadow-lg">
          <CardHeader className="items-center space-y-1 text-center">
            <div className="mb-2 rounded-full bg-primary/10 p-3">
              <ShieldCheck className="h-6 w-6 text-primary" />
            </div>
            <CardTitle className="text-2xl">Create Admin User</CardTitle>
            <CardDescription>
              Finish first-run setup for this Email Node instance
            </CardDescription>
          </CardHeader>
          <form onSubmit={submit}>
            <CardContent className="space-y-4">
              {error && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <div className="space-y-2">
                <Label htmlFor="setup-username">Username</Label>
                <Input
                  id="setup-username"
                  value={username}
                  onChange={event => setUsername(event.target.value)}
                  autoComplete="username"
                  required
                  minLength={3}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="setup-password">Password</Label>
                <Input
                  id="setup-password"
                  type="password"
                  value={password}
                  onChange={event => setPassword(event.target.value)}
                  autoComplete="new-password"
                  required
                  minLength={8}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="setup-confirm-password">Confirm Password</Label>
                <Input
                  id="setup-confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={event => setConfirmPassword(event.target.value)}
                  autoComplete="new-password"
                  required
                  minLength={8}
                />
              </div>
            </CardContent>
            <CardFooter>
              <Button className="w-full" type="submit" disabled={isLoading}>
                {isLoading ? 'Creating admin...' : 'Create Admin'}
              </Button>
            </CardFooter>
          </form>
        </Card>
      </section>
    </AppShell>
  )
}
