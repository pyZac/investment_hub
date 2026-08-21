import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardHeader, CardContent } from "@/components/ui/card";

export default function ReferralsLoading() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-10 lg:px-8">
      <div className="space-y-10">
        <div className="space-y-2 border-b border-border/60 pb-6">
          <Skeleton className="h-9 w-56" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>

        <div className="space-y-4">
          <Skeleton className="h-6 w-40" />
          <Card className="border-border/60 shadow-sm">
            <CardContent className="py-4">
              <Skeleton className="h-10 w-full" />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Skeleton className="h-6 w-40" />
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Card key={i} className="border-border/60 shadow-sm">
                <CardHeader className="pb-2">
                  <Skeleton className="h-5 w-28" />
                </CardHeader>
                <CardContent className="space-y-3">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-24" />
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <Skeleton className="h-6 w-48" />
          <div className="space-y-3">
            {Array.from({ length: 2 }).map((_, i) => (
              <Card key={i} className="border-border/60 shadow-sm">
                <CardContent className="py-4">
                  <Skeleton className="h-10 w-full" />
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
