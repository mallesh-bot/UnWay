import { useEffect, type RefObject } from "react";
import Lenis from "lenis";

/** Smooth, inertial scrolling for a scroll container (or the whole window when no ref is given). */
export function useSmoothScroll(wrapper?: RefObject<HTMLElement | null>, deps: unknown[] = []) {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const el = wrapper?.current;
    if (wrapper && !el) return;
    const lenis = new Lenis(el ? { wrapper: el, content: el.firstElementChild as HTMLElement, duration: 1.05, smoothWheel: true } : { duration: 1.15, smoothWheel: true });
    let raf = 0;
    const loop = (t: number) => { lenis.raf(t); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    (window as unknown as { __lenis?: Lenis }).__lenis = lenis;
    return () => { cancelAnimationFrame(raf); lenis.destroy(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
