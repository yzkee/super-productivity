import { Pipe, PipeTransform } from '@angular/core';

interface J2mModule {
  to_markdown(input: string): string;
}

let _j2mPromise: Promise<J2mModule> | undefined;

const _loadJ2m = (): Promise<J2mModule> => {
  if (!_j2mPromise) {
    // @ts-ignore
    _j2mPromise = import('jira2md').then((m: { default: J2mModule }) => m.default);
  }
  return _j2mPromise;
};

@Pipe({ name: 'jiraToMarkdown' })
export class JiraToMarkdownPipe implements PipeTransform {
  transform(value: string): Promise<string> {
    if (!value) {
      return Promise.resolve(value);
    }
    return _loadJ2m().then((j2m) => j2m.to_markdown(value));
  }
}
