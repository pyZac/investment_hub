import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardHeader, CardContent, CardFooter } from "@/components/ui/card";

export default function InvestmentsLoading() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-10 lg:px-8">
      <div className="space-y-8">
        <div className="space-y-2 border-b border-border/60 pb-6">
          <Skeleton className="h-9 w-56" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="border-border/60 shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                <Skeleton className="h-5 w-20" />
                <Skeleton className="h-5 w-14 rounded-full" />
              </CardHeader>
              <CardContent className="flex-1 space-y-3">
                <Skeleton className="h-8 w-28" />
                <Skeleton className="h-3 w-32" />
              </CardContent>
              <CardFooter className="flex flex-col items-stretch gap-2 border-t border-border/60 pt-3">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
              </CardFooter>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
