import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { launch, packageBin, quoteWindowsArg } from '../src/platform.js'
import { tscArgs } from '../src/verify/tsc.js'

describe('launching on macOS / Linux (unchanged)', () => {
  it('spawns commands and package bins directly', () => {
    expect(launch('pnpm', ['add', 'dayjs'], 'darwin')).toEqual({ command: 'pnpm', args: ['add', 'dayjs'] })
    expect(launch('pnpm', ['add', 'dayjs'], 'linux')).toEqual({ command: 'pnpm', args: ['add', 'dayjs'] })
    expect(packageBin('/w', 'vite', 'darwin')).toEqual([join('/w', 'node_modules', '.bin', 'vite')])
    expect(packageBin('/w', 'tsc', 'linux')).toEqual([join('/w', 'node_modules', '.bin', 'tsc')])
  })
})

describe('launching on Windows (command lines only; not run on Windows yet)', () => {
  it('runs a bare pnpm / npm through cmd.exe with a verbatim, quoted command line', () => {
    const l = launch('pnpm', ['add', '--ignore-scripts', 'recharts@^3.9.2'], 'win32', { ComSpec: 'C:\\Windows\\system32\\cmd.exe' })
    expect(l.command).toBe('C:\\Windows\\system32\\cmd.exe')
    expect(l.windowsVerbatimArguments).toBe(true)
    expect(l.args.slice(0, 3)).toEqual(['/d', '/s', '/c'])
    // ^ escapes cmd metacharacters (the caret in a version range included), quotes keep spaces.
    expect(l.args[3]).toBe('"pnpm ^"add^" ^"--ignore-scripts^" ^"recharts@^^3.9.2^""')
  })

  it('spawns paths and .exe files directly, even on Windows', () => {
    expect(launch('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', ['--headless=new'], 'win32')).toEqual({
      command: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      args: ['--headless=new'],
    })
    expect(launch('node.exe', ['x.js'], 'win32').command).toBe('node.exe')
  })

  it('quotes arguments the way the Windows C runtime parses them, then escapes cmd metacharacters', () => {
    expect(quoteWindowsArg('plain')).toBe('^"plain^"')
    expect(quoteWindowsArg('two words')).toBe('^"two^ words^"')
    expect(quoteWindowsArg('a"b')).toBe('^"a\\^"b^"')
    expect(quoteWindowsArg('C:\\dir\\')).toBe('^"C:\\dir\\\\^"') // trailing backslash doubled before the closing quote
    expect(quoteWindowsArg('x & del *')).toBe('^"x^ ^&^ del^ ^*^"')
    expect(quoteWindowsArg('100%')).toBe('^"100^%^"')
  })

  it('runs vite and tsc from their JavaScript entries with node (no .cmd shim)', () => {
    expect(packageBin('C:\\w', 'vite', 'win32')).toEqual(['node', join('C:\\w', 'node_modules', 'vite', 'bin', 'vite.js')])
    expect(packageBin('C:\\w', 'tsc', 'win32')).toEqual(['node', join('C:\\w', 'node_modules', 'typescript', 'bin', 'tsc')])
    // tsc: the workspace's own TypeScript when it has one, else a global tsc.
    expect(tscArgs('C:\\no-such-workspace', 'win32').command).toBe('tsc')
    const ws = mkdtempSync(join(tmpdir(), 'ts-'))
    mkdirSync(join(ws, 'node_modules', 'typescript', 'bin'), { recursive: true })
    writeFileSync(join(ws, 'node_modules', 'typescript', 'bin', 'tsc'), '')
    const t = tscArgs(ws, 'win32')
    expect(t.command).toBe('node')
    expect(t.args[0]).toBe(join(ws, 'node_modules', 'typescript', 'bin', 'tsc'))
    expect(t.args).toContain('--noEmit')
  })
})
