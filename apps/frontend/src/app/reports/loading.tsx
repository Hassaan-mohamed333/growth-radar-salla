import { CardListSkeleton, ShellSkeleton, StatCardsSkeleton } from '../skeleton';

export default function Loading() {
  return (
    <ShellSkeleton active="reports" title="التقارير">
      <StatCardsSkeleton count={4} />
      <CardListSkeleton count={3} />
    </ShellSkeleton>
  );
}
