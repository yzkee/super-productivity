import type { IValidation } from 'typia';
import { OpLog } from '../../../core/log';
import {
  DataValidationFailedError,
  DecompressError,
  InvalidFilePrefixError,
  InvalidDataSPError,
  JsonParseError,
  ModelValidationError,
} from './sync-errors';

describe('sync errors', () => {
  beforeEach(() => {
    spyOn(OpLog, 'log').and.stub();
    spyOn(OpLog, 'err').and.stub();
  });

  it('logs AdditionalLogErrorBase diagnostics as safe metadata', () => {
    new InvalidDataSPError({
      responseName: 'sync-response',
      status: 400,
      payload: {
        title: 'secret task',
      },
    });

    const logText = JSON.stringify((OpLog.log as jasmine.Spy).calls.allArgs());
    expect(logText).toContain('InvalidDataSPError');
    expect(logText).toContain('responseName');
    expect(logText).toContain('status');
    expect(logText).not.toContain('secret task');
  });

  it('preserves safe InvalidFilePrefixError metadata', () => {
    new InvalidFilePrefixError({
      expectedPrefix: 'pf_',
      endSeparator: '__',
      inputLength: 42,
    });

    const logText = JSON.stringify((OpLog.log as jasmine.Spy).calls.allArgs());
    expect(logText).toContain('InvalidFilePrefixError');
    expect(logText).toContain('inputLength');
  });

  it('does not log raw wrapped error messages from additional log errors', () => {
    new DecompressError(new Error('secret task title'));

    const logText = JSON.stringify((OpLog.log as jasmine.Spy).calls.allArgs());
    expect(logText).toContain('DecompressError');
    expect(logText).toContain('firstAdditionalErrorName');
    expect(logText).not.toContain('secret task title');
  });

  it('does not log JSON parse data samples or raw original errors', () => {
    new JsonParseError(
      new SyntaxError('Unexpected token SECRET at position 6'),
      '{"a":"secret value"}',
    );

    const errText = JSON.stringify((OpLog.err as jasmine.Spy).calls.allArgs());
    expect(errText).toContain('JsonParseError');
    expect(errText).toContain('dataLength');
    expect(errText).not.toContain('SECRET');
    expect(errText).not.toContain('secret value');
  });

  it('logs model validation diagnostics without validation payloads', () => {
    const validationResult = {
      success: false,
      errors: [
        {
          path: '$input.title',
          expected: 'string',
          value: 'secret title',
        },
      ],
    } as unknown as IValidation<unknown>;

    new ModelValidationError({
      id: 'task-id-1',
      data: { title: 'secret title' },
      validationResult,
      e: new Error('secret validation failure'),
    });

    const logText = JSON.stringify((OpLog.log as jasmine.Spy).calls.allArgs());
    expect(logText).toContain('ModelValidationError');
    expect(logText).toContain('task-id-1');
    expect(logText).toContain('validationErrorCount');
    expect(logText).not.toContain('secret title');
    expect(logText).not.toContain('secret validation failure');
  });

  it('logs data validation diagnostics without validation payloads', () => {
    const validationResult = {
      success: false,
      errors: [
        {
          path: '$input.notes',
          expected: 'string',
          value: 'secret note text',
        },
      ],
    } as unknown as IValidation<unknown>;

    new DataValidationFailedError(validationResult);

    const logText = JSON.stringify((OpLog.log as jasmine.Spy).calls.allArgs());
    expect(logText).toContain('DataValidationFailedError');
    expect(logText).toContain('validationErrorCount');
    expect(logText).toContain('$input.notes');
    expect(logText).not.toContain('secret note text');
  });
});
