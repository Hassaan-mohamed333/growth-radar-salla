// Brand assets, one place. Files live in public/brand/ (generated from the approved logo):
//   logo.png       512px, mark + "Growth Radar / راصد" wordmark (sign-in, error pages)
//   logo-mark.png  128px, the circle-and-arrow mark alone (sidebar, mobile header)
// Favicon and Apple touch icon are app/icon.png and app/apple-icon.png (Next picks them up).
//
// The images are already sized for their slots, so next/image optimisation is skipped: it would
// only add a runtime dependency (sharp) on self-hosted deployments for no saving.

import Image from 'next/image';

/** The mark alone, e.g. for the mobile header. Decorative unless `label` is given. */
export function BrandMark({ size = 36, label }: { size?: number; label?: string }) {
  return (
    <Image
      src="/brand/logo-mark.png"
      alt={label ?? ''}
      width={size}
      height={size}
      unoptimized
      priority
      className="shrink-0 rounded-lg"
    />
  );
}

/** Mark + the Arabic name, for the sidebar. The visible text names it, so the image is decorative. */
export function BrandLogo({ size = 36 }: { size?: number }) {
  return (
    <span className="flex items-center gap-3">
      <BrandMark size={size} />
      <span className="text-xl font-bold text-brand-dark">راصد</span>
    </span>
  );
}

/** The full logo with its wordmark. */
export function BrandLogoFull({ size = 160 }: { size?: number }) {
  return (
    <Image
      src="/brand/logo.png"
      alt="راصد — Growth Radar"
      width={size}
      height={size}
      unoptimized
      priority
      className="mx-auto rounded-2xl"
    />
  );
}
