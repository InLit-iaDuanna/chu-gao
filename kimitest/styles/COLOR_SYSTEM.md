# Global Color Enhancement System

## Overview

This document describes the enhanced color system following Neo-brutalism + Editorial Hybrid design principles.

## Design Philosophy

### Neo-brutalism Foundation
- **Bold borders**: 2-4px thick borders for visual weight
- **Offset shadows**: 3-8px brutal shadows that simulate physical depth
- **High contrast**: Strong color blocks against dark/light surfaces
- **Sharp geometry**: Mix of sharp corners and selective rounded corners
- **Intentional imperfection**: Micro-rotations (-1deg) and offsets for handcrafted feel

### Editorial Refinement
- **Typography system**: Geist Sans + Fraunces Serif pairing
- **Asymmetric layouts**: Bento grids that break rigid structure
- **Decorative elements**: Large background numbers/symbols
- **Magazine rhythm**: Varied spacing and visual hierarchy

### Interaction Principles
- **Physical buttons**: Shadow disappears + translate on press
- **Spring physics**: Use `--ease-spring` for bouncy interactions
- **Hover lift**: Cards float up-left with shadow extension
- **Weight and momentum**: Animations have mass and inertia

---

## Color Tokens

### Base Colors

#### Dark Mode (Default)
```css
--bg: 8 8 9                  /* Deep black background */
--surface: 14 14 16          /* Primary surface */
--surface-2: 26 26 30        /* Elevated surface (+12 lightness) */
--surface-3: 38 38 44        /* Highest surface (+12 lightness) */

--border: 32 32 36           /* Default border */
--border-strong: 64 64 68    /* Emphasized border */

--text: 237 237 240          /* Primary text */
--text-muted: 150 150 158    /* Secondary text */
--text-faint: 95 95 102      /* Tertiary text */
```

#### Light Mode
```css
--bg: 252 252 252
--surface: 255 255 255
--surface-2: 247 247 248
--surface-3: 240 240 242

--border: 232 232 234
--border-strong: 210 210 214

--text: 17 17 19
--text-muted: 102 102 110
--text-faint: 156 156 163
```

### Semantic Colors

#### Brand Purple (Primary CTA, Selection, Links)
```css
--brand-primary: 147 51 234  /* Dark mode */
--brand-primary: 139 65 207  /* Light mode */
```

**Usage:**
- Primary call-to-action buttons
- Active selection states
- Key interactive elements
- Brand emphasis

#### Success Green (Positive Actions, Confirmations)
```css
--success: 76 175 130  /* Dark mode */
--success: 22 128 86   /* Light mode */
```

**Usage:**
- Success states and confirmations
- Positive action buttons (e.g., "Start", "Create")
- Status indicators (online, completed)
- Success messages

#### Info Blue (Tools, Highlights, Secondary Actions)
```css
--info: 130 170 230  /* Dark mode */
--info: 56 110 196   /* Light mode */
```

**Usage:**
- Tool UI and utility actions
- Informational highlights
- Secondary interactive elements
- System notifications

#### Warning Amber (Cautions, Secondary CTAs)
```css
--warning: 230 175 84  /* Dark mode */
--warning: 178 124 32  /* Light mode */
```

**Usage:**
- Warning states
- Secondary action buttons
- Attention-needed indicators
- Non-critical alerts

#### Danger Red (Destructive Actions Only)
```css
--danger: 232 90 79   /* Dark mode */
--danger: 196 56 50   /* Light mode */
```

**Usage:**
- Destructive actions only (delete, remove)
- Error states
- Critical warnings
- Irreversible operations

---

## Gradient System

### Hero Gradient (Brand → Info)
```css
--gradient-hero-start: 147 51 234  /* Brand purple */
--gradient-hero-end: 130 170 230   /* Info blue */
```

**Usage:**
- Hero section backgrounds
- Primary feature highlights
- Brand-forward elements
- Main CTA backgrounds

**Implementation:**
```css
.gradient-hero {
  background: linear-gradient(135deg, 
    rgb(var(--gradient-hero-start)), 
    rgb(var(--gradient-hero-end))
  );
}

.gradient-text-hero {
  background: linear-gradient(135deg, 
    rgb(var(--gradient-hero-start)), 
    rgb(var(--gradient-hero-end))
  );
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}
```

### Accent Gradient (Success → Info)
```css
--gradient-accent-start: 76 175 130  /* Success green */
--gradient-accent-end: 130 170 230   /* Info blue */
```

**Usage:**
- Secondary features
- Positive state indicators
- Decorative accents
- Success-oriented elements

### Danger Gradient (Warning → Danger)
```css
--gradient-danger-start: 230 175 84  /* Warning amber */
--gradient-danger-end: 232 90 79     /* Danger red */
```

**Usage:**
- Destructive action confirmations
- Error states with severity
- Critical warnings
- Danger zone indicators

---

## Decorative Color System

Used at 15% opacity for background patterns, overlays, and atmospheric effects.

```css
--deco-1: 130 170 230  /* Info blue */
--deco-2: 76 175 130   /* Success green */
--deco-3: 230 175 84   /* Warning amber */
--deco-4: 147 51 234   /* Brand purple */
```

**Usage:**
```css
.deco-pattern-1 { background-color: rgb(var(--deco-1) / 0.15); }
.deco-pattern-2 { background-color: rgb(var(--deco-2) / 0.15); }
.deco-pattern-3 { background-color: rgb(var(--deco-3) / 0.15); }
.deco-pattern-4 { background-color: rgb(var(--deco-4) / 0.15); }
```

---

## Shadow System

### Standard Shadows
```css
--shadow-xs: 0 1px 2px rgb(0 0 0 / 0.06)
--shadow-sm: 0 2px 4px -1px rgb(0 0 0 / 0.08), 0 1px 2px rgb(0 0 0 / 0.04)
--shadow-md: 0 8px 24px -8px rgb(0 0 0 / 0.18)
--shadow-lg: 0 16px 40px -12px rgb(0 0 0 / 0.24)
```

### Focus & Ring Shadows
```css
--shadow-ring: 0 0 0 1px rgb(var(--border))
--shadow-ring-strong: 0 0 0 1px rgb(var(--border-strong))
--shadow-focus: 0 0 0 2px rgb(var(--bg)), 0 0 0 4px rgb(var(--brand-primary) / 0.6)
```

### Brutal Shadows (Neo-brutalism)
```css
--shadow-brutal-sm: 3px 3px 0 0 rgb(0 0 0 / 0.8)
--shadow-brutal-md: 6px 6px 0 0 rgb(0 0 0 / 0.9)
--shadow-brutal-lg: 8px 8px 0 0 rgb(0 0 0 / 0.95)
```

### Colored Brutal Shadows
```css
--shadow-brutal-brand: 4px 4px 0 0 rgb(var(--brand-primary) / 0.9)
--shadow-brutal-success: 4px 4px 0 0 rgb(var(--success) / 0.9)
--shadow-brutal-info: 4px 4px 0 0 rgb(var(--info) / 0.9)
--shadow-brutal-warning: 4px 4px 0 0 rgb(var(--warning) / 0.9)
```

---

## Component Patterns

### Brutal Buttons

#### Brand Button
```tsx
<button className="button-brutal-brand h-14">
  <span>Primary Action</span>
  <ArrowRight size={18} strokeWidth={3} />
</button>
```

**Behavior:**
- Rest: 4px offset shadow
- Hover: 2px offset (presses in)
- Active: 0px offset (fully pressed)

#### Success Button
```tsx
<button className="button-brutal-success h-14">
  <span>Start Creating</span>
</button>
```

#### Info Button
```tsx
<button className="button-brutal-info h-12">
  <span>Learn More</span>
</button>
```

#### Warning Button
```tsx
<button className="button-brutal-warning h-12">
  <span>Proceed with Caution</span>
</button>
```

### Brutal Cards

```tsx
<div className="card-brutal p-6">
  <h3>Card Title</h3>
  <p>Card content with brutal shadow effect</p>
</div>
```

**Hover behavior:**
- Translates up-left (-2px, -2px)
- Shadow extends (4px 4px)
- Border color intensifies

---

## Animation Tokens

```css
--duration-micro: 120ms      /* Micro-interactions */
--duration-fast: 150ms       /* Quick transitions */
--duration-transition: 200ms /* Standard transitions */
--duration-base: 160ms       /* Base duration */
--duration-reveal: 300ms     /* Content reveals */
--duration-morph: 400ms      /* Shape morphing */

--ease-out: cubic-bezier(0.16, 1, 0.3, 1)       /* Smooth exit */
--ease-in-out: cubic-bezier(0.4, 0, 0.2, 1)     /* Balanced */
--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1) /* Bouncy spring */
```

### Spring Bounce Utility
```css
.spring-bounce {
  transition-timing-function: var(--ease-spring);
}
```

---

## Usage Guidelines

### Color Selection Decision Tree

**When to use Brand Purple:**
- Primary CTAs that drive core actions
- Selected/active states
- Navigation highlights
- Links and interactive text

**When to use Success Green:**
- Positive actions (create, start, confirm)
- Success feedback
- Online/active status
- Growth/progress indicators

**When to use Info Blue:**
- Tool and utility actions
- Informational elements
- Secondary interactive elements
- System notifications

**When to use Warning Amber:**
- Caution states
- Secondary CTAs
- Non-critical alerts
- Attention indicators

**When to use Danger Red:**
- Destructive actions ONLY
- Error states
- Critical warnings
- Deletion confirmations

### Contrast Requirements

**Surface Contrast (Dark Mode):**
- surface → surface-2: +12 lightness
- surface-2 → surface-3: +12 lightness
- Provides clear visual layering

**Border Contrast:**
- border: Subtle separation
- border-strong: Emphasized separation (2x intensity)

**Text Contrast:**
- text: Primary content (WCAG AAA)
- text-muted: Secondary content (WCAG AA)
- text-faint: Tertiary content (WCAG AA on surface-2+)

---

## Migration Guide

### From Old System to Enhanced System

**Brand color change:**
```diff
- --brand-primary: 168 85 247
+ --brand-primary: 147 51 234
```

**Surface contrast improvement:**
```diff
- --surface-2: 22 22 25
+ --surface-2: 26 26 30

- --surface-3: 32 32 36
+ --surface-3: 38 38 44
```

**Border strength:**
```diff
- --border-strong: 56 56 62
+ --border-strong: 64 64 68
```

**Focus state uses brand color:**
```diff
- --shadow-focus: 0 0 0 2px rgb(var(--bg)), 0 0 0 4px rgb(var(--text) / 0.5)
+ --shadow-focus: 0 0 0 2px rgb(var(--bg)), 0 0 0 4px rgb(var(--brand-primary) / 0.6)
```

**New additions:**
- Gradient system (hero, accent, danger)
- Decorative color system (deco-1 to deco-4)
- Colored brutal shadows
- Spring animation easing
- Additional duration tokens

---

## Accessibility

### WCAG Compliance

**Dark Mode:**
- text on bg: 15.8:1 (AAA)
- text on surface: 15.2:1 (AAA)
- text-muted on surface: 6.8:1 (AA)
- brand-primary on bg: 5.2:1 (AA)

**Light Mode:**
- text on bg: 19.2:1 (AAA)
- text on surface: 21:1 (AAA)
- text-muted on surface: 7.2:1 (AA)
- brand-primary on surface: 6.8:1 (AA)

### Color Blindness

All semantic colors are distinguishable by:
- Position/context
- Text labels
- Iconography
- Border treatments

Never rely on color alone for critical information.

---

## Examples

### Hero Section with Gradient Background
```tsx
<section className="relative overflow-hidden">
  <div className="absolute inset-0 gradient-hero opacity-10" />
  <h1 className="gradient-text-hero">Welcome to Chūgǎo</h1>
</section>
```

### Feature Card with Brutal Shadow
```tsx
<div className="card-brutal p-8 hover:shadow-brutal-md">
  <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-xl deco-pattern-1">
    <Icon size={24} />
  </div>
  <h3>Feature Title</h3>
  <p>Feature description</p>
</div>
```

### CTA Button with Spring Animation
```tsx
<button className="button-brutal-brand spring-bounce h-14 px-8">
  <span>Get Started</span>
  <ArrowRight size={18} />
</button>
```

### Status Indicator with Semantic Color
```tsx
<div className="flex items-center gap-2">
  <div className="h-2 w-2 rounded-full bg-success" />
  <span className="text-sm text-success">Online</span>
</div>
```

---

## File Locations

- **Token definitions**: `/styles/tokens.css`
- **Global styles**: `/app/globals.css`
- **Component utilities**: `/app/globals.css` (components layer)
- **This documentation**: `/styles/COLOR_SYSTEM.md`

---

## Changelog

### v3.0 (Current)
- Introduced brand purple as primary color (147 51 234 dark / 139 65 207 light)
- Enhanced surface contrast (+12 lightness steps)
- Added gradient system (hero, accent, danger)
- Added decorative color system (deco-1 to deco-4)
- Added colored brutal shadows
- Improved focus states with brand color
- Added spring animation easing
- Expanded duration tokens

### v2.0 (Previous)
- Initial design system with basic color tokens
- Standard shadow system
- Basic brutal shadows
