// Renders assets/src/icon.svg into the icons the apps need. Run with Electron:
//   npm run icons
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const root = path.join(__dirname, '..')
const svg = fs.readFileSync(path.join(root, 'assets/src/icon.svg'), 'utf8')
const a = (p) => path.join(root, p)

/** The icon at `size`, inset by `margin` (fraction of the size) with a soft shadow, like Mac icons. */
async function render(win, size, file, margin = 0) {
  const inner = size * (1 - margin * 2)
  const shadow = margin ? `filter: drop-shadow(0 ${size * 0.01}px ${size * 0.015}px rgba(0,0,0,.28));` : ''
  const html = `<html><body style="margin:0;background:transparent"><div style="width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center"><img style="width:${inner}px;height:${inner}px;${shadow}" src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}"></div></body></html>`
  win.setContentSize(size, size)
  await win.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`)
  await new Promise((r) => setTimeout(r, 150))
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size })
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, img.resize({ width: size, height: size }).toPNG())
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, frame: false, transparent: true, useContentSize: true, webPreferences: { offscreen: true }, width: 1024, height: 1024 })
  await render(win, 1024, a('desktop/build/icon.png'), 0.04)
  await render(win, 512, a('public/icon.png'), 0.0977)
  await render(win, 512, a('docs/icon.png'), 0.0977)
  await render(win, 64, a('public/favicon.png'), 0.04)
  await render(win, 1024, a('assets/icon.png'), 0)
  const set = a('desktop/build/icon.iconset')
  fs.rmSync(set, { recursive: true, force: true })
  for (const s of [16, 32, 128, 256, 512]) {
    await render(win, s, path.join(set, `icon_${s}x${s}.png`), 0.0977)
    await render(win, s * 2, path.join(set, `icon_${s}x${s}@2x.png`), 0.0977)
  }
  execFileSync('/usr/bin/iconutil', ['-c', 'icns', set, '-o', a('desktop/build/icon.icns')])
  fs.rmSync(set, { recursive: true, force: true })
  console.log('icons written')
  app.quit()
})
