import pkg from '../package.json'

/** Notes' version (package.json is the one place it's set; the desktop build reads it too). */
export const VERSION: string = pkg.version
