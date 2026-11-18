# Chugao Typography

All routes use the Geist Sans stack and Chinese system fallbacks from `--font-stack-sans`. Geist Mono is reserved for code, identifiers, and technical values.

## Scale

| Use                        | Size | Weight    |
| -------------------------- | ---- | --------- |
| Page title                 | 24px | 600       |
| Compact page title         | 20px | 600       |
| Dialog title               | 16px | 600       |
| Section title              | 14px | 600       |
| Body and standard controls | 14px | 400 / 500 |
| Supporting text and labels | 12px | 400 / 500 |
| Dense metadata             | 11px | 400       |

Use zero letter spacing. Body line height is 1.5-1.6; headings use 1.25-1.3. Long labels wrap or truncate inside a width-constrained element. Do not scale UI fonts continuously with viewport width.

## Shared Classes

- `app-page-header`: wrapping title/action row with a bottom separator.
- `app-page-title`: page heading.
- `app-page-description`: supporting copy below a heading.
- `app-section-title`: compact section heading.
- `field-label`: form label.
- `eyebrow`: compact secondary label.

Native headings use the product scale. Use explicit display classes only on the public homepage. Existing `type-*` classes remain compatible; their colors, fonts, and spacing follow the shared system.

Use semantic headings in order. Paragraphs inherit the surrounding color and size so descriptions inside controls, dialogs, and messages do not unexpectedly expand.

Definitions live in `styles/typography.css` and `styles/tokens.css`. See `styles/COLOR_SYSTEM.md` for controls, color, and layout rules.
