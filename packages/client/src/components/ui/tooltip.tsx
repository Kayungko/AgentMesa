import { useEffect, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';

/**
 * Tooltip — a float-above-everything hover hint.
 *
 * The old implementation was a `[data-tooltip]::after` pseudo-element. Because
 * each IconButton sits inside a parent stacking context (.rail z=4, .titlebar
 * z=5, panels z=0), the pseudo-element's `z-index` was trapped there — a rail
 * tooltip could never paint above the titlebar or a modal. By mounting a
 * `position: fixed` node to `document.body` with a top-tier z-index, the tooltip
 * escapes every ancestor stacking context and always renders on top.
 */

const TOOLTIP_Z = 90; // above toast (60), workspace menu (30), modal (20)

export function Tooltip({ label, anchor }: { label: string; anchor: HTMLElement | null }) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!anchor) {
      setPos(null);
      return;
    }
    const place = () => {
      const rect = anchor.getBoundingClientRect();
      // Anchor to the trigger's vertical center, right edge + 8px (matches the
      // previous rail-side placement).
      setPos({ top: rect.top + rect.height / 2, left: rect.right + 8 });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchor]);

  if (!anchor || !pos) return null;

  const style: CSSProperties = { top: pos.top, left: pos.left, zIndex: TOOLTIP_Z };
  return createPortal(
    <div className="tooltip" role="tooltip" style={style}>
      {label}
    </div>,
    document.body,
  );
}
