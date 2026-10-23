# 08: UI Design System

Premium corporate: sapphire and gold on ivory, card-based, Inter type. This comes from the supplied design brief (a logistics dashboard) and is adapted to Freshroots screens. Follow the tokens exactly.

## Tokens
| Token | Value | Use |
|---|---|---|
| `--sapphire` | `#002D72` | Primary, headings, nav text, secondary button outline |
| `--gold` | `#F9A825` | Primary action, highlights, active markers, active nav underline |
| `--emerald` | `#10B981` | Success, completed steps, accepted |
| `--royal` | `#1E88E5` | Links, active mobile tab |
| `--ivory` | `#FFF8E1` | **Page background (required, avoids a sterile look)** |
| `--border` | `#E0DDD6` | All borders, 1px solid |
| `--surface` | `#FFFFFF` | Cards, header |
| `--highlight` | `#F4F1EC` | Highlight boxes inside cards |
| `--row-hover` | `#F9F8F6` | List row hover |
| `--track` | `#D1D5DB` | Timeline line, pending markers |
| `--muted-text` | `#666666` | Secondary text, inactive tab |
| `--danger-muted` | `#94504A` | **Derived.** Killed / rejected / error. Muted terracotta, never vibrant red. (Was `#A65D57`; darkened in Phase 7 because text on its own tint measured 3.9:1, below the 4.5:1 minimum.) |
| `--danger-muted-bg` | `#F3E4E2` | **Derived.** Tint behind muted danger pills and banners |
| `--royal-text` | `#0B5FA5` | **Derived (Phase 7).** `--royal` as small TEXT reaches only 3.7:1 on white. Link text uses this; `--royal` stays for the focus ring and icons |

`--danger-muted` and its tint are derived from the rule "do not use vibrant red; prefer muted tones". `--royal-text` is derived from the contrast rule below. Everything else is from the brief. `tests/ui/contrast.test.ts` computes the contrast of every text and background pair from these values.

## Typography (Inter)
| Style | Spec |
|---|---|
| H2 | 32px, 700 |
| H3 | 24px, 600 |
| Body | 14px, 400 |
| Label | 11px, 700, uppercase, letter-spacing 0.1em |
| Timeline step title | 14px, 700 |
| Timestamp | 10px, gray |
Use weights 400 to 800 for hierarchy. Load Inter with `next/font`.

## Components
**Card:** white background, 1px `--border`, radius 16px, shadow `0 1px 2px rgba(0,0,0,0.05)`. Card header: H3 title on the left, an action (primary button, secondary button, or royal link such as "View all") on the right.

**Buttons:** minimum height 44px, always. Primary: `--gold` background, `--sapphire` text, radius 10px, bold. Secondary: transparent with 2px `--sapphire` outline and sapphire text. Hover: `scale(1.02)` and opacity 0.9. Transitions 200ms ease-in-out (transform and opacity only).

**Status pill:** padding 6px 12px, pill radius, 11px / 700 / uppercase, tracking 0.05em to 0.1em.
| Variant | Style | Used for |
|---|---|---|
| Active | gold bg, sapphire text | STOCKOUT_RISK, active run step |
| Quoted | sapphire at 10% bg, sapphire text | HIGH_DEMAND, "pending review" |
| Expired | gray at 30% bg, gray 600 text | OVERSTOCK_RISK, AI fallback, placed |
| Success | emerald bg, **sapphire text** (the brief said white; white on emerald is only 2.5:1, sapphire is 5.6:1) | Accepted, green state, completed |
| Danger-muted | `--danger-muted-bg` bg, `--danger-muted` text | Rejected, killed, held |
| Needs judgment | white bg, gold 2px border, sapphire text | needs_judgment items |

**List widget:** vertical list, items separated by 1px `--border`; each row has a 14px bold title, 12px gray secondary text, and a right-aligned pill. Row hover background `--row-hover`. Used for the Review list, Orders list, run history, audit log.

**Highlight box:** `--highlight` background, 12px radius, used for the key numbers inside a card (for example the AI decision "Reorder 750 units").

**Vertical tracker** (the run pipeline): 2px line in `--track`, 16px circular markers. Completed: emerald with a check; segments between completed steps emerald. Active: gold circle with an arrow and a 4px soft ring. Pending: gray. Step title 14px bold, timestamp 10px gray.

**Cover bar** (Freshroots addition): a thin horizontal bar showing `cover_weeks` against the min-max band; band in `--highlight`, marker in sapphire, out-of-band marker in gold (or muted danger for overstock).

**KPI card:** label (11px uppercase), big number (H2), small note. Quarter-to-date loss shows two band lines at Rs 28L and Rs 34L.

**Alert banner:** full-width strip under the header. Kill 2 alert = gold tint with sapphire text. Killed = `--danger-muted-bg` with `--danger-muted` text. Both include the reason and a link.

## Layout
- Desktop: sticky 64px header (white, 1px bottom border). Logo in sapphire with a 32px icon container on the left. Centre nav links in 14px/600 sapphire; the active link has a 2px gold bottom border. Right: 40px circular avatar and a 12px bold uppercase name label.
- Nav by role: Raghav sees Run, Review, Dashboard. Procurement sees Orders, Dashboard. Priya sees Dashboard. Deepa and CEO see Dashboard, Kill and alerts, Audit.
- Main container: max-width 1200px, centred, background `--ivory`, padding 32px horizontal and 24px vertical. Two-column bento grid with 32px gap; stacks to one column on mobile.
- Mobile: fixed bottom bar, 72px, white, 1px top border. Four icons: Dashboard, Review, Orders, Account. Active = `--royal`, inactive = `--muted-text`. Labels 9px bold uppercase.

## Icons
Lucide, 24px in headers and 18px in actions.

## Rules
- Page background is always `--ivory`.
- No vibrant red anywhere. Use `--danger-muted` family.
- All pill badges have tracking-wider (0.05em to 0.1em).
- All buttons at least 44px tall.
- Animations: 200ms ease-in-out, transforms and opacity only.
- Accessibility: contrast checks on gold with sapphire text and on all pills; focus rings visible; every icon-only control has a label.

## Tailwind starting point
```ts
// tailwind.config.ts (extend)
colors: {
  sapphire: '#002D72', gold: '#F9A825', emerald: '#10B981', royal: '#1E88E5',
  ivory: '#FFF8E1', border: '#E0DDD6', highlight: '#F4F1EC', rowhover: '#F9F8F6',
  track: '#D1D5DB', mutedtext: '#666666', dangermuted: '#94504A', dangermutedbg: '#F3E4E2', royaltext: '#0B5FA5'
},
borderRadius: { card: '16px', btn: '10px', box: '12px' },
fontFamily: { sans: ['Inter', 'sans-serif'] }
```
