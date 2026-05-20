import { type FC, useCallback, useEffect, useRef, useState } from 'react';

interface Props {
  width: number;
  onWidthChange: (next: number) => void;
}

const MIN = 240;
const MAX = 480;

export const Sidebar: FC<Props> = ({ width, onWidthChange }) => {
  const [dragging, setDragging] = useState(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(width);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      setDragging(true);
      startXRef.current = e.clientX;
      startWidthRef.current = width;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [width],
  );

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const dx = e.clientX - startXRef.current;
      const next = Math.max(MIN, Math.min(MAX, startWidthRef.current + dx));
      onWidthChange(next);
    };
    const onUp = () => setDragging(false);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dragging, onWidthChange]);

  return (
    <aside
      style={{ width }}
      className="relative flex h-full shrink-0 flex-col border-r border-slate-800 bg-slate-900"
    >
      <div className="px-3 py-2 text-xs uppercase tracking-wide text-slate-500">Sessions</div>
      <div className="flex-1 overflow-y-auto px-3 py-2 text-sm text-slate-400">
        (no sessions yet)
      </div>
      <button
        type="button"
        onPointerDown={onPointerDown}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') onWidthChange(Math.max(MIN, width - 16));
          else if (e.key === 'ArrowRight') onWidthChange(Math.min(MAX, width + 16));
        }}
        aria-label="Resize sidebar"
        aria-orientation="vertical"
        className="absolute right-0 top-0 h-full w-1 cursor-col-resize bg-transparent hover:bg-blue-500/40"
      />
    </aside>
  );
};
