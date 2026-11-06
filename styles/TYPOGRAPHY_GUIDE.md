# Typography System Guide
## Neo-Brutalism + Editorial Hybrid

This typography system implements a distinctive design direction combining neo-brutalist boldness with editorial refinement.

---

## Design Philosophy

### Core Characteristics

1. **Brutalist Backbone**
   - Heavy font weights (700 for display, 600 for headlines)
   - Tight line-height for impact (1.1-1.2 for large text)
   - Negative letter-spacing for density
   - Bold offset shadows and strokes

2. **Editorial Refinement**
   - Serif accents (Fraunces) for emphasis and numbers
   - Comfortable reading line-height (1.6) for body text
   - Intentional weight pairing across scales
   - Text-wrap utilities for polished layout

3. **Technical Precision**
   - Mono type (Geist Mono) for labels and code
   - Tabular numerals for data
   - Wide letter-spacing for uppercase labels
   - Consistent scale across breakpoints

---

## Type Scale

### Display Scale
**Purpose:** Hero headlines, main page titles  
**Font:** Geist Sans Bold (700)  
**Characteristics:** Maximum impact, tight leading

```tsx
<h1 className="type-display-xl">
  Build faster with AI
</h1>

<h1 className="type-display-lg">
  Feature Announcement
</h1>

<h2 className="type-display-md">
  Section Opener
</h2>
```

**Sizes:**
- `type-display-xl` → 60px (mobile: 36px)
- `type-display-lg` → 48px (mobile: 30px)
- `type-display-md` → 36px (mobile: 24px)

**Serif Variant:**
```tsx
<h1 className="type-display-lg type-display-serif">
  Editorial Headline
</h1>
```

---

### Headline Scale
**Purpose:** Section headers, card titles, subsections  
**Font:** Geist Sans Semibold (600)  
**Characteristics:** Snug leading, subtle negative tracking

```tsx
<h2 className="type-headline-lg">
  Features
</h2>

<h3 className="type-headline-md">
  Workbench Tools
</h3>

<h4 className="type-headline-sm">
  Card Title
</h4>
```

**Sizes:**
- `type-headline-lg` → 30px (mobile: 20px)
- `type-headline-md` → 24px
- `type-headline-sm` → 20px

---

### Body Scale
**Purpose:** Paragraph text, descriptions, UI copy  
**Font:** Geist Sans Regular (400)  
**Characteristics:** Comfortable reading, neutral tracking

```tsx
<p className="type-body-lg">
  Large body text for emphasis or lead paragraphs.
</p>

<p className="type-body-md">
  Standard body text for most content.
</p>

<p className="type-body-sm">
  Smaller body text for compact layouts.
</p>
```

**Sizes:**
- `type-body-lg` → 18px
- `type-body-md` → 16px
- `type-body-sm` → 14px

**Muted Variant:**
```tsx
<p className="type-body-md type-body-muted">
  Secondary information
</p>
```

---

### Caption Scale
**Purpose:** Metadata, timestamps, microcopy  
**Font:** Geist Sans Medium (500)  
**Characteristics:** Subtle positive tracking for legibility

```tsx
<span className="type-caption-lg">
  2 hours ago
</span>

<span className="type-caption-md">
  Badge text
</span>

<span className="type-caption-sm">
  Smallest metadata
</span>
```

**Sizes:**
- `type-caption-lg` → 13px
- `type-caption-md` → 12px
- `type-caption-sm` → 11px

---

### Label / Eyebrow Scale
**Purpose:** Form labels, categorical tags, navigation  
**Font:** Geist Mono Regular (400)  
**Characteristics:** Uppercase, wide tracking, technical

```tsx
<label className="type-label-lg">
  Email Address
</label>

<div className="type-label-md">
  Category Tag
</div>

<span className="type-label-sm">
  Status
</span>
```

**Sizes:**
- `type-label-lg` → 13px
- `type-label-md` → 12px
- `type-label-sm` → 11px

---

### Code / Mono Scale
**Purpose:** Code snippets, file paths, API responses  
**Font:** Geist Mono Regular (400)  
**Characteristics:** Tabular numerals, wider tracking

```tsx
<code className="type-code-lg">
  npm install @package
</code>

<code className="type-code-md">
  /api/users/{id}
</code>

<code className="type-code-sm">
  const value = 42;
</code>
```

**Sizes:**
- `type-code-lg` → 15px
- `type-code-md` → 14px
- `type-code-sm` → 13px

---

## Editorial Accents

### Serif Emphasis
**Purpose:** Pull quotes, decorative numbers, emphasis  
**Font:** Fraunces Serif Medium Italic (500/600)

```tsx
{/* Pull quote */}
<blockquote className="type-accent-quote">
  "This changed how we build products."
</blockquote>

{/* Decorative stat number */}
<div className="type-accent-number">
  99.9%
</div>

{/* Inline emphasis */}
<p className="type-body-lg">
  We focus on <span className="type-accent-emphasis">quality</span> 
  over quantity.
</p>
```

---

## Responsive Typography

### Fluid Scaling
For hero sections that adapt smoothly across viewports:

```tsx
<h1 className="type-fluid-hero">
  Scales from 36px to 60px
</h1>

<h2 className="type-fluid-headline">
  Scales from 20px to 30px
</h2>

<p className="type-fluid-body">
  Scales from 14px to 18px
</p>
```

---

## Utility Modifiers

### Weight Modifiers
```tsx
<p className="type-body-md type-bold">Bold text (700)</p>
<p className="type-body-md type-semibold">Semibold text (600)</p>
<p className="type-body-md type-medium">Medium text (500)</p>
```

### Layout Utilities
```tsx
{/* Balance lines for headlines */}
<h1 className="type-display-lg type-balance">
  Multi-line headline with balanced wrapping
</h1>

{/* Prevent orphans in paragraphs */}
<p className="type-body-md type-pretty">
  Long paragraph text that avoids orphaned words.
</p>

{/* Prevent wrapping */}
<span className="type-body-sm type-nowrap">
  No line breaks here
</span>

{/* Truncate with ellipsis */}
<div className="type-body-md type-truncate">
  Very long text that gets cut off...
</div>
```

### Gradient Effects
```tsx
{/* Subtle text gradient */}
<h1 className="type-display-lg type-gradient">
  Gradient Headline
</h1>

{/* Brand gradient */}
<h2 className="type-headline-lg type-gradient-brand">
  Brand Accent
</h2>
```

---

## Neo-Brutalism Effects

### Text Shadows
```tsx
{/* Outlined stroke effect */}
<h1 className="type-display-xl type-brutal-stroke">
  Heavy Stroke
</h1>

{/* Offset shadow */}
<h1 className="type-display-lg type-brutal-shadow">
  Brutal Shadow
</h1>

{/* Brand color shadow */}
<h2 className="type-headline-lg type-brutal-shadow-brand">
  Brand Shadow
</h2>
```

### Decorative Background Text
```tsx
<section className="relative">
  <div className="type-decoration" style={{ top: -40, right: 20 }}>
    01
  </div>
  <h2 className="type-headline-lg relative z-10">
    Feature Section
  </h2>
</section>
```

---

## Link Styles

### Standard Link
```tsx
<a href="#" className="type-link">
  Underlined link with smooth hover
</a>
```

### Brutalist Link
```tsx
<a href="#" className="type-link-brutal">
  Link with animated underline swipe
</a>
```

---

## Semantic HTML

The system automatically styles native HTML elements:

```html
<!-- Automatically styled as type-display-lg -->
<h1>Page Title</h1>

<!-- Automatically styled as type-headline-lg -->
<h2>Section Header</h2>

<!-- Automatically styled as type-body-md -->
<p>Paragraph text</p>

<!-- Styled code block -->
<pre><code>const value = 42;</code></pre>

<!-- Styled blockquote with serif italic -->
<blockquote>Pull quote text</blockquote>

<!-- Styled keyboard shortcut -->
<kbd>Cmd + K</kbd>

<!-- Styled highlight -->
<mark>Highlighted text</mark>
```

---

## Usage Patterns

### Hero Section
```tsx
<section className="page-shell py-24">
  <div className="type-label-md mb-4">New Feature</div>
  <h1 className="type-fluid-hero type-balance mb-6">
    Build products faster with AI
  </h1>
  <p className="type-fluid-body type-body-muted type-pretty max-w-2xl">
    Ship features in minutes, not days. Our AI workbench handles 
    the heavy lifting so you can focus on what matters.
  </p>
</section>
```

### Feature Card
```tsx
<div className="surface-panel p-6">
  <div className="type-accent-number mb-4">01</div>
  <h3 className="type-headline-md mb-3">
    Real-time Collaboration
  </h3>
  <p className="type-body-sm type-body-muted">
    Work together seamlessly with your team in a shared workspace.
  </p>
</div>
```

### Editorial Stat Block
```tsx
<div className="relative">
  <div className="type-decoration" style={{ top: -60, left: -40 }}>
    99
  </div>
  <div className="relative z-10">
    <div className="type-accent-number">99.9%</div>
    <div className="type-label-md mt-2">Uptime Guarantee</div>
    <p className="type-body-sm type-body-muted mt-4">
      Best-in-class reliability for mission-critical workloads.
    </p>
  </div>
</div>
```

### Form Label
```tsx
<div className="space-y-2">
  <label className="type-label-md block">
    Email Address
  </label>
  <input 
    type="email" 
    className="type-body-md w-full px-4 py-2"
    placeholder="you@example.com"
  />
  <p className="type-caption-md type-body-muted">
    We'll never share your email.
  </p>
</div>
```

### Code Block with Context
```tsx
<div className="space-y-2">
  <div className="type-label-sm">Installation</div>
  <pre><code className="type-code-md">npm install @acme/sdk</code></pre>
  <p className="type-caption-sm type-body-muted">
    Requires Node.js 18 or higher
  </p>
</div>
```

---

## Accessibility

### Screen Reader Support
All type classes preserve semantic HTML meaning. Use proper heading hierarchy:

```tsx
{/* Good */}
<h1 className="type-display-xl">Page Title</h1>
<h2 className="type-headline-lg">Section</h2>
<h3 className="type-headline-md">Subsection</h3>

{/* Bad - visual only, no semantic meaning */}
<div className="type-display-xl">Page Title</div>
```

### Focus States
All interactive text elements (links, buttons) have proper focus indicators via `--shadow-focus`.

### Reduced Motion
Typography animations are disabled when `prefers-reduced-motion: reduce` is detected.

---

## Breakpoint Behavior

The system automatically adjusts at key breakpoints:

**Mobile (max-width: 640px)**
- Display XL: 60px → 48px
- Display LG: 48px → 36px
- Headline LG: 30px → 24px
- Accent Number: 60px → 48px

**Small Mobile (max-width: 420px)**
- Display XL: 48px → 36px
- Display LG: 36px → 30px
- Headline LG: 24px → 20px

Fluid classes (`type-fluid-*`) scale smoothly without breakpoints.

---

## Design Tokens Reference

### Line Heights
- `--lh-display`: 1.1 (tight, for large display text)
- `--lh-headline`: 1.2 (snug, for section headers)
- `--lh-body`: 1.6 (comfortable reading)
- `--lh-caption`: 1.5 (compact metadata)
- `--lh-label`: 1.4 (form labels)

### Letter Spacing
- `--ls-display`: -0.04em (tight for impact)
- `--ls-headline`: -0.02em (subtle negative)
- `--ls-body`: 0 (neutral for readability)
- `--ls-caption`: 0.01em (slight positive for small text)
- `--ls-label`: 0.1em (wide for uppercase)

### Font Stacks
- `--font-stack-sans`: Geist, HarmonyOS Sans SC, system-ui
- `--font-stack-serif`: Fraunces, LXGW WenKai, Georgia
- `--font-stack-mono`: Geist Mono, JetBrains Mono, ui-monospace

---

## Best Practices

### Do's
✅ Use semantic HTML tags (`<h1>`, `<p>`, `<code>`)  
✅ Apply `type-balance` to multi-line headlines  
✅ Apply `type-pretty` to long paragraphs  
✅ Use serif accents sparingly for emphasis  
✅ Pair display weights with body weights for hierarchy  
✅ Use mono type for technical content and labels  

### Don'ts
❌ Don't skip heading levels (`<h1>` → `<h3>`)  
❌ Don't use display text for body copy  
❌ Don't mix too many type scales in one component  
❌ Don't ignore semantic meaning for visual styling  
❌ Don't overuse brutal effects (shadows, strokes)  
❌ Don't set text smaller than 11px  

---

## Migration from Old System

### Replace Generic Classes

**Old:**
```tsx
<h1 className="text-5xl font-bold">Title</h1>
<p className="text-base text-gray-400">Text</p>
<label className="text-xs uppercase">Label</label>
```

**New:**
```tsx
<h1 className="type-display-lg">Title</h1>
<p className="type-body-md type-body-muted">Text</p>
<label className="type-label-md">Label</label>
```

### Benefits
- Consistent vertical rhythm
- Automatic responsive scaling
- Proper font pairing (sans/serif/mono)
- Built-in brutalist effects
- Better semantic HTML
- Centralized design tokens

---

## Performance Notes

- Font files are preloaded via Google Fonts with `display=swap`
- Font weights loaded: 300, 400, 500, 600, 700 (only used weights)
- Chinese font fallback uses CDN-hosted subset
- All type classes use CSS custom properties for easy theming
- No JavaScript required for typography system

---

## Related Files

- `/styles/tokens.css` - Design tokens (colors, spacing, shadows)
- `/styles/typography.css` - Typography system (this file's source)
- `/app/globals.css` - Global styles and font imports
- `/styles/TYPOGRAPHY_GUIDE.md` - This documentation

---

## Support

For questions or issues with the typography system, check:
1. Token definitions in `tokens.css`
2. Class implementations in `typography.css`
3. Global font imports in `globals.css`
4. This guide for usage examples
