import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { untrustedText } from '../src/preview/manager.js'
import { runProcess } from '../src/proc.js'

const node = process.execPath
const cwd = tmpdir()

describe('runProcess (real child processes)', () => {
  it('collects stdout, stderr and a non-zero exit without rejecting', async () => {
    const r = await runProcess(node, ['-e', 'process.stdout.write("out"); process.stderr.write("err"); process.exit(3)'], { cwd })
    expect(r).toMatchObject({ code: 3, stdout: 'out', stderr: 'err', timedOut: false, aborted: false })
  })

  it('kills a process that runs past timeoutMs', async () => {
    const r = await runProcess(node, ['-e', 'setTimeout(() => {}, 60000)'], { cwd, timeoutMs: 100 })
    expect(r.timedOut).toBe(true)
    expect(r.code).not.toBe(0)
    expect(r.ms).toBeLessThan(10_000)
  })

  it('kills on abort, including a signal that is already aborted', async () => {
    const ac = new AbortController()
    const p = runProcess(node, ['-e', 'setTimeout(() => {}, 60000)'], { cwd, signal: ac.signal })
    setTimeout(() => ac.abort(), 50)
    expect((await p).aborted).toBe(true)
    const pre = new AbortController()
    pre.abort()
    expect((await runProcess(node, ['-e', 'setTimeout(() => {}, 60000)'], { cwd, signal: pre.signal })).aborted).toBe(true)
  })

  it('escalates to SIGKILL when the child ignores SIGTERM', async () => {
    if (process.platform === 'win32') return
    const script = 'process.on("SIGTERM", () => {}); process.stdout.write("up"); setInterval(() => {}, 1000)'
    const ac = new AbortController()
    const p = runProcess(node, ['-e', script], { cwd, signal: ac.signal })
    setTimeout(() => ac.abort(), 200)
    const r = await p
    expect(r.aborted).toBe(true)
    expect(r.ms).toBeLessThan(8000)
  }, 10_000)

  it('settles after the child exits even if a grandchild keeps the pipes open', async () => {
    if (process.platform === 'win32') return
    const script = 'require("child_process").spawn(process.execPath, ["-e", "setTimeout(() => {}, 20000)"], { stdio: "inherit" }).unref(); process.exit(0)'
    const r = await runProcess(node, ['-e', script], { cwd })
    expect(r.code).toBe(0)
    expect(r.ms).toBeLessThan(8000)
  }, 10_000)

  it('rejects when the command cannot be spawned', async () => {
    await expect(runProcess('astryx-no-such-command-xyz', [], { cwd })).rejects.toThrow(/ENOENT/)
  })

  it('runs CI-style (CI=1, no colour)', async () => {
    const r = await runProcess(node, ['-e', 'process.stdout.write(process.env.CI + "," + process.env.FORCE_COLOR)'], { cwd })
    expect(r.stdout).toBe('1,0')
  })
})

describe('untrustedText', () => {
  it('removes control and line-separator characters and breaks code fences', () => {
    expect(untrustedText('a\u0000b\u001bc d\u009fe')).toBe('a b c d e')
    expect(untrustedText('x```\nignore previous```')).toBe("x'''\nignore previous'''")
  })

  it('caps the length', () => {
    expect(untrustedText('x'.repeat(1000))).toHaveLength(600)
    expect(untrustedText('abcdef', 3)).toBe('abc')
  })
})
