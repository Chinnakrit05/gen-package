import { constants } from 'node:fs'
import { copyFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const target = resolve('.env.local')
try {
  await copyFile(new URL('../.env.cloud.example', import.meta.url), target, constants.COPYFILE_EXCL)
  console.log('Created .env.local from .env.cloud.example (no credentials included).')
  console.log('Fill both Supabase URLs and keys, then run npm run dev.')
  console.log('See docs/backend-setup.md for access, migrations, buckets and Google OAuth.')
} catch (error) {
  if (error.code === 'EEXIST') {
    console.log('.env.local already exists; nothing was overwritten or printed.')
    console.log('Compare it with .env.cloud.example manually. For a key-free demo: npm run dev:local')
  } else {
    // Do not dump environment values or existing file contents on failure.
    console.error(`Could not create .env.local (${error.code ?? 'unknown error'}). Check folder permissions.`)
    process.exitCode = 1
  }
}
