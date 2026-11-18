# Chugao Visual System

The canonical color values live in `styles/tokens.css`. All routes, workspace shells, dialogs, menus, and canvas controls inherit them. Do not redefine a theme on a page wrapper.

## Colors

- Use `bg-background` for the page, `bg-surface` for controls and framed tools, and `bg-surface-2` for hover or secondary surfaces.
- Use `text-foreground`, `text-text-muted`, and `text-text-faint` for the three text levels.
- Use `border-border` for separators and the `--control-border` token for inputs.
- Brand green identifies primary actions and selection. Pair filled brand backgrounds with `text-on-accent`.
- Success, danger, warning, and info describe status. Do not use a different semantic color just to decorate each page.
- User-selected accent colors remain supported and apply to the entire app, including portaled content.
- Keep artwork colors and image overlays independent of the surrounding UI theme.

## Controls and Layout

Use the shared components in `components/ui`.

- Compact controls: 32px. Default controls: 36px. Large controls: 44px.
- Corners: 4px for small elements, 6px for controls, 8px for cards and dialogs. Circles are reserved for avatars, swatches, radio controls, and status dots.
- Borders: 1px. Shadows are subtle and primarily distinguish floating menus, toolbars, and dialogs.
- Page sections use headings, spacing, and separators. Individual results and genuinely framed tools may use cards; avoid nesting cards.
- Page padding: 16px on narrow screens, 24px on desktop. Sections use 24px spacing; related controls use 8px gaps.
- Canvas tools float above the drawing area. Opening a tool panel does not shrink the canvas.
- Prefer Lucide icons and accessible labels for tool commands. Keep visible focus, hover, selected, disabled, and loading states.

## Sources

- `styles/tokens.css`: colors, spacing, radii, motion, shadows.
- `styles/typography.css`: typography defaults and compatibility classes.
- `app/globals.css`: page headers and shared layout helpers.
- `components/ui`: reusable controls.
- `components/studio/comfyart/canvas.css`: tldraw UI token adapter; artwork is unchanged.
