// This file can be replaced during build by using the `fileReplacements` array.
// `ng build ---prod` replaces `environment.ts` with `environment.prod.ts`.
// The list of file replacements can be found in `angular.json`.
import pkg from '../../package.json';

export const environment = {
  production: false,
  stage: false,
  version: pkg.version,
};
