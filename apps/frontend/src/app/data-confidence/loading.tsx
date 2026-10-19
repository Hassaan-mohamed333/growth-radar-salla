import { CardListSkeleton, ShellSkeleton, Skeleton, StatCardsSkeleton } from '../skeleton';

export default function Loading() {
  return (
    <ShellSkeleton active="confidence" title="ثقة البيانات">
      <Skeleton className="h-4 w-3/4" />
      <StatCardsSkeleton count={4} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-56 rounded-xl" />
        <Skeleton className="h-56 rounded-xl" />
      </div>
      <CardListSkeleton count={2} />
    </ShellSkeleton>
  );
}
