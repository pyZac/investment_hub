import Image from "next/image";
import type { ReactNode } from "react";

/**
 * Full-width hero used by all 4 public pages, each with its own photo. A
 * dark gradient overlay (top -> bottom, stronger at the bottom where the
 * text sits) keeps light foreground text legible over an arbitrary photo,
 * matching this project's dark-only design system (see globals.css) rather
 * than relying on the photo itself always being dark enough at that spot.
 */
export function PublicHero({
  imageSrc,
  imageAlt,
  imagePosition = "center",
  headline,
  subheadline,
  cta,
}: {
  imageSrc: string;
  imageAlt: string;
  /** CSS `object-position` for the hero photo — tune per-image when the
   * subject isn't centered (e.g. a portrait photo whose subject sits in
   * the upper half). Defaults to "center", which suits any landscape
   * photo with no strong off-center subject. */
  imagePosition?: string;
  headline: string;
  subheadline?: string;
  cta?: ReactNode;
}) {
  return (
    <div className="relative flex h-[70vh] min-h-[420px] w-full items-end overflow-hidden">
      <Image
        src={imageSrc}
        alt={imageAlt}
        fill
        priority
        sizes="100vw"
        className="object-cover"
        style={{ objectPosition: imagePosition }}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-background/10" />
      <div className="relative mx-auto w-full max-w-6xl space-y-4 px-6 pb-14 lg:px-8">
        <h1 className="max-w-3xl font-heading text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
          {headline}
        </h1>
        {subheadline && (
          <p className="max-w-2xl text-base text-foreground/90 sm:text-lg">{subheadline}</p>
        )}
        {cta && <div className="pt-2">{cta}</div>}
      </div>
    </div>
  );
}
