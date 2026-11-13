import { CardListSkeleton, ShellSkeleton, StatCardsSkeleton } from '../skeleton';

export default function Loading() {
  return (
    <ShellSkeleton active="health" title="صحة المتجر">
      <StatCardsSkeleton count={4} />
      <CardListSkeleton count={3} />
    </ShellSkeleton>
  );
}
