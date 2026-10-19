import { ShellSkeleton, Skeleton, TableSkeleton } from '../skeleton';

export default function Loading() {
  return (
    <ShellSkeleton active="products" title="المنتجات">
      <Skeleton className="h-20 rounded-xl" />
      <TableSkeleton rows={6} cols={5} />
    </ShellSkeleton>
  );
}
