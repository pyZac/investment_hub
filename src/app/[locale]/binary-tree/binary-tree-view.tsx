"use client";

import { useMemo, useRef, useState, useLayoutEffect } from "react";
import Tree, { type CustomNodeElementProps, type RawNodeDatum } from "react-d3-tree";
import { useTranslations } from "next-intl";
import { Network } from "lucide-react";
import type { SubtreeNode } from "@/lib/binary-tree";

type NodeAttributes = {
  position: "LEFT" | "RIGHT" | "ROOT";
};

/**
 * Converts the server-fetched subtree (a plain nested object, LEFT/RIGHT
 * position read directly from binary_nodes.position) into react-d3-tree's
 * own RawNodeDatum shape. The `position` attribute here is copied verbatim
 * from the source data — never inferred from array order, recursion order,
 * or anything about how react-d3-tree lays the node out visually.
 */
function toRawNodeDatum(node: SubtreeNode, isRoot: boolean): RawNodeDatum {
  return {
    name: node.name,
    attributes: { position: isRoot ? "ROOT" : (node.position ?? "ROOT") } satisfies NodeAttributes,
    children: node.children.map((child) => toRawNodeDatum(child, false)),
  };
}

function CustomNode({ nodeDatum, mirrored }: CustomNodeElementProps & { mirrored: boolean }) {
  const position = (nodeDatum.attributes?.position as NodeAttributes["position"] | undefined) ?? "ROOT";

  const badgeColor =
    position === "LEFT"
      ? "var(--color-primary)"
      : position === "RIGHT"
        ? "oklch(0.55 0.15 25)" // a distinct accent from primary, consistent regardless of locale
        : "var(--color-muted-foreground)";

  return (
    <g>
      <circle r={10} fill="var(--color-card)" stroke="var(--color-border)" strokeWidth={1.5} />
      {/* Counter-flip the text/label group so it reads correctly even when the
          whole SVG container is mirrored for RTL — this is a pixel-level
          correction only, the underlying `position` value above is untouched. */}
      <g transform={mirrored ? "scale(-1, 1)" : undefined}>
        <foreignObject x={-70} y={16} width={140} height={54}>
          <div className="flex flex-col items-center gap-1 text-center" style={{ direction: "ltr" }}>
            <span className="truncate text-xs font-medium" style={{ color: "var(--color-foreground)" }}>
              {nodeDatum.name}
            </span>
            {position !== "ROOT" && (
              <span
                className="rounded-full px-2 py-0.5 text-[10px] font-semibold text-white"
                style={{ backgroundColor: badgeColor }}
              >
                {position}
              </span>
            )}
          </div>
        </foreignObject>
      </g>
    </g>
  );
}

export function BinaryTreeView({ subtree, locale }: { subtree: SubtreeNode | null; locale: string }) {
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
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border py-14 text-center">
        <Network className="size-10 text-muted-foreground/60" aria-hidden="true" />
        <div className="space-y-1">
          <p className="text-base font-medium">{t("emptyStateTitle")}</p>
          <p className="max-w-sm text-sm text-muted-foreground">{t("emptyStateDescription")}</p>
        </div>
      </div>
    );
  }

  const hasDownline = subtree.children.length > 0;

  return (
    <div className="space-y-4">
      <div
        ref={containerRef}
        className="h-[520px] w-full overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm"
      >
        {dimensions.width > 0 && (
          <div
            className="h-full w-full"
            style={{ transform: mirrored ? "scaleX(-1)" : undefined }}
          >
            <Tree
              data={data}
              translate={{ x: mirrored ? dimensions.width - 40 : 40, y: dimensions.height / 2 }}
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
      </div>

      {!hasDownline && (
        <p className="text-sm text-muted-foreground">{t("noDownlineYetNote")}</p>
      )}
    </div>
  );
}
