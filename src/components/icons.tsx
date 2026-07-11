/**
 * src/components/icons.tsx
 *
 * Minimal stroke icon set (todo:ee098434) replacing the ASCII glyphs
 * (✓ ▶ ✕ ≡) that rendered differently per platform. 1.5px stroke on a
 * 16-unit grid, sized/colored by the parent via `size` + currentColor.
 */

interface IconProps {
  size?: number;
  strokeWidth?: number;
  className?: string;
}

function base({ size = 16, strokeWidth = 1.5, className }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    className,
  };
}

export function IconCheck(props: IconProps) {
  return <svg {...base(props)}><path d="M3 8.5 6.5 12 13 4.5" /></svg>;
}

export function IconChevronRight(props: IconProps & { style?: React.CSSProperties }) {
  const { style, ...rest } = props;
  return <svg {...base(rest)} style={style}><path d="M6 3.5 10.5 8 6 12.5" /></svg>;
}

export function IconMinus(props: IconProps) {
  return <svg {...base(props)}><path d="M3.5 8h9" /></svg>;
}

export function IconClose(props: IconProps) {
  return <svg {...base(props)}><path d="M4 4l8 8M12 4l-8 8" /></svg>;
}

export function IconMenu(props: IconProps) {
  return <svg {...base(props)}><path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" /></svg>;
}
