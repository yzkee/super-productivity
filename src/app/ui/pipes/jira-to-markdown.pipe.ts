import { Pipe, PipeTransform } from '@angular/core';

let _j2mPromise: Promise<any> | undefined;

const _loadJ2m = (): Promise<any> => {
  if (!_j2mPromise) {
    // @ts-ignore
    _j2mPromise = import('jira2md').then((m: { default: unknown }) => m.default);
  }
  return _j2mPromise;
};

@Pipe({ name: 'jiraToMarkdown' })
export class JiraToMarkdownPipe implements PipeTransform {
  transform(value: string): Promise<string> {
    if (!value) {
      return Promise.resolve(value);
    }
    return _loadJ2m().then((j2m: any) => j2m.to_markdown(value));
  }
}
