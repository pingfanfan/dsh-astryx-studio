import { transformSync, type Message } from 'esbuild'

export interface SyntaxError {
  readonly line: number
  readonly column: number
  readonly message: string
}

/** Millisecond syntax check: parse only, no type information. */
export function checkSyntax(source: string, file: string): SyntaxError[] {
  const loader = file.endsWith('.tsx') ? 'tsx' : 'ts'
  try {
    transformSync(source, { loader, sourcefile: file, logLevel: 'silent', jsx: 'automatic' })
    return []
  } catch (error) {
    const errors = (error as { errors?: Message[] }).errors
    if (!Array.isArray(errors)) return [{ line: 0, column: 0, message: String(error) }]
    return errors.map((e) => ({
      line: e.location?.line ?? 0,
      column: e.location?.column ?? 0,
      message: e.text,
    }))
  }
}
