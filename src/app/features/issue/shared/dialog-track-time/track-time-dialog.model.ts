import { Task } from '../../../tasks/task.model';
import { Observable } from 'rxjs';
import { IssueProviderKey } from '../../issue.model';

export interface TrackTimeSubmitParams {
  timeSpent: number;
  started: string;
  comment: string;
  activityId?: number;
}

export interface TrackTimeDialogData {
  task: Task;

  // Issue display
  issueIcon: string;
  issueLabel: string;
  issueUrl?: string;

  // Logged time
  timeLogged: number;
  timeLoggedUpdate$?: Observable<number>;

  // Activities (Redmine/OpenProject)
  activities$?: Observable<Array<{ id: number; name: string }>>;

  // Provider config
  issueProviderType: IssueProviderKey;
  configTimeKey: 'worklogDialogDefaultTime' | 'timeTrackingDialogDefaultTime';

  // Submit handling
  onSubmit: (params: TrackTimeSubmitParams) => Observable<unknown>;
  successMsg: string;
  successTranslateParams: Record<string, string>;

  // Provider-specific translation keys (labels that differ per provider)
  t: {
    title: string;
    submitFor: string;
    currentlyLogged?: string;
    submit: string;
  };
}
