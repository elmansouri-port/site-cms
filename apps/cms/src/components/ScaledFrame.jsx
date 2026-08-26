/*
 * ScaledFrame — the page at a real device width, shrunk to fit.
 *
 * The editors used to give the iframe whatever width was left over after the
 * rails: about 700px in the page builder, 900px in the header editor. Both are
 * below the site's `lg:` breakpoint, so both were showing the *mobile* header
 * and footer — a hamburger menu — while claiming to show the desktop view.
 * Somebody editing the header saw a version most visitors never see.
 *
 * The fix is not a wider column, it is the standard one: render at the real
 * width and scale the result down with a CSS transform. 1440 logical pixels in a
 * 700px column is a legible 49% zoom, and the page inside is laid out exactly as
 * a 1440px browser would lay it out — same breakpoints, same wrapping, same
 * everything.
 *
 * The scale is reported back because anything drawn over the frame — the block
 * outline in the page builder — is positioned in the iframe's coordinates and
 * has to be multiplied by it.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export default function ScaledFrame({
  src,
  logicalWidth,
  frameRef,
  frameKey,
  title,
  onScale,
  onOffset,
  children,
}) {
  const wrap = useRef(null);
  const [box, setBox] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return undefined;
    const measure = () => setBox({ width: el.clientWidth, height: el.clientHeight });
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // A device narrower than the column is shown at 1:1 rather than blown up:
  // a mobile preview at 180% would misrepresent the type size.
  const scale = logicalWidth && box.width
    ? Math.min(1, box.width / logicalWidth)
    : 1;

  useEffect(() => { onScale?.(scale); }, [scale, onScale]);

  const frameWidth = logicalWidth || box.width || 0;
  // The transform scales from the top-left, so a device narrower than the column
  // has to be nudged into the middle by hand.
  const offset = Math.max(0, (box.width - frameWidth * scale) / 2);
  useEffect(() => { onOffset?.(offset); }, [offset, onOffset]);

  return (
    <div className="scaled" ref={wrap}>
      <div
        className="scaled__inner"
        style={{
          width: frameWidth || '100%',
          // The frame is rendered tall enough that, once scaled, it fills the
          // container: a fixed height is required because the frame is out of
          // flow, and `100%` of an absolutely positioned box is not the parent's.
          height: box.height && scale ? box.height / scale : '100%',
          transform: `translateX(${offset}px) scale(${scale})`,
          transformOrigin: 'top left',
        }}
      >
        <iframe
          key={frameKey}
          ref={frameRef}
          src={src}
          title={title}
          className="scaled__frame"
        />
      </div>
      {children}
      {scale < 0.999 && (
        <span className="scaled__zoom" aria-hidden="true">
          {logicalWidth}px · {Math.round(scale * 100)}%
        </span>
      )}
    </div>
  );
}
