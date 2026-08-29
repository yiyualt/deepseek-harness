import { copyFile, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.platform !== 'darwin') {
  throw new Error('sideload:mac is only supported on macOS')
}

const manifest = fileURLToPath(new URL('../manifest.xml', import.meta.url))
const directory = join(homedir(), 'Library/Containers/com.microsoft.Excel/Data/Documents/wef')
const target = join(directory, 'dsh-office-addin.xml')
await mkdir(directory, { recursive: true })
await copyFile(manifest, target)
console.log(`Sideloaded DSH Excel Add-in manifest to ${target}`)
console.log('Restart Microsoft Excel, then open Home > Add-ins > DeepSeek Harness for Excel.')
