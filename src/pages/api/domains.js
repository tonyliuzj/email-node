import { getPublicDomains } from '../../lib/db'

export default function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET'])
    return res.status(405).end(`Method ${req.method} Not Allowed`)
  }

  try {
    return res.status(200).json(getPublicDomains())
  } catch (error) {
    console.error('Error fetching domains:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
