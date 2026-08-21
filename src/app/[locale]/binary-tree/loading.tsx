import { Skeleton } from "@/components/ui/skeleton";

export default function BinaryTreeLoading() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-10 lg:px-8">
      <div className="space-y-10">
        <div className="space-y-2 border-b border-border/60 pb-6">
          <Skeleton className="h-9 w-56" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>

        <div className="space-y-4">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-[520px] w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}
