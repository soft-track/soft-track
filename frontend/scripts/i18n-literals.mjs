// The i18n guardrail's rules (#106), separate from the CLI so they can be
// tested. Plain JavaScript on purpose: it runs in CI with no build step.
import ts from 'typescript'

/** Attributes a person reads or hears. `className` and `data-*` are not text. */
const TEXT_ATTRIBUTES = new Set(['placeholder', 'title', 'aria-label', 'alt', 'label'])

/** Something with a word in it. Punctuation, digits and symbols are not copy. */
const WORD = /\p{L}{2,}/u

/** A line saying `i18n-ignore` exempts the line after it, for the rare real case. */
const IGNORE = 'i18n-ignore'

/**
 * Literal user-facing text in a TSX source: JSX text, string children, and
 * string values of the attributes above. Returns `{ line, column, text }`.
 */
export function findLiterals(source, fileName = 'file.tsx') {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const lines = source.split('\n')
  const found = []

  const report = (node, text) => {
    const { line, character } = file.getLineAndCharacterOfPosition(node.getStart(file))
    if (line > 0 && lines[line - 1].includes(IGNORE)) return
    if (lines[line].includes(IGNORE)) return
    found.push({ line: line + 1, column: character + 1, text: text.trim().slice(0, 60) })
  }

  const isLiteral = (node) =>
    ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)

  const visit = (node) => {
    if (ts.isJsxText(node) && WORD.test(node.text)) {
      report(node, node.text)
    } else if (
      ts.isJsxAttribute(node) &&
      TEXT_ATTRIBUTES.has(node.name.getText(file)) &&
      node.initializer
    ) {
      const value = ts.isJsxExpression(node.initializer)
        ? node.initializer.expression
        : node.initializer
      if (value && isLiteral(value) && WORD.test(value.text)) report(value, value.text)
    } else if (
      (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
      node.tagName.getText(file) === 'Trans'
    ) {
      // Values go into a string Trans parses as markup; without `userText`
      // a `<` in somebody's team name would be read as a tag.
      const props = node.attributes.properties
      const hasValues = props.some((p) => ts.isJsxAttribute(p) && p.name.getText(file) === 'values')
      const guarded = props.some(
        (p) => ts.isJsxSpreadAttribute(p) && p.expression.getText(file) === 'userText',
      )
      if (hasValues && !guarded) report(node, '<Trans values> without {...userText}')
    } else if (
      ts.isJsxExpression(node) &&
      node.expression &&
      isLiteral(node.expression) &&
      (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent)) &&
      WORD.test(node.expression.text)
    ) {
      report(node.expression, node.expression.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return found
}
