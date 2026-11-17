/**
 * The setup agent. Importing this module also loads the built-in loop, which registers itself as the
 * setups service's launcher, so routes that start a setup import from here.
 *
 *   import { setups } from '@/server/setup';
 */
import './loop';

export * as setups from '../services/setups';
export { runSetup, launchSetup } from './loop';
export { SYSTEM_PROMPT } from './prompt';
