import { Injectable } from '@angular/core';
import { getDbDateStr } from '../../util/get-db-date-str';

@Injectable({ providedIn: 'root' })
export class DateService {
  startOfNextDayDiff: number = 0;

  setStartOfNextDayDiff(startOfNextDay: number): void {
    this.startOfNextDayDiff = (startOfNextDay || 0) * 60 * 60 * 1000;
  }

  todayStr(date?: Date | number): string {
    if (!date) {
      date = new Date(Date.now() - this.startOfNextDayDiff);
    }
    return getDbDateStr(date);
  }

  isToday(date: number | Date): boolean {
    const timestamp = typeof date === 'number' ? date : date.getTime();
    const d = new Date(timestamp - this.startOfNextDayDiff);
    const today = new Date(Date.now() - this.startOfNextDayDiff);
    return (
      d.getDate() === today.getDate() &&
      d.getMonth() === today.getMonth() &&
      d.getFullYear() === today.getFullYear()
    );
  }
}
