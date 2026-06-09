import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { toast } from 'sonner'
import { withSessionSsr } from '../../lib/session'
import { AppShell } from '../../components/app-shell'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../../components/ui/card'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Button } from '../../components/ui/button'
import { ArrowLeft, Shield } from 'lucide-react'

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
  if (admin) {
    return {
      redirect: {
        destination: `/${currentAdminPath}`,
        permanent: false,
      },
    }
  }
  return {
    props: {
      adminPath: currentAdminPath,
      siteTitle: getSiteTitle() || 'Email Node',
    },
  }
})

export default function Login({ adminPath, siteTitle }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const router = useRouter()

  const submit = async e => {
    e.preventDefault()
    setIsLoading(true)
    try {
      const res = await fetch(`/api/${adminPath}/login`, {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ username, password }),
      })
      if (res.ok) router.push(`/${adminPath}`)
      else {
        const { error: msg } = await res.json()
        toast.error(msg || 'Login failed')
        setIsLoading(false)
      }
    } catch {
      toast.error('An error occurred. Please try again.')
      setIsLoading(false)
    }
  }

  return (
    <AppShell siteTitle={siteTitle} adminPath={adminPath}>
      <section className="mx-auto flex min-h-[calc(100vh-14rem)] w-full max-w-sm items-center py-8">
        <Card className="w-full shadow-lg">
          <CardHeader className="items-center space-y-1 text-center">
            <div className="mb-2 rounded-full bg-primary/10 p-3">
              <Shield className="h-6 w-6 text-primary" />
            </div>
            <CardTitle className="text-2xl">Admin Login</CardTitle>
            <CardDescription>
              Enter your credentials to access the admin panel
            </CardDescription>
          </CardHeader>
          <form onSubmit={submit}>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username">
                  Username
                </Label>
                <Input
                  id="username"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  autoFocus
                  autoComplete="username"
                  required
                  placeholder="Enter username"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">
                  Password
                </Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                  placeholder="Enter password"
                />
              </div>
            </CardContent>
            <CardFooter>
              <div className="grid w-full gap-2">
                <Button className="w-full" type="submit" disabled={isLoading}>
                  {isLoading ? 'Logging in...' : 'Login'}
                </Button>
                <Button variant="ghost" type="button" asChild>
                  <Link href="/">
                    <ArrowLeft className="h-4 w-4" />
                    Back to site
                  </Link>
                </Button>
              </div>
            </CardFooter>
          </form>
        </Card>
      </section>
    </AppShell>
  )
}
