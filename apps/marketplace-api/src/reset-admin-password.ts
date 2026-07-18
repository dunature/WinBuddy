import { randomUUID } from 'node:crypto'
import { resetMarketplaceAdminPassword } from './admin-auth'
import { createMarketplaceDatabase } from './database/client'

class ResetCliError extends Error {}

async function readPipedPasswords(): Promise<[string, string]> {
  process.stdout.write('新密码: \n确认新密码: \n')
  let source = ''
  for await (const chunk of process.stdin) source += String(chunk)
  const lines = source.split(/\r?\n/)
  return [lines[0] ?? '', lines[1] ?? '']
}

async function readHiddenLine(prompt: string): Promise<string> {
  const input = process.stdin
  const output = process.stdout
  output.write(prompt)
  return await new Promise<string>((resolve, reject) => {
    let value = ''
    const previousRaw = input.isRaw
    const finish = (error?: Error): void => {
      input.off('data', onData)
      input.setRawMode(previousRaw)
      input.pause()
      output.write('\n')
      if (error) reject(error)
      else resolve(value)
    }
    const onData = (chunk: Buffer | string): void => {
      for (const character of String(chunk)) {
        if (character === '\u0003') {
          finish(new ResetCliError('已取消密码重置'))
          return
        }
        if (character === '\r' || character === '\n') {
          finish()
          return
        }
        if (character === '\u007f' || character === '\b') {
          if (value) {
            value = [...value].slice(0, -1).join('')
            output.write('\b \b')
          }
          continue
        }
        if (character >= ' ' && character !== '\u007f') {
          value += character
          output.write('•')
        }
      }
    }
    input.setRawMode(true)
    input.resume()
    input.on('data', onData)
  })
}

async function readPasswords(): Promise<[string, string]> {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') return await readPipedPasswords()
  return [await readHiddenLine('新密码: '), await readHiddenLine('确认新密码: ')]
}

async function main(): Promise<void> {
  if (process.argv.length > 2) throw new ResetCliError('此命令不接受密码或其他命令参数')
  const databaseUrl = Bun.env.MARKETPLACE_DATABASE_URL?.trim()
  if (!databaseUrl) throw new ResetCliError('缺少 MARKETPLACE_DATABASE_URL')

  const [password, confirmation] = await readPasswords()
  if (password.length < 12) throw new ResetCliError('新密码至少需要 12 个字符')
  if (password !== confirmation) throw new ResetCliError('两次输入的密码不一致')

  const database = createMarketplaceDatabase(databaseUrl)
  try {
    await resetMarketplaceAdminPassword(database, { newPassword: password, requestId: randomUUID() })
  } finally {
    await database.sql.end()
  }
  process.stdout.write('管理员密码已重置；下次登录必须修改密码。\n')
}

try {
  await main()
} catch (error) {
  const message = error instanceof ResetCliError ? error.message : '管理员密码重置失败'
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
}
