import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardHeader, CardContent, CardFooter } from "@/components/ui/card";

export default function PackagesLoading() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-10 lg:px-8">
      <div className="space-y-8">
        <div className="space-y-4 border-b border-border/60 pb-6">
          <div className="space-y-2">
            <Skeleton className="h-9 w-64" />
            <Skeleton className="h-4 w-96 max-w-full" />
          </div>
          <Skeleton className="h-10 w-48 rounded-lg" />
        </div>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="border-border/60 shadow-sm">
              <CardHeader className="pb-2">
                <Skeleton className="h-5 w-24" />
              </CardHeader>
              <CardContent className="flex-1">
                <Skeleton className="h-8 w-32" />
              </CardContent>
              <CardFooter>
                <Skeleton className="h-9 w-full rounded-lg" />
              </CardFooter>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
