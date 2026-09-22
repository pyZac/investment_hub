"use client";

import { useMemo, useRef, useState, useLayoutEffect } from "react";
import Tree, { type CustomNodeElementProps, type RawNodeDatum } from "react-d3-tree";
import { useTranslations } from "next-intl";
import { Network } from "lucide-react";
import { Card } from "@/components/ui/card";
import { toDisplayWithCurrency } from "@/lib/display";

/**
 * Client-facing mirror of `SubtreeNode` (@/lib/binary-tree) with
 * `personalBv` already converted to a display-ready Decimal string at the
 * server/client boundary — a `Prisma.Decimal` never crosses into a "use
 * client" component, same convention as every other server->client money
 * value in this app (page.tsx converts via `toDisplay`/`toDisplayWithCurrency`
 * before handing props to a client component).
 */
export type ClientSubtreeNode = {
  userId: string;
  name: string;
  position: "LEFT" | "RIGHT" | null;
  personalBv: string;
  children: ClientSubtreeNode[];
};

type NodeAttributes = {
  position: "LEFT" | "RIGHT" | "ROOT";
  personalBv: string;
};

// react-d3-tree renders into raw SVG presentation attributes, which do not
// resolve `var(--color-*)` CSS custom properties (see lessons.md's SCRUM-92
// entry) — literal hex values matching globals.css's dark-theme tokens,
// same convention as daily-profit-chart.tsx's CHART_* constants.
const TREE_CARD = "#0d2c2b";
const TREE_BORDER = "#203b37";
const TREE_FOREGROUND = "#f4f5f1";
const TREE_MUTED_FOREGROUND = "#8d9b98";
const TREE_BRAND = "#70c9aa"; // LEFT — brand mint, chart-1
const TREE_ACCENT = "#5fb3d9"; // RIGHT — chart-5, a distinct accent from brand
const TREE_BRAND_FOREGROUND = "#06201f";

/**
 * Converts the server-fetched subtree (a plain nested object, LEFT/RIGHT
 * position read directly from binary_nodes.position) into react-d3-tree's
 * own RawNodeDatum shape. The `position` attribute here is copied verbatim
 * from the source data — never inferred from array order, recursion order,
 * or anything about how react-d3-tree lays the node out visually.
 */
function toRawNodeDatum(node: ClientSubtreeNode, isRoot: boolean): RawNodeDatum {
  return {
    name: node.name,
    attributes: {
      position: isRoot ? "ROOT" : (node.position ?? "ROOT"),
      personalBv: node.personalBv,
    } satisfies NodeAttributes,
    children: node.children.map((child) => toRawNodeDatum(child, false)),
  };
}

function CustomNode({ nodeDatum, mirrored }: CustomNodeElementProps & { mirrored: boolean }) {
  const position = (nodeDatum.attributes?.position as NodeAttributes["position"] | undefined) ?? "ROOT";
  const personalBv = (nodeDatum.attributes?.personalBv as NodeAttributes["personalBv"] | undefined) ?? "0";

  const badgeColor = position === "LEFT" ? TREE_BRAND : position === "RIGHT" ? TREE_ACCENT : TREE_MUTED_FOREGROUND;
  // RIGHT's chart-5 accent is a light blue, readable with dark text like
  // brand mint; ROOT's muted gray needs the app's near-white foreground
  // instead, matching the badge/status-chip contrast convention used
  // elsewhere (Badge's `success`/`warning` variants use colored text on a
  // tinted background rather than white-on-solid, but a tiny 10px SVG badge
  // needs a solid fill to stay legible at that size, so this keeps the solid
  // -fill treatment and just picks a contrast-safe text color per fill).
  const badgeTextColor = position === "ROOT" ? TREE_FOREGROUND : TREE_BRAND_FOREGROUND;

  return (
    <g>
      <circle r={10} fill={TREE_CARD} stroke={TREE_BORDER} strokeWidth={1.5} />
      {/* Counter-flip the text/label group so it reads correctly even when the
          whole SVG container is mirrored for RTL — this is a pixel-level
          correction only, the underlying `position` value above is untouched. */}
      <g transform={mirrored ? "scale(-1, 1)" : undefined}>
        <foreignObject x={-70} y={16} width={140} height={70}>
          <div className="flex flex-col items-center gap-1 text-center" style={{ direction: "ltr" }}>
            <span
              className="truncate font-heading text-xs font-medium"
              style={{ color: TREE_FOREGROUND }}
            >
              {nodeDatum.name}
            </span>
            {position !== "ROOT" && (
              <span
                className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                style={{ backgroundColor: badgeColor, color: badgeTextColor }}
              >
                {position}
              </span>
            )}
            <span className="text-[10px]" style={{ color: TREE_MUTED_FOREGROUND }}>
              BV: {toDisplayWithCurrency(personalBv)}
            </span>
          </div>
        </foreignObject>
      </g>
    </g>
  );
}

export function BinaryTreeView({ subtree, locale }: { subtree: ClientSubtreeNode | null; locale: string }) {
  const t = useTranslations("BinaryTree");
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  const mirrored = locale === "ar";

  useLayoutEffect(() => {
    if (!containerRef.current) return;
    const { width, height } = containerRef.current.getBoundingClientRect();
    setDimensions({ width, height });
  }, []);

  const data = useMemo(() => (subtree ? toRawNodeDatum(subtree, true) : null), [subtree]);

  if (!subtree || !data) {
    return (
      <Card className="border-border/60">
        <div className="flex flex-col items-center justify-center gap-3 py-14 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-muted/60 text-muted-foreground">
            <Network className="size-6" aria-hidden="true" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium">{t("emptyStateTitle")}</p>
            <p className="max-w-sm text-sm text-muted-foreground">{t("emptyStateDescription")}</p>
          </div>
        </div>
      </Card>
    );
  }

  const hasDownline = subtree.children.length > 0;

  return (
    <div className="space-y-4">
      <Card
        ref={containerRef}
        className="h-[520px] w-full overflow-hidden border-border/60 p-0"
      >
        {dimensions.width > 0 && (
          <div
            className="h-full w-full"
            style={{ transform: mirrored ? "scaleX(-1)" : undefined }}
          >
            <Tree
              data={data}
              // Root always anchors at local x=40 regardless of locale: the
              // outer div's scaleX(-1) mirrors around its own center (default
              // transform-origin), which maps local x -> (width - x) on
              // screen — so x=40 already lands root near the *right* visual
              // edge once mirrored, matching RTL's reading-start-at-right
              // convention, while every deeper generation (which only grows
              // in the positive-x direction from root) stays within
              // [40, width], safely on-canvas after mirroring to
              // [0, width-40]. The previous `width - 40` value was
              // backwards: it put the root near the *left* edge in RTL and,
              // more importantly, pushed every non-root node's local x past
              // roughly width/2, which mirrors to a negative (off-canvas)
              // screen position — every generation past the root was
              // invisible in Arabic as a result.
              translate={{ x: 40, y: dimensions.height / 2 }}
              orientation="horizontal"
              pathFunc="step"
              zoomable
              draggable
              collapsible={false}
              separation={{ siblings: 1.2, nonSiblings: 1.6 }}
              renderCustomNodeElement={(rd3tProps) => <CustomNode {...rd3tProps} mirrored={mirrored} />}
            />
          </div>
        )}
      </Card>

      {!hasDownline && (
        <p className="text-sm text-muted-foreground">{t("noDownlineYetNote")}</p>
      )}
    </div>
  );
}
