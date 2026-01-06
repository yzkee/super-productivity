import { AppDataCompleteLegacy } from '../../imex/sync/sync.model';
import { AppDataComplete } from '../../sync/model-config';

export const isDataRepairPossible = (
  data: AppDataCompleteLegacy | AppDataComplete,
): boolean => {
  const d: any = data as any;
  return (
    typeof d === 'object' &&
    d !== null &&
    typeof d.task === 'object' &&
    d.task !== null &&
    typeof d.project === 'object' &&
    d.project !== null
  );
};
