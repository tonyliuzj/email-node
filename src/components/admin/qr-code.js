import { useMemo } from 'react'
import qrcode from 'qrcode-generator'

// Draws a QR code as plain SVG shapes (one square per dark module), so no markup is ever built from the
// text. It is drawn here in the browser: the two-factor secret inside it is not sent anywhere.
export function QrCode({ value, label, size = 192 }) {
  const { path, extent } = useMemo(() => {
    const code = qrcode(0, 'M')
    code.addData(value)
    code.make()

    const margin = 4 // the quiet zone scanners need around the code
    const modules = code.getModuleCount()
    let squares = ''
    for (let row = 0; row < modules; row += 1) {
      for (let column = 0; column < modules; column += 1) {
        if (code.isDark(row, column)) squares += `M${column + margin} ${row + margin}h1v1h-1z`
      }
    }
    return { path: squares, extent: modules + margin * 2 }
  }, [value])

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${extent} ${extent}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      className="rounded-md border"
      data-testid="totp-qr"
    >
      {/* Always black on white, even in dark mode, or scanners cannot read it. */}
      <rect width={extent} height={extent} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  )
}
