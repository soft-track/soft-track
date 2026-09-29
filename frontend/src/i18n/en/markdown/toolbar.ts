/** The formatting toolbar over the editor (#118): its buttons, its two menus, and the text it writes in. */
export const toolbar = {
  label: 'Formatting',
  // A button's name with its shortcut, e.g. "Bold (Ctrl+B)".
  withShortcut: '{{label}} ({{shortcut}})',
  textStyle: 'Text style',
  // The text-style picker, which shows the style it is on.
  textStyleIs: 'Text style: {{style}}',
  normal: 'Normal text',
  heading: 'Heading {{level}}',
  more: 'More formatting',
  commands: {
    heading: 'Heading',
    bold: 'Bold',
    italic: 'Italic',
    strikethrough: 'Strikethrough',
    bulletList: 'Bulleted list',
    numberedList: 'Numbered list',
    checklist: 'Checklist',
    link: 'Link',
    quote: 'Quote',
    code: 'Inline code',
    codeBlock: 'Code block',
    outdent: 'Outdent',
    indent: 'Indent',
    clear: 'Clear formatting',
  },
  // Written in, and selected, when a button has nothing selected to format.
  placeholders: {
    bold: 'bold text',
    italic: 'italic text',
    strikethrough: 'struck text',
    code: 'code',
    linkText: 'link text',
    url: 'url',
  },
} as const
