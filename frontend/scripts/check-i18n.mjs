#!/usr/bin/env node
// Keep the interface in the catalog (#106): fail on literal user-facing text
// in JSX anywhere under src/. Every folder has been converted, so this is the
// whole tree -- new text has to go in src/i18n/en/ from the start.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { findLiterals } from './i18n-literals.mjs'

const CONVERTED = ['src']

const root = fileURLToPath(new URL('..', import.meta.url))

function* sources(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      if (name !== '__tests__' && name !== 'generated') yield* sources(path)
    } else if (name.endsWith('.tsx')) {
      yield path
    }
  }
}

let problems = 0
for (const folder of CONVERTED) {
  for (const path of sources(join(root, folder))) {
    for (const { line, column, text } of findLiterals(readFileSync(path, 'utf8'), path)) {
      problems += 1
      console.log(`${relative(root, path)}:${line}:${column}  literal text: ${JSON.stringify(text)}`)
    }
  }
}

if (problems > 0) {
  console.log(
    `\n${problems} literal string${problems === 1 ? '' : 's'} in converted folders. ` +
      'Put the text in src/i18n/en/ and use t(); see src/i18n/index.ts.',
  )
  process.exit(1)
}
console.log(`No literal UI text in ${CONVERTED.join(', ')}.`)
