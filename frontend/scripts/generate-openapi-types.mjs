import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const frontendDirectory = path.resolve(scriptDirectory, '..')
const npmCliDirectory = path.dirname(process.env.npm_execpath ?? '')
if (!process.env.npm_execpath) throw new Error('Run this script through npm run api:types.')
const args = [
  '--yes',
  '--package=openapi-typescript@7.13.0',
  '--package=typescript@5.9.3',
  'openapi-typescript',
  path.resolve(frontendDirectory, '..', 'backend', 'openapi.json'),
  '-o',
  path.resolve(frontendDirectory, 'src', 'lib', 'openapi.generated.ts'),
]

execFileSync(process.execPath, [path.join(npmCliDirectory, 'npx-cli.js'), ...args], {
  cwd: tmpdir(),
  stdio: 'inherit',
})
