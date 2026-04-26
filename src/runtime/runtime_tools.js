/**
 * DEPRECATED: This module is kept for backward compatibility only.
 * 
 * New code should import from '../host_modules/index.js' or '../host_modules/builtin/index.js'.
 * This re-export ensures existing code continues to work during migration.
 * 
 * Migration timeline: This compatibility bridge will be removed in a future major version.
 */

export {
  createRuntimeBuiltinToolProvider,
} from '../host_modules/builtin/index.js'