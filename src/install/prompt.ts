/**
 * Zero-dependency single-select TTY prompt.
 */
export async function selectPrompt<T extends string>(opts: {
  message: string
  choices: Array<{ value: T; name: string }>
  defaultIndex?: number
}): Promise<T> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return opts.choices[opts.defaultIndex ?? 0]!.value
  }

  let cursor = opts.defaultIndex ?? 0
  const lines = opts.choices.length + 2

  const draw = (first = false) => {
    if (!first) process.stdout.write(`\x1b[${lines}A`)
    process.stdout.write('\x1b[0G\x1b[J')
    process.stdout.write(`${opts.message}\n`)
    process.stdout.write('  (↑↓ move · Enter confirm)\n')
    for (let index = 0; index < opts.choices.length; index += 1) {
      const choice = opts.choices[index]!
      const pointer = index === cursor ? '❯' : ' '
      const mark = index === cursor ? '●' : '○'
      process.stdout.write(` ${pointer} ${mark} ${choice.name}\n`)
    }
  }

  return new Promise((resolve, reject) => {
    const stdin = process.stdin
    const wasRaw = stdin.isRaw
    stdin.setRawMode?.(true)
    stdin.resume()
    stdin.setEncoding('utf8')
    draw(true)

    const cleanup = () => {
      stdin.off('data', onData)
      stdin.setRawMode?.(wasRaw ?? false)
      stdin.pause()
    }

    const onData = (key: string) => {
      if (key === '\u0003') {
        cleanup()
        process.stdout.write('\n')
        reject(new Error('cancelled'))
        return
      }
      if (key === '\r' || key === '\n') {
        cleanup()
        process.stdout.write('\n')
        resolve(opts.choices[cursor]!.value)
        return
      }
      if (key === '\u001b[A' || key === 'k') {
        cursor = (cursor - 1 + opts.choices.length) % opts.choices.length
        draw()
        return
      }
      if (key === '\u001b[B' || key === 'j') {
        cursor = (cursor + 1) % opts.choices.length
        draw()
      }
    }

    stdin.on('data', onData)
  })
}
