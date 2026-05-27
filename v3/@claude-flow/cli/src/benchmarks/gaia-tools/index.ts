/**
 * gaia-tools barrel — ADR-133-PR2/PR4
 *
 * Exports all tool implementations + shared types so that gaia-agent.ts
 * (PR-3) and future tools (PR-5: web_browse) can import from a single
 * entry point.
 *
 * Refs: ADR-133, #2156
 */

export * from './types.js';
export * from './web_search.js';
export * from './file_read.js';
export * from './python_exec.js';

import { createWebSearchTool } from './web_search.js';
import { createFileReadTool } from './file_read.js';
import { createPythonExecTool, type PythonExecToolOptions } from './python_exec.js';
import type { GaiaToolCatalogue } from './types.js';

export interface GaiaToolCatalogueOptions {
  pythonExec?: PythonExecToolOptions;
}

/**
 * Returns the default tool catalogue for a GAIA Level-1 run.
 *
 * PR-2 catalogue: web_search + file_read
 * PR-4 catalogue: + python_exec (local Python 3 subprocess — see python_exec.ts security model)
 * PR-5 will add: web_browse, image_describe
 */
export function createDefaultToolCatalogue(opts?: GaiaToolCatalogueOptions): GaiaToolCatalogue {
  return [
    createWebSearchTool(),
    createFileReadTool(),
    createPythonExecTool(opts?.pythonExec),
  ];
}
