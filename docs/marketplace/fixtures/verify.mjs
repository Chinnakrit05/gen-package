// Validate development fixture data against the existing API schemas.
// This does not authenticate users, seed a database or call network services.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import path from 'node:path'
import { build } from 'esbuild'
import sharp from 'sharp'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const require = createRequire(path.join(root, 'package.json'))
const fixture = JSON.parse(fs.readFileSync(new URL('./phase-1.json', import.meta.url), 'utf8'))
fs.mkdirSync(path.join(root, 'tmp'), { recursive: true })
const temporary = fs.mkdtempSync(path.join(root, 'tmp/marketplace-fixture-'))

try {
  // Keep the schemas at their original source; do not copy a second contract.
  const entry = path.join(temporary, 'entry.ts')
  fs.writeFileSync(entry, [
    'export * from "../../server/modules/projects/validation";',
    'export * from "../../server/modules/projects/canonical";',
    'export { API_ERROR_CODES } from "../../shared/contracts/errors";',
  ].join('\n'))
  const output = path.join(temporary, 'validators.cjs')
  await build({
    entryPoints: [entry], outfile: output, bundle: true,
    platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent',
  })
  const v = require(output)
  const cases = fixture.cases
  for (const [name, testCase] of Object.entries(cases)) {
    assert.equal(typeof testCase.response.requestId, 'string', name)
    if (testCase.status >= 400) {
      assert(v.API_ERROR_CODES.includes(testCase.response.error.code), name)
      continue
    }
    const data = testCase.response.data
    assert(data && !testCase.response.error, name)
    if (name.startsWith('me.')) {
      for (const workspace of data.workspaces) {
        assert(['personal', 'team'].includes(workspace.kind), name)
        assert(fixture.memberships.some(member =>
          member.userId === data.user.id && member.workspaceId === workspace.id && member.role === workspace.role,
        ), name)
      }
    }
    if (name.startsWith('projects.page') || name === 'projects.empty') {
      assert(data.items.length <= 24, name)
      for (const item of data.items) {
        assert(!('document' in item) && !('history' in item) && !('assets' in item), name)
        v.projectListRowSchema.parse({
          project_id: item.id, workspace_id: item.workspaceId,
          project_name: item.name, project_revision: item.revision,
          project_updated_at: item.updatedAt,
        })
      }
      if (data.nextCursor) {
        const last = data.items.at(-1)
        assert.deepEqual(v.decodeProjectCursor(data.nextCursor), { updatedAt: last.updatedAt, id: last.id })
      }
    }
    if (name === 'projects.detail' || name.startsWith('projects.create')) v.cloudProjectSchema.parse(data)
    if (name.startsWith('projects.create')) v.createProjectInputSchema.parse(testCase.request.body)
    if (name.startsWith('projects.save')) {
      v.saveProjectInputSchema.parse(testCase.request.body)
      v.saveReceiptSchema.parse(data)
    }
    if (name === 'projects.delete') {
      v.deleteReceiptSchema.parse(data)
      v.operationIdSchema.parse(testCase.request.headers['idempotency-key'])
      v.expectedRevisionSchema.parse(testCase.request.headers['x-expected-revision'])
      assert(!('body' in testCase.request), name)
    }
    if (name.startsWith('thumbnails.') && name !== 'thumbnails.put') {
      v.projectThumbnailBatchSchema.parse(testCase.request.body)
      for (const item of data.items) {
        v.projectThumbnailImageRowSchema.parse({
          project_id: item.projectId, thumbnail_version: item.version,
          mime_type: item.mimeType, image_base64: item.imageBase64,
        })
      }
    }
    if (name === 'thumbnails.put') {
      v.putProjectThumbnailInputSchema.parse(testCase.request.body)
      v.projectThumbnailReceiptSchema.parse(data)
    }
  }
  assert.equal(cases['projects.page1'].response.data.items.length, 24)
  assert.equal(cases['projects.page2'].response.data.items.length, 1)
  assert.equal(cases['projects.page2'].response.data.nextCursor, null)
  assert.notEqual(
    cases['projects.page1'].response.data.items[0].thumbnail.version,
    cases['projects.page-thumbnail-updated'].response.data.items[0].thumbnail.version,
  )
  for (const operation of ['create', 'save']) {
    const original = cases['projects.' + operation]
    const retry = cases['projects.' + operation + '-retry']
    assert.deepEqual(original.request.body, retry.request.body)
    assert.deepEqual(original.response.data, retry.response.data)
  }
  const metadata = await sharp(Buffer.from(cases['thumbnails.put'].request.body.imageBase64, 'base64')).metadata()
  assert.equal(metadata.format, 'jpeg')
  assert.equal(metadata.width, 1)
  assert.equal(metadata.height, 1)
  console.log('PASS: ' + Object.keys(cases).length + ' synthetic scenarios; API schemas, pagination, retry and JPEG')
  console.log('NOT RUN: real Auth, PostgreSQL, browser integration and preview OAuth')
} finally {
  fs.rmSync(temporary, { recursive: true, force: true })
}
