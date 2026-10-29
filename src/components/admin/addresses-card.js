import { useCallback, useEffect, useRef, useState } from 'react'
import { Clock, Search, Trash2, Users } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { Checkbox } from '../ui/checkbox'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Separator } from '../ui/separator'
import { Skeleton } from '../ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table'

// SQLite stores UTC as "YYYY-MM-DD HH:MM:SS".
function formatTimestamp(value) {
  if (!value) return 'Never'
  const date = new Date(`${String(value).replace(' ', 'T')}Z`)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 'es'}`

export function AddressesCard({ adminPath }) {
  const [data, setData] = useState({ rows: [], total: 0, page: 1, pageSize: 25, retentionDays: 0 })
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState(() => new Set())
  const [retention, setRetention] = useState('0')
  const retentionLoaded = useRef(false)

  // Wait for the admin to stop typing before searching.
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search.trim())
      setPage(1)
    }, 300)
    return () => clearTimeout(timer)
  }, [search])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), search: query })
      const res = await fetch(`/api/${adminPath}/addresses?${params}`)
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Failed to load addresses.')

      // The last row of the last page was just deleted: step back instead of showing an empty list.
      if (body.rows.length === 0 && body.total > 0 && page > 1) {
        setPage(Math.max(1, Math.ceil(body.total / body.pageSize)))
        return
      }

      setData(body)
      setSelected(new Set())
      if (!retentionLoaded.current) {
        retentionLoaded.current = true
        setRetention(String(body.retentionDays || 0))
      }
    } catch (error) {
      toast.error(error.message || 'Failed to load addresses.')
    } finally {
      setLoading(false)
    }
  }, [adminPath, page, query])

  useEffect(() => {
    load()
  }, [load])

  const post = async (method, body) => {
    const res = await fetch(`/api/${adminPath}/addresses`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const result = await res.json()
    if (!res.ok) throw new Error(result.error || 'Request failed.')
    return result
  }

  const removeAddresses = async ids => {
    const label = ids.length === 1 ? 'this address' : `these ${ids.length} addresses`
    if (!confirm(`Delete ${label}? Each one loses its passkey and sign-in for good.`)) return

    try {
      const { removed } = await post('DELETE', { ids })
      toast.success(`${removed} ${removed === 1 ? 'address' : 'addresses'} deleted.`)
      await load()
    } catch (error) {
      toast.error(error.message)
    }
  }

  const saveRetention = async event => {
    event.preventDefault()
    const days = Number.parseInt(retention, 10)
    if (!Number.isInteger(days) || days < 0 || days > 3650) {
      toast.error('Enter 0 to keep addresses forever, or a number of days from 1 to 3650.')
      return
    }

    try {
      if (days > 0) {
        const res = await fetch(`/api/${adminPath}/addresses?previewDays=${days}&pageSize=1`)
        const preview = await res.json()
        const count = Number(preview.previewInactive || 0)
        if (count > 0 && !confirm(
          `${plural(count, 'address')} not used for more than ${days} days will be deleted permanently. Continue?`
        )) {
          return
        }
      }

      await post('POST', { action: 'retention', days })
      toast.success(days ? `Addresses unused for ${days} days will now be deleted.` : 'Addresses are now kept forever.')
      await load()
    } catch (error) {
      toast.error(error.message)
    }
  }

  const purgeNow = async () => {
    try {
      const res = await fetch(`/api/${adminPath}/addresses?previewDays=${data.retentionDays}&pageSize=1`)
      const preview = await res.json()
      const count = Number(preview.previewInactive || 0)
      if (count === 0) {
        toast.success('No addresses are past the limit.')
        return
      }
      if (!confirm(`Delete ${plural(count, 'address')} not used for more than ${data.retentionDays} days now?`)) return

      const { removed } = await post('POST', { action: 'purge' })
      toast.success(`${removed} ${removed === 1 ? 'address' : 'addresses'} deleted.`)
      await load()
    } catch (error) {
      toast.error(error.message)
    }
  }

  const toggle = id => {
    setSelected(current => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const allSelected = data.rows.length > 0 && data.rows.every(row => selected.has(row.id))
  const pageCount = Math.max(1, Math.ceil(data.total / data.pageSize))

  return (
    <Card>
      <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            Addresses
          </CardTitle>
          <CardDescription>Every inbox address visitors have created. Remove abusive or unused ones.</CardDescription>
        </div>
        <Badge variant="secondary">{data.total} total</Badge>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              className="pl-9"
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Search addresses"
              aria-label="Search addresses"
            />
          </div>
          <Button
            variant="destructive"
            size="sm"
            disabled={selected.size === 0}
            onClick={() => removeAddresses([...selected])}
          >
            <Trash2 className="h-4 w-4" />
            Delete selected ({selected.size})
          </Button>
        </div>

        {loading && data.rows.length === 0 ? (
          <div className="space-y-2">
            {[0, 1, 2, 3].map(index => <Skeleton key={index} className="h-10 w-full" />)}
          </div>
        ) : data.rows.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={checked => setSelected(checked ? new Set(data.rows.map(row => row.id)) : new Set())}
                    aria-label="Select all addresses on this page"
                  />
                </TableHead>
                <TableHead>Address</TableHead>
                <TableHead className="hidden md:table-cell">Created</TableHead>
                <TableHead className="hidden sm:table-cell">Last active</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map(row => (
                <TableRow key={row.id}>
                  <TableCell>
                    <Checkbox
                      checked={selected.has(row.id)}
                      onCheckedChange={() => toggle(row.id)}
                      aria-label={`Select ${row.email_address}`}
                    />
                  </TableCell>
                  <TableCell className="max-w-[16rem] truncate font-medium">{row.email_address}</TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">{formatTimestamp(row.created_at)}</TableCell>
                  <TableCell className="hidden text-muted-foreground sm:table-cell">{formatTimestamp(row.last_active_at)}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeAddresses([row.id])}
                      title={`Delete ${row.email_address}`}
                      aria-label={`Delete ${row.email_address}`}
                    >
                      <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="flex min-h-[140px] flex-col items-center justify-center rounded-md border border-dashed p-6 text-center">
            <p className="font-semibold">{query ? 'No addresses match your search' : 'No addresses yet'}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {query ? 'Try a different search.' : 'They appear here as visitors create them.'}
            </p>
          </div>
        )}

        {data.total > data.pageSize ? (
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>Page {data.page} of {pageCount}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>
                Previous
              </Button>
              <Button variant="outline" size="sm" disabled={page >= pageCount || loading} onClick={() => setPage(page + 1)}>
                Next
              </Button>
            </div>
          </div>
        ) : null}

        <Separator />

        <form onSubmit={saveRetention} className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="address-retention" className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-primary" />
              Delete addresses after inactivity
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id="address-retention"
                type="number"
                min={0}
                max={3650}
                step={1}
                className="max-w-[8rem]"
                value={retention}
                onChange={event => setRetention(event.target.value)}
              />
              <span className="text-sm text-muted-foreground">days (0 keeps addresses forever)</span>
            </div>
            <p className="text-xs text-muted-foreground">
              An address counts as active when its owner signs in or opens the inbox. Mail arriving for it does not.
              Expired addresses are removed the next time someone uses the site, checked once an hour, and the name
              can then be registered again.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="outline">Save limit</Button>
            {data.retentionDays > 0 ? (
              <Button type="button" variant="outline" onClick={purgeNow}>
                Delete inactive addresses now
              </Button>
            ) : null}
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
