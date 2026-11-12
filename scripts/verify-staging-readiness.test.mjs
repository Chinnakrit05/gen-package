import test from 'node:test'
import assert from 'node:assert/strict'
import { parseMigrationRows, compareMigrationHistory } from './verify-staging-readiness.mjs'

const a = '20260918000100', b = '20261027000900', c = '20261108001500', d = '20261108001600'
const rows = [{ local: a, remote: a }, { local: b, remote: '' }, { local: c, remote: c }, { local: d, remote: '' }]

test('accepts current CLI backtick table with missing remote versions', () => {
  const table = ` Local | Remote | Time (UTC)\n-------|--------|-----------\n\`${a}\` | \`${a}\` | \`2026-09-18 00:01:00\`\n\`${b}\` | \` \` | \`2026-10-27 00:09:00\`\n\`${c}\` | \`${c}\` | \`2026-11-08 00:15:00\`\n\`${d}\` | \` \` | \`2026-11-08 00:16:00\``
  assert.deepEqual(parseMigrationRows(table), rows)
})
test('accepts plain table with outer pipes and Windows newlines', () => {
  assert.deepEqual(parseMigrationRows(`| Local | Remote | Time (UTC) |\r\n| --- | --- | --- |\r\n| ${a} | ${a} | date |`), [rows[0]])
})
test('accepts documented JSON shapes and null empty versions', () => {
  assert.deepEqual(parseMigrationRows(JSON.stringify(rows)), rows)
  assert.deepEqual(parseMigrationRows(JSON.stringify({ migrations: [{ local: a, remote: null }] })), [{ local: a, remote: '' }])
})
test('separates historical gaps from tail migrations', () => {
  assert.deepEqual(compareMigrationHistory([a,b,c,d], rows), { remoteOnly: [], historicalGaps: [b], pending: [d], ready: false })
})
test('accepts exact parity only', () => {
  assert.equal(compareMigrationHistory([a], [rows[0]]).ready, true)
  assert.equal(compareMigrationHistory([a], [{ local:a, remote:'' }]).ready, false)
})
test('remote-only migration blocks readiness', () => {
  assert.deepEqual(compareMigrationHistory([a], [rows[0], { local:'', remote:b }]).remoteOnly, [b])
})
test('CLI local/repository mismatch and bad manifest are rejected', () => {
  assert.throws(() => compareMigrationHistory([a,b], [rows[0]]))
  assert.throws(() => compareMigrationHistory([a,a], [rows[0]]))
  assert.throws(() => compareMigrationHistory([], []))
})
for (const bad of ['not a table', '{}', '[]', '{bad', 'Local | Remote | Time (UTC)\n-----|-----|-----', 'Local | Remote | Time (UTC)\ninvalid | value | time', `Local | Remote | Time (UTC)\n${a} | ${a} | time\nwarning not a row`, JSON.stringify([rows[0], rows[0]]), JSON.stringify([{local:a,remote:b}]), JSON.stringify([{local:'',remote:''}]), JSON.stringify([{local:123,remote:null}])]) {
  test(`rejects malformed or ambiguous output: ${bad.slice(0,65)}`, () => assert.throws(() => parseMigrationRows(bad)))
}

test('preserves a blank local column for remote-only table rows', () => {
  assert.deepEqual(parseMigrationRows(`Local | Remote | Time (UTC)\n | ${a} | date`), [{local:'',remote:a}])
})
